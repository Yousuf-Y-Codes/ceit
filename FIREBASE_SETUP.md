# CEIT Firebase Setup Guide

This guide walks you through setting up and securing the Firebase backend for the **Computer Engineering Item Tracker (CEIT)** web application.

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
3. Leave "Also set up Firebase Hosting" **unchecked** (since you deploy with GitHub Pages).
4. Click **Register app**.
5. Copy the `firebaseConfig` snippet into [`js/firebase-config.js`](./js/firebase-config.js).

---

## 3. Configure Authentication Providers (Google OAuth ONLY)

1. In the left sidebar of the Firebase Console, navigate to **Build** -> **Authentication**.
2. Click **Get Started**.
3. Under the **Sign-in method** tab:

### A. Enable Google Sign-In (Required for `@pdsb.net`)
- Click **Google**.
- Toggle **Enable**.
- Set the **Project public-facing name** to `CEIT - Computer Engineering`.
- Select your support email from the dropdown.
- Click **Save**.

### B. Disable Email / Password (Important Security Step)
- Ensure **Email/Password** is **DISABLED** (or deleted) under **Sign-in method**.
- Email/Password sign-up allows creating unverified accounts with arbitrary `@pdsb.net` addresses. Both the client app and `firestore.rules` strictly require verified Google OAuth sessions (`sign_in_provider == 'google.com'` and `email_verified == true`).
- If any test Email/Password accounts were previously created, delete them under **Authentication -> Users**.

### C. Configure Authorized Domains
- Switch to the **Settings** tab -> **Authorized domains**.
- Ensure `localhost`, `127.0.0.1`, `ceit.site`, and your GitHub Pages domain (`<your-github-username>.github.io`) are present.

---

## 4. Deploy Cloud Firestore Security Rules

1. In the left sidebar, navigate to **Build** -> **Firestore Database**.
2. Switch to the **Rules** tab at the top.
3. Replace the existing rules with the exact contents of [`firestore.rules`](./firestore.rules) from this repository and click **Publish**.

### What `firestore.rules` Enforces Server-Side
- **Google OAuth + Verified `@pdsb.net` Only:** Rejects all non-Google providers, unverified emails, and non-`@pdsb.net` domains.
- **Anti-Privilege-Escalation on `/users/{uid}`:** Students can only read their own profile and can never set `role: "teacher"` or spoof another student's ID/email.
- **Atomic Stock Integrity on `/items/{itemId}`:** Students can only update `availableQuantity` by exactly `±1` within `[0, totalQuantity]`. Only teachers can create, edit metadata/totals, or delete items.
- **Tamper-Proof Loans & Audit Trail on `/checkouts/{checkoutId}`:** Student checkouts must match their verified UID, email, student number, valid period (`Period 1`–`Period 4`), duration (1–30 days), and verify atomic stock decrement via `getAfter()`. Students can only transition their own active loan to `returned`. Audit deletions are blocked (`allow delete: if false`).
- **Default Deny:** All other Firestore paths are denied by default.

---

## 5. Teacher Whitelist Configuration

In [`js/firebase-config.js`](./js/firebase-config.js), Mr. Kidston's email (`p0161177@pdsb.net`) is whitelisted, and all verified `p<digits>@pdsb.net` Google accounts are automatically recognized as teachers in both client code and `firestore.rules`.

---

## 6. Verification with `test-backend.html`

1. Start a local static server from the repository root:
   ```bash
   python3 -m http.server 8000
   ```
2. Sign in with a verified teacher `@pdsb.net` Google account at `http://localhost:8000/`.
3. Visit [http://localhost:8000/test-backend.html](http://localhost:8000/test-backend.html) (restricted to teachers only) to verify live inventory creation, atomic checkout, and return transactions.
