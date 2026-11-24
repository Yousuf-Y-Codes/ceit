// js/services/item-service.js
// Item & Inventory Management Service for CEIT
// Handles validated CRUD operations, atomic quantity updates, and real-time inventory sync.

import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import { auth, db, isFirebaseConfigured } from "../firebase-config.js";

const ITEMS_COLLECTION = "items";
const ITEM_CODE_REGEX = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;
const MAX_QUANTITY = 9999;

export const ALLOWED_CATEGORIES = [
  "Microcontrollers",
  "Sensors",
  "Components",
  "Cables & Tools",
  "Cables & Power",
  "Tools & Meters",
  "General"
];

function assertDbReady() {
  if (!isFirebaseConfigured() || !db) {
    throw new Error("Firestore is not initialized. Please configure js/firebase-config.js.");
  }
}

/**
 * Normalizes an item code (trims and converts to uppercase for uniform matching).
 * @param {string} code
 * @returns {string}
 */
export function normalizeItemCode(code) {
  return String(code ?? "").trim().toUpperCase().slice(0, 32);
}

function validateCategory(category) {
  const clean = String(category ?? "General").trim();
  return ALLOWED_CATEGORIES.includes(clean) ? clean : "General";
}

/**
 * Creates a new inventory item with strict validation.
 * @param {object} itemData
 * @param {string} [teacherUid=""]
 * @returns {Promise<string>} The new item ID
 */
export async function createItem(itemData, teacherUid = "") {
  assertDbReady();

  const currentUid = auth?.currentUser?.uid || teacherUid;
  if (!currentUid) throw new Error("Authentication required to create items.");

  const code = normalizeItemCode(itemData.code);
  const name = String(itemData.name ?? "").trim();
  const location = String(itemData.location ?? "").trim();
  const notes = String(itemData.notes ?? "").trim();
  const category = validateCategory(itemData.category);
  const total = Number.parseInt(String(itemData.totalQuantity), 10);

  if (!code) throw new Error("Item code is required.");
  if (!ITEM_CODE_REGEX.test(code)) {
    throw new Error("Item code must be 1–32 characters using letters, numbers, hyphens, underscores, or periods.");
  }
  if (!name || name.length > 120) {
    throw new Error("Item name must be between 1 and 120 characters.");
  }
  if (location.length > 100) {
    throw new Error("Bin / location must be 100 characters or fewer.");
  }
  if (notes.length > 300) {
    throw new Error("Notes must be 300 characters or fewer.");
  }
  if (!Number.isInteger(total) || total < 1 || total > MAX_QUANTITY) {
    throw new Error(`Total quantity must be a whole number between 1 and ${MAX_QUANTITY}.`);
  }

  // Check for duplicate code
  const existing = await getItemByCode(code);
  if (existing) {
    throw new Error(`An item with code "${code}" already exists ("${existing.name}").`);
  }

  const docData = {
    name,
    code,
    category,
    totalQuantity: total,
    availableQuantity: total,
    location,
    notes,
    createdBy: currentUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const docRef = await addDoc(collection(db, ITEMS_COLLECTION), docData);
  return docRef.id;
}

/**
 * Finds an item by its unique QR code or text code.
 * @param {string} rawCode
 * @returns {Promise<object|null>}
 */
export async function getItemByCode(rawCode) {
  assertDbReady();
  const code = normalizeItemCode(rawCode);
  if (!code || !ITEM_CODE_REGEX.test(code)) return null;

  const q = query(collection(db, ITEMS_COLLECTION), where("code", "==", code));
  const snap = await getDocs(q);

  if (snap.empty) {
    return null;
  }

  const docSnap = snap.docs[0];
  return { id: docSnap.id, ...docSnap.data() };
}

/**
 * Gets a single item by Firestore document ID.
 * @param {string} itemId
 * @returns {Promise<object|null>}
 */
export async function getItemById(itemId) {
  assertDbReady();
  if (!itemId) return null;
  const docRef = doc(db, ITEMS_COLLECTION, itemId);
  const snap = await getDoc(docRef);
  if (snap.exists()) {
    return { id: snap.id, ...snap.data() };
  }
  return null;
}

/**
 * Updates an item's details.
 * Uses a Firestore transaction when totalQuantity changes so concurrent checkouts never desync stock.
 * @param {string} itemId
 * @param {object} updates
 * @returns {Promise<void>}
 */
export async function updateItem(itemId, updates) {
  assertDbReady();
  if (!itemId) throw new Error("Item ID is required.");
  const docRef = doc(db, ITEMS_COLLECTION, itemId);

  const cleanUpdates = {
    updatedAt: serverTimestamp()
  };

  if (updates.name !== undefined) {
    const name = String(updates.name).trim();
    if (!name || name.length > 120) {
      throw new Error("Item name must be between 1 and 120 characters.");
    }
    cleanUpdates.name = name;
  }
  if (updates.category !== undefined) {
    cleanUpdates.category = validateCategory(updates.category);
  }
  if (updates.location !== undefined) {
    const loc = String(updates.location).trim();
    if (loc.length > 100) throw new Error("Location must be 100 characters or fewer.");
    cleanUpdates.location = loc;
  }
  if (updates.notes !== undefined) {
    const notes = String(updates.notes).trim();
    if (notes.length > 300) throw new Error("Notes must be 300 characters or fewer.");
    cleanUpdates.notes = notes;
  }

  if (updates.totalQuantity !== undefined) {
    const newTotal = Number.parseInt(String(updates.totalQuantity), 10);
    if (!Number.isInteger(newTotal) || newTotal < 0 || newTotal > MAX_QUANTITY) {
      throw new Error(`Total quantity must be a whole number between 0 and ${MAX_QUANTITY}.`);
    }

    await runTransaction(db, async (transaction) => {
      const currentSnap = await transaction.get(docRef);
      if (!currentSnap.exists()) throw new Error("Item not found.");
      const currentData = currentSnap.data();

      const checkedOutCount = Math.max(
        0,
        (currentData.totalQuantity || 0) - (currentData.availableQuantity || 0)
      );
      if (newTotal < checkedOutCount) {
        throw new Error(
          `Cannot reduce total to ${newTotal}. There are currently ${checkedOutCount} units signed out.`
        );
      }

      transaction.update(docRef, {
        ...cleanUpdates,
        totalQuantity: newTotal,
        availableQuantity: newTotal - checkedOutCount
      });
    });
    return;
  }

  await updateDoc(docRef, cleanUpdates);
}

/**
 * Deletes an item from inventory.
 * @param {string} itemId
 * @returns {Promise<void>}
 */
export async function deleteItem(itemId) {
  assertDbReady();
  if (!itemId) throw new Error("Item ID is required.");
  const docRef = doc(db, ITEMS_COLLECTION, itemId);
  await deleteDoc(docRef);
}

/**
 * Fetches all items once.
 * @returns {Promise<Array<object>>}
 */
export async function getAllItems() {
  assertDbReady();
  const q = query(collection(db, ITEMS_COLLECTION), orderBy("name", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Subscribes to real-time updates for all items in the inventory.
 * @param {function(Array<object>): void} onUpdate
 * @param {function(Error): void} [onError]
 * @returns {function(): void} Unsubscribe function
 */
export function subscribeToItems(onUpdate, onError = console.error) {
  if (!isFirebaseConfigured() || !db) {
    onUpdate([]);
    return () => {};
  }

  const q = query(collection(db, ITEMS_COLLECTION), orderBy("name", "asc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      onUpdate(items);
    },
    onError
  );
}
