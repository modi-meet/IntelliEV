import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDw3BAOGOTBBK-ng9H6085IYxVkv5hAmuk",
  authDomain: "myapp-50919.firebaseapp.com",
  projectId: "myapp-50919",
  storageBucket: "myapp-50919.firebasestorage.app",
  messagingSenderId: "798113728643",
  appId: "1:798113728643:web:8a19494bbbead17df8b3b6",
  measurementId: "G-JBMJZXP0J5",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let selectedRole = null;
let isLoginMode = true;

// DOM Elements
const authModal = document.getElementById("authModal");
const modalContent = document.getElementById("modalContent");
const modalTitle = document.getElementById("modalTitle");
const regLabel = document.getElementById("regLabel");
const regInput = document.getElementById("regInput");
const actionBtn = document.getElementById("actionBtn");
const notificationToast = document.getElementById("notification-toast");
const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const usernameInput = document.getElementById("usernameInput");

// --- Functions ---

/**
 * Shows a notification toast message.
 * @param {string} message - The message to display.
 * @param {string} type - 'success' or 'error'.
 */
function showNotification(message, type = "error") {
  notificationToast.textContent = message;
  notificationToast.className = type;
  notificationToast.classList.add("show");
  setTimeout(() => {
    notificationToast.classList.remove("show");
  }, 3000);
}

/**
 * Configures and displays the authentication modal based on role and mode (login/signup).
 * @param {string} role - 'ev' or 'emergency'.
 * @param {boolean} isLogin - True for login mode, false for signup mode.
 */
function setupModalForRole(role, isLogin) {
  isLoginMode = isLogin;
  const roleName = role === "ev" ? "EV Driver" : "Emergency Responder";
  modalContent.classList.toggle("show-login", isLogin);
  modalContent.classList.toggle("show-signup", !isLogin);

  if (isLogin) {
    modalTitle.textContent = `${roleName} Login`;
    actionBtn.textContent = "Login";
    document.getElementById("regGroup").style.display = "none";
  } else {
    modalTitle.textContent = `${roleName} Sign Up`;
    actionBtn.textContent = "Sign Up";
    document.getElementById("regGroup").style.display = "block";
  }

  if (role === "ev") {
    regLabel.textContent = "EV Registration No.";
    regInput.placeholder = "e.g., KA01EV0001";
  } else {
    regLabel.textContent = "Vehicle ID";
    regInput.placeholder = "e.g., AMB-101";
  }
}

/**
 * Handles the user signup process.
 */
async function handleSignup() {
  const email = emailInput.value;
  const password = passwordInput.value;
  const username = usernameInput.value;
  const regNumber = regInput.value.toUpperCase();

  if (!email || !password || !username || !regNumber) {
    showNotification("Please fill all fields.");
    return;
  }
  try {
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );
    // Save additional user info to Firestore
    await setDoc(doc(db, "users", userCredential.user.uid), {
      uid: userCredential.user.uid,
      username,
      email,
      regNumber,
      userType: selectedRole,
    });
    showNotification("Sign up successful!", "success");
    setTimeout(() => redirectUser(selectedRole), 1000);
  } catch (error) {
    showNotification(`Sign up failed: ${error.message}`);
  }
}

/**
 * Handles the user login process.
 */
async function handleLogin() {
  const email = emailInput.value;
  const password = passwordInput.value;
  if (!email || !password) {
    showNotification("Please enter email and password.");
    return;
  }
  try {
    const userCredential = await signInWithEmailAndPassword(
      auth,
      email,
      password
    );
    const userDoc = await getDoc(doc(db, "users", userCredential.user.uid));

    if (userDoc.exists()) {
      const actualUserType = userDoc.data().userType;
      // Check if the user is logging in with the correct role
      if (actualUserType === selectedRole) {
        redirectUser(actualUserType);
      } else {
        const actualRoleName =
          actualUserType === "ev" ? "EV Driver" : "Emergency Responder";
        showNotification(
          `Access denied. You are registered as an ${actualRoleName}.`
        );
        auth.signOut();
      }
    } else {
      showNotification("User data not found. Please sign up again.");
      auth.signOut();
    }
  } catch (error) {
    showNotification(`Login failed: ${error.message}`);
  }
}

/**
 * Redirects the user to the appropriate page based on their role.
 * @param {string} userType - 'ev' or 'emergency'.
 */
function redirectUser(userType) {
  if (userType === "ev") {
    window.location.href = "../EVuser/index.html";
  } else if (userType === "emergency") {
    window.location.href = "../emgResponder/index.html";
  }
}

// --- Event Listeners ---

// Open modal when a role card is clicked
document.querySelectorAll(".role-card").forEach((card) => {
  card.addEventListener("click", () => {
    selectedRole = card.dataset.role;
    setupModalForRole(selectedRole, true); // Default to login view
    authModal.classList.add("visible");
  });
});

// Close modal
document.getElementById("closeBtn").addEventListener("click", () => {
  authModal.classList.remove("visible");
});

// Switch to signup form
document
  .getElementById("switchToSignup")
  .addEventListener("click", () => setupModalForRole(selectedRole, false));

// Switch to login form
document
  .getElementById("switchToLogin")
  .addEventListener("click", () => setupModalForRole(selectedRole, true));

// Handle main form submission (Login/Signup)
actionBtn.addEventListener("click", async () => {
  actionBtn.disabled = true;
  actionBtn.classList.add("loading");

  if (isLoginMode) {
    await handleLogin();
  } else {
    await handleSignup();
  }

  actionBtn.disabled = false;
  actionBtn.classList.remove("loading");
});