// js/firebase-config.js
// Computer Engineering Item Tracker (CEIT) - Firebase Configuration
// Uses Firebase v11 Modular SDK via official Google CDN (pure Vanilla JS, no bundlers)

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/**
 * Replace the placeholders below with the credentials from your Firebase Console:
 * Firebase Console -> Project Settings -> General -> Your apps -> Web app -> SDK setup and configuration.
 * See FIREBASE_SETUP.md for detailed steps.
 */
export const firebaseConfig = {
  apiKey: "AIzaSyBtYY_XShKCrfwhc7gaE1Yo612UbhYHEXk",
  authDomain: "compengit.firebaseapp.com",
  projectId: "compengit",
  storageBucket: "compengit.firebasestorage.app",
  messagingSenderId: "204700968128",
  appId: "1:204700968128:web:347fd061282e454254b925"
};

/**
 * Default teacher emails. Any user signing in with these emails will automatically
 * be granted the "teacher" role in Firestore.
 */
export const INITIAL_TEACHER_EMAILS = [
  "p0161177@pdsb.net", // Mr. Kidston
  "882914@pdsb.net",   // Admin
  "1027290@pdsb.net",  // Admin
];

/**
 * Checks whether the user has replaced placeholder values with real Firebase credentials.
 * @returns {boolean}
 */
export function isFirebaseConfigured() {
  return (
    Boolean(firebaseConfig.apiKey) &&
    firebaseConfig.apiKey !== "YOUR_API_KEY" &&
    firebaseConfig.projectId !== "YOUR_PROJECT_ID"
  );
}

// Initialize Firebase App and Services
let app = null;
let auth = null;
let db = null;

if (isFirebaseConfigured()) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true
    });
    console.log("[CEIT] Firebase initialized successfully.");
  } catch (err) {
    console.error("[CEIT] Error initializing Firebase:", err);
  }
} else {
  console.warn(
    "[CEIT] Firebase is not yet configured. Please set your credentials in js/firebase-config.js (see FIREBASE_SETUP.md)."
  );
}

export { app, auth, db };
