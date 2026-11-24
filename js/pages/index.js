// js/pages/index.js
// Sign-In portal controller (Google OAuth @pdsb.net ONLY)

import {
  signInWithGoogle,
  signOutUser,
  observeAuthState,
  enforceAntiFraming
} from "../services/auth-service.js";
import { getFriendlyAuthError, sanitizeRedirectUrl } from "../utils.js";

enforceAntiFraming();

let currentUser = null;

const params = new URLSearchParams(window.location.search);
const redirectTarget = sanitizeRedirectUrl(params.get("redirect"));
const reason = params.get("reason");

if (reason === "timeout") {
  const timeoutNotice = document.getElementById("timeout-notice");
  if (timeoutNotice) timeoutNotice.style.display = "block";
} else if (redirectTarget) {
  const redirectNotice = document.getElementById("redirect-notice");
  if (redirectNotice) redirectNotice.style.display = "block";
}

const errorBox = document.getElementById("error-box");
const statusBox = document.getElementById("status-box");
const authForms = document.getElementById("auth-forms");
const authRedirecting = document.getElementById("auth-redirecting");
const googleBtn = document.getElementById("btn-google");

function showError(msg) {
  if (!msg) {
    errorBox.style.display = "none";
    errorBox.textContent = "";
    return;
  }
  statusBox.style.display = "none";
  errorBox.textContent = msg;
  errorBox.style.display = "block";
}

function showStatus(msg) {
  if (!msg) {
    statusBox.style.display = "none";
    statusBox.textContent = "";
    return;
  }
  errorBox.style.display = "none";
  statusBox.textContent = msg;
  statusBox.style.display = "block";
}

function resolveDestination(user) {
  const role = user.profile?.role || "student";
  if (redirectTarget) {
    if (
      (redirectTarget.startsWith("teacher.html") || redirectTarget.startsWith("test-backend.html")) &&
      role !== "teacher"
    ) {
      return "dashboard.html";
    }
    return redirectTarget;
  }
  return role === "teacher" ? "teacher.html" : "dashboard.html";
}

observeAuthState((user) => {
  currentUser = user;
  if (user) {
    authForms.style.display = "none";
    authRedirecting.style.display = "block";
    const dest = resolveDestination(user);
    document.getElementById("redirect-msg").textContent = "Redirecting...";
    window.location.replace(dest);
  } else {
    authForms.style.display = "block";
    authRedirecting.style.display = "none";
  }
});

googleBtn.addEventListener("click", async () => {
  showError("");
  showStatus("Opening Google Sign-In...");
  googleBtn.disabled = true;
  try {
    const res = await signInWithGoogle();
    showStatus("Redirecting...");
    window.location.replace(
      resolveDestination({
        uid: res.user.uid,
        email: res.user.email,
        displayName: res.user.displayName,
        profile: res.profile
      })
    );
  } catch (err) {
    showError(getFriendlyAuthError(err));
    googleBtn.disabled = false;
  }
});

document.getElementById("btn-continue").addEventListener("click", () => {
  if (!currentUser) return;
  window.location.replace(resolveDestination(currentUser));
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  await signOutUser();
});
