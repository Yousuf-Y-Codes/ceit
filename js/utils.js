// js/utils.js
// Shared Vanilla JS utility helpers for CEIT (Computer Engineering Item Tracker)

const ALLOWED_REDIRECT_PAGES = new Set([
  "dashboard.html",
  "checkout.html",
  "teacher.html",
  "docs.html",
  "test-backend.html"
]);

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
 * Validates a basic email format safely (bounded length, no control chars or whitespace).
 * @param {string} email
 * @returns {boolean}
 */
export function isValidEmail(email) {
  if (typeof email !== "string") return false;
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 120) return false;
  return /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed);
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
 * Translates Firebase Auth error codes into clear, helpful messages (Google OAuth only).
 * @param {Error} err
 * @returns {string}
 */
export function getFriendlyAuthError(err) {
  const code = err?.code || "";
  switch (code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Google Sign-In popup was closed before completing. Please try again.";
    case "auth/popup-blocked":
      return "Your browser blocked the Google Sign-In popup. Please allow popups for this site and try again.";
    case "auth/unauthorized-domain":
      return "This domain is not authorized in Firebase Authentication settings. Contact your teacher.";
    case "auth/network-request-failed":
      return "Network error. Check your internet connection and try again.";
    case "auth/too-many-requests":
      return "Too many sign-in attempts. Please wait a minute and try again.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact your teacher for assistance.";
    default:
      return err?.message || "An unexpected authentication error occurred.";
  }
}

/**
 * Parses a scanned QR string or typed text into a normalized, safe item code.
 * Supports full checkout URLs (e.g., https://ceit.site/checkout.html?code=ARD-01)
 * and plain text item codes (e.g., ARD-01).
 * @param {string} raw
 * @returns {string}
 */
export function extractCodeFromScan(raw) {
  const trimmed = String(raw ?? "").trim().slice(0, 256);
  if (!trimmed) return "";

  let candidate = trimmed;

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      const codeParam = url.searchParams.get("code");
      if (codeParam) {
        candidate = codeParam.trim();
      }
    }
  } catch {
    // Not a valid URL; treat as raw code
  }

  if (candidate === trimmed) {
    const match = trimmed.match(/(?:\?|&)code=([^&]+)/i) || trimmed.match(/^code=([^&]+)/i);
    if (match && match[1]) {
      try {
        candidate = decodeURIComponent(match[1]).trim();
      } catch {
        candidate = match[1].trim();
      }
    }
  }

  return candidate.toUpperCase().slice(0, 32);
}

/**
 * Builds the scannable checkout URL encoded inside a component's QR code.
 * Scanning with a phone camera opens CEIT directly to checkout.html?code=...
 * @param {string} code
 * @returns {string}
 */
export function buildCheckoutQrUrl(code) {
  const normalized = String(code ?? "").trim().toUpperCase().slice(0, 32);
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
  const words = String(name ?? "")
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
    existingItems.map((i) => String(i.code ?? "").trim().toUpperCase())
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
 * Validates that a redirect query parameter targets an allowlisted local CEIT page.
 * Prevents open redirects and path traversal.
 * @param {string|null} target
 * @returns {string|null}
 */
export function sanitizeRedirectUrl(target) {
  if (typeof target !== "string") return null;
  const trimmed = target.trim();
  if (!trimmed || trimmed.length > 200) return null;

  const match = /^([a-z0-9_-]+\.html)(\?([a-z0-9_=&%.+-]*))?$/i.exec(trimmed);
  if (!match) return null;

  const page = match[1].toLowerCase();
  if (!ALLOWED_REDIRECT_PAGES.has(page)) return null;

  return match[2] ? `${page}${match[2]}` : page;
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

  const safeType = type === "success" || type === "warn" ? type : "info";
  const toast = document.createElement("div");
  toast.className = `ceit-toast toast-${safeType}`;
  toast.textContent = String(message ?? "");
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, durationMs);
}

/**
 * Escapes a single CSV cell and neutralizes spreadsheet formula injection (=, +, -, @, tab, CR).
 * @param {*} val
 * @returns {string}
 */
function escapeCsvCell(val) {
  let str = String(val ?? "");
  // Neutralize formula injection (DDE / Excel / Google Sheets)
  if (/^[\s]*[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
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
    "Period",
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

  const rows = records.map((r) => [
    r.id,
    r.itemName,
    r.itemCode,
    r.category || "General",
    r.period || "Unassigned",
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
    .map((row) => row.map(escapeCsvCell).join(","))
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
