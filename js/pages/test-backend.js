// js/pages/test-backend.js
// Teacher-only Backend Diagnostics console (Google OAuth only)

import { isFirebaseConfigured } from "../firebase-config.js";
import {
  requireAuth,
  signOutUser
} from "../services/auth-service.js";
import {
  createItem,
  getItemByCode,
  deleteItem,
  subscribeToItems
} from "../services/item-service.js";
import {
  checkOutItem,
  returnItem,
  subscribeToAllActiveCheckouts,
  getCheckoutDisplayStatus
} from "../services/checkout-service.js";
import { escapeHtml, formatDate } from "../utils.js";

const configAlert = document.getElementById("config-alert");
const configStatusBadge = document.getElementById("config-status-badge");
const logBox = document.getElementById("log-box");

let currentUser = null;
let unsubItems = null;
let unsubActive = null;

function log(message, type = "info") {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement("div");
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${time}] ${message}`;
  logBox.appendChild(entry);
  logBox.scrollTop = logBox.scrollHeight;
}

document.getElementById("btn-clear-log").addEventListener("click", () => {
  logBox.innerHTML = "";
});

if (isFirebaseConfigured()) {
  configStatusBadge.innerHTML = '<span class="badge badge-success">Firebase Ready</span>';
  log("Firebase configuration verified.", "success");
} else {
  configStatusBadge.innerHTML = '<span class="badge badge-warn">Config Missing</span>';
  configAlert.style.display = "block";
  log("Firebase is using placeholder credentials.", "warn");
}

async function handleSignOut() {
  if (unsubItems) unsubItems();
  if (unsubActive) unsubActive();
  await signOutUser();
  window.location.replace("index.html");
}

document.getElementById("btn-sign-out").addEventListener("click", handleSignOut);
document.getElementById("btn-logout").addEventListener("click", handleSignOut);

document.getElementById("btn-create-item").addEventListener("click", async () => {
  try {
    if (!currentUser) throw new Error("Teacher authentication required.");
    const name = document.getElementById("item-name").value;
    const code = document.getElementById("item-code").value;
    const category = document.getElementById("item-category").value;
    const totalQuantity = document.getElementById("item-quantity").value;
    const location = document.getElementById("item-location").value;

    const id = await createItem(
      { name, code, category, totalQuantity, location },
      currentUser.uid
    );
    log(`Created item ID: ${id}`, "success");
    document.getElementById("item-name").value = "";
    document.getElementById("item-code").value = "";
    document.getElementById("item-location").value = "";
  } catch (err) {
    log(`Failed to create item: ${err.message}`, "error");
  }
});

document.getElementById("btn-checkout-item").addEventListener("click", async () => {
  try {
    if (!currentUser) throw new Error("Sign in first to check out an item.");
    let itemId = document.getElementById("checkout-item-select").value;
    const codeLookup = document.getElementById("checkout-code-lookup").value.trim();
    const period = document.getElementById("checkout-period").value;
    const durationDays = Number.parseInt(document.getElementById("checkout-duration").value, 10) || 7;

    if (!itemId && codeLookup) {
      const found = await getItemByCode(codeLookup);
      if (!found) throw new Error(`Code "${codeLookup}" not found.`);
      itemId = found.id;
    }
    if (!itemId) throw new Error("Select an item or enter a valid code.");

    const res = await checkOutItem({ itemId, user: currentUser, period, durationDays });
    log(`Checked out "${res.item.name}" (${period}, ${res.checkoutId})`, "success");
    document.getElementById("checkout-code-lookup").value = "";
  } catch (err) {
    log(`Checkout failed: ${err.message}`, "error");
  }
});

requireAuth({
  requiredRole: "teacher",
  redirectUrl: "index.html",
  preserveTarget: true,
  onAuthorized: (user) => {
    currentUser = user;
    const role = user.profile?.role || "teacher";
    const name = user.displayName || user.profile?.displayName || "Teacher";

    document.getElementById("diag-teacher-name").textContent = name;
    document.getElementById("diag-teacher-email").textContent = (user.email || "").split("@")[0];

    const roleBadge = document.getElementById("user-role-badge");
    roleBadge.textContent = role.toUpperCase();
    roleBadge.className = "badge badge-success";

    document.getElementById("user-display-name").textContent = name;
    document.getElementById("user-email").textContent = user.email || "N/A";
    document.getElementById("user-student-number").textContent = user.profile?.studentNumber || "N/A";
    document.getElementById("user-role-text").textContent = role;
    document.getElementById("user-uid").textContent = user.uid;

    log(`Authenticated via Google OAuth: ${user.email} (${role})`, "success");

    if (unsubItems) unsubItems();
    unsubItems = subscribeToItems((items) => {
      document.getElementById("inventory-count").textContent = items.length;
      const select = document.getElementById("checkout-item-select");
      select.innerHTML = '<option value="">-- Choose an item --</option>';
      items.forEach((item) => {
        const opt = document.createElement("option");
        opt.value = item.id;
        opt.textContent = `${item.name} (${item.code}) — ${item.availableQuantity}/${item.totalQuantity} avail`;
        select.appendChild(opt);
      });

      const tbody = document.getElementById("inventory-table-body");
      if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No items yet.</td></tr>';
        return;
      }

      tbody.innerHTML = items
        .map((item) => {
          const avail = Number(item.availableQuantity) || 0;
          const total = Number(item.totalQuantity) || 0;
          return `
            <tr>
              <td><code>${escapeHtml(item.code)}</code></td>
              <td><strong>${escapeHtml(item.name)}</strong></td>
              <td>
                <span class="badge ${avail > 0 ? "badge-success" : "badge-danger"}">
                  ${avail} / ${total}
                </span>
              </td>
              <td>
                <button type="button" class="btn btn-danger-soft btn-xs btn-delete-item" data-id="${escapeHtml(item.id)}">Delete</button>
              </td>
            </tr>
          `;
        })
        .join("");

      tbody.querySelectorAll(".btn-delete-item").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await deleteItem(btn.dataset.id);
            log(`Deleted item ${btn.dataset.id}`, "info");
          } catch (err) {
            log(`Delete failed: ${err.message}`, "error");
          }
        });
      });
    });

    if (unsubActive) unsubActive();
    unsubActive = subscribeToAllActiveCheckouts((checkouts) => {
      document.getElementById("active-checkout-count").textContent = checkouts.length;
      const tbody = document.getElementById("checkouts-table-body");
      if (checkouts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No active checkouts.</td></tr>';
        return;
      }

      tbody.innerHTML = checkouts
        .map((co) => {
          const status = getCheckoutDisplayStatus(co);
          const badge = status === "overdue" ? ' <span class="badge badge-danger">Overdue</span>' : "";
          return `
            <tr>
              <td><strong>${escapeHtml(co.itemName)}</strong><br><code>${escapeHtml(co.itemCode)}</code></td>
              <td>${escapeHtml(co.studentName)}<br><small class="text-muted">${escapeHtml(co.studentNumber || "N/A")}${co.period ? " · " + escapeHtml(co.period) : ""}</small></td>
              <td class="tabular">${escapeHtml(formatDate(co.dueDate))}${badge}</td>
              <td>
                <button type="button" class="btn btn-success btn-xs btn-return-item" data-id="${escapeHtml(co.id)}">Check In</button>
              </td>
            </tr>
          `;
        })
        .join("");

      tbody.querySelectorAll(".btn-return-item").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await returnItem(btn.dataset.id);
            log(`Returned checkout ${btn.dataset.id}`, "success");
          } catch (err) {
            log(`Return failed: ${err.message}`, "error");
          }
        });
      });
    });
  }
});
