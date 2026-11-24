// js/utils.js
// Shared Vanilla JS utility helpers for CEIT (Computer Engineering Item Tracker)

/**
 * Escapes HTML special characters to prevent XSS when inserting strings into templates.
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Converts a Firestore Timestamp, Date, or epoch number into a JS Date object.
 * @param {*} ts
 * @returns {Date|null}
 */
export function toDateObj(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  if (ts instanceof Date) return ts;
  if (typeof ts === "number") return new Date(ts);
  return null;
}

/**
 * Formats a date nicely (e.g. "Nov 24, 2026").
 * @param {*} ts
 * @returns {string}
 */
export function formatDate(ts) {
  const d = toDateObj(ts);
  if (!d || isNaN(d.getTime())) return "N/A";
  return d.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

/**
 * Formats a date and time nicely (e.g. "Nov 24, 2026, 2:15 PM").
 * @param {*} ts
 * @returns {string}
 */
export function formatDateTime(ts) {
  const d = toDateObj(ts);
  if (!d || isNaN(d.getTime())) return "Just now";
  return d.toLocaleString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

/**
 * Formats a human-friendly relative due countdown (e.g., "Due in 5 days", "Due tomorrow", "2 days overdue").
 * @param {*} ts
 * @returns {string}
 */
export function formatRelativeDue(ts) {
  const d = toDateObj(ts);
  if (!d || isNaN(d.getTime())) return "";
  const diffMs = d.getTime() - Date.now();
  const absHours = Math.abs(diffMs) / (1000 * 60 * 60);
  const absDays = Math.ceil(absHours / 24);

  if (diffMs < 0) {
    if (absHours < 24) return "Overdue today";
    return absDays === 1 ? "1 day overdue" : `${absDays} days overdue`;
  }
  if (absHours <= 12) return "Due today";
  if (absHours <= 36) return "Due tomorrow";
  return `Due in ${Math.round(absHours / 24)} days`;
}

/**
 * Translates Firebase Auth error codes into clear, helpful messages.
 * @param {Error} err
 * @returns {string}
 */
export function getFriendlyAuthError(err) {
  const code = err?.code || "";
  switch (code) {
    case "auth/popup-closed-by-user":
      return "Sign-in popup was closed before completing. Please try again.";
    case "auth/popup-blocked":
      return "Your browser blocked the Google Sign-In popup. Please allow popups for this site or use Email/Password below.";
    case "auth/unauthorized-domain":
      return "This domain is not yet authorized in Firebase Authentication settings. Use Email/Password or add this domain in Firebase Console.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password. Double-check your credentials or create an account.";
    case "auth/email-already-in-use":
      return "An account with this email already exists. Switch to Sign In instead.";
    case "auth/weak-password":
      return "Password is too weak. Please choose at least 6 characters.";
    case "auth/invalid-email":
      return "Please enter a valid email address (e.g., 123456@pdsb.net).";
    case "auth/network-request-failed":
      return "Network error. Check your internet connection and try again.";
    case "auth/too-many-requests":
      return "Too many failed attempts. Please wait a minute and try again.";
    default:
      return err?.message || "An unexpected authentication error occurred.";
  }
}

/**
 * Parses a scanned QR string or typed text into a normalized item code.
 * Supports both full checkout URLs (e.g., https://ceit.site/checkout.html?code=ARD-01)
 * and plain text item codes (e.g., ARD-01).
 * @param {string} raw
 * @returns {string}
 */
export function extractCodeFromScan(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      const codeParam = url.searchParams.get("code");
      if (codeParam) {
        return codeParam.trim().toUpperCase();
      }
    }
  } catch {
    // Not a valid URL; treat as raw code
  }

  // Handle relative query strings like "checkout.html?code=ARD-01" or "code=ARD-01"
  const match = trimmed.match(/(?:\?|&)code=([^&]+)/i) || trimmed.match(/^code=([^&]+)/i);
  if (match && match[1]) {
    try {
      return decodeURIComponent(match[1]).trim().toUpperCase();
    } catch {
      return match[1].trim().toUpperCase();
    }
  }

  return trimmed.toUpperCase();
}

/**
 * Builds the scannable checkout URL encoded inside a component's QR code.
 * Scanning with a phone camera opens CEIT directly to checkout.html?code=...
 * @param {string} code
 * @returns {string}
 */
export function buildCheckoutQrUrl(code) {
  const normalized = (code || "").trim().toUpperCase();
  if (typeof window !== "undefined" && window.location && /^https?:/.test(window.location.origin)) {
    const basePath = window.location.pathname.replace(/[^/]*$/, "");
    return `${window.location.origin}${basePath}checkout.html?code=${encodeURIComponent(normalized)}`;
  }
  return `https://ceit.site/checkout.html?code=${encodeURIComponent(normalized)}`;
}

/**
 * Suggests a clean item code based on category and item name (e.g. "MCU-ARD-01").
 * @param {string} category
 * @param {string} name
 * @param {Array<object>} existingItems
 * @returns {string}
 */
export function generateSuggestedCode(category, name, existingItems = []) {
  const catMap = {
    Microcontrollers: "MCU",
    Sensors: "SEN",
    Components: "CMP",
    "Cables & Tools": "CTL",
    "Cables & Power": "PWR",
    "Tools & Meters": "TLS",
    General: "GEN"
  };

  const prefix = catMap[category] || "CEIT";
  const words = (name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let stem = "ITEM";
  if (words.length >= 2) {
    stem = (words[0].slice(0, 3) + words[1].slice(0, 2)).slice(0, 5);
  } else if (words.length === 1) {
    stem = words[0].slice(0, 4);
  }

  const existingCodes = new Set(
    existingItems.map((i) => (i.code || "").trim().toUpperCase())
  );

  for (let n = 1; n <= 999; n++) {
    const num = String(n).padStart(2, "0");
    const candidate = `${prefix}-${stem}-${num}`;
    if (!existingCodes.has(candidate)) {
      return candidate;
    }
  }
  return `${prefix}-${Date.now().toString().slice(-4)}`;
}

/**
 * Validates that a redirect query parameter is a safe local relative page.
 * @param {string|null} target
 * @returns {string|null}
 */
export function sanitizeRedirectUrl(target) {
  if (!target) return null;
  const trimmed = target.trim();
  // Allow only local relative html files in the same folder
  if (/^[a-z0-9_-]+\.html(\?[a-z0-9_=&%-]*)?$/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

/**
 * Shows a non-blocking toast notification in the bottom-right corner.
 * @param {string} message
 * @param {"info"|"success"|"warn"} [type="info"]
 * @param {number} [durationMs=3500]
 */
export function showToast(message, type = "info", durationMs = 3500) {
  let container = document.getElementById("ceit-toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "ceit-toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `ceit-toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = "opacity 0.25s ease";
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 260);
  }, durationMs);
}

/**
 * Exports an array of checkout records as a downloadable CSV file.
 * @param {Array<object>} records
 * @param {string} [filename="ceit-checkout-logs.csv"]
 */
export function exportCheckoutsToCsv(records, filename = "ceit-checkout-logs.csv") {
  const headers = [
    "Checkout ID",
    "Item Name",
    "Item Code",
    "Category",
    "Student Name",
    "Student Number",
    "Student Email",
    "Mode",
    "Status",
    "Checked Out At",
    "Due Date",
    "Returned At",
    "Returned By",
    "Notes"
  ];

  const escapeCsv = (val) => {
    const str = String(val ?? "").replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = records.map((r) => [
    r.id,
    r.itemName,
    r.itemCode,
    r.category || "General",
    r.studentName,
    r.studentNumber || "N/A",
    r.studentEmail || "",
    r.isGuest ? "Teacher Guest Sign-Out" : "Student Self Sign-Out",
    r.status,
    formatDateTime(r.checkedOutAt),
    formatDate(r.dueDate),
    r.returnedAt ? formatDateTime(r.returnedAt) : "",
    r.returnedBy || "",
    r.notes || ""
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
