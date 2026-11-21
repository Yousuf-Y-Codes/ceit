// js/services/checkout-service.js
// Checkout & Sign-In/Out Service for CEIT
// Uses Firestore transactions to ensure atomic inventory updates and concurrency safety.

import {
  collection,
  doc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import { db, isFirebaseConfigured } from "../firebase-config.js";
import { extractStudentNumberFromEmail } from "./auth-service.js";

const CHECKOUTS_COLLECTION = "checkouts";
const ITEMS_COLLECTION = "items";

function assertDbReady() {
  if (!isFirebaseConfigured() || !db) {
    throw new Error("Firestore is not initialized. Please configure js/firebase-config.js.");
  }
}

/**
 * Atomically signs out an item for a student using a Firestore transaction.
 * Decrements the item's availableQuantity and records the checkout.
 *
 * @param {object} params
 * @param {string} params.itemId - Firestore ID of the item
 * @param {object} params.user - Current user object (with uid, email, profile)
 * @param {string} [params.studentNumber] - Optional student number override
 * @param {number} [params.durationDays=7] - Loan period in days
 * @param {string} [params.notes=""] - Optional checkout notes
 * @returns {Promise<{ checkoutId: string, item: object }>}
 */
export async function checkOutItem({
  itemId,
  user,
  studentNumber = "",
  durationDays = 7,
  notes = ""
}) {
  assertDbReady();

  if (!itemId) throw new Error("Item ID is required for checkout.");
  if (!user || !user.uid) throw new Error("A logged-in user is required for checkout.");

  const itemRef = doc(db, ITEMS_COLLECTION, itemId);
  const newCheckoutRef = doc(collection(db, CHECKOUTS_COLLECTION));

  const resolvedStudentNumber =
    studentNumber ||
    user.profile?.studentNumber ||
    extractStudentNumberFromEmail(user.email) ||
    "N/A";

  const durationMs = Math.max(1, durationDays) * 24 * 60 * 60 * 1000;
  const dueDate = Timestamp.fromDate(new Date(Date.now() + durationMs));

  const checkoutData = await runTransaction(db, async (transaction) => {
    const itemSnap = await transaction.get(itemRef);

    if (!itemSnap.exists()) {
      throw new Error("Item does not exist in inventory.");
    }

    const itemData = itemSnap.data();

    if (itemData.availableQuantity <= 0) {
      throw new Error(
        `"${itemData.name}" is currently out of stock (0 of ${itemData.totalQuantity} available).`
      );
    }

    // Decrement item availability
    transaction.update(itemRef, {
      availableQuantity: itemData.availableQuantity - 1,
      updatedAt: serverTimestamp()
    });

    const newRecord = {
      id: newCheckoutRef.id,
      itemId: itemRef.id,
      itemCode: itemData.code,
      itemName: itemData.name,
      category: itemData.category || "General",
      userId: user.uid,
      studentEmail: user.email || "",
      studentName: user.displayName || user.profile?.displayName || "Student",
      studentNumber: resolvedStudentNumber,
      durationDays: durationDays,
      checkedOutAt: serverTimestamp(),
      dueDate: dueDate,
      returnedAt: null,
      status: "active",
      notes: notes.trim()
    };

    transaction.set(newCheckoutRef, newRecord);
    return { checkoutId: newCheckoutRef.id, item: itemData };
  });

  return checkoutData;
}

/**
 * Atomically marks a checkout record as returned and increments item inventory.
 * Can be performed by the student or by a teacher.
 *
 * @param {string} checkoutId - Firestore checkout document ID
 * @param {string} [returnedBy="self"] - User/actor returning the item
 * @returns {Promise<void>}
 */
export async function returnItem(checkoutId, returnedBy = "self") {
  assertDbReady();

  if (!checkoutId) throw new Error("Checkout ID is required.");

  const checkoutRef = doc(db, CHECKOUTS_COLLECTION, checkoutId);

  await runTransaction(db, async (transaction) => {
    const checkoutSnap = await transaction.get(checkoutRef);

    if (!checkoutSnap.exists()) {
      throw new Error("Checkout record not found.");
    }

    const checkoutData = checkoutSnap.data();

    if (checkoutData.status === "returned") {
      throw new Error("This item has already been checked in.");
    }

    const itemRef = doc(db, ITEMS_COLLECTION, checkoutData.itemId);
    const itemSnap = await transaction.get(itemRef);

    // Update checkout document
    transaction.update(checkoutRef, {
      status: "returned",
      returnedAt: serverTimestamp(),
      returnedBy: returnedBy
    });

    // If item still exists in inventory, increment available quantity
    if (itemSnap.exists()) {
      const itemData = itemSnap.data();
      const updatedAvailable = Math.min(
        itemData.totalQuantity,
        (itemData.availableQuantity || 0) + 1
      );
      transaction.update(itemRef, {
        availableQuantity: updatedAvailable,
        updatedAt: serverTimestamp()
      });
    }
  });
}

/**
 * Calculates display state of a checkout (flags overdue items).
 * @param {object} checkout
 * @returns {"returned" | "overdue" | "active"}
 */
export function getCheckoutDisplayStatus(checkout) {
  if (checkout.status === "returned") return "returned";
  if (checkout.dueDate && checkout.dueDate.toDate) {
    const dueTime = checkout.dueDate.toDate().getTime();
    if (Date.now() > dueTime) return "overdue";
  }
  return "active";
}

/**
 * Subscribes to real-time active checkouts for a specific student (for Student Dashboard).
 * @param {string} studentUid
 * @param {function(Array<object>): void} onUpdate
 * @param {function(Error): void} [onError]
 * @returns {function(): void} Unsubscribe function
 */
export function subscribeToStudentActiveCheckouts(studentUid, onUpdate, onError = console.error) {
  if (!isFirebaseConfigured() || !db || !studentUid) {
    onUpdate([]);
    return () => {};
  }

  const q = query(
    collection(db, CHECKOUTS_COLLECTION),
    where("userId", "==", studentUid),
    where("status", "==", "active")
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const checkouts = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      // Sort in memory by checkedOutAt descending
      checkouts.sort((a, b) => {
        const timeA = a.checkedOutAt?.toMillis ? a.checkedOutAt.toMillis() : 0;
        const timeB = b.checkedOutAt?.toMillis ? b.checkedOutAt.toMillis() : 0;
        return timeB - timeA;
      });
      onUpdate(checkouts);
    },
    onError
  );
}

/**
 * Subscribes to ALL active checkouts across all students (for Teacher Admin Panel).
 * @param {function(Array<object>): void} onUpdate
 * @param {function(Error): void} [onError]
 * @returns {function(): void} Unsubscribe function
 */
export function subscribeToAllActiveCheckouts(onUpdate, onError = console.error) {
  if (!isFirebaseConfigured() || !db) {
    onUpdate([]);
    return () => {};
  }

  const q = query(
    collection(db, CHECKOUTS_COLLECTION),
    where("status", "==", "active")
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const checkouts = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      checkouts.sort((a, b) => {
        const timeA = a.checkedOutAt?.toMillis ? a.checkedOutAt.toMillis() : 0;
        const timeB = b.checkedOutAt?.toMillis ? b.checkedOutAt.toMillis() : 0;
        return timeB - timeA;
      });
      onUpdate(checkouts);
    },
    onError
  );
}

/**
 * Subscribes to full checkout history (for Teacher Audit Logs / Reports).
 * @param {number} [maxResults=100]
 * @param {function(Array<object>): void} onUpdate
 * @param {function(Error): void} [onError]
 * @returns {function(): void} Unsubscribe function
 */
export function subscribeToCheckoutHistory(onUpdate, maxResults = 100, onError = console.error) {
  if (!isFirebaseConfigured() || !db) {
    onUpdate([]);
    return () => {};
  }

  const q = query(
    collection(db, CHECKOUTS_COLLECTION),
    orderBy("checkedOutAt", "desc"),
    limit(maxResults)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const history = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      onUpdate(history);
    },
    onError
  );
}
