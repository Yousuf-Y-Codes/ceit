// js/pages/docs.js
// Documentation page navigation and auth state controller

import {
  observeAuthState,
  signOutUser,
  extractStudentNumberFromEmail,
  getUiRoleHint,
  enforceAntiFraming
} from "../services/auth-service.js";

enforceAntiFraming();

const navHome = document.getElementById("nav-home");
const navTeacher = document.getElementById("nav-teacher-link");
const navDash = document.getElementById("nav-dash");
const navCheckout = document.getElementById("nav-checkout");
const headerUser = document.getElementById("docs-header-user");
const userNameEl = document.getElementById("docs-user-name");
const userIdEl = document.getElementById("docs-user-id");
const brandLink = document.getElementById("brand-home-link");

function applyNavLayout(role) {
  if (role === "teacher") {
    navHome.style.display = "none";
    navTeacher.style.display = "inline-block";
    navDash.style.display = "inline-block";
    navDash.textContent = "Student View";
    navCheckout.style.display = "inline-block";
    brandLink.href = "teacher.html";
  } else if (role === "student") {
    navHome.style.display = "none";
    navTeacher.style.display = "none";
    navDash.style.display = "inline-block";
    navDash.textContent = "Dashboard";
    navCheckout.style.display = "inline-block";
    brandLink.href = "dashboard.html";
  } else {
    navHome.style.display = "inline-block";
    navTeacher.style.display = "none";
    navDash.style.display = "none";
    navCheckout.style.display = "none";
    headerUser.style.display = "none";
    brandLink.href = "index.html";
  }
}

// Apply non-authoritative UI hint immediately to prevent nav tab jump on page load;
// authoritative Firebase observeAuthState immediately overrides this.
const hint = getUiRoleHint();
if (hint) {
  applyNavLayout(hint);
}

observeAuthState((user) => {
  if (!user) {
    applyNavLayout(null);
    return;
  }

  const isTeacher = user.profile?.role === "teacher";
  applyNavLayout(isTeacher ? "teacher" : "student");

  const name = user.displayName || user.profile?.displayName || (isTeacher ? "Teacher" : "Student");
  const sNum = extractStudentNumberFromEmail(user.email) || user.profile?.studentNumber || "";
  userNameEl.textContent = name;
  userIdEl.textContent = sNum
    ? `#${sNum}`
    : (user.email || "").split("@")[0] || "User";
  headerUser.style.display = "flex";
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  await signOutUser();
  window.location.replace("index.html");
});
