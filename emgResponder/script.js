import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
  orderBy,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import {
  getDatabase,
  ref,
  onValue,
  update,
  set,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

import { firebaseConfig } from "../firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const rtdb = getDatabase(app);
const auth = getAuth(app);

// --- Element Selectors ---
const mainContent = document.querySelector("main");
const activeEVsCountElement = document.getElementById("active-ev-count");
const activeAmbulanceCountElement = document.getElementById(
  "active-ambulance-count"
);
const activeAlertsCount = document.getElementById("active-alerts-count");
const alertsFeed = document.getElementById("alerts-feed");
const vehicleControls = document.getElementById("vehicle-controls");
const logoutBtn = document.getElementById("logoutBtn-emergency");
const simulateAmbulanceBtn = document.getElementById("simulateAmbulanceBtn");
const sosAlertCard = document.getElementById("sos-alert-card");
const sosUser = document.getElementById("sos-user");
const sosReg = document.getElementById("sos-reg");
const sosSeverity = document.getElementById("sos-severity");
const sosTrigger = document.getElementById("sos-trigger");
const clearSosBtn = document.getElementById("clearSosBtn");
const dispatchSingleBtn = document.getElementById("dispatchSingleBtn");
const dispatchModal = document.getElementById("dispatch-modal");
const dispatchSuggestionsEl = document.getElementById("dispatch-suggestions");

// --- State Variables ---
let map,
  routingControls = {},
  sosAlerts = {},
  ambulanceFleet = [],
  sosMarkers = {},
  ambulanceMarkers = {},
  selectedSosAlert = null,
  simulatedAmbulanceInterval = null;

// --- Authentication and Initialization ---
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists() && userDoc.data().userType === "emergency") {
      mainContent.style.display = "grid";
      initializeDashboard();
    } else {
      window.location.href = "index.html";
    }
  } else {
    window.location.href = "index.html";
  }
});

function initializeDashboard() {
  map = L.map("map").setView([12.9716, 77.5946], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
  setupFirestoreListeners();
  setupRTDBListeners();
}

// --- Data Listeners ---
function setupFirestoreListeners() {
  onSnapshot(
    query(collection(db, "users"), where("userType", "==", "ev")),
    (snapshot) => {
      activeEVsCountElement.textContent = snapshot.size;
    }
  );
  onSnapshot(
    query(collection(db, "messages"), orderBy("timestamp", "desc")),
    (snapshot) => {
      alertsFeed.innerHTML = "";
      snapshot.forEach((doc) =>
        alertsFeed.appendChild(createAlertElement(doc.data()))
      );
    }
  );
  onSnapshot(
    query(collection(db, "sos_alerts"), where("status", "==", "active")),
    (snapshot) => {
      const currentActiveAlerts = {};
      snapshot.forEach(
        (doc) => (currentActiveAlerts[doc.id] = { id: doc.id, ...doc.data() })
      );
      sosAlerts = currentActiveAlerts;
      activeAlertsCount.textContent = Object.keys(sosAlerts).length;
      handleAlertsUpdate();
    }
  );
}

function setupRTDBListeners() {
  onValue(ref(rtdb, "ambulances"), (snapshot) => {
    const data = snapshot.val() || {};
    ambulanceFleet = Object.values(data);
    activeAmbulanceCountElement.textContent = ambulanceFleet.length;
    updateAmbulanceMarkers(data);
    updateVehicleControls(data);

    // Regenerate suggestions if ambulance availability changes
    if (Object.keys(sosAlerts).length >= 2) {
      generateDispatchSuggestions();
    }
  });
}

// --- JavaScript AI Severity Logic ---
function getAccidentSeverityJS(vehicleData) {
  if (!vehicleData) return "Medium";
  const { g_force, delta_v, airbags_deployed, rollover_detected } = vehicleData;
  let score = 0;
  if (g_force > 4.5) score += 4;
  else if (g_force > 2.5) score += 2;
  if (delta_v > 40) score += 3;
  else if (delta_v > 20) score += 1;
  if (airbags_deployed) score += 3;
  if (rollover_detected) score += 5;
  if (score >= 7) return "High";
  if (score >= 4) return "Medium";
  return "Low";
}

// --- Core Dispatch Logic ---
function handleAlertsUpdate() {
  updateSOSMarkersOnMap();
  const activeAlerts = Object.values(sosAlerts);

  if (activeAlerts.length === 0) {
    sosAlertCard.classList.add("hidden");
    updateDispatchSuggestionsUI([]);
  } else if (activeAlerts.length === 1) {
    showPriorityAlert("Single incident detected. Manual dispatch.", "bg-blue-600");
    displaySingleSOSCard(activeAlerts[0]);
    updateDispatchSuggestionsUI([]);
  } else {
    sosAlertCard.classList.add("hidden");
    showPriorityAlert(
      `Multiple incidents (${activeAlerts.length})! AI suggestions generated.`,
      "bg-orange-500"
    );
    generateDispatchSuggestions();
  }
}

function displaySingleSOSCard(alert) {
  const severity = getAccidentSeverityJS(alert.vehicleData);
  sosUser.textContent = alert.senderInfo.username;
  sosReg.textContent = alert.senderInfo.regNumber;
  sosSeverity.textContent = severity;
  sosTrigger.textContent = alert.triggerMethod;
  sosAlertCard.dataset.sosId = alert.id;
  sosAlertCard.classList.remove("hidden");
}

function generateDispatchSuggestions() {
  let availableAmbulances = ambulanceFleet.filter(
    (a) => a.status === "available"
  );
  let unassignedAlerts = Object.values(sosAlerts)
    .map((alert) => ({
      ...alert,
      severity: getAccidentSeverityJS(alert.vehicleData),
    }))
    .sort(compareSeverity);

  const suggestions = [];

  for (const alert of unassignedAlerts) {
    if (availableAmbulances.length === 0) break;

    const closestAmbulance = findClosestAmbulance(
      alert,
      availableAmbulances
    );
    if (closestAmbulance) {
      suggestions.push({
        alert,
        ambulance: closestAmbulance,
        distance: (closestAmbulance.distance / 1000).toFixed(2),
      });
      availableAmbulances = availableAmbulances.filter(
        (a) => a.id !== closestAmbulance.id
      );
    }
  }
  updateDispatchSuggestionsUI(suggestions);
}

async function dispatchAmbulance(sosId, ambulanceId) {
  const sosRef = doc(db, "sos_alerts", sosId);
  await updateDoc(sosRef, {
    status: "dispatched",
    dispatchedAmbulanceId: ambulanceId,
  });

  const updates = {};
  updates[`/ambulances/${ambulanceId}/status`] = "en-route";
  updates[`/ambulances/${ambulanceId}/destination`] =
    sosAlerts[sosId].location;
  await update(ref(rtdb), updates);

  const alert = Object.values(sosAlerts).find((a) => a.id === sosId);
  const ambulance = ambulanceFleet.find((a) => a.id === ambulanceId);
  if (alert && ambulance && ambulance.location)
    createRoute(alert, ambulance);
}

// --- UI and Map Update Functions ---
function updateDispatchSuggestionsUI(suggestions) {
  dispatchSuggestionsEl.innerHTML = "";
  if (suggestions.length === 0) {
    dispatchSuggestionsEl.innerHTML =
      '<p class="text-gray-500">No suggestions available. Ensure ambulances are simulated and available.</p>';
    return;
  }
  suggestions.forEach((suggestion) => {
    const suggestionEl = document.createElement("div");
    suggestionEl.className = "p-3 border rounded-lg bg-gray-50";
    suggestionEl.innerHTML = `
                  <p class="font-bold text-blue-700">Dispatch <span class="text-black">${suggestion.ambulance.id}</span></p>
                  <p>to <span class="font-semibold">${suggestion.alert.senderInfo.username}</span></p>
                  <div class="text-sm text-gray-600 mt-1">
                      <span>Severity: ${suggestion.alert.severity}</span> | 
                      <span>Dist: ${suggestion.distance} km</span>
                  </div>
                  <button onclick="window.confirmSuggestionDispatch('${suggestion.alert.id}', '${suggestion.ambulance.id}')" 
                          class="w-full mt-2 bg-green-600 text-white font-semibold py-1 rounded hover:bg-green-700">
                      Confirm & Dispatch
                  </button>
              `;
    dispatchSuggestionsEl.appendChild(suggestionEl);
  });
}

function updateSOSMarkersOnMap() {
  Object.keys(sosMarkers).forEach((id) => {
    if (!sosAlerts[id]) {
      map.removeLayer(sosMarkers[id]);
      delete sosMarkers[id];
    }
  });
  Object.values(sosAlerts).forEach((alert) => {
    const severity = getAccidentSeverityJS(alert.vehicleData);
    const icon = L.divIcon({
      className: "custom-div-icon",
      html: `<div class="p-2 rounded-full bg-${
        severity === "High" ? "red" : "orange"
      }-600 border-2 border-white shadow-lg blinking"><i class="fas fa-car-crash text-white"></i></div>`,
      iconSize: [30, 30],
    });
    if (!sosMarkers[alert.id]) {
      sosMarkers[alert.id] = L.marker(
        [alert.location.lat, alert.location.lng],
        { icon }
      )
        .addTo(map)
        .bindPopup(
          `<b>SOS: ${alert.senderInfo.username}</b><br>Severity: ${severity}`
        );
    }
  });
}

function updateAmbulanceMarkers(ambulances) {
  Object.keys(ambulanceMarkers).forEach((id) =>
    map.removeLayer(ambulanceMarkers[id])
  );
  ambulanceMarkers = {};
  if (!ambulances) return;
  Object.keys(ambulances).forEach((id) => {
    const ambulance = ambulances[id];
    if (ambulance.location) {
      const icon = L.divIcon({
        className: "custom-div-icon",
        html: `<div class="p-2 rounded-full bg-blue-600 border-2 border-white shadow-lg"><i class="fas fa-ambulance text-white"></i></div>`,
        iconSize: [30, 30],
      });
      ambulanceMarkers[id] = L.marker(
        [ambulance.location.lat, ambulance.location.lng],
        { icon }
      )
        .addTo(map)
        .bindPopup(
          `<b>Ambulance ${id}</b><br>Status: ${ambulance.status}`
        );
    }
  });
}

function updateVehicleControls(ambulances) {
  vehicleControls.innerHTML = "";
  if (!ambulances || Object.keys(ambulances).length === 0) {
    vehicleControls.innerHTML =
      '<p class="text-gray-500">No active ambulances.</p>';
    return;
  }
  Object.keys(ambulances).forEach((id) => {
    const ambulance = ambulances[id];
    const controlDiv = document.createElement("div");
    controlDiv.className = "p-2 border rounded-lg bg-gray-50";
    controlDiv.innerHTML = `<p class="font-semibold">Ambulance ${id}</p><p class="text-sm text-gray-600">Status: ${
      ambulance.status || "Active"
    }</p>`;
    vehicleControls.appendChild(controlDiv);
  });
}

function createRoute(alert, ambulance) {
  if (routingControls[ambulance.id])
    map.removeControl(routingControls[ambulance.id]);
  routingControls[ambulance.id] = L.Routing.control({
    waypoints: [
      L.latLng(ambulance.location.lat, ambulance.location.lng),
      L.latLng(alert.location.lat, alert.location.lng),
    ],
    createMarker: () => null,
    lineOptions: { styles: [{ color: "blue", opacity: 0.7, weight: 5 }] },
  }).addTo(map);
}

// --- Event Listeners and Helper Functions ---
dispatchSingleBtn.addEventListener("click", () => {
  const sosId = sosAlertCard.dataset.sosId;
  if (sosId) showDispatchModal(sosId);
});

clearSosBtn.addEventListener("click", async () => {
  const sosId = sosAlertCard.dataset.sosId;
  if (sosId) {
    await updateDoc(doc(db, "sos_alerts", sosId), { status: "resolved" });
    sosAlertCard.classList.add("hidden");
  }
});

document
  .getElementById("confirmDispatchBtn")
  .addEventListener("click", async () => {
    const selectedAmbulanceId = document.querySelector(
      'input[name="ambulance"]:checked'
    )?.value;
    if (selectedSosAlert && selectedAmbulanceId) {
      await dispatchAmbulance(selectedSosAlert.id, selectedAmbulanceId);
    }
    closeDispatchModal();
  });

document
  .getElementById("cancelDispatchBtn")
  .addEventListener("click", closeDispatchModal);

window.confirmSuggestionDispatch = (sosId, ambulanceId) => {
  dispatchAmbulance(sosId, ambulanceId);
};

function showDispatchModal(sosId) {
  selectedSosAlert = sosAlerts[sosId];
  const dispatchOptions = document.getElementById("dispatch-options");
  const availableAmbulances = ambulanceFleet.filter(
    (a) => a.status === "available"
  );

  if (availableAmbulances.length === 0) {
    dispatchOptions.innerHTML = "<p>No available ambulances.</p>";
  } else {
    const sortedAmbulances = availableAmbulances
      .map((amb) => ({
        ...amb,
        distance:
          L.latLng(
            selectedSosAlert.location.lat,
            selectedSosAlert.location.lng
          ).distanceTo(L.latLng(amb.location.lat, amb.location.lng)) / 1000,
      }))
      .sort((a, b) => a.distance - b.distance);

    dispatchOptions.innerHTML = sortedAmbulances
      .map(
        (amb, i) => `
              <label class="flex items-center p-2 border rounded cursor-pointer">
                  <input type="radio" name="ambulance" value="${
                    amb.id
                  }" class="mr-3" ${i === 0 ? "checked" : ""}>
                  <span>${amb.id} (${amb.distance.toFixed(2)} km away)</span>
              </label>
          `
      )
      .join("");
  }
  dispatchModal.classList.remove("hidden");
}

function closeDispatchModal() {
  dispatchModal.classList.add("hidden");
  selectedSosAlert = null;
}

function findClosestAmbulance(alert, ambulances) {
  if (ambulances.length === 0) return null;
  return ambulances
    .map((amb) => ({
      ...amb,
      distance: L.latLng(
        alert.location.lat,
        alert.location.lng
      ).distanceTo(L.latLng(amb.location.lat, amb.location.lng)),
    }))
    .sort((a, b) => a.distance - b.distance)[0];
}

function compareSeverity(a, b) {
  const severities = { High: 3, Medium: 2, Low: 1 };
  return (severities[b.severity] || 0) - (severities[a.severity] || 0);
}

function showPriorityAlert(message, className) {
  const alertBox = document.getElementById("priority-alert");
  alertBox.textContent = message;
  alertBox.className = `priority-alert ${className}`;
  alertBox.style.display = "block";
  setTimeout(() => (alertBox.style.display = "none"), 4000);
}

function createAlertElement(data) {
  const el = document.createElement("div");
  el.className = "flex items-start gap-3 p-2 border-b";
  el.innerHTML = `<div><i class="fas fa-comment-dots text-purple-500 text-2xl"></i></div>
                      <div>
                          <p class="font-semibold">${data.senderInfo.username}</p>
                          <p class="text-sm">${data.payload.message}</p>
                      </div>`;
  return el;
}

// --- Simulation and Logout ---
simulateAmbulanceBtn.addEventListener("click", () => {
  const ambulanceId = `AMB-${Math.floor(Math.random() * 900) + 100}`;
  set(ref(rtdb, `ambulances/${ambulanceId}`), {
    id: ambulanceId,
    location: {
      lat: 12.9716 + (Math.random() - 0.5) * 0.1,
      lng: 77.5946 + (Math.random() - 0.5) * 0.1,
    },
    status: "available",
    type: "Advanced Life Support",
  });
});

logoutBtn.addEventListener("click", () => signOut(auth));