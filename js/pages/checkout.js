// js/pages/checkout.js
// Single-screen component check-out & inline QR scanner controller

import {
  requireAuth,
  signOutUser,
  extractStudentNumberFromEmail
} from "../services/auth-service.js";
import { getItemByCode, subscribeToItems } from "../services/item-service.js";
import { checkOutItem } from "../services/checkout-service.js";
import {
  extractCodeFromScan,
  formatDate,
  showToast
} from "../utils.js";

const MAX_QR_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

let currentUser = null;
let foundItem = null;
let selectedPeriod = "";
let selectedDurationMode = "7";
let unsubItems = null;
let mediaStream = null;
let scanRafId = null;
let facingMode = "environment";

const alertBox = document.getElementById("alert-box");
const successBox = document.getElementById("success-box");
const codeInput = document.getElementById("code-input");
const quickSelect = document.getElementById("quick-select");
const previewBox = document.getElementById("preview-box");
const previewBadge = document.getElementById("preview-badge");
const periodBadge = document.getElementById("period-status-badge");
const confirmBtn = document.getElementById("btn-confirm");
const customDaysGroup = document.getElementById("custom-days-group");
const customDaysInput = document.getElementById("custom-days-input");
const studentNumInput = document.getElementById("checkout-student-num");

const scannerDrawer = document.getElementById("scanner-drawer");
const scannerBox = document.getElementById("scanner-box");
const videoEl = document.getElementById("qr-video");
const canvasEl = document.getElementById("qr-canvas");
const placeholderEl = document.getElementById("scanner-placeholder");
const scannerStatus = document.getElementById("scanner-status");
const btnStartCam = document.getElementById("btn-start-cam");
const btnStopCam = document.getElementById("btn-stop-cam");
const btnFlipCam = document.getElementById("btn-flip-cam");

function showAlert(msg) {
  if (!msg) {
    alertBox.style.display = "none";
    alertBox.textContent = "";
    return;
  }
  successBox.style.display = "none";
  alertBox.textContent = msg;
  alertBox.style.display = "block";
}

function showSuccess(msg) {
  alertBox.style.display = "none";
  successBox.textContent = msg;
  successBox.style.display = "block";
}

function syncConfirmEnabled() {
  const hasStock = Boolean(foundItem && foundItem.availableQuantity > 0);
  confirmBtn.disabled = !hasStock;
}

function getSelectedDurationDays() {
  if (selectedDurationMode === "custom") {
    const val = Number.parseInt(customDaysInput.value, 10);
    return Number.isNaN(val) ? 7 : Math.min(30, Math.max(1, val));
  }
  return Number.parseInt(selectedDurationMode, 10) || 7;
}

function updateDueDatePreview() {
  const days = getSelectedDurationDays();
  const due = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  document.getElementById("due-date-preview").textContent = `Due ${formatDate(due)}`;
}

// Step 2: Explicit Period Selector
document.querySelectorAll("#period-chips .chip-btn").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("#period-chips .chip-btn").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    selectedPeriod = chip.dataset.period;
    periodBadge.className = "badge badge-success";
    periodBadge.textContent = selectedPeriod;
    showAlert("");
  });
});

// Step 3: Duration Chips
document.querySelectorAll("#duration-chips .chip-btn").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("#duration-chips .chip-btn").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    selectedDurationMode = chip.dataset.days;
    customDaysGroup.style.display = selectedDurationMode === "custom" ? "block" : "none";
    updateDueDatePreview();
  });
});
customDaysInput.addEventListener("input", updateDueDatePreview);
updateDueDatePreview();

// Inline QR Drawer Toggle
document.getElementById("btn-toggle-qr").addEventListener("click", () => {
  const isOpen = scannerDrawer.classList.toggle("open");
  if (!isOpen) stopCamera();
});
document.getElementById("btn-close-qr").addEventListener("click", () => {
  stopCamera();
  scannerDrawer.classList.remove("open");
});

// Lookup Component
async function lookupCode(rawValue) {
  showAlert("");
  const code = extractCodeFromScan(rawValue ?? codeInput.value);
  if (!code) {
    showAlert("Please enter or scan a component code.");
    return;
  }

  codeInput.value = code;

  try {
    const item = await getItemByCode(code);
    if (!item) {
      foundItem = null;
      previewBox.style.display = "none";
      previewBadge.className = "badge badge-danger";
      previewBadge.textContent = "Not Found";
      syncConfirmEnabled();
      showAlert(`No component found with code "${code}". Check the bin label and try again.`);
      return;
    }

    foundItem = item;
    previewBox.style.display = "block";
    document.getElementById("prev-name").textContent = item.name;
    document.getElementById("prev-code").textContent = item.code;
    document.getElementById("prev-category").textContent = item.category || "General";
    document.getElementById("prev-location").textContent = item.location || "Main Lab";
    document.getElementById("prev-avail-text").textContent =
      `${item.availableQuantity} of ${item.totalQuantity} available`;

    const notesEl = document.getElementById("prev-notes");
    if (item.notes) {
      notesEl.textContent = `Note: ${item.notes}`;
      notesEl.style.display = "block";
    } else {
      notesEl.style.display = "none";
    }

    if (item.availableQuantity > 0) {
      previewBadge.className = "badge badge-success";
      previewBadge.textContent = "In Stock";
    } else {
      previewBadge.className = "badge badge-danger";
      previewBadge.textContent = "Out of Stock";
      showAlert(`"${item.name}" (${item.code}) is currently out of stock.`);
    }
    syncConfirmEnabled();
  } catch (err) {
    showAlert("Lookup error: " + err.message);
  }
}

document.getElementById("btn-lookup").addEventListener("click", () => lookupCode(codeInput.value));
codeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    lookupCode(codeInput.value);
  }
});
quickSelect.addEventListener("change", () => {
  if (quickSelect.value) lookupCode(quickSelect.value);
});

// QR Scanning
function decodeImageData(imageData) {
  if (typeof window.jsQR === "function") {
    const result = window.jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "dontInvert"
    });
    if (result && result.data) return result.data;
  }
  return null;
}

function handleQrDetected(rawText) {
  const code = extractCodeFromScan(rawText);
  if (!code) return;
  stopCamera();
  scannerDrawer.classList.remove("open");
  showToast(`Scanned ${code}`, "success");
  lookupCode(code);
}

function stopCamera() {
  if (scanRafId) {
    cancelAnimationFrame(scanRafId);
    scanRafId = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  videoEl.srcObject = null;
  videoEl.style.display = "none";
  placeholderEl.style.display = "block";
  scannerBox.classList.remove("active");
  btnStartCam.disabled = false;
  btnStopCam.disabled = true;
  btnFlipCam.style.display = "none";
  scannerStatus.textContent = "Camera is off.";
}

async function startCamera() {
  showAlert("");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showAlert("Camera access is not supported in this browser. Type the code or upload a QR photo instead.");
    return;
  }

  stopCamera();
  scannerStatus.textContent = "Starting camera...";
  btnStartCam.disabled = true;

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode } },
      audio: false
    });

    videoEl.srcObject = mediaStream;
    await videoEl.play();

    placeholderEl.style.display = "none";
    videoEl.style.display = "block";
    scannerBox.classList.add("active");
    btnStopCam.disabled = false;
    btnFlipCam.style.display = "inline-flex";
    scannerStatus.textContent = "Scanning — center the QR code inside the green square.";

    const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
    const nativeDetector =
      "BarcodeDetector" in window ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
    let scanningNative = false;

    const tick = () => {
      if (!mediaStream) return;
      if (videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
        canvasEl.width = videoEl.videoWidth;
        canvasEl.height = videoEl.videoHeight;
        ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);

        const imgData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
        const decoded = decodeImageData(imgData);
        if (decoded) {
          handleQrDetected(decoded);
          return;
        }

        if (nativeDetector && !scanningNative && typeof window.jsQR !== "function") {
          scanningNative = true;
          nativeDetector
            .detect(videoEl)
            .then((barcodes) => {
              scanningNative = false;
              if (barcodes.length > 0 && barcodes[0].rawValue) {
                handleQrDetected(barcodes[0].rawValue);
              }
            })
            .catch(() => {
              scanningNative = false;
            });
        }
      }
      scanRafId = requestAnimationFrame(tick);
    };

    scanRafId = requestAnimationFrame(tick);
  } catch {
    btnStartCam.disabled = false;
    scannerStatus.textContent = "Unable to open camera.";
    showAlert("Camera permission denied or no camera available. Type the code or upload a QR image instead.");
  }
}

btnStartCam.addEventListener("click", startCamera);
btnStopCam.addEventListener("click", stopCamera);
btnFlipCam.addEventListener("click", () => {
  facingMode = facingMode === "environment" ? "user" : "environment";
  startCamera();
});
window.addEventListener("beforeunload", stopCamera);

document.getElementById("qr-file-input").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  showAlert("");

  if (!file.type || !file.type.startsWith("image/")) {
    showAlert("Please select a valid image file.");
    e.target.value = "";
    return;
  }
  if (file.size > MAX_QR_IMAGE_BYTES) {
    showAlert("Image file is too large (max 10 MB).");
    e.target.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = async () => {
      canvasEl.width = img.width;
      canvasEl.height = img.height;
      const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);

      let decoded = decodeImageData(imgData);
      if (!decoded && "BarcodeDetector" in window) {
        try {
          const det = new window.BarcodeDetector({ formats: ["qr_code"] });
          const res = await det.detect(img);
          if (res.length > 0) decoded = res[0].rawValue;
        } catch {
          // ignore
        }
      }

      if (decoded) {
        handleQrDetected(decoded);
      } else {
        showAlert("Could not detect a QR code in that image. Try a clearer photo or type the code.");
      }
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

// Submit Form
document.getElementById("checkout-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;

  if (!foundItem || foundItem.availableQuantity <= 0) {
    showAlert("Please select an in-stock component in Step 1 first.");
    codeInput.focus();
    return;
  }

  if (!selectedPeriod) {
    showAlert("Please select your class period (Period 1–4) in Step 2 before signing out.");
    document.getElementById("period-chips").scrollIntoView({ block: "center" });
    return;
  }

  confirmBtn.disabled = true;
  confirmBtn.textContent = "Signing Out...";
  showAlert("");

  try {
    const durationDays = getSelectedDurationDays();
    const notes = document.getElementById("checkout-notes").value.trim();

    await checkOutItem({
      itemId: foundItem.id,
      user: currentUser,
      period: selectedPeriod,
      durationDays,
      notes
    });

    showSuccess(`Signed out "${foundItem.name}" (${foundItem.code}) for ${selectedPeriod}! Redirecting...`);
    window.location.href = "dashboard.html";
  } catch (err) {
    showAlert(err.message);
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Confirm Sign Out";
  }
});

requireAuth({
  redirectUrl: "index.html",
  preserveTarget: true,
  onAuthorized: (user) => {
    currentUser = user;
    const name = user.displayName || user.profile?.displayName || "Student";
    const sNum = extractStudentNumberFromEmail(user.email);
    const pdsbId = sNum || (user.email ? user.email.split("@")[0] : "N/A");

    document.getElementById("student-name").textContent = name;
    document.getElementById("student-number-pill").textContent = sNum ? `#${sNum}` : pdsbId;
    studentNumInput.value = pdsbId;

    if (user.profile?.role === "teacher") {
      document.getElementById("nav-teacher-link").style.display = "inline-block";
      document.getElementById("nav-dash").textContent = "Student View";
    }

    if (unsubItems) unsubItems();
    unsubItems = subscribeToItems((items) => {
      const prev = quickSelect.value;
      quickSelect.innerHTML = '<option value="">-- Choose an available component --</option>';
      items.forEach((item) => {
        const opt = document.createElement("option");
        opt.value = item.code;
        opt.textContent = `${item.name} (${item.code}) — ${item.availableQuantity}/${item.totalQuantity} avail`;
        if (item.availableQuantity <= 0) opt.disabled = true;
        quickSelect.appendChild(opt);
      });
      quickSelect.value = prev;
    });

    const urlCode = new URLSearchParams(window.location.search).get("code");
    if (urlCode && !foundItem) {
      lookupCode(urlCode);
    }
  }
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  stopCamera();
  if (unsubItems) unsubItems();
  await signOutUser();
  window.location.replace("index.html");
});
