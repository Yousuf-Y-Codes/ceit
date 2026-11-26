// js/services/auth-service.js
// Authentication Service for CEIT (Computer Engineering Item Tracker)
// Strictly enforces verified Google OAuth (@pdsb.net) — Email/Password is disabled for security.

import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserSessionPersistence,
  getIdTokenResult
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import { auth, db, INITIAL_TEACHER_EMAILS, isFirebaseConfigured } from "../firebase-config.js";

const UI_ROLE_HINT_KEY = "ceit_ui_role";
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes for shared lab PCs

const googleProvider = new GoogleAuthProvider();
// Always prompt account selection and hint the PDSB Google Workspace domain
googleProvider.setCustomParameters({
  prompt: "select_account",
  hd: "pdsb.net"
});

// Prefer session persistence so closing the browser tab on a shared lab PC ends the session
const persistenceReady = auth
  ? setPersistence(auth, browserSessionPersistence).catch((err) => {
      console.warn("[CEIT] Could not set session persistence:", err.message);
    })
  : Promise.resolve();

/**
 * Prevents the app from being embedded in unauthorized iframes (clickjacking defense).
 */
export function enforceAntiFraming() {
  if (typeof window === "undefined") return;
  try {
    if (window.top !== window.self) {
      window.top.location.replace(window.self.location.href);
    }
  } catch {
    document.documentElement.style.display = "none";
  }
}

/**
 * Reads a non-authoritative UI-only hint for initial navbar rendering (never used for access control).
 * @returns {"teacher"|"student"|null}
 */
export function getUiRoleHint() {
  try {
    const val = window.sessionStorage.getItem(UI_ROLE_HINT_KEY);
    return val === "teacher" || val === "student" ? val : null;
  } catch {
    return null;
  }
}

function setUiRoleHint(role) {
  try {
    if (role === "teacher" || role === "student") {
      window.sessionStorage.setItem(UI_ROLE_HINT_KEY, role);
    } else {
      window.sessionStorage.removeItem(UI_ROLE_HINT_KEY);
    }
  } catch {
    // Ignore storage access errors in restricted privacy modes
  }
}

function clearUiRoleHint() {
  setUiRoleHint(null);
}

/**
 * Checks if Firebase is initialized.
 * @throws {Error} If Firebase is not configured yet.
 */
function assertFirebaseReady() {
  if (!isFirebaseConfigured() || !auth || !db) {
    throw new Error(
      "Firebase is not configured yet. Please update js/firebase-config.js with your project credentials."
    );
  }
}

/**
 * Wraps a promise with a timeout so slow or unreachable Firestore requests
 * never block authentication or page redirects indefinitely.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} [ms=3500]
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms = 3500) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Firestore request timed out")), ms)
    )
  ]);
}

/**
 * Validates that an email belongs to Peel District School Board (@pdsb.net).
 * @param {string} email
 * @returns {boolean}
 */
export function isPdsbEmail(email) {
  if (typeof email !== "string") return false;
  const trimmed = email.trim();
  if (trimmed.length > 120) return false;
  return /^[a-z0-9._+-]+@pdsb\.net$/i.test(trimmed);
}

/**
 * Extracts student number from a PDSB student email (e.g. 1234567890@pdsb.net -> "1234567890").
 * Returns "" for teacher emails (p<digits>@pdsb.net).
 * @param {string} email
 * @returns {string}
 */
export function extractStudentNumberFromEmail(email) {
  if (!isPdsbEmail(email)) return "";
  const username = email.split("@")[0].trim();
  if (/^\d+$/.test(username)) {
    return username;
  }
  return "";
}

/**
 * Determines whether a @pdsb.net email belongs to a teacher:
 * matches p<digits>@pdsb.net or is in INITIAL_TEACHER_EMAILS.
 * @param {string} email
 * @returns {boolean}
 */
export function isWhitelistedTeacher(email) {
  if (!isPdsbEmail(email)) return false;
  const normalized = email.toLowerCase().trim();
  const username = normalized.split("@")[0];
  if (/^p\d+$/.test(username)) {
    return true;
  }
  return INITIAL_TEACHER_EMAILS.some((t) => t.toLowerCase().trim() === normalized);
}

/**
 * Alias for isWhitelistedTeacher.
 * @param {string} email
 * @returns {boolean}
 */
export function isTeacherEmail(email) {
  return isWhitelistedTeacher(email);
}

/**
 * Verifies that the Firebase user authenticated via Google OAuth with a verified @pdsb.net email.
 * Rejects legacy Email/Password accounts, unverified emails, and non-PDSB domains.
 * @param {import("firebase/auth").User | null} firebaseUser
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function verifyGooglePdsbSession(firebaseUser) {
  if (!firebaseUser) {
    return { ok: false, reason: "No active session." };
  }

  const email = (firebaseUser.email || "").toLowerCase().trim();
  if (!isPdsbEmail(email)) {
    return {
      ok: false,
      reason: `Access restricted: Only verified school Google accounts are allowed.${email ? ` You used: ${email}` : ""}`
    };
  }

  if (!firebaseUser.emailVerified) {
    return {
      ok: false,
      reason: "Access restricted: Your Google account email must be verified."
    };
  }

  const hasGoogleProvider =
    Array.isArray(firebaseUser.providerData) &&
    firebaseUser.providerData.some((p) => p && p.providerId === "google.com");

  if (!hasGoogleProvider) {
    return {
      ok: false,
      reason: "Password sign-in has been disabled. Please sign in with your school Google account."
    };
  }

  try {
    const tokenResult = await withTimeout(getIdTokenResult(firebaseUser), 3500);
    if (tokenResult.signInProvider !== "google.com") {
      return {
        ok: false,
        reason: "Password sign-in has been disabled. Please sign in with your school Google account."
      };
    }
    if (tokenResult.claims && tokenResult.claims.email_verified !== true) {
      return {
        ok: false,
        reason: "Access restricted: Unverified email token."
      };
    }
  } catch (err) {
    console.warn("[CEIT] Token verification fallback to providerData:", err.message);
  }

  return { ok: true };
}

/**
 * Creates or updates the user profile record in Firestore `users/{uid}`.
 * @param {object} firebaseUser
 * @returns {Promise<object>} The combined user profile.
 */
export async function syncUserProfile(firebaseUser) {
  assertFirebaseReady();
  const email = (firebaseUser.email || "").toLowerCase().trim();
  const isTeacher = isWhitelistedTeacher(email);
  const inferredStudentNumber = extractStudentNumberFromEmail(email);
  const cleanName = (firebaseUser.displayName || email.split("@")[0] || "User")
    .trim()
    .slice(0, 120);

  const fallbackProfile = {
    uid: firebaseUser.uid,
    email,
    displayName: cleanName,
    role: isTeacher ? "teacher" : "student",
    studentNumber: inferredStudentNumber
  };

  try {
    const userRef = doc(db, "users", firebaseUser.uid);
    const userSnap = await withTimeout(getDoc(userRef), 3500);

    if (!userSnap.exists()) {
      const profile = {
        ...fallbackProfile,
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp()
      };
      await withTimeout(setDoc(userRef, profile), 3500);
      return profile;
    }

    const existingData = userSnap.data();
    const updates = { lastLoginAt: serverTimestamp() };
    if (isTeacher && existingData.role !== "teacher") {
      updates.role = "teacher";
    }
    if (inferredStudentNumber && existingData.studentNumber !== inferredStudentNumber) {
      updates.studentNumber = inferredStudentNumber;
    }
    if (cleanName && cleanName !== existingData.displayName) {
      updates.displayName = cleanName;
    }
    await withTimeout(updateDoc(userRef, updates), 3500);
    return { ...existingData, ...updates };
  } catch (err) {
    console.warn(
      "[CEIT] Firestore profile sync skipped (database may be offline or rules not yet deployed):",
      err.message
    );
    return fallbackProfile;
  }
}

/**
 * Sign in with Google Popup.
 * Strictly requires a verified Peel District School Board (@pdsb.net) Google account.
 * @returns {Promise<{ user: object, profile: object }>}
 */
export async function signInWithGoogle() {
  assertFirebaseReady();
  await persistenceReady;

  const result = await signInWithPopup(auth, googleProvider);
  const user = result.user;

  const check = await verifyGooglePdsbSession(user);
  if (!check.ok) {
    await signOut(auth).catch(() => {});
    clearUiRoleHint();
    throw new Error(check.reason);
  }

  const profile = await syncUserProfile(user);
  setUiRoleHint(profile.role === "teacher" ? "teacher" : "student");
  return { user, profile };
}

/**
 * Sign out the current user and clear any session UI hints.
 * @returns {Promise<void>}
 */
export async function signOutUser() {
  clearUiRoleHint();
  if (!auth) return;
  await signOut(auth);
}

/**
 * Get the current user profile from Firestore.
 * @returns {Promise<object|null>}
 */
export async function getCurrentUserProfile() {
  if (!auth || !auth.currentUser) return null;
  const u = auth.currentUser;
  const fallback = {
    uid: u.uid,
    email: (u.email || "").toLowerCase().trim(),
    displayName: (u.displayName || "User").trim().slice(0, 120),
    role: isWhitelistedTeacher(u.email) ? "teacher" : "student",
    studentNumber: extractStudentNumberFromEmail(u.email)
  };

  try {
    const userRef = doc(db, "users", u.uid);
    const snap = await withTimeout(getDoc(userRef), 3500);
    if (snap.exists()) {
      return { uid: u.uid, ...snap.data() };
    }
  } catch (err) {
    console.warn("[CEIT] Could not read user profile from Firestore:", err.message);
  }
  return fallback;
}

/**
 * Observes auth state changes. Verifies Google OAuth + @pdsb.net domain + email_verified.
 * @param {function(object|null): void} callback
 * @returns {function(): void} Unsubscribe function
 */
export function observeAuthState(callback) {
  if (!isFirebaseConfigured() || !auth) {
    clearUiRoleHint();
    callback(null);
    return () => {};
  }

  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      clearUiRoleHint();
      callback(null);
      return;
    }

    const check = await verifyGooglePdsbSession(firebaseUser);
    if (!check.ok) {
      console.warn(`[CEIT] Signing out unauthorized session: ${check.reason}`);
      await signOut(auth).catch(() => {});
      clearUiRoleHint();
      callback(null);
      return;
    }

    const email = (firebaseUser.email || "").toLowerCase().trim();
    const baseUser = {
      uid: firebaseUser.uid,
      email,
      displayName: (firebaseUser.displayName || "").trim().slice(0, 120),
      photoURL: firebaseUser.photoURL || ""
    };
    const derivedStudentNumber = extractStudentNumberFromEmail(email);
    const emailIsTeacher = isWhitelistedTeacher(email);
    const fallbackProfile = {
      uid: firebaseUser.uid,
      email,
      displayName: baseUser.displayName || "User",
      role: emailIsTeacher ? "teacher" : "student",
      studentNumber: derivedStudentNumber
    };

    try {
      const profile = await getCurrentUserProfile();
      const resolvedRole = emailIsTeacher
        ? "teacher"
        : profile?.role === "teacher"
          ? "teacher"
          : "student";
      const mergedProfile = profile
        ? {
            ...profile,
            email,
            role: resolvedRole,
            studentNumber: derivedStudentNumber || profile.studentNumber || ""
          }
        : fallbackProfile;

      setUiRoleHint(resolvedRole);
      callback({
        ...baseUser,
        profile: mergedProfile
      });
    } catch (err) {
      console.error("[CEIT] Error resolving user profile:", err);
      setUiRoleHint(fallbackProfile.role);
      callback({
        ...baseUser,
        profile: fallbackProfile
      });
    }
  });
}

let idleGuardCleanup = null;

/**
 * Automatically signs out inactive sessions on shared lab computers.
 * @param {number} [timeoutMs=1800000]
 */
function startIdleSessionGuard(timeoutMs = DEFAULT_IDLE_TIMEOUT_MS) {
  if (typeof window === "undefined") return;
  if (idleGuardCleanup) idleGuardCleanup();

  let timerId = null;
  const resetTimer = () => {
    if (timerId) clearTimeout(timerId);
    timerId = setTimeout(async () => {
      await signOutUser().catch(() => {});
      window.location.replace("index.html?reason=timeout");
    }, timeoutMs);
  };

  const events = ["pointerdown", "keydown", "scroll", "touchstart"];
  events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));
  resetTimer();

  idleGuardCleanup = () => {
    if (timerId) clearTimeout(timerId);
    events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    idleGuardCleanup = null;
  };
}

/**
 * Route protection helper for pages.
 * Keeps page content hidden (`auth-pending` class on body) until verified.
 * @param {object} options
 * @param {string|null} [options.requiredRole] - "teacher" or "student"
 * @param {string} [options.redirectUrl="index.html"]
 * @param {boolean} [options.preserveTarget=false]
 * @param {function(object): void} [options.onAuthorized]
 */
export function requireAuth({
  requiredRole = null,
  redirectUrl = "index.html",
  preserveTarget = false,
  onAuthorized = () => {}
} = {}) {
  enforceAntiFraming();

  return observeAuthState((user) => {
    if (!user) {
      if (idleGuardCleanup) idleGuardCleanup();
      if (preserveTarget && typeof window !== "undefined") {
        const currentFile = window.location.pathname.split("/").pop() || "dashboard.html";
        const target = `${currentFile}${window.location.search || ""}`;
        window.location.replace(`${redirectUrl}?redirect=${encodeURIComponent(target)}`);
      } else {
        window.location.replace(redirectUrl);
      }
      return;
    }

    const role = user.profile?.role || "student";

    if (requiredRole && role !== requiredRole) {
      console.warn(`[CEIT] Unauthorized: expected role '${requiredRole}', got '${role}'`);
      window.location.replace(role === "teacher" ? "teacher.html" : "dashboard.html");
      return;
    }

    if (typeof document !== "undefined" && document.body) {
      document.body.classList.remove("auth-pending");
    }

    startIdleSessionGuard();
    onAuthorized(user);
  });
}
