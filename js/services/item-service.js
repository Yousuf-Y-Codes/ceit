// js/services/item-service.js
// Item & Inventory Management Service for CEIT
// Handles CRUD operations, QR/text code lookups, and real-time inventory synchronization.

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
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import { db, isFirebaseConfigured } from "../firebase-config.js";

const ITEMS_COLLECTION = "items";

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
  return (code || "").trim().toUpperCase();
}

/**
 * Creates a new inventory item.
 * Validates that the item code is unique.
 * @param {object} itemData
 * @param {string} itemData.name
 * @param {string} itemData.code - Unique QR or text code (e.g. "ARD-01")
 * @param {string} [itemData.category="General"]
 * @param {number} itemData.totalQuantity
 * @param {string} [itemData.location=""]
 * @param {string} [itemData.notes=""]
 * @param {string} [teacherUid=""]
 * @returns {Promise<string>} The new item ID
 */
export async function createItem(itemData, teacherUid = "") {
  assertDbReady();

  const code = normalizeItemCode(itemData.code);
  const name = (itemData.name || "").trim();
  const total = parseInt(itemData.totalQuantity, 10);

  if (!code) throw new Error("Item code is required.");
  if (!name) throw new Error("Item name is required.");
  if (isNaN(total) || total < 1) {
    throw new Error("Total quantity must be at least 1.");
  }

  // Check for duplicate code
  const existing = await getItemByCode(code);
  if (existing) {
    throw new Error(`An item with code "${code}" already exists ("${existing.name}").`);
  }

  const docData = {
    name,
    code,
    category: (itemData.category || "General").trim(),
    totalQuantity: total,
    availableQuantity: total, // Initially all are available
    location: (itemData.location || "").trim(),
    notes: (itemData.notes || "").trim(),
    createdBy: teacherUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const docRef = await addDoc(collection(db, ITEMS_COLLECTION), docData);
  return docRef.id;
}

/**
 * Finds an item by its unique QR code or text code.
 * @param {string} rawCode
 * @returns {Promise<object|null>} Item document or null if not found
 */
export async function getItemByCode(rawCode) {
  assertDbReady();
  const code = normalizeItemCode(rawCode);
  if (!code) return null;

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
  const docRef = doc(db, ITEMS_COLLECTION, itemId);
  const snap = await getDoc(docRef);
  if (snap.exists()) {
    return { id: snap.id, ...snap.data() };
  }
  return null;
}

/**
 * Updates an item's details.
 * If totalQuantity is changed, adjusts availableQuantity accordingly.
 * @param {string} itemId
 * @param {object} updates
 * @returns {Promise<void>}
 */
export async function updateItem(itemId, updates) {
  assertDbReady();
  const docRef = doc(db, ITEMS_COLLECTION, itemId);

  const cleanUpdates = {
    updatedAt: serverTimestamp()
  };

  if (updates.name !== undefined) cleanUpdates.name = updates.name.trim();
  if (updates.category !== undefined) cleanUpdates.category = updates.category.trim();
  if (updates.location !== undefined) cleanUpdates.location = updates.location.trim();
  if (updates.notes !== undefined) cleanUpdates.notes = updates.notes.trim();

  if (updates.totalQuantity !== undefined) {
    const currentSnap = await getDoc(docRef);
    if (!currentSnap.exists()) throw new Error("Item not found.");
    const currentData = currentSnap.data();

    const newTotal = parseInt(updates.totalQuantity, 10);
    if (isNaN(newTotal) || newTotal < 0) {
      throw new Error("Invalid total quantity.");
    }

    const checkedOutCount = currentData.totalQuantity - currentData.availableQuantity;
    if (newTotal < checkedOutCount) {
      throw new Error(
        `Cannot reduce total to ${newTotal}. There are currently ${checkedOutCount} units signed out.`
      );
    }

    cleanUpdates.totalQuantity = newTotal;
    cleanUpdates.availableQuantity = newTotal - checkedOutCount;
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
 * @param {function(Array<object>): void} onUpdate Callback receiving array of items
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
