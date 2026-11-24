# Computer Engineering Item Tracker (CEIT)

A lightweight, pure HTML/CSS/JS web application for the **PDSB Computer Engineering Lab (Mr. Kidston)** allowing students to sign out and return hardware components via QR codes or text codes, with a full admin panel for teachers to manage inventory and print QR bin labels.

- **Live Site:** [https://ceit.site](https://ceit.site) / [https://yousuf-y-codes.github.io/ceit/](https://yousuf-y-codes.github.io/ceit/)
- **Course / Stakeholder:** Computer Engineering — Mr. Kidston (`p0161177@pdsb.net`)
- **Team:** Yousuf Yaghmour & Ahmed Salem
- **Tech Stack:** Pure Vanilla HTML5, CSS3, ES Module JavaScript (zero frameworks, zero build step) + Firebase v11 CDN (Auth & Cloud Firestore)
- **Visual Style:** Classic Flat Blueprint Lab (sharp corners, flat solid colors, 100% system fonts, zero animations for instant classroom load speed)

---

## Features

### 1. Authentication & Role Routing (`index.html`)
- **Strict `@pdsb.net` access control** enforced in Google Sign-In, Email/Password auth, session observer, and Cloud Firestore security rules.
- **Email & Password Sign-In / Sign-Up fallback** in case PDSB IT restricts third-party Google OAuth on school computers.
- **Automatic Student Number & Teacher Role detection** from PDSB emails (variable number of digits):
  - `<digits>@pdsb.net` -> **Student** role, student number = `<digits>`
  - `p<digits>@pdsb.net` -> **Teacher** role (routed to `teacher.html`)
- Deep-link redirect preservation: scanning a printed QR code (`checkout.html?code=...`) while logged out redirects back to that exact component after signing in.

### 2. Student Dashboard (`dashboard.html`)
- Live summary counters: **Checked Out Now**, **Due Within 24h**, **Overdue**, and **Total Returned**.
- **My Checked Out Items:** View component names, codes, checkout timestamps, due dates, status badges, and return items back to inventory.
- **My Return History:** Full personal record of returned hardware.
- **Available Lab Inventory:** Searchable read-only catalog with one-click check-out links.

### 3. Single-Screen Check Out Form (`checkout.html`)
- **Step 1 — Component Code or Inline QR Scan:** Type an item code, pick from the in-stock dropdown, or open the inline camera QR scanner (`getUserMedia` + `jsQR` / `BarcodeDetector`) with an image upload fallback.
- **Step 2 — Explicit Class Period (`Period 1`–`Period 4`):** No default pre-selected so every loan is accurately grouped by class period.
- **Step 3 — Defaults & Confirm:** Auto-filled PDSB ID, default 1-week duration (adjustable 1–30 days) with live due-date preview, and atomic Firestore checkout.

### 4. Teacher Admin Panel (`teacher.html`)
- Strict teacher role guard (`requireAuth({ requiredRole: "teacher" })`).
- **Active Sign-Outs:** Real-time monitor with **Class Period filter (`Period 1`–`Period 4`)**, search, overdue/due-soon/guest filters, one-click **Check In**, and pre-filled `mailto:` **Email Reminders**.
- **Inventory & Printable QR Labels:**
  - Create new components with auto-generated unique codes (e.g., `MCU-ARDUN-01`).
  - Edit item details/quantities (with safety checks against currently checked-out units) or delete items.
  - Generate crisp offline QR code labels (Canvas + SVG via `js/lib/qrcode.js`), download PNGs, or print a 3-column cut-out **Print All QR Labels** sheet.
- **Guest Sign-Out Mode:** Sign out components on behalf of students (with Period 1–4 assignment) without requiring them to log in.
- **Audit History & CSV Export:** Complete chronological log with Period filter and one-click CSV download (includes `Period`).

### 5. Documentation (`docs.html`) & Diagnostics (`test-backend.html`)
- In-app **User Documentation** (`docs.html`) covering every feature for both students and teachers.
- **Backend Diagnostic Console** (`test-backend.html`) for verifying live Firebase Auth and Firestore operations.

---

## Project File Structure

```text
ceit/
├── index.html                   # Login / Sign-Up portal (auto-routes by role)
├── login.html                   # Redirect stub -> index.html
├── dashboard.html               # Student Dashboard (active loans, history, catalog)
├── checkout.html                # Component Check-Out (text code + QR camera/image scanner)
├── teacher.html                 # Teacher Admin Panel (active loans, inventory, QR print, guest mode, CSV)
├── docs.html                    # In-app User Documentation for students & teachers
├── test-backend.html            # Live Firebase backend diagnostic console
├── css/
│   └── style.css                # Classic Flat Blueprint Lab theme + print stylesheet (zero animations, 100% system fonts)
├── js/
│   ├── firebase-config.js       # Firebase v11 initialization & teacher email whitelist
│   ├── utils.js                 # XSS escaping, relative due countdowns, QR parser, CSV export, toasts
│   ├── lib/
│   │   └── qrcode.js            # Zero-dependency pure-JS ISO/IEC 18004 QR code generator
│   └── services/
│       ├── auth-service.js      # Google OAuth, Email/Password, profile sync, route guards
│       ├── item-service.js      # Inventory CRUD, code lookup, real-time listener
│       └── checkout-service.js  # Atomic checkout/return transactions, guest mode, audit streams
├── firestore.rules              # Cloud Firestore security rules
├── FIREBASE_SETUP.md            # Step-by-step Firebase setup reference
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
3. For Firebase configuration, Firestore security rules, and adding additional teacher emails, see [`FIREBASE_SETUP.md`](./FIREBASE_SETUP.md) and [`firestore.rules`](./firestore.rules).
4. Deployed automatically via **GitHub Pages** from the `main` branch.

---

## Out of Scope (By Design)
- Native iOS/Android/Desktop apps (runs directly in any web browser)
- Custom physical barcode/QR scanner hardware
- Component photo/image uploads
- Item holds / advance reservations
