# Computer Engineering Item Tracker (CEIT)

A lightweight web app for the PDSB Computer Engineering lab (Mr. Kidston) allowing students to sign out and return hardware components via codes/QR codes, with an admin panel for teachers to track inventory.

- **Live URL:** [https://yousuf-y-codes.github.io/ceit/](https://yousuf-y-codes.github.io/ceit/)
- **Tech Stack:** Pure Vanilla HTML/CSS/JS (no frameworks) + Firebase v11 CDN
- **Team:** Ahmed Salem & Yousuf Yaghmour

---

## Quick Reference for Ahmed (Front-End Integration)

All backend functions are ready in `/js/services/`. Just import what you need with `<script type="module">`:

### 1. Log In Page (`login.html`)
```javascript
import { signInWithGoogle, signInWithEmail, observeAuthState } from "./js/services/auth-service.js";

// Google Sign-In button click
await signInWithGoogle();

// Redirect based on role
observeAuthState((user) => {
  if (!user) return;
  if (user.profile.role === "teacher") {
    window.location.href = "teacher.html";
  } else {
    window.location.href = "dashboard.html";
  }
});
```

### 2. Student Dashboard (`dashboard.html`)
```javascript
import { observeAuthState, signOutUser } from "./js/services/auth-service.js";
import { subscribeToStudentActiveCheckouts } from "./js/services/checkout-service.js";

observeAuthState((user) => {
  if (!user) { window.location.href = "login.html"; return; }

  // Listen to the student's checked-out items in real-time
  subscribeToStudentActiveCheckouts(user.uid, (items) => {
    // items = [{ id, itemName, itemCode, checkedOutAt, dueDate, ... }]
    console.log("My items:", items);
  });
});
```

### 3. Check Out Page (`checkout.html`)
```javascript
import { getItemByCode } from "./js/services/item-service.js";
import { checkOutItem } from "./js/services/checkout-service.js";

// 1. Look up item by scanned QR or typed code
const item = await getItemByCode("ARD-UNO-01");

// 2. Sign out item for student
await checkOutItem({
  itemId: item.id,
  user: currentUser,
  durationDays: 7
});

// 3. Return to dashboard
window.location.href = "dashboard.html";
```

---

## Features & Pages Overview

1. **Sign In / Log In (`login.html`)**
   - Supports Google Sign-In (`@pdsb.net`) and email/password fallback.
   - Automatically directs teachers to `teacher.html` and students to `dashboard.html`.

2. **Student Dashboard (`dashboard.html`)**
   - Displays all hardware components currently checked out by the student.
   - Shows check-out date and due date.
   - Contains a button to open the Check Out page.

3. **Check Out Page (`checkout.html`)**
   - Lets students type in an item code or scan a QR code.
   - Atomically decrements the component stock and returns student to dashboard.

4. **Teacher Panel (`teacher.html`)**
   - Shows all active sign-outs and student numbers across the lab.
   - Allows teachers to add new items and generate item/QR codes.
   - Allows checking items back into inventory.

5. **Diagnostic Console (`test-backend.html`)**
   - Developer tool to verify live Firebase auth, inventory, and checkouts.
