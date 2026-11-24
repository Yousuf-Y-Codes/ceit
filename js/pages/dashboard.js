// js/pages/dashboard.js
// Student Dashboard controller

import {
  requireAuth,
  signOutUser,
  extractStudentNumberFromEmail
} from "../services/auth-service.js";
import {
  subscribeToStudentCheckouts,
  returnItem,
  getCheckoutDisplayStatus
} from "../services/checkout-service.js";
import { subscribeToItems } from "../services/item-service.js";
import {
  escapeHtml,
  formatDate,
  formatDateTime,
  formatRelativeDue,
  showToast
} from "../utils.js";

let currentUser = null;
let unsubCheckouts = null;
let unsubItems = null;
let allItems = [];
let pendingReturnId = null;

document.getElementById("quick-code-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const code = document.getElementById("quick-code-input").value.trim().toUpperCase();
  window.location.href = code ? `checkout.html?code=${encodeURIComponent(code)}` : "checkout.html";
});

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-selected", "false");
    });
    document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
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

function renderStudentHeader() {
  const name = currentUser.displayName || currentUser.profile?.displayName || "Student";
  const sNum = extractStudentNumberFromEmail(currentUser.email) || currentUser.profile?.studentNumber || "";
  const isTeacher = currentUser.profile?.role === "teacher";
  document.getElementById("student-name").textContent = name;
  document.getElementById("student-number-pill").textContent = sNum
    ? `#${sNum}`
    : isTeacher
      ? (currentUser.email || "").split("@")[0]
      : "PDSB";
}

function renderStatusBadge(status) {
  if (status === "overdue") return '<span class="badge badge-danger">Overdue</span>';
  if (status === "due-soon") return '<span class="badge badge-warn">Due Soon</span>';
  if (status === "returned") return '<span class="badge badge-success">Returned</span>';
  return '<span class="badge badge-accent">Active</span>';
}

function renderActiveCheckouts(active) {
  const tbody = document.getElementById("checkouts-list");
  document.getElementById("tab-active-count").textContent = active.length;
  document.getElementById("stat-active").textContent = active.length;

  let overdueCount = 0;
  let dueSoonCount = 0;
  active.forEach((co) => {
    const st = getCheckoutDisplayStatus(co);
    if (st === "overdue") overdueCount++;
    else if (st === "due-soon") dueSoonCount++;
  });
  document.getElementById("stat-overdue").textContent = overdueCount;
  document.getElementById("stat-due-soon").textContent = dueSoonCount;

  if (active.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No active loans.</td></tr>';
    return;
  }

  tbody.innerHTML = active
    .map((co) => {
      const status = getCheckoutDisplayStatus(co);
      const relDue = formatRelativeDue(co.dueDate);
      const notesHtml = co.notes ? `<div class="text-small text-muted">Note: ${escapeHtml(co.notes)}</div>` : "";
      const periodHtml = co.period
        ? `<span class="badge badge-neutral">${escapeHtml(co.period)}</span>`
        : '<span class="text-muted">—</span>';

      return `
        <tr>
          <td>
            <strong>${escapeHtml(co.itemName)}</strong>
            <div class="text-small text-muted">${escapeHtml(co.category || "General")}</div>
            ${notesHtml}
          </td>
          <td><code>${escapeHtml(co.itemCode)}</code></td>
          <td>${periodHtml}</td>
          <td class="tabular text-secondary">${escapeHtml(formatDateTime(co.checkedOutAt))}</td>
          <td class="tabular">
            <strong>${escapeHtml(formatDate(co.dueDate))}</strong>
            <div class="text-small text-muted">${escapeHtml(relDue)}</div>
          </td>
          <td>${renderStatusBadge(status)}</td>
          <td style="text-align: right;">
            <button type="button" class="btn btn-ghost btn-sm btn-open-return"
              data-id="${escapeHtml(co.id)}"
              data-name="${escapeHtml(co.itemName)}"
              data-code="${escapeHtml(co.itemCode)}">
              Return
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll(".btn-open-return").forEach((btn) => {
    btn.addEventListener("click", () => {
      pendingReturnId = btn.dataset.id;
      document.getElementById("return-modal-desc").textContent =
        `Return "${btn.dataset.name}" (${btn.dataset.code}) back into lab inventory?`;
      openModal("return-modal");
    });
  });
}

function renderHistory(returned) {
  const tbody = document.getElementById("history-list");
  document.getElementById("tab-history-count").textContent = returned.length;
  document.getElementById("stat-returned").textContent = returned.length;

  if (returned.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No return history.</td></tr>';
    return;
  }

  tbody.innerHTML = returned
    .map(
      (co) => `
        <tr>
          <td><strong>${escapeHtml(co.itemName)}</strong></td>
          <td><code>${escapeHtml(co.itemCode)}</code></td>
          <td>${co.period ? `<span class="badge badge-neutral">${escapeHtml(co.period)}</span>` : "—"}</td>
          <td class="tabular text-secondary">${escapeHtml(formatDateTime(co.checkedOutAt))}</td>
          <td class="tabular text-secondary">${escapeHtml(formatDateTime(co.returnedAt))}</td>
          <td>${renderStatusBadge("returned")}</td>
        </tr>
      `
    )
    .join("");
}

function renderCatalog() {
  const search = document.getElementById("catalog-search").value.trim().toLowerCase();
  const cat = document.getElementById("catalog-category").value;

  const filtered = allItems.filter((item) => {
    if (cat && item.category !== cat) return false;
    if (!search) return true;
    return (
      (item.name || "").toLowerCase().includes(search) ||
      (item.code || "").toLowerCase().includes(search) ||
      (item.location || "").toLowerCase().includes(search)
    );
  });

  document.getElementById("tab-catalog-count").textContent = allItems.length;
  const tbody = document.getElementById("catalog-list");

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No matching components.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered
    .map((item) => {
      const avail = Math.max(0, Number(item.availableQuantity) || 0);
      const total = Math.max(1, Number(item.totalQuantity) || 1);
      const pct = Math.min(100, Math.round((avail / total) * 100));
      const fillClass = avail === 0 ? "is-empty" : pct <= 30 ? "is-low" : "";
      const checkoutHref = escapeHtml(`checkout.html?code=${encodeURIComponent(item.code || "")}`);
      const actionHtml =
        avail > 0
          ? `<a href="${checkoutHref}" class="btn btn-primary btn-sm">Check Out</a>`
          : '<span class="badge badge-neutral">Out of Stock</span>';

      return `
        <tr>
          <td><code>${escapeHtml(item.code)}</code></td>
          <td>
            <strong>${escapeHtml(item.name)}</strong>
            ${item.notes ? `<div class="text-small text-muted">${escapeHtml(item.notes)}</div>` : ""}
          </td>
          <td class="text-secondary">${escapeHtml(item.category || "General")}</td>
          <td class="text-secondary">${escapeHtml(item.location || "Main Lab")}</td>
          <td>
            <div class="stock-meter">
              <span class="tabular text-small fw-bold">${avail} / ${total}</span>
              <div class="stock-bar"><div class="stock-bar-fill ${fillClass}" style="width: ${pct}%;"></div></div>
            </div>
          </td>
          <td style="text-align: right;">${actionHtml}</td>
        </tr>
      `;
    })
    .join("");
}

document.getElementById("catalog-search").addEventListener("input", renderCatalog);
document.getElementById("catalog-category").addEventListener("change", renderCatalog);

document.getElementById("btn-confirm-return").addEventListener("click", async () => {
  if (!pendingReturnId || !currentUser) return;
  const btn = document.getElementById("btn-confirm-return");
  btn.disabled = true;
  btn.textContent = "Returning...";
  try {
    await returnItem(pendingReturnId);
    closeModal("return-modal");
    showToast("Component returned to inventory.", "success");
  } catch (err) {
    showToast("Return failed: " + err.message, "warn");
  } finally {
    pendingReturnId = null;
    btn.disabled = false;
    btn.textContent = "Confirm Return";
  }
});

requireAuth({
  redirectUrl: "index.html",
  preserveTarget: true,
  onAuthorized: (user) => {
    currentUser = user;
    renderStudentHeader();

    if (user.profile?.role === "teacher") {
      document.getElementById("nav-teacher-link").style.display = "inline-block";
      document.getElementById("nav-dash").textContent = "Student View";
    }

    if (unsubCheckouts) unsubCheckouts();
    unsubCheckouts = subscribeToStudentCheckouts(
      user.uid,
      ({ active, returned }) => {
        renderActiveCheckouts(active);
        renderHistory(returned);
      },
      (err) => showToast("Error loading checkouts: " + err.message, "warn")
    );

    if (unsubItems) unsubItems();
    unsubItems = subscribeToItems(
      (items) => {
        allItems = items;
        renderCatalog();
      },
      (err) => console.error("[CEIT] Catalog load error:", err)
    );
  }
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  if (unsubCheckouts) unsubCheckouts();
  if (unsubItems) unsubItems();
  await signOutUser();
  window.location.replace("index.html");
});
