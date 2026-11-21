# CEIT Firebase Setup Guide

This guide walks you through setting up the Firebase backend for the **Computer Engineering Item Tracker (CEIT)** web application.

---

## 1. Create a Firebase Project

1. Navigate to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project** (or **Create a project**).
3. Name your project (e.g., `ceit-pdsb` or `computer-engineering-tracker`).
4. You can disable Google Analytics (not required for this project) to simplify setup, then click **Create project**.
5. Once your project is ready, click **Continue**.

---

## 2. Register Your Web App

1. On your Firebase Project Overview page, click the **Web icon** (`</>`) to add a web application.
2. Enter an App nickname: `CEIT Web App`.
3. Leave "Also set up Firebase Hosting" **unchecked** (since you plan to deploy with GitHub Pages).
4. Click **Register app**.
5. Firebase will display your `firebaseConfig` snippet. It will look like this:
   ```javascript
   const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "your-project-id.firebaseapp.com",
     projectId: "your-project-id",
     storageBucket: "your-project-id.firebasestorage.app",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abcdef..."
   };
   ```
6. Open [`js/firebase-config.js`](./js/firebase-config.js) in this project and paste these values into the `firebaseConfig` object.

---

## 3. Enable Authentication Providers

1. In the left sidebar of the Firebase Console, navigate to **Build** -> **Authentication**.
2. Click **Get Started**.
3. Under the **Sign-in method** tab:

### A. Google Sign-In (Primary for @pdsb.net)
- Click **Google**.
- Toggle **Enable**.
- Set the **Project public-facing name** to `CEIT - Computer Engineering`.
- Select your support email from the dropdown.
- Click **Save**.

### B. Email / Password (Fallback in case PDSB blocks OAuth apps)
- Click **Add new provider** and select **Email/Password**.
- Toggle the first switch **Enable**. (Leave Email link / passwordless disabled).
- Click **Save**.

### C. Configure Authorized Domains
- In the Authentication page, switch to the **Settings** tab.
- Click **Authorized domains**.
- Ensure `localhost` and `127.0.0.1` are present.
- Click **Add domain** and add your GitHub Pages host:
  - `<your-github-username>.github.io`

---

## 4. Set Up Cloud Firestore Database

1. In the left sidebar, navigate to **Build** -> **Firestore Database**.
2. Click **Create database**.
3. Choose a location closest to Ontario (e.g., `northamerica-northeast1` (Montreal) or `us-central1` (Iowa)). Click **Next**.
4. Choose **Start in test mode** for immediate setup, then click **Create**.
5. Once created, switch to the **Rules** tab at the top.
6. Replace the existing rules with the contents of [`firestore.rules`](./firestore.rules) from this repository, and click **Publish**.

---

## 5. Teacher Whitelist Configuration

In [`js/firebase-config.js`](./js/firebase-config.js), Mr. Kidston's email (`p0161177@pdsb.net`) is already whitelisted:

```javascript
export const INITIAL_TEACHER_EMAILS = [
  "p0161177@pdsb.net", // Mr. Kidston
  // Add other teacher emails here if needed
];
```

When a user signs in with an email in this list, their user role is automatically set to `"teacher"` in Firestore. All other users signing in receive the `"student"` role.

---

## 6. Verification with `test-backend.html`

We have provided a diagnostic test page to verify your Firebase backend setup before building the front-end pages:

1. Start a simple local server from the repository root:
   ```bash
   python3 -m http.server 8000
   ```
2. Open [http://localhost:8000/test-backend.html](http://localhost:8000/test-backend.html) in your browser.
3. The page will verify:
   - Config validation (checks if `js/firebase-config.js` has valid keys).
   - Google Sign-In and Email/Password Sign-In.
   - User profile creation and role assignment (`teacher` vs. `student`).
   - Adding a test component to inventory.
   - Signing out an item (atomic transaction test).
   - Returning an item (inventory restock test).

---

## 7. How Ahmed & Yousuf Use These Services in HTML Pages

The services are built as standard ES modules for vanilla JavaScript. To use them in your HTML pages:

```html
<script type="module">
  import { signInWithGoogle, observeAuthState, signOutUser } from "./js/services/auth-service.js";
  import { getItemByCode, subscribeToItems } from "./js/services/item-service.js";
  import { checkOutItem, returnItem, subscribeToStudentActiveCheckouts } from "./js/services/checkout-service.js";

  // Listen to who is logged in
  observeAuthState((user) => {
    if (user) {
      console.log("Logged in as:", user.displayName, "Role:", user.profile?.role);
      // Update your UI here
    } else {
      console.log("Not logged in");
    }
  });
</script>
```
