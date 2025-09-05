import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy,
  limit,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import {
  getDatabase,
  ref,
  onValue,
  set,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

import { firebaseConfig } from '../firebase-config.js'; 

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const rtdb = getDatabase(app);
const auth = getAuth(app);

let currentUser = null;
let map = null;
let userMarkers = {};
let chargingMarkers = null;
let routingControl = null;
let trafficLayer = null;
let messageQueue = [];
let trafficSignalMarkers = {};
let sosSent = false;
let countdownInterval;
const COUNTDOWN_SECONDS = 15;
let sosListenerUnsubscribe = null;
let ambulanceMarker = null;
let ambulanceRoutingControl = null;
let colorInterval = null;
let userMarker = null;
let cocoModel = null;
let currentAnalysisResults = null;
let aiCountdownInterval = null;
let pendingAISOS = null;
let greenCorridorRoute = null;
let greenCorridorNotification = null;

const mainContainer = document.getElementById("main-container");
const registrationInfo = document.getElementById("registration-info");
const logoutBtn = document.getElementById("logoutBtn");
const messageBox = document.getElementById("message-box");
const chargingBtn = document.getElementById("chargingBtn");
const emergencyBtn = document.getElementById("emergencyBtn");
const toggleTrafficBtn = document.getElementById("toggleTrafficBtn");
const closeNavigationBtn = document.getElementById("close-navigation-btn");

// New selectors for inline SOS view
const mapView = document.getElementById("map-view");
const inlineSosView = document.getElementById("inline-sos-view");
const backToMapBtn = document.getElementById("back-to-map-btn");
const sosButtonInline = document.getElementById("sos-button-inline");
const sosStatusInline = document.getElementById("sos-status-inline");
const batteryLevelInline = document.getElementById("battery-level-inline");
const passengerCountInline = document.getElementById("passenger-count-inline");
const driverVitalsInline = document.getElementById("driver-vitals-inline");

const sosConfirmModal = document.getElementById("sos-confirm-modal");
const confirmSosButton = document.getElementById("confirm-sos-button");
const cancelSosButton = document.getElementById("cancel-sos-button");
const countdownTimerEl = document.getElementById("countdown-timer");
const countdownCircle = document.getElementById("countdown-circle");
const trafficSignalGrid = document.getElementById("traffic-signal-grid");

const createIcon = (iconClass, color) =>
  L.divIcon({
    html: `<i class="${iconClass} text-3xl" style="color: ${color}; text-shadow: 0 0 3px #000;"></i>`,
    className: "leaflet-div-icon",
    iconSize: [30, 30],
    iconAnchor: [15, 30],
  });
const icons = {
  you: createIcon("fa-solid fa-circle-user", "#2563eb"),
  ev: createIcon("fa-solid fa-car", "#16a34a"),
  emergency: createIcon("fa-solid fa-truck-medical", "#dc2626"),
};

const chargingStations = [
  {
    id: 1,
    name: "Jayanagar Charging Hub",
    location: { lat: 12.9298, lng: 77.5845 },
    total_ports: 6,
    working_ports: 5,
    current_vehicles: 4,
    isRecommended: true,
    type: "Fast Charger",
  },
  {
    id: 2,
    name: "Koramangala EV Point",
    location: { lat: 12.9333, lng: 77.6258 },
    total_ports: 8,
    working_ports: 7,
    current_vehicles: 9,
    isRecommended: false,
    type: "Standard Charger",
  },
  {
    id: 3,
    name: "Marathahalli Charging Station",
    location: { lat: 12.9557, lng: 77.6974 },
    total_ports: 4,
    working_ports: 4,
    current_vehicles: 3,
    isRecommended: true,
    type: "Fast Charger",
  },
  {
    id: 4,
    name: "Indiranagar Battery Bay",
    location: { lat: 12.9782, lng: 77.6402 },
    total_ports: 10,
    working_ports: 8,
    current_vehicles: 12,
    isRecommended: false,
    type: "Standard Charger",
  },
  {
    id: 5,
    name: "Hebbal Charging Hub",
    location: { lat: 13.0371, lng: 77.5925 },
    total_ports: 5,
    working_ports: 5,
    current_vehicles: 2,
    isRecommended: true,
    type: "Fast Charger",
  },
];

const showMessage = (message) => {
  messageBox.textContent = message;
  messageBox.style.display = "block";
  void messageBox.offsetWidth;
  messageBox.style.animation = "fadeinout 4s forwards";
};

onAuthStateChanged(auth, async (user) => {
  if (user) {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists() && userDoc.data().userType === "ev") {
      currentUser = { uid: user.uid, ...userDoc.data() };
      getGeolocationAndStartDashboard();
    } else {
      window.location.href = "index.html";
    }
  } else {
    window.location.href = "index.html";
  }
});

const getGeolocationAndStartDashboard = () => {
  navigator.geolocation.getCurrentPosition(
    (position) => {
      currentUser.location = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      startDashboard();
      updateUserLocationInFirestore();
    },
    () => {
      currentUser.location = { lat: 12.9716, lng: 77.5946 };
      startDashboard();
    },
    { enableHighAccuracy: true }
  );
};

const startDashboard = () => {
  mainContainer.style.visibility = "visible";
  registrationInfo.querySelector("p:first-child").textContent =
    currentUser.username;
  registrationInfo.querySelector("p:last-child").textContent =
    currentUser.regNumber;
  map = L.map("mapid").setView(currentUser.location, 14);
  L.tileLayer("https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}", {
    maxZoom: 20,
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
  }).addTo(map);
  chargingMarkers = L.featureGroup().addTo(map);
  listenForUserUpdates();
  listenForMessages();
  initializeSOSSystem();
  listenForTrafficSignalUpdates();
  initializeAIAnalysis();
  listenForGreenCorridorNotifications();

  const activeSosId = sessionStorage.getItem("activeSosId");
  if (activeSosId) {
    listenForSOSUpdates(activeSosId);
  }
};

const listenForUserUpdates = () => {
  onSnapshot(collection(db, "users"), (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      const userData = change.doc.data();
      const userId = change.doc.id;
      if (!userData.location) return;

      if (change.type === "added" || change.type === "modified") {
        if (userMarkers[userId]) {
          userMarkers[userId].setLatLng(userData.location);
        } else {
          let icon =
            userId === currentUser.uid
              ? icons.you
              : userData.userType === "emergency"
              ? icons.emergency
              : icons.ev;
          const marker = L.marker(userData.location, { icon })
            .addTo(map)
            .bindPopup(
              `<b>${userData.username}</b><br>${userData.regNumber || "N/A"}`
            );
          if (userId === currentUser.uid) {
            userMarker = marker;
          }
          if (userId !== currentUser.uid && userData.userType === "ev") {
            marker.on("click", () => {
              if (confirm(`Do you want to navigate to ${userData.username}?`)) {
                if (routingControl) {
                  map.removeControl(routingControl);
                }
                routingControl = L.Routing.control({
                  waypoints: [
                    L.latLng(currentUser.location.lat, currentUser.location.lng),
                    L.latLng(userData.location.lat, userData.location.lng),
                  ],
                  routeWhileDragging: true,
                  lineOptions: {
                    styles: [{ color: "green", opacity: 0.8, weight: 6 }],
                  },
                }).addTo(map);
                closeNavigationBtn.classList.remove("hidden");
              }
            });
          }
          userMarkers[userId] = marker;
        }
      } else if (change.type === "removed") {
        if (userMarkers[userId]) {
          map.removeLayer(userMarkers[userId]);
          delete userMarkers[userId];
        }
      }
    });
  });
};

const listenForMessages = () => {
  const q = query(
    collection(db, "messages"),
    orderBy("timestamp", "desc"),
    limit(10)
  );
  const feedContainer = document.getElementById("live-feed-messages");

  onSnapshot(q, (snapshot) => {
    feedContainer.innerHTML = "";

    snapshot.docs.forEach((doc) => {
      const message = doc.data();
      const color =
        message.type === "hazard"
          ? "border-orange-500"
          : "border-purple-500";
      const timestamp = message.timestamp
        ? new Date(message.timestamp.seconds * 1000).toLocaleTimeString()
        : "";
      const messageEl = document.createElement("div");
      messageEl.className = `live-feed-message p-2 text-sm rounded ${color}`;
      messageEl.innerHTML = `<div class="flex justify-between items-center"><p class="font-bold text-gray-800">${message.senderInfo.username}</p><p class="text-xs text-gray-500">${timestamp}</p></div><p class="text-gray-600">${message.payload.message}</p>`;
      feedContainer.appendChild(messageEl);
    });
  });
};

const updateUserLocationInFirestore = async () => {
  if (!currentUser?.uid || !currentUser.location) return;
  await setDoc(
    doc(db, "users", currentUser.uid),
    { location: currentUser.location, lastUpdated: serverTimestamp() },
    { merge: true }
  );
};

const sendMessage = async (type, payload) => {
  if (!currentUser?.location) return;
  try {
    await addDoc(collection(db, "messages"), {
      type,
      payload,
      senderId: currentUser.uid,
      senderInfo: {
        username: currentUser.username,
        regNumber: currentUser.regNumber,
      },
      location: currentUser.location,
      timestamp: serverTimestamp(),
    });
  } catch (e) {
    console.error("Error sending message: ", e);
  }
};

const toggleChargingPorts = () => {
  if (chargingMarkers.getLayers().length > 0) {
    chargingMarkers.clearLayers();
    chargingBtn.classList.remove("bg-sky-700");
    chargingBtn.classList.add("bg-sky-500");
  } else {
    chargingStations.forEach((station) => {
      let avgSessionTime = 30;
      let extra = Math.max(
        0,
        station.current_vehicles - station.working_ports
      );
      let waitTime = extra * avgSessionTime;
      let crowd = extra === 0 ? "Low" : extra < 3 ? "Medium" : "High";

      const markerColorClass = station.isRecommended
        ? "recommended-marker"
        : "";
      const markerHTML = `<div class="charging-marker ${markerColorClass}">⚡</div>`;
      const customIcon = L.divIcon({
        className: "custom-div-icon",
        html: markerHTML,
        iconAnchor: [17.5, 17.5],
      });

      const marker = L.marker(
        [station.location.lat, station.location.lng],
        { icon: customIcon }
      )
        .addTo(chargingMarkers)
        .on("click", () => {
          if (confirm(`Do you want to navigate to ${station.name}?`)) {
            if (routingControl) {
              map.removeControl(routingControl);
            }
            routingControl = L.Routing.control({
              waypoints: [
                L.latLng(currentUser.location.lat, currentUser.location.lng),
                L.latLng(station.location.lat, station.location.lng),
              ],
              routeWhileDragging: true,
              lineOptions: {
                styles: [{ color: "green", opacity: 0.8, weight: 6 }],
              },
            }).addTo(map);
            closeNavigationBtn.classList.remove("hidden");
          }
        });

      const popupContent = `
<div class="p-2">
  <strong class="text-lg">${station.name}</strong>
  <p class="text-sm">Type: ${station.type}</p>
  <p class="text-sm">Working Ports: ${station.working_ports}/${
        station.total_ports
      }</p>
  <p class="text-sm">Vehicles: ${station.current_vehicles}</p>
  <p class="text-sm">Predicted Wait: <span class="font-bold">${waitTime} min</span></p>
  <p class="text-sm">Crowd: <span class="${
    crowd === "High"
      ? "text-red-500"
      : crowd === "Medium"
      ? "text-yellow-500"
      : "text-green-500"
  }">${crowd}</span></p>
  ${
    station.isRecommended
      ? '<p class="text-sm text-green-600">⭐ Recommended Station ⭐</p>'
      : ""
  }
</div>`;
      marker.bindPopup(popupContent);

      marker.on("mouseover", function () {
        this.openPopup();
      });
      marker.on("mouseout", function () {
        this.closePopup();
      });
    });

    chargingBtn.classList.remove("bg-sky-500");
    chargingBtn.classList.add("bg-sky-700");
  }
};

function initializeSOSSystem() {
  updateVehicleData();
  setInterval(updateVehicleData, 5000);
  emergencyBtn.addEventListener("click", showInlineSOSView);
  sosButtonInline.addEventListener("click", () => sendSOS("Manual"));
  confirmSosButton.addEventListener("click", () =>
    sendSOS("Automatic (Confirmed)")
  );
  cancelSosButton.addEventListener("click", hideConfirmModal);
  backToMapBtn.addEventListener("click", hideInlineSOSView);
}

async function sendSOS(triggerMethod) {
  if (sosSent) return;
  sosSent = true;

  sosButtonInline.disabled = true;
  sosButtonInline.classList.remove("hover:bg-red-700", "hover:scale-105");
  sosButtonInline.classList.add("bg-gray-500", "cursor-not-allowed");
  sosButtonInline.style.animation = "none";
  hideConfirmModal();

  try {
    const location = await getCurrentLocation();

    const sosData = {
      status: "active",
      senderId: currentUser.uid,
      senderInfo: {
        username: currentUser.username,
        regNumber: currentUser.regNumber,
      },
      vehicleData: {
        battery: parseInt(batteryLevelInline.textContent),
        passengers: parseInt(passengerCountInline.textContent),
        vitals: parseInt(driverVitalsInline.textContent),
      },
      location: location,
      triggerMethod: triggerMethod,
      timestamp: serverTimestamp(),
    };

    const sosDocRef = await addDoc(collection(db, "sos_alerts"), sosData);
    sosStatusInline.textContent =
      "SOS Signal Sent! Waiting for dispatch...";
    listenForSOSUpdates(sosDocRef.id);
    sessionStorage.setItem("activeSosId", sosDocRef.id);
  } catch (error) {
    console.error("Error sending SOS:", error);
    sosStatusInline.textContent = "Error sending SOS. Please try again.";
    sosSent = false;
    sosButtonInline.disabled = false;
    sosButtonInline.classList.add("hover:bg-red-700", "hover:scale-105");
    sosButtonInline.classList.remove("bg-gray-500", "cursor-not-allowed");
  }
}

function listenForSOSUpdates(sosId) {
  const sosDocRef = doc(db, "sos_alerts", sosId);
  sosListenerUnsubscribe = onSnapshot(sosDocRef, (doc) => {
    if (doc.exists()) {
      const data = doc.data();
      if (data.status === "dispatched" && data.dispatchedAmbulanceId) {
        hideInlineSOSView();
        const trackingCard = document.getElementById(
          "ambulance-tracking-card"
        );
        trackingCard.classList.remove("hidden");
        document.getElementById("ambulance-id").textContent =
          data.dispatchedAmbulanceId;
        trackAmbulanceOnMap(data.dispatchedAmbulanceId);
      } else if (data.status === "resolved") {
        hideInlineSOSView();
        document
          .getElementById("ambulance-tracking-card")
          .classList.add("hidden");
        if (ambulanceMarker) map.removeLayer(ambulanceMarker);
        if (ambulanceRoutingControl) {
          map.removeControl(ambulanceRoutingControl);
          ambulanceRoutingControl = null;
        }
        if (colorInterval) {
          clearInterval(colorInterval);
          colorInterval = null;
        }
        if (sosListenerUnsubscribe) {
          sosListenerUnsubscribe();
        }
      }
    }
  });
}

function trackAmbulanceOnMap(ambulanceId) {
  const ambulanceRef = ref(rtdb, "ambulances/" + ambulanceId);
  const icon = L.divIcon({
    className: "custom-div-icon",
    html: `<div class="p-2 rounded-full bg-red-600 border-2 border-white shadow-lg"><i class="fas fa-truck-medical text-white"></i></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });

  let colorToggle = false;
  colorInterval = setInterval(() => {
    if (ambulanceRoutingControl) {
      ambulanceRoutingControl.getPlan().setWaypoints([]);
      ambulanceRoutingControl
        .getPlan()
        .setWaypoints([
          ambulanceMarker.getLatLng(),
          L.latLng(currentUser.location.lat, currentUser.location.lng),
        ]);
      ambulanceRoutingControl
        .getRouter()
        .route(ambulanceRoutingControl.getWaypoints(), (err, routes) => {
          if (!err) {
            const line = ambulanceRoutingControl
              .getRouter()
              .routeToLine(routes[0]);
            line.setStyle({
              color: colorToggle ? "blue" : "red",
              opacity: 0.8,
              weight: 6,
            });
            line.addTo(map);
          }
        });
      colorToggle = !colorToggle;
    }
  }, 500);

  onValue(ambulanceRef, (snapshot) => {
    const data = snapshot.val();
    if (data && data.location) {
      const ambulanceLatLng = [data.location.lat, data.location.lng];
      if (ambulanceMarker) {
        ambulanceMarker.setLatLng(ambulanceLatLng);
      } else {
        ambulanceMarker = L.marker(ambulanceLatLng, { icon })
          .addTo(map)
          .bindPopup(
            `<b>Ambulance ${ambulanceId}</b><br>Status: En Route`
          );
      }

      if (ambulanceRoutingControl) {
        ambulanceRoutingControl
          .getPlan()
          .setWaypoints([
            ambulanceMarker.getLatLng(),
            L.latLng(currentUser.location.lat, currentUser.location.lng),
          ]);
      } else {
        ambulanceRoutingControl = L.Routing.control({
          waypoints: [
            ambulanceMarker.getLatLng(),
            L.latLng(currentUser.location.lat, currentUser.location.lng),
          ],
          routeWhileDragging: false,
          createMarker: () => null,
        }).addTo(map);
      }

      if (currentUser.location) {
        const userLatLng = [
          currentUser.location.lat,
          currentUser.location.lng,
        ];
        const distance = map.distance(userLatLng, ambulanceLatLng);
        const speed = data.speed || 50;
        const speedMps = (speed * 1000) / 3600;
        if (speedMps > 0) {
          const etaSeconds = distance / speedMps;
          const etaMinutes = Math.ceil(etaSeconds / 60);
          document.getElementById(
            "ambulance-eta"
          ).textContent = `${etaMinutes} min`;
        } else {
          document.getElementById("ambulance-eta").textContent = `N/A`;
        }
      }
    }
  });
}

function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(new Error("Geolocation is not supported."));
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }),
      () => resolve({ lat: 12.9716, lng: 77.5946 }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

function updateVehicleData() {
  const battery = Math.floor(Math.random() * 31) + 70;
  const passengers = Math.floor(Math.random() * 4) + 1;
  const vitals = Math.floor(Math.random() * 41) + 60;

  batteryLevelInline.textContent = `${battery}%`;
  batteryLevelInline.className = `text-2xl font-bold ${
    battery < 80 ? "text-yellow-400" : "text-green-400"
  }`;
  passengerCountInline.textContent = `${passengers}`;
  driverVitalsInline.textContent = `${vitals} BPM`;
  driverVitalsInline.className = `text-2xl font-bold ${
    vitals > 90 ? "text-orange-400" : "text-blue-400"
  }`;
}

function showConfirmModal() {
  sosConfirmModal.classList.remove("hidden");
  startCountdown();
}

function hideConfirmModal() {
  sosConfirmModal.classList.add("hidden");
  clearInterval(countdownInterval);
}

function showInlineSOSView() {
  mapView.classList.add("hidden");
  inlineSosView.classList.remove("hidden");
  sosSent = false;
  sosButtonInline.disabled = false;
  sosButtonInline.classList.add("hover:bg-red-700", "hover:scale-105");
  sosButtonInline.classList.remove("bg-gray-500", "cursor-not-allowed");
  sosButtonInline.style.animation = "pulse 2s infinite";
  sosStatusInline.textContent = "";
  updateVehicleData();
}

function hideInlineSOSView() {
  inlineSosView.classList.add("hidden");
  mapView.classList.remove("hidden");
  if (map) {
    map.invalidateSize();
  }
}

function startCountdown() {
  let timeLeft = COUNTDOWN_SECONDS;
  countdownTimerEl.textContent = timeLeft;
  countdownCircle.style.strokeDasharray = "100, 100";
  countdownInterval = setInterval(() => {
    timeLeft--;
    countdownTimerEl.textContent = timeLeft;
    const percentage = (timeLeft / COUNTDOWN_SECONDS) * 100;
    countdownCircle.style.strokeDasharray = `${percentage}, 100`;
    if (timeLeft <= 0) {
      clearInterval(countdownInterval);
      sendSOS("Automatic");
    }
  }, 1000);
}

function simulateAutoTrigger() {
  if (sosSent) return;
  showConfirmModal();
}

logoutBtn.addEventListener("click", () => signOut(auth));
const hazardModal = document.getElementById("hazardModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const hazardBtns = document.querySelectorAll(".hazard-btn");

document.getElementById("hazardBtn").addEventListener("click", () => {
  hazardModal.classList.add("visible");
});

closeModalBtn.addEventListener("click", () => {
  hazardModal.classList.remove("visible");
});

hazardModal.addEventListener("click", (e) => {
  if (e.target === hazardModal) {
    hazardModal.classList.remove("visible");
  }
});

hazardBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const selectedHazard = btn.getAttribute("data-hazard");
    hazardModal.classList.remove("visible");

    if (selectedHazard === "Car Accident") {
      document.getElementById("aiAnalysisModal").classList.add("visible");
    } else if (selectedHazard) {
      sendMessage("hazard", { message: `${selectedHazard} reported.` });
      showMessage(`Hazard Reported: ${selectedHazard}`);
    }
  });
});

const aiAnalysisModal = document.getElementById("aiAnalysisModal");
const imageUpload = document.getElementById("imageUpload");
const previewImg = document.getElementById("previewImg");
const imagePreview = document.getElementById("imagePreview");
const analysisCanvas = document.getElementById("analysisCanvas");
const analysisResults = document.getElementById("analysisResults");
const detectionsList = document.getElementById("detectionsList");
const severityScore = document.getElementById("severityScore");
const analyzeBtn = document.getElementById("analyzeBtn");
const sendReportBtn = document.getElementById("sendReportBtn");
const closeAiModalBtn = document.getElementById("closeAiModalBtn");

imageUpload.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      previewImg.onload = () => {
        imagePreview.classList.remove("hidden");
        analyzeBtn.disabled = false;
        analysisResults.classList.add("hidden");
        analysisCanvas.classList.add("hidden");
        sendReportBtn.classList.add("hidden");
      };
      previewImg.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }
});

analyzeBtn.addEventListener("click", async () => {
  if (!cocoModel) {
    alert("AI model is still loading. Please wait a moment and try again.");
    return;
  }

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "Analyzing...";

  try {
    const detections = await analyzeImage(previewImg);
    currentAnalysisResults = detections;

    detectionsList.innerHTML = "";
    detections.forEach((detection) => {
      const item = document.createElement("div");
      item.className = "p-2 bg-gray-100 rounded"; // removed confidence
      detectionsList.appendChild(item);
    });

    const severity = calculateSeverityScore(detections);
    severityScore.innerHTML = `
<strong>Accident Severity Score: ${severity}/10</strong>
<p class="text-sm mt-1">
  ${
    severity <= 3
      ? "Low severity - Minor incident"
      : severity <= 6
      ? "Medium severity - Moderate incident"
      : "High severity - Major incident requiring immediate attention"
  }
</p>
`;
    severityScore.className = `mt-4 p-3 rounded-lg ${
      severity <= 3
        ? "bg-green-100 text-green-800"
        : severity <= 6
        ? "bg-yellow-100 text-yellow-800"
        : "bg-red-100 text-red-800"
    }`;

    drawDetections(analysisCanvas, detections, previewImg);
    analysisCanvas.classList.add("hidden");
    analysisResults.classList.remove("hidden");
    sendReportBtn.classList.remove("hidden");
  } catch (error) {
    console.error("Error analyzing image:", error);
    alert("Error analyzing image. Please try again.");
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "Analyze Image";
  }
});

sendReportBtn.addEventListener("click", async () => {
  if (!currentAnalysisResults) return;

  const severity = calculateSeverityScore(currentAnalysisResults);
  const detectedObjects = currentAnalysisResults
    .map((d) => d.class)
    .join(", ");

  pendingAISOS = {
    severity: severity,
    detections: currentAnalysisResults,
    detectedObjects: detectedObjects,
    reportMessage: `Car Accident detected via AI analysis. Severity: ${severity}/10. Objects detected: ${detectedObjects}`,
  };

  aiAnalysisModal.classList.remove("visible");

  if (severity > 6) {
    // 🚨 High severity → confirmation modal with auto-SOS
    showAISOSConfirmation();
  } else {
    // ⚠️ Moderate severity → send hazard-only report
    await sendAIReport();
  }
});

// ✅ Hazard-only report (no SOS document, just logs a hazard event)
async function sendAIReport() {
  if (!pendingAISOS) return;

  try {
    await sendMessage("hazard", {
      message: pendingAISOS.reportMessage,
      aiAnalysis: {
        severity: pendingAISOS.severity,
        detections: pendingAISOS.detections,
        timestamp: new Date().toISOString(),
      },
    });

    showMessage(
      `AI-Analyzed Car Accident Report Sent (Severity: ${pendingAISOS.severity}/10)`
    );
    resetAIModal();
  } catch (error) {
    console.error("Error sending report:", error);
    alert("Error sending report. Please try again.");
  }
}

// 🚨 Critical SOS (Firestore + dispatcher alert)
async function sendAISOSAlert() {
  if (!pendingAISOS) return;

  try {
    await sendMessage("hazard", {
      message: pendingAISOS.reportMessage,
      aiAnalysis: {
        severity: pendingAISOS.severity,
        detections: pendingAISOS.detections,
        timestamp: new Date().toISOString(),
      },
    });

    const location = await getCurrentLocation();
    const sosData = {
      status: "active",
      senderId: currentUser.uid,
      senderInfo: {
        username: currentUser.username,
        regNumber: currentUser.regNumber,
      },
      vehicleData: {
        battery: parseInt(batteryLevelInline.textContent),
        passengers: parseInt(passengerCountInline.textContent),
        vitals: parseInt(driverVitalsInline.textContent),
      },
      location: location,
      triggerMethod: `AI Analysis (Severity: ${pendingAISOS.severity}/10)`,
      timestamp: serverTimestamp(),
    };

    await addDoc(collection(db, "sos_alerts"), sosData);
    showMessage(
      `Critical SOS Alert Sent! (AI Severity: ${pendingAISOS.severity}/10)`
    );

    sosSent = true;
    resetAIModal();
  } catch (error) {
    console.error("Error sending SOS alert:", error);
    alert("Error sending SOS alert. Please try again.");
  }
}

// Confirmation modal countdown
function showAISOSConfirmation() {
  const aiSosModal = document.getElementById("ai-sos-confirm-modal");
  const aiCountdownTimer = document.getElementById("ai-countdown-timer");
  const aiCountdownDisplay = document.getElementById("ai-countdown-display");
  const aiCountdownCircle = document.getElementById("ai-countdown-circle");

  aiSosModal.classList.remove("hidden");

  let timeLeft = 15;
  aiCountdownTimer.textContent = timeLeft;
  aiCountdownDisplay.textContent = timeLeft;
  aiCountdownCircle.style.strokeDasharray = "100, 100";

  aiCountdownInterval = setInterval(() => {
    timeLeft--;
    aiCountdownTimer.textContent = timeLeft;
    aiCountdownDisplay.textContent = timeLeft;

    const percentage = (timeLeft / 15) * 100;
    aiCountdownCircle.style.strokeDasharray = `${percentage}, 100`;

    if (timeLeft <= 0) {
      clearInterval(aiCountdownInterval);
      aiSosModal.classList.add("hidden");
      sendAISOSAlert();
    }
  }, 1000);
}

function hideAISOSConfirmation() {
  const aiSosModal = document.getElementById("ai-sos-confirm-modal");
  aiSosModal.classList.add("hidden");
  clearInterval(aiCountdownInterval);
}

function resetAIModal() {
  imageUpload.value = "";
  imagePreview.classList.add("hidden");
  analysisResults.classList.add("hidden");
  analysisCanvas.classList.add("hidden");
  sendReportBtn.classList.add("hidden");
  analyzeBtn.disabled = true;
  pendingAISOS = null;
}

closeAiModalBtn.addEventListener("click", () => {
  aiAnalysisModal.classList.remove("visible");
  resetAIModal();
});

document
  .getElementById("confirm-ai-sos-button")
  .addEventListener("click", () => {
    hideAISOSConfirmation();
    sendAISOSAlert();
  });

document
  .getElementById("cancel-ai-sos-button")
  .addEventListener("click", () => {
    hideAISOSConfirmation();
    sendAIReport();
  });

function listenForGreenCorridorNotifications() {
  const notificationsRef = ref(rtdb, "notifications/green_corridor");
  onValue(notificationsRef, (snapshot) => {
    const notificationData = snapshot.val();
    if (notificationData) {
      handleGreenCorridorNotification(notificationData);
    }
  });

  const greenCorridorRef = ref(rtdb, "green_corridor");
  onValue(greenCorridorRef, (snapshot) => {
    const corridorData = snapshot.val();
    if (corridorData && corridorData.active) {
      displayGreenCorridorRoute(corridorData);
    } else {
      clearGreenCorridorRoute();
    }
  });
}

function handleGreenCorridorNotification(notificationData) {
  if (notificationData.type === "green_corridor_active") {
    showGreenCorridorAlert(notificationData);
  } else if (notificationData.type === "green_corridor_deactivated") {
    hideGreenCorridorAlert();
    showMessage(
      "Green Corridor Deactivated - Normal traffic flow resumed"
    );
  }
}

function showGreenCorridorAlert(notificationData) {
  if (greenCorridorNotification) {
    greenCorridorNotification.remove();
  }

  greenCorridorNotification = document.createElement("div");
  greenCorridorNotification.className =
    "fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-600 text-white p-4 rounded-lg shadow-lg max-w-md border-2 border-red-700";
  greenCorridorNotification.innerHTML = `
<div class="flex items-center gap-3">
  <div class="w-4 h-4 bg-white rounded-full animate-pulse"></div>
  <div>
    <h3 class="font-bold text-lg">${notificationData.title}</h3>
    <p class="text-sm">${notificationData.message}</p>
    <p class="text-xs mt-1 opacity-90">Please avoid the highlighted route and clear the path for emergency vehicles.</p>
  </div>
  <button onclick="hideGreenCorridorAlert()" class="ml-2 text-white hover:text-gray-200">
    <i class="fas fa-times"></i>
  </button>
</div>
`;

  document.body.appendChild(greenCorridorNotification);

  setTimeout(() => {
    if (greenCorridorNotification) {
      greenCorridorNotification.style.opacity = "0.7";
    }
  }, 10000);
}

function hideGreenCorridorAlert() {
  if (greenCorridorNotification) {
    greenCorridorNotification.remove();
    greenCorridorNotification = null;
  }
}

function displayGreenCorridorRoute(corridorData) {
  if (greenCorridorRoute) {
    map.removeLayer(greenCorridorRoute);
  }

  greenCorridorRoute = L.polyline(
    [
      [
        corridorData.ambulanceLocation.lat,
        corridorData.ambulanceLocation.lng,
      ],
      [corridorData.sosLocation.lat, corridorData.sosLocation.lng],
    ],
    {
      color: "red",
      weight: 6,
      opacity: 0.9,
      dashArray: "15, 10",
      className: "green-corridor-route",
    }
  ).addTo(map);

  const style = document.createElement("style");
  style.textContent = `
.green-corridor-route {
  animation: pulse-route 2s infinite;
}
@keyframes pulse-route {
  0% { opacity: 0.9; }
  50% { opacity: 0.5; }
  100% { opacity: 0.9; }
}
`;
  document.head.appendChild(style);

  const ambulanceIcon = L.divIcon({
    className: "custom-div-icon",
    html: `<div class="p-2 rounded-full bg-red-600 border-2 border-white shadow-lg animate-pulse"><i class="fas fa-ambulance text-white"></i></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });

  const sosIcon = L.divIcon({
    className: "custom-div-icon",
    html: `<div class="p-2 rounded-full bg-red-800 border-2 border-white shadow-lg animate-pulse"><i class="fas fa-exclamation-triangle text-white"></i></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });

  L.marker(
    [
      corridorData.ambulanceLocation.lat,
      corridorData.ambulanceLocation.lng,
    ],
    { icon: ambulanceIcon }
  )
    .addTo(map)
    .bindPopup("🚑 Emergency Ambulance");

  L.marker([corridorData.sosLocation.lat, corridorData.sosLocation.lng], {
    icon: sosIcon,
  })
    .addTo(map)
    .bindPopup("🆘 Emergency Location");

  showMessage(
    "🚨 GREEN CORRIDOR ACTIVE - Please avoid the highlighted route!"
  );
}

function clearGreenCorridorRoute() {
  if (greenCorridorRoute) {
    map.removeLayer(greenCorridorRoute);
    greenCorridorRoute = null;
  }
  hideGreenCorridorAlert();
}

window.hideGreenCorridorAlert = hideGreenCorridorAlert;

document
  .getElementById("chargingBtn")
  .addEventListener("click", toggleChargingPorts);

toggleTrafficBtn.addEventListener("click", () => {
  if (trafficLayer) {
    map.removeLayer(trafficLayer);
    trafficLayer = null;
  } else {
    trafficLayer = L.tileLayer(
      "https://{s}.google.com/vt/lyrs=m@221097413,traffic&x={x}&y={y}&z={z}",
      {
        maxZoom: 20,
        subdomains: ["mt0", "mt1", "mt2", "mt3"],
      }
    ).addTo(map);
  }
});

closeNavigationBtn.addEventListener("click", () => {
  if (routingControl) {
    map.removeControl(routingControl);
    routingControl = null;
    closeNavigationBtn.classList.add("hidden");
  }
});

document
  .getElementById("sendCustomMsgBtn")
  .addEventListener("click", () => {
    const message = document
      .getElementById("customMessageInput")
      .value.trim();
    if (message) {
      sendMessage("custom", { message });
      document.getElementById("customMessageInput").value = "";
    }
  });

function listenForTrafficSignalUpdates() {
  const signalsRef = ref(rtdb, "traffic_signals/");
  onValue(signalsRef, (snapshot) => {
    const signals = snapshot.val();
    if (signals) {
      updateTrafficSignalMarkersOnMap(signals);
      updateTrafficSignalUI(signals);
    } else {
      initializeDefaultTrafficSignals();
    }
  });
}

function initializeDefaultTrafficSignals() {
  const defaultSignals = {
    signal_1: {
      name: "MG Road Junction",
      location: "MG Road & Brigade Road",
      coords: { lat: 12.9716, lng: 77.5946 },
      state: "green",
    },
    signal_2: {
      name: "Koramangala Signal",
      location: "80 Feet Road",
      coords: { lat: 12.9279, lng: 77.6271 },
      state: "red",
    },
    signal_3: {
      name: "Indiranagar Junction",
      location: "100 Feet Road",
      coords: { lat: 12.9719, lng: 77.6412 },
      state: "yellow",
    },
    signal_4: {
      name: "Whitefield Main Road",
      location: "ITPL Main Road",
      coords: { lat: 12.9698, lng: 77.75 },
      state: "green",
    },
    signal_5: {
      name: "Electronic City",
      location: "Hosur Road",
      coords: { lat: 12.8456, lng: 77.6603 },
      state: "red",
    },
  };

  set(ref(rtdb, "traffic_signals"), defaultSignals)
    .then(() => {
      console.log("Default traffic signals initialized");
    })
    .catch((error) => {
      console.error("Error initializing traffic signals:", error);
    });
}
function updateTrafficSignalMarkersOnMap(signals) {
  Object.keys(trafficSignalMarkers).forEach((signalId) => {
    if (trafficSignalMarkers[signalId]) {
      map.removeLayer(trafficSignalMarkers[signalId]);
      delete trafficSignalMarkers[signalId];
    }
  });

  Object.keys(signals).forEach((signalId) => {
    const signal = signals[signalId];

    if (
      !signal.coords ||
      signal.coords.lat === undefined ||
      signal.coords.lng === undefined
    ) {
      console.warn(`Signal ${signalId} missing coordinates:`, signal);
      return;
    }

    const iconColor =
      signal.state === "red"
        ? "#ef4444"
        : signal.state === "yellow"
        ? "#f59e0b"
        : "#22c55e";

    const icon = L.divIcon({
      className: "traffic-light-marker",
      html: `<div class="traffic-light-marker ${signal.state}"><i class="fas fa-traffic-light"></i></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    const marker = L.marker([signal.coords.lat, signal.coords.lng], {
      icon: icon,
    }).addTo(map);

    marker.bindPopup(`
  <strong>${signal.name || signalId}</strong><br>
  Location: ${signal.location || "N/A"}<br>
  Status: <span style="color: ${iconColor}; font-weight: bold;">${signal.state.toUpperCase()}</span>
`);

    trafficSignalMarkers[signalId] = marker;
    console.log(
      `Added traffic signal marker: ${signalId} at ${signal.coords.lat}, ${signal.coords.lng}`
    );
  });
}

function updateTrafficSignalUI(signals) {
  if (!trafficSignalGrid) return;
  trafficSignalGrid.innerHTML = "";
  Object.keys(signals).forEach((signalId) => {
    const signal = signals[signalId];
    const card = document.createElement("div");
    card.className = `signal-card ${signal.state}`;
    card.innerHTML = `
<p class="signal-name">${signal.name}</p>
<p class="signal-location">${signal.location}</p>
`;
    trafficSignalGrid.appendChild(card);
  });
}

async function initializeAIAnalysis() {
  try {
    console.log("Loading COCO-SSD model...");
    cocoModel = await cocoSsd.load();
    console.log("COCO-SSD model loaded successfully");

    // Enable analyze button only after model is ready
    analyzeBtn.disabled = false;
  } catch (error) {
    console.error("Error loading COCO-SSD model:", error);
  }
}

async function analyzeImage(imageElement) {
  if (!cocoModel) {
    throw new Error("AI model not loaded yet. Please wait...");
  }
  const predictions = await cocoModel.detect(imageElement);
  return predictions;
}

function calculateSeverityScore(detections) {
  let score = 0;
  let vehicleCount = 0;
  let personDetected = false;

  const hazardObjects = {
    car: 3,
    truck: 5,
    bus: 6,
    motorcycle: 2,
    bicycle: 1,
    person: 10, // High score for human presence
    ambulance: 8,
    police_car: 7,
    fire_truck: 8,
    "fire hydrant": 1,
    "stop sign": 1,
    "traffic light": 1,
  };

  detections.forEach((detection) => {
    if (hazardObjects[detection.class]) {
      score += hazardObjects[detection.class] * detection.score;
      if (
        [
          "car",
          "truck",
          "bus",
          "motorcycle",
          "ambulance",
          "police_car",
          "fire_truck",
        ].includes(detection.class)
      ) {
        vehicleCount++;
      }
      if (detection.class === "person") {
        personDetected = true;
      }
    }
  });

  // Increase score based on the number of vehicles
  if (vehicleCount > 1) {
    score += vehicleCount * 2;
  }

  // Major increase in score if a person is detected
  if (personDetected) {
    score *= 1.5;
  }

  const normalizedScore = Math.min(Math.round(score), 10);
  return normalizedScore;
}

function drawDetections(canvas, detections, imageElement) {
  const ctx = canvas.getContext("2d");
  canvas.width = imageElement.width;
  canvas.height = imageElement.height;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(imageElement, 0, 0);

  detections.forEach((prediction) => {
    const [x, y, width, height] = prediction.bbox;

    ctx.strokeStyle = "#ff0000";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);

    ctx.fillStyle = "#ff0000";
    ctx.font = "16px Arial";
    const label = `${prediction.class} (${Math.round(
      prediction.score * 100
    )}%)`;
    ctx.fillText(label, x, y > 20 ? y - 5 : y + 20);
  });
}
setInterval(() => {
  if (currentUser?.location) {
    updateUserLocationInFirestore();
  }
}, 10000);