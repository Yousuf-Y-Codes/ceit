// js/services/auth-service.js
// Authentication Service for CEIT (Computer Engineering Item Tracker)
// Handles Google OAuth (@pdsb.net), Email/Password fallback, role assignment, and auth state listeners.

import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import { auth, db, INITIAL_TEACHER_EMAILS, isFirebaseConfigured } from "../firebase-config.js";

const googleProvider = new GoogleAuthProvider();
// Prompt user to select their @pdsb.net account every time for shared lab computers
googleProvider.setCustomParameters({
  prompt: "select_account",
  hd: "pdsb.net"
});

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
  if (!email) return false;
  return /^[^@\s]+@pdsb\.net$/i.test(email.trim());
}

/**
 * Throws if an email is not a valid @pdsb.net address.
 * @param {string} email
 */
function assertPdsbEmail(email) {
  if (!isPdsbEmail(email)) {
    throw new Error(
      `Access restricted: Only Peel District School Board (@pdsb.net) emails are allowed.${email ? ` You used: ${email}` : ""}`
    );
  }
}

/**
 * Extracts student number from a PDSB student email (e.g. 1234567890@pdsb.net -> "1234567890").
 * Number of digits varies across PDSB accounts. Returns "" for teacher emails (p<digits>@pdsb.net).
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
 * matches p<digits>@pdsb.net (variable digits) or is in INITIAL_TEACHER_EMAILS.
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
 * Alias for isWhitelistedTeacher — checks if a @pdsb.net email is a teacher account.
 * @param {string} email
 * @returns {boolean}
 */
export function isTeacherEmail(email) {
  return isWhitelistedTeacher(email);
}

/**
 * Creates or updates the user profile record in Firestore `users/{uid}`.
 * @param {object} firebaseUser
 * @param {object} extraData - optional extra fields (e.g. studentNumber, customRole)
 * @returns {Promise<object>} The combined user profile.
 */
export async function syncUserProfile(firebaseUser, extraData = {}) {
  assertFirebaseReady();
  const email = (firebaseUser.email || "").toLowerCase().trim();
  const isTeacher = isWhitelistedTeacher(email);
  const inferredStudentNumber = extractStudentNumberFromEmail(email);

  const fallbackProfile = {
    uid: firebaseUser.uid,
    email: email,
    displayName: firebaseUser.displayName || extraData.displayName || "User",
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
    } else {
      const existingData = userSnap.data();
      const updates = { lastLoginAt: serverTimestamp() };
      if (isTeacher && existingData.role !== "teacher") updates.role = "teacher";
      if (inferredStudentNumber && existingData.studentNumber !== inferredStudentNumber) {
        updates.studentNumber = inferredStudentNumber;
      }
      if (extraData.displayName && extraData.displayName !== existingData.displayName) {
        updates.displayName = extraData.displayName;
      }
      await withTimeout(updateDoc(userRef, updates), 3500);
      return { ...existingData, ...updates };
    }
  } catch (err) {
    console.warn(
      "[CEIT] Firestore profile sync skipped (database may be offline or not initialized yet):",
      err.message
    );
    return fallbackProfile;
  }
}

/**
 * Sign in with Google Popup.
 * Strictly requires a Peel District School Board (@pdsb.net) account.
 * @param {boolean} [enforcePdsbDomain=true]
 * @returns {Promise<object>} Combined user profile
 */
export async function signInWithGoogle(enforcePdsbDomain = true) {
  assertFirebaseReady();
  const result = await signInWithPopup(auth, googleProvider);
  const user = result.user;
  const email = (user.email || "").toLowerCase().trim();

  if (enforcePdsbDomain && !isPdsbEmail(email)) {
    await signOut(auth);
    throw new Error(
      `Access restricted: Please sign in with your Peel District School Board account (@pdsb.net). You used: ${email}`
    );
  }

  const profile = await syncUserProfile(user);
  return { user, profile };
}

/**
 * Sign up with Email and Password (for fallback if Google OAuth is blocked by school admin).
 * Strictly requires a @pdsb.net email; student number and teacher role are derived from the email.
 * @param {string} email
 * @param {string} password
 * @param {string} displayName
 * @returns {Promise<object>}
 */
export async function signUpWithEmail(email, password, displayName) {
  assertFirebaseReady();
  const cleanEmail = (email || "").trim().toLowerCase();
  assertPdsbEmail(cleanEmail);

  const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
  if (displayName) {
    await updateProfile(cred.user, { displayName: displayName.trim() });
  }
  const profile = await syncUserProfile(cred.user, {
    displayName: (displayName || "").trim()
  });
  return { user: cred.user, profile };
}

/**
 * Sign in with Email and Password.
 * Strictly requires a @pdsb.net email.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<object>}
 */
export async function signInWithEmail(email, password) {
  assertFirebaseReady();
  const cleanEmail = (email || "").trim().toLowerCase();
  assertPdsbEmail(cleanEmail);

  const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
  const profile = await syncUserProfile(cred.user);
  return { user: cred.user, profile };
}

/**
 * Sign out the current user.
 * @returns {Promise<void>}
 */
export async function signOutUser() {
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
    email: u.email || "",
    displayName: u.displayName || "User",
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
 * Updates the current user's student number in Firestore `users/{uid}`.
 * @param {string} uid
 * @param {string} studentNumber
 * @returns {Promise<string>} Normalized student number
 */
export async function updateUserStudentNumber(uid, studentNumber) {
  assertFirebaseReady();
  const clean = (studentNumber || "").trim();
  if (!uid) throw new Error("User ID is required.");
  const userRef = doc(db, "users", uid);
  await setDoc(
    userRef,
    {
      studentNumber: clean,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
  return clean;
}

/**
 * Observes auth state changes. Fetches the Firestore profile and invokes callback.
 * Preserves Firebase User properties explicitly so prototype getters are never dropped.
 * @param {function(object|null): void} callback Receives the enriched user object (or null if logged out)
 * @returns {function(): void} Unsubscribe function
 */
export function observeAuthState(callback) {
  if (!isFirebaseConfigured() || !auth) {
    callback(null);
    return () => {};
  }

  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      callback(null);
      return;
    }

    // Reject any non-@pdsb.net session immediately
    if (!isPdsbEmail(firebaseUser.email)) {
      console.warn(`[CEIT] Signing out unauthorized non-PDSB email: ${firebaseUser.email}`);
      await signOut(auth).catch(() => {});
      callback(null);
      return;
    }

    const baseUser = {
      uid: firebaseUser.uid,
      email: firebaseUser.email || "",
      displayName: firebaseUser.displayName || "",
      photoURL: firebaseUser.photoURL || ""
    };
    const derivedStudentNumber = extractStudentNumberFromEmail(firebaseUser.email);
    const fallbackProfile = {
      uid: firebaseUser.uid,
      email: firebaseUser.email || "",
      displayName: firebaseUser.displayName || "User",
      role: isWhitelistedTeacher(firebaseUser.email) ? "teacher" : "student",
      studentNumber: derivedStudentNumber
    };
    try {
      const profile = await getCurrentUserProfile();
      const mergedProfile = profile
        ? {
            ...profile,
            role: isWhitelistedTeacher(firebaseUser.email) ? "teacher" : (profile.role || "student"),
            studentNumber: derivedStudentNumber || profile.studentNumber || ""
          }
        : fallbackProfile;
      callback({
        ...baseUser,
        profile: mergedProfile
      });
    } catch (err) {
      console.error("[CEIT] Error resolving user profile:", err);
      callback({
        ...baseUser,
        profile: fallbackProfile
      });
    }
  });
}

/**
 * Route protection helper for pages.
 * Redirects unauthorized users to the specified URL.
 * @param {object} options
 * @param {string} [options.requiredRole] - "teacher" or "student". If set, enforces role.
 * @param {string} [options.redirectUrl="index.html"] - Where to send unauthorized users.
 * @param {boolean} [options.preserveTarget=false] - Attach current page as ?redirect=... on login redirect.
 * @param {function(object): void} [options.onAuthorized] - Callback when authorized.
 */
export function requireAuth({
  requiredRole = null,
  redirectUrl = "index.html",
  preserveTarget = false,
  onAuthorized = () => {}
} = {}) {
  return observeAuthState((user) => {
    if (!user) {
      if (preserveTarget && typeof window !== "undefined") {
        const currentFile = window.location.pathname.split("/").pop() || "dashboard.html";
        const target = `${currentFile}${window.location.search || ""}`;
        window.location.href = `${redirectUrl}?redirect=${encodeURIComponent(target)}`;
      } else {
        window.location.href = redirectUrl;
      }
      return;
    }

    const role = user.profile?.role || "student";

    if (requiredRole && role !== requiredRole) {
      console.warn(`[CEIT] Unauthorized: expected role '${requiredRole}', got '${role}'`);
      if (role === "teacher") {
        window.location.href = "teacher.html";
      } else {
        window.location.href = "dashboard.html";
      }
      return;
    }

    onAuthorized(user);
  });
}
