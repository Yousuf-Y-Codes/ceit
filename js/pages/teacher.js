// js/pages/teacher.js
// Teacher Admin Panel controller

import { requireAuth, signOutUser } from "../services/auth-service.js";
import {
  createItem,
  updateItem,
  deleteItem,
  subscribeToItems
} from "../services/item-service.js";
import {
  subscribeToAllActiveCheckouts,
  subscribeToCheckoutHistory,
  returnItem,
  guestCheckOutItem,
  getCheckoutDisplayStatus
} from "../services/checkout-service.js";
import { renderQrToCanvas, generateQrSvg } from "../lib/qrcode.js";
import {
  escapeHtml,
  isValidEmail,
  formatDate,
  formatDateTime,
  formatRelativeDue,
  buildCheckoutQrUrl,
  generateSuggestedCode,
  exportCheckoutsToCsv,
  showToast
} from "../utils.js";

let currentUser = null;
let allItems = [];
let activeCheckouts = [];
let checkoutHistory = [];
let activeQrItem = null;
let pendingConfirmAction = null;
let activeStatusFilter = "all";

let unsubItems = null;
let unsubActive = null;
let unsubHistory = null;

function activateTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach((b) => {
    const isMatch = b.dataset.tab === tabId;
    b.classList.toggle("active", isMatch);
    b.setAttribute("aria-selected", String(isMatch));
  });
  document.querySelectorAll(".tab-pane").forEach((p) => {
    p.classList.toggle("active", p.id === tabId);
  });
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => activateTab(btn.dataset.tab));
});

function setActiveFilter(filterVal) {
  activeStatusFilter = filterVal;
  document.querySelectorAll("#active-filter-chips .chip-btn").forEach((c) => {
    c.classList.toggle("active", c.dataset.filter === filterVal);
  });
  renderActiveCheckouts();
}

document.querySelectorAll("#active-filter-chips .chip-btn").forEach((chip) => {
  chip.addEventListener("click", () => setActiveFilter(chip.dataset.filter));
});

document.getElementById("btn-jump-overdue").addEventListener("click", () => {
  activateTab("tab-active");
  document.getElementById("active-period-filter").value = "all";
  setActiveFilter("overdue");
});

function openModal(id) {
  document.getElementById(id).classList.add("open");
}

function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}

document.querySelectorAll("[data-close-modal]").forEach((el) => {
  el.addEventListener("click", () => closeModal(el.dataset.closeModal));
});

document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.classList.remove("open");
  });
});

function showConfirmDialog({ title, message, okLabel = "Confirm", okClass = "btn-primary", onConfirm }) {
  document.getElementById("confirm-modal-title").textContent = title;
  document.getElementById("confirm-modal-message").textContent = message;
  const okBtn = document.getElementById("confirm-modal-ok");
  okBtn.textContent = okLabel;
  okBtn.className = `btn ${okClass}`;
  pendingConfirmAction = onConfirm;
  openModal("confirm-modal");
}

document.getElementById("confirm-modal-ok").addEventListener("click", async () => {
  if (!pendingConfirmAction) return;
  const okBtn = document.getElementById("confirm-modal-ok");
  okBtn.disabled = true;
  try {
    await pendingConfirmAction();
    closeModal("confirm-modal");
  } catch (err) {
    showToast("Action failed: " + err.message, "warn");
  } finally {
    pendingConfirmAction = null;
    okBtn.disabled = false;
  }
});

function statusBadgeHtml(status) {
  if (status === "overdue") return '<span class="badge badge-danger">Overdue</span>';
  if (status === "due-soon") return '<span class="badge badge-warn">Due Soon</span>';
  if (status === "returned") return '<span class="badge badge-success">Returned</span>';
  return '<span class="badge badge-accent">Active</span>';
}

function matchesPeriodFilter(recordPeriod, filterValue) {
  if (filterValue === "all") return true;
  if (filterValue === "unassigned") return !recordPeriod;
  return recordPeriod === filterValue;
}

function updateStats() {
  document.getElementById("stat-item-types").textContent = allItems.length;
  const availUnits = allItems.reduce((sum, i) => sum + (Number(i.availableQuantity) || 0), 0);
  document.getElementById("stat-avail-units").textContent = availUnits;
  document.getElementById("stat-active-loans").textContent = activeCheckouts.length;

  const overdue = activeCheckouts.filter((c) => getCheckoutDisplayStatus(c) === "overdue").length;
  document.getElementById("stat-overdue-loans").textContent = overdue;

  const banner = document.getElementById("overdue-attention");
  if (overdue > 0) {
    banner.style.display = "flex";
    document.getElementById("overdue-attention-text").textContent =
      `${overdue} component ${overdue === 1 ? "loan is" : "loans are"} currently overdue.`;
  } else {
    banner.style.display = "none";
  }
}

function buildReminderMailto(co) {
  const email = String(co.studentEmail ?? "").trim();
  if (!isValidEmail(email)) return "";
  const subject = `CEIT Lab Return Reminder: ${co.itemName} (${co.itemCode})`;
  const dueStr = formatDate(co.dueDate);
  const body =
    `Hi ${co.studentName},\n\n` +
    `This is a reminder from the Computer Engineering Lab that the following component is signed out under your account:\n\n` +
    `- Component: ${co.itemName} (${co.itemCode})\n` +
    `- Class Period: ${co.period || "N/A"}\n` +
    `- Student #: ${co.studentNumber || "N/A"}\n` +
    `- Due Date: ${dueStr}\n\n` +
    `Please return it to the lab bin and check it in on CEIT.\n\nThank you!`;
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// Render Tab 1: Active Sign-Outs
function renderActiveCheckouts() {
  document.getElementById("count-active").textContent = activeCheckouts.length;
  const queryStr = document.getElementById("active-search").value.trim().toLowerCase();
  const periodFilter = document.getElementById("active-period-filter").value;

  const filtered = activeCheckouts.filter((co) => {
    const disp = getCheckoutDisplayStatus(co);
    if (!matchesPeriodFilter(co.period, periodFilter)) return false;
    if (activeStatusFilter === "overdue" && disp !== "overdue") return false;
    if (activeStatusFilter === "due-soon" && disp !== "due-soon") return false;
    if (activeStatusFilter === "guest" && !co.isGuest) return false;
    if (!queryStr) return true;
    return (
      (co.itemName || "").toLowerCase().includes(queryStr) ||
      (co.itemCode || "").toLowerCase().includes(queryStr) ||
      (co.studentName || "").toLowerCase().includes(queryStr) ||
      (co.studentNumber || "").toLowerCase().includes(queryStr) ||
      (co.studentEmail || "").toLowerCase().includes(queryStr) ||
      (co.period || "").toLowerCase().includes(queryStr)
    );
  });

  const tbody = document.getElementById("active-list");
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No active sign-outs.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered
    .map((co) => {
      const status = getCheckoutDisplayStatus(co);
      const relDue = formatRelativeDue(co.dueDate);
      const guestTag = co.isGuest ? ' <span class="badge badge-neutral">Guest</span>' : "";
      const periodHtml = co.period
        ? `<span class="badge badge-neutral">${escapeHtml(co.period)}</span>`
        : '<span class="text-muted">—</span>';
      const mailto = buildReminderMailto(co);
      const remindBtn = mailto
        ? `<a href="${escapeHtml(mailto)}" class="btn btn-ghost btn-xs" rel="noopener noreferrer">Email</a>`
        : "";

      return `
        <tr>
          <td>
            <strong>${escapeHtml(co.itemName)}</strong>
            <div><code>${escapeHtml(co.itemCode)}</code></div>
            ${co.notes ? `<div class="text-small text-muted">Note: ${escapeHtml(co.notes)}</div>` : ""}
          </td>
          <td>
            <strong>${escapeHtml(co.studentName)}</strong>${guestTag}
            ${co.studentEmail ? `<div class="text-small text-muted">${escapeHtml(co.studentEmail)}</div>` : ""}
          </td>
          <td><code>${escapeHtml(co.studentNumber || "N/A")}</code></td>
          <td>${periodHtml}</td>
          <td class="tabular text-secondary">${escapeHtml(formatDateTime(co.checkedOutAt))}</td>
          <td class="tabular">
            <strong>${escapeHtml(formatDate(co.dueDate))}</strong>
            <div class="text-small text-muted">${escapeHtml(relDue)}</div>
          </td>
          <td>${statusBadgeHtml(status)}</td>
          <td style="text-align: right;">
            <div class="btn-row" style="justify-content: flex-end;">
              <button type="button" class="btn btn-success btn-xs btn-checkin"
                data-id="${escapeHtml(co.id)}"
                data-item="${escapeHtml(co.itemName)}"
                data-student="${escapeHtml(co.studentName)}">
                Check In
              </button>
              ${remindBtn}
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll(".btn-checkin").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      showConfirmDialog({
        title: "Check In Component",
        message: `Mark "${btn.dataset.item}" signed out by ${btn.dataset.student} as returned?`,
        okLabel: "Confirm Check In",
        okClass: "btn-success",
        onConfirm: async () => {
          await returnItem(id);
          showToast(`Checked in "${btn.dataset.item}"`, "success");
        }
      });
    });
  });
}

function getFilteredInventory() {
  const q = document.getElementById("inv-search").value.trim().toLowerCase();
  const cat = document.getElementById("inv-cat-filter").value;
  return allItems.filter((item) => {
    if (cat && item.category !== cat) return false;
    if (!q) return true;
    return (
      (item.name || "").toLowerCase().includes(q) ||
      (item.code || "").toLowerCase().includes(q) ||
      (item.location || "").toLowerCase().includes(q)
    );
  });
}

// Render Tab 2: Inventory
function renderInventory() {
  document.getElementById("count-inventory").textContent = allItems.length;

  const guestSelect = document.getElementById("guest-item-select");
  const prevGuestVal = guestSelect.value;
  guestSelect.innerHTML = '<option value="">-- Choose an available component --</option>';
  allItems.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = `${item.name} (${item.code}) — ${item.availableQuantity}/${item.totalQuantity} avail`;
    if (item.availableQuantity <= 0) opt.disabled = true;
    guestSelect.appendChild(opt);
  });
  guestSelect.value = prevGuestVal;

  const filtered = getFilteredInventory();
  const tbody = document.getElementById("inventory-list");

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No components found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered
    .map((item) => {
      const avail = Math.max(0, Number(item.availableQuantity) || 0);
      const total = Math.max(1, Number(item.totalQuantity) || 1);
      const pct = Math.min(100, Math.round((avail / total) * 100));
      const fillClass = avail === 0 ? "is-empty" : pct <= 30 ? "is-low" : "";
      return `
        <tr>
          <td><code>${escapeHtml(item.code)}</code></td>
          <td>
            <strong>${escapeHtml(item.name)}</strong>
            <div class="text-small text-muted">
              ${escapeHtml(item.category || "General")}${item.location ? " · " + escapeHtml(item.location) : ""}
            </div>
            ${item.notes ? `<div class="text-small text-muted">${escapeHtml(item.notes)}</div>` : ""}
          </td>
          <td>
            <div class="stock-meter">
              <span class="tabular text-small fw-bold">${avail} / ${total}</span>
              <div class="stock-bar"><div class="stock-bar-fill ${fillClass}" style="width: ${pct}%;"></div></div>
            </div>
          </td>
          <td style="text-align: right;">
            <div class="btn-row" style="justify-content: flex-end;">
              <button type="button" class="btn btn-primary btn-xs btn-qr" data-id="${escapeHtml(item.id)}">QR Label</button>
              <button type="button" class="btn btn-ghost btn-xs btn-edit" data-id="${escapeHtml(item.id)}">Edit</button>
              <button type="button" class="btn btn-danger-soft btn-xs btn-del" data-id="${escapeHtml(item.id)}">Delete</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll(".btn-qr").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = allItems.find((i) => i.id === btn.dataset.id);
      if (item) openQrModal(item);
    });
  });

  tbody.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = allItems.find((i) => i.id === btn.dataset.id);
      if (!item) return;
      document.getElementById("edit-item-id").value = item.id;
      document.getElementById("edit-item-name").value = item.name || "";
      document.getElementById("edit-item-category").value = item.category || "General";
      document.getElementById("edit-item-qty").value = item.totalQuantity ?? 1;
      document.getElementById("edit-item-location").value = item.location || "";
      document.getElementById("edit-item-notes").value = item.notes || "";
      openModal("edit-modal");
    });
  });

  tbody.querySelectorAll(".btn-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = allItems.find((i) => i.id === btn.dataset.id);
      if (!item) return;
      const checkedOut = (item.totalQuantity || 0) - (item.availableQuantity || 0);
      const warning =
        checkedOut > 0 ? ` Warning: ${checkedOut} unit(s) are currently signed out.` : "";
      showConfirmDialog({
        title: "Delete Component",
        message: `Permanently delete "${item.name}" (${item.code}) from inventory?${warning}`,
        okLabel: "Delete Item",
        okClass: "btn-danger",
        onConfirm: async () => {
          await deleteItem(item.id);
          showToast(`Deleted "${item.name}"`, "info");
        }
      });
    });
  });
}

// Render Tab 4: Audit History
function renderHistory() {
  document.getElementById("count-history").textContent = checkoutHistory.length;
  const q = document.getElementById("history-search").value.trim().toLowerCase();
  const periodFilter = document.getElementById("history-period-filter").value;
  const stFilter = document.getElementById("history-status-filter").value;

  const filtered = checkoutHistory.filter((co) => {
    if (!matchesPeriodFilter(co.period, periodFilter)) return false;
    if (stFilter !== "all" && co.status !== stFilter) return false;
    if (!q) return true;
    return (
      (co.itemName || "").toLowerCase().includes(q) ||
      (co.itemCode || "").toLowerCase().includes(q) ||
      (co.studentName || "").toLowerCase().includes(q) ||
      (co.studentNumber || "").toLowerCase().includes(q) ||
      (co.period || "").toLowerCase().includes(q)
    );
  });

  const tbody = document.getElementById("history-list");
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No audit logs found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered
    .map((co) => {
      const disp = getCheckoutDisplayStatus(co);
      const guestBadge = co.isGuest ? ' <span class="badge badge-neutral">Guest</span>' : "";
      const periodHtml = co.period
        ? `<span class="badge badge-neutral">${escapeHtml(co.period)}</span>`
        : '<span class="text-muted">—</span>';
      return `
        <tr>
          <td><strong>${escapeHtml(co.itemName)}</strong><div><code>${escapeHtml(co.itemCode)}</code></div></td>
          <td>${escapeHtml(co.studentName)}${guestBadge}</td>
          <td><code>${escapeHtml(co.studentNumber || "N/A")}</code></td>
          <td>${periodHtml}</td>
          <td class="tabular text-secondary">${escapeHtml(formatDateTime(co.checkedOutAt))}</td>
          <td class="tabular text-secondary">${escapeHtml(formatDate(co.dueDate))}</td>
          <td class="tabular text-secondary">${co.returnedAt ? escapeHtml(formatDateTime(co.returnedAt)) : "—"}</td>
          <td>${statusBadgeHtml(disp)}</td>
        </tr>
      `;
    })
    .join("");
}

function openQrModal(item) {
  activeQrItem = item;
  const qrUrl = buildCheckoutQrUrl(item.code);
  renderQrToCanvas(document.getElementById("qr-modal-canvas"), qrUrl, { size: 200, quietZone: 4 });

  document.getElementById("qr-modal-code").textContent = item.code;
  document.getElementById("qr-modal-name").textContent = item.name;
  document.getElementById("qr-modal-meta").textContent =
    `${item.category || "General"}${item.location ? " · " + item.location : ""}`;
  document.getElementById("qr-modal-url").value = qrUrl;

  openModal("qr-modal");
}

function printQrLabels(itemsToPrint) {
  if (!itemsToPrint || itemsToPrint.length === 0) {
    showToast("No components to print labels for.", "warn");
    return;
  }

  const grid = document.getElementById("print-grid");
  grid.innerHTML = itemsToPrint
    .map((item) => {
      const url = buildCheckoutQrUrl(item.code);
      const svg = generateQrSvg(url, { size: 135, quietZone: 4 });
      return `
        <div class="print-label">
          ${svg}
          <div class="qr-label-code">${escapeHtml(item.code)}</div>
          <div class="qr-label-name">${escapeHtml(item.name)}</div>
          <div class="qr-label-meta">${escapeHtml(item.location || item.category || "CEIT Lab")}</div>
        </div>
      `;
    })
    .join("");

  window.print();
}

document.getElementById("btn-qr-copy").addEventListener("click", async () => {
  if (!activeQrItem) return;
  try {
    await navigator.clipboard.writeText(activeQrItem.code);
    showToast(`Copied "${activeQrItem.code}"`, "success");
  } catch {
    showToast(`Code: ${activeQrItem.code}`, "info");
  }
});

document.getElementById("btn-qr-download").addEventListener("click", () => {
  if (!activeQrItem) return;
  const link = document.createElement("a");
  link.download = `CEIT-${activeQrItem.code}.png`;
  link.href = document.getElementById("qr-modal-canvas").toDataURL("image/png");
  link.click();
  showToast(`Downloaded QR PNG for ${activeQrItem.code}`, "success");
});

document.getElementById("btn-qr-print-one").addEventListener("click", () => {
  if (activeQrItem) printQrLabels([activeQrItem]);
});

document.getElementById("btn-print-all-top").addEventListener("click", () => printQrLabels(allItems));
document.getElementById("btn-print-filtered").addEventListener("click", () => printQrLabels(getFilteredInventory()));

document.getElementById("btn-gen-code").addEventListener("click", () => {
  const category = document.getElementById("item-category").value;
  const name = document.getElementById("item-name").value;
  document.getElementById("item-code").value = generateSuggestedCode(category, name, allItems);
});

document.getElementById("add-item-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  const btn = document.getElementById("btn-add-item");
  btn.disabled = true;

  try {
    const name = document.getElementById("item-name").value.trim();
    const code = document.getElementById("item-code").value.trim().toUpperCase();
    const category = document.getElementById("item-category").value;
    const totalQuantity = document.getElementById("item-qty").value;
    const location = document.getElementById("item-location").value.trim();
    const notes = document.getElementById("item-notes").value.trim();

    await createItem({ name, code, category, totalQuantity, location, notes }, currentUser.uid);
    showToast(`Added "${name}" (${code})`, "success");
    document.getElementById("add-item-form").reset();
    document.getElementById("item-qty").value = "5";
  } catch (err) {
    showToast("Could not add item: " + err.message, "warn");
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("edit-item-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("edit-item-id").value;
  try {
    await updateItem(id, {
      name: document.getElementById("edit-item-name").value,
      category: document.getElementById("edit-item-category").value,
      totalQuantity: document.getElementById("edit-item-qty").value,
      location: document.getElementById("edit-item-location").value,
      notes: document.getElementById("edit-item-notes").value
    });
    closeModal("edit-modal");
    showToast("Component updated", "success");
  } catch (err) {
    showToast("Update failed: " + err.message, "warn");
  }
});

document.getElementById("guest-checkout-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  const period = document.getElementById("guest-period").value;
  if (!period) {
    showToast("Please select a Class Period (Period 1–4).", "warn");
    return;
  }

  const btn = document.getElementById("btn-guest-submit");
  btn.disabled = true;

  try {
    const res = await guestCheckOutItem({
      itemId: document.getElementById("guest-item-select").value,
      teacherUser: currentUser,
      studentName: document.getElementById("guest-student-name").value,
      studentNumber: document.getElementById("guest-student-num").value,
      studentEmail: document.getElementById("guest-student-email").value,
      period,
      durationDays: Number.parseInt(document.getElementById("guest-duration").value, 10) || 7,
      notes: document.getElementById("guest-notes").value
    });

    showToast(`Recorded guest sign-out for "${res.item.name}" (${period})`, "success");
    document.getElementById("guest-checkout-form").reset();
    document.getElementById("guest-duration").value = "7";
  } catch (err) {
    showToast("Guest sign-out failed: " + err.message, "warn");
  } finally {
    btn.disabled = false;
  }
});

function handleExportCsv() {
  if (checkoutHistory.length === 0) {
    showToast("No checkout history available to export yet.", "warn");
    return;
  }
  exportCheckoutsToCsv(checkoutHistory);
  showToast(`Exported ${checkoutHistory.length} records to CSV`, "success");
}
document.getElementById("btn-export-csv").addEventListener("click", handleExportCsv);
document.getElementById("btn-export-csv-top").addEventListener("click", handleExportCsv);

document.getElementById("active-search").addEventListener("input", renderActiveCheckouts);
document.getElementById("active-period-filter").addEventListener("change", renderActiveCheckouts);
document.getElementById("inv-search").addEventListener("input", renderInventory);
document.getElementById("inv-cat-filter").addEventListener("change", renderInventory);
document.getElementById("history-search").addEventListener("input", renderHistory);
document.getElementById("history-period-filter").addEventListener("change", renderHistory);
document.getElementById("history-status-filter").addEventListener("change", renderHistory);

requireAuth({
  requiredRole: "teacher",
  redirectUrl: "index.html",
  preserveTarget: true,
  onAuthorized: (user) => {
    currentUser = user;
    const name = user.displayName || user.profile?.displayName || "Teacher";
    document.getElementById("teacher-name").textContent = name;
    document.getElementById("teacher-email").textContent = (user.email || "").split("@")[0];

    if (unsubItems) unsubItems();
    unsubItems = subscribeToItems(
      (items) => {
        allItems = items;
        updateStats();
        renderInventory();
      },
      (err) => showToast("Inventory listener error: " + err.message, "warn")
    );

    if (unsubActive) unsubActive();
    unsubActive = subscribeToAllActiveCheckouts(
      (checkouts) => {
        activeCheckouts = checkouts;
        updateStats();
        renderActiveCheckouts();
      },
      (err) => showToast("Active checkouts error: " + err.message, "warn")
    );

    if (unsubHistory) unsubHistory();
    unsubHistory = subscribeToCheckoutHistory(
      (records) => {
        checkoutHistory = records;
        renderHistory();
      },
      200,
      (err) => console.error("[CEIT] History listener error:", err)
    );
  }
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  if (unsubItems) unsubItems();
  if (unsubActive) unsubActive();
  if (unsubHistory) unsubHistory();
  await signOutUser();
  window.location.replace("index.html");
});
