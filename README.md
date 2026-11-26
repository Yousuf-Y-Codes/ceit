# Computer Engineering Item Tracker (CEIT)

A lightweight, secure, pure HTML/CSS/JS web application for the **Computer Engineering Lab (Mr. Kidston)** allowing students to sign out and return hardware components via QR codes or text codes, with a full admin panel for teachers to manage inventory and print QR bin labels.

- **Live Site:** [https://ceit.site](https://ceit.site) / [https://yousuf-y-codes.github.io/ceit/](https://yousuf-y-codes.github.io/ceit/)
- **Course / Stakeholder:** Computer Engineering — Mr. Kidston
- **Team:** Yousuf Yaghmour & Ahmed Salem
- **Tech Stack:** Pure Vanilla HTML5, CSS3, ES Module JavaScript (zero frameworks, zero build step) + Firebase v11 CDN (Auth & Cloud Firestore)
- **Visual Style:** Classic Flat Blueprint Lab (sharp corners, flat solid colors, 100% system fonts, zero animations for instant classroom load speed)

---

## Features & Security Architecture

### 1. Verified Google OAuth Only (`index.html`)
- **Google Sign-In ONLY:** Email/Password authentication has been removed to eliminate unverified email impersonation.
- **Multi-layer verification:** Both `auth-service.js` (ID token claim + provider check) and `firestore.rules` (`sign_in_provider == 'google.com'` + `email_verified == true`) enforce verified school Google sessions.
- **Shared Lab PC Protection:** Uses `browserSessionPersistence` (closing the browser tab ends the session) plus a 30-minute inactivity auto-sign-out timer.
- **Automatic Role & Student Number Detection:**
  - Numeric student ID email -> **Student** role, student number extracted automatically
  - Staff ID email (`p<digits>`) -> **Teacher** role (routed to `teacher.html`)
- **Defense-in-Depth Hardening:**
  - Strict Content Security Policy (CSP) on every page with zero inline scripts (`js/pages/*`).
  - Anti-privilege-escalation and atomic `getAfter()` validation in `firestore.rules`, plus immutable checkout audit logs.
  - CSV formula-injection neutralization, allowlisted redirect sanitization, clickjacking protection, and auth-pending DOM guards.

### 2. Student Dashboard (`dashboard.html`)
- Live summary counters: **Checked Out Now**, **Due Within 24h**, **Overdue**, and **Total Returned**.
- **Active Loans:** View component names, codes, checkout timestamps, due dates, status badges, and return items back to inventory.
- **Return History:** Full personal record of returned hardware.
- **Lab Catalog:** Searchable read-only catalog with one-click check-out links.

### 3. Single-Screen Check Out Form (`checkout.html`)
- **Step 1 — Component Code or Inline QR Scan:** Type an item code, pick from the in-stock dropdown, or open the inline camera QR scanner (`getUserMedia` + `jsQR` / `BarcodeDetector`) with an image upload fallback.
- **Step 2 — Explicit Class Period (`Period 1`–`Period 4`):** No default pre-selected so every loan is accurately grouped by class period.
- **Step 3 — Defaults & Confirm:** Auto-filled school account ID, default 1-week duration (adjustable 1–30 days) with live due-date preview, and atomic Firestore checkout.

### 4. Teacher Admin Panel (`teacher.html`)
- Strict teacher role guard (`requireAuth({ requiredRole: "teacher" })`).
- **Active Sign-Outs:** Real-time monitor with **Class Period filter (`Period 1`–`Period 4`)**, search, overdue/due-soon/guest filters, one-click **Check In**, and pre-filled `mailto:` **Email Reminders**.
- **Inventory & Printable QR Labels:**
  - Create new components with auto-generated unique codes (e.g., `MCU-ARDUN-01`).
  - Transactional stock editing (prevents concurrency desync and reducing stock below checked-out units) or deleting items.
  - Generate crisp offline QR code labels (Canvas + SVG via `js/lib/qrcode.js`), download PNGs, or print a 3-column cut-out **Print All QR Labels** sheet.
- **Guest Sign-Out Mode:** Sign out components on behalf of students (with Period 1–4 assignment) without requiring them to log in.
- **Audit History & CSV Export:** Complete chronological log with Period filter and one-click CSV download (includes `Period` and formula-injection protection).

### 5. Documentation (`docs.html`) & Teacher Diagnostics (`test-backend.html`)
- In-app **User Documentation** (`docs.html`) covering every feature for students and teachers.
- **Backend Diagnostic Console** (`test-backend.html`), restricted to verified teachers only.

---

## Project File Structure

```text
ceit/
├── index.html                   # Google OAuth sign-in portal (auto-routes by role)
├── login.html                   # Redirect stub -> index.html
├── dashboard.html               # Student Dashboard (active loans, history, catalog)
├── checkout.html                # Component Check-Out (text code + QR camera/image scanner)
├── teacher.html                 # Teacher Admin Panel (active loans, inventory, QR print, guest mode, CSV)
├── docs.html                    # In-app User Documentation for students & teachers
├── test-backend.html            # Teacher-only Firebase backend diagnostic console
├── css/
│   └── style.css                # Classic Flat Blueprint Lab theme + print stylesheet
├── js/
│   ├── firebase-config.js       # Firebase v11 initialization & teacher email whitelist
│   ├── utils.js                 # XSS escaping, CSV neutralization, QR parser, allowlisted redirects, toasts
│   ├── lib/
│   │   └── qrcode.js            # Zero-dependency pure-JS ISO/IEC 18004 QR code generator
│   ├── pages/                   # External ES module scripts (enables strict CSP with no inline scripts)
│   │   ├── index.js
│   │   ├── dashboard.js
│   │   ├── checkout.js
│   │   ├── teacher.js
│   │   ├── docs.js
│   │   ├── test-backend.js
│   │   └── login-redirect.js
│   └── services/
│       ├── auth-service.js      # Verified Google OAuth, session persistence, idle timeout, route guards
│       ├── item-service.js      # Validated inventory CRUD, transactional stock updates, live listener
│       └── checkout-service.js  # Atomic checkout/return transactions, guest mode, audit streams
├── firestore.rules              # Hardened Cloud Firestore security rules
├── FIREBASE_SETUP.md            # Step-by-step Firebase setup & security deployment guide
├── CNAME                        # Custom GitHub Pages domain (ceit.site)
└── .nojekyll                    # Static GitHub Pages serving
```

---

## Local Development & Deployment

1. Run a local static server from the repository root:
   ```bash
   python3 -m http.server 8000
   ```
2. Visit `http://localhost:8000/`.
3. Publish [`firestore.rules`](./firestore.rules) in Firebase Console and ensure **Email/Password** sign-in is disabled under **Authentication -> Sign-in method** (see [`FIREBASE_SETUP.md`](./FIREBASE_SETUP.md)).
4. Deployed automatically via **GitHub Pages** from the `main` branch.
