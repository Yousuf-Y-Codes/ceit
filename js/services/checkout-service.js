// js/services/checkout-service.js
// Checkout & Sign-In/Out Service for CEIT
// Uses Firestore transactions with strict identity & input validation for concurrency and security.

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

import { auth, db, isFirebaseConfigured } from "../firebase-config.js";
import { extractStudentNumberFromEmail, isPdsbEmail } from "./auth-service.js";
import { isValidEmail } from "../utils.js";

const CHECKOUTS_COLLECTION = "checkouts";
const ITEMS_COLLECTION = "items";
export const VALID_PERIODS = ["Period 1", "Period 2", "Period 3", "Period 4"];

function assertDbReady() {
  if (!isFirebaseConfigured() || !db) {
    throw new Error("Firestore is not initialized. Please configure js/firebase-config.js.");
  }
}

function validatePeriod(period) {
  const clean = String(period ?? "").trim();
  if (!VALID_PERIODS.includes(clean)) {
    throw new Error("Please select a valid class period (Period 1–4).");
  }
  return clean;
}

function validateDurationDays(durationDays) {
  const parsed = Number.parseInt(String(durationDays), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 30) {
    throw new Error("Loan duration must be between 1 and 30 days.");
  }
  return parsed;
}

function validateNotes(notes) {
  const clean = String(notes ?? "").trim();
  if (clean.length > 300) {
    throw new Error("Notes must be 300 characters or fewer.");
  }
  return clean;
}

/**
 * Atomically signs out an item for the authenticated user using a Firestore transaction.
 * Derives identity strictly from the verified Firebase Auth session.
 *
 * @param {object} params
 * @param {string} params.itemId
 * @param {object} params.user
 * @param {string} params.period
 * @param {number} [params.durationDays=7]
 * @param {string} [params.notes=""]
 * @returns {Promise<{ checkoutId: string, item: object }>}
 */
export async function checkOutItem({
  itemId,
  user,
  period = "",
  durationDays = 7,
  notes = ""
}) {
  assertDbReady();

  const liveAuthUser = auth?.currentUser;
  if (!liveAuthUser || !user || liveAuthUser.uid !== user.uid) {
    throw new Error("A verified logged-in session is required for checkout.");
  }

  const verifiedEmail = (liveAuthUser.email || "").toLowerCase().trim();
  if (!isPdsbEmail(verifiedEmail)) {
    throw new Error("Only verified @pdsb.net accounts can check out components.");
  }

  if (!itemId) throw new Error("Item ID is required for checkout.");

  const validPeriod = validatePeriod(period);
  const validDays = validateDurationDays(durationDays);
  const validNotes = validateNotes(notes);

  const resolvedStudentNumber =
    extractStudentNumberFromEmail(verifiedEmail) || verifiedEmail.split("@")[0];
  const resolvedName = (
    liveAuthUser.displayName ||
    user.profile?.displayName ||
    verifiedEmail.split("@")[0] ||
    "Student"
  )
    .trim()
    .slice(0, 120);

  const itemRef = doc(db, ITEMS_COLLECTION, itemId);
  const newCheckoutRef = doc(collection(db, CHECKOUTS_COLLECTION));

  const durationMs = validDays * 24 * 60 * 60 * 1000;
  const dueDate = Timestamp.fromDate(new Date(Date.now() + durationMs));

  return await runTransaction(db, async (transaction) => {
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

    transaction.update(itemRef, {
      availableQuantity: itemData.availableQuantity - 1,
      lastCheckoutId: newCheckoutRef.id,
      updatedAt: serverTimestamp()
    });

    const newRecord = {
      id: newCheckoutRef.id,
      itemId: itemRef.id,
      itemCode: itemData.code,
      itemName: itemData.name,
      category: itemData.category || "General",
      userId: liveAuthUser.uid,
      studentEmail: verifiedEmail,
      studentName: resolvedName,
      studentNumber: resolvedStudentNumber,
      period: validPeriod,
      durationDays: validDays,
      checkedOutAt: serverTimestamp(),
      dueDate,
      returnedAt: null,
      status: "active",
      notes: validNotes
    };

    transaction.set(newCheckoutRef, newRecord);
    return { checkoutId: newCheckoutRef.id, item: itemData };
  });
}

/**
 * Atomically marks a checkout record as returned and increments item inventory.
 * Derives `returnedBy` strictly from the authenticated user's verified email.
 *
 * @param {string} checkoutId
 * @returns {Promise<void>}
 */
export async function returnItem(checkoutId) {
  assertDbReady();

  const liveAuthUser = auth?.currentUser;
  if (!liveAuthUser || !liveAuthUser.email) {
    throw new Error("A verified logged-in session is required to return an item.");
  }
  if (!checkoutId) throw new Error("Checkout ID is required.");

  const actorEmail = liveAuthUser.email.toLowerCase().trim();
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

    transaction.update(checkoutRef, {
      status: "returned",
      returnedAt: serverTimestamp(),
      returnedBy: actorEmail
    });

    if (itemSnap.exists()) {
      const itemData = itemSnap.data();
      const currentAvail = Number(itemData.availableQuantity) || 0;
      const totalQty = Number(itemData.totalQuantity) || 0;
      if (currentAvail < totalQty) {
        transaction.update(itemRef, {
          availableQuantity: currentAvail + 1,
          lastCheckoutId: checkoutId,
          updatedAt: serverTimestamp()
        });
      }
    }
  });
}

/**
 * Atomically signs out an item on behalf of a student (Teacher Guest Mode).
 *
 * @param {object} params
 * @returns {Promise<{ checkoutId: string, item: object }>}
 */
export async function guestCheckOutItem({
  itemId,
  teacherUser,
  studentName,
  studentNumber,
  studentEmail = "",
  period = "",
  durationDays = 7,
  notes = ""
}) {
  assertDbReady();

  const liveAuthUser = auth?.currentUser;
  if (!liveAuthUser || !teacherUser || liveAuthUser.uid !== teacherUser.uid) {
    throw new Error("Teacher authentication is required.");
  }
  if (teacherUser.profile?.role !== "teacher") {
    throw new Error("Only teachers can record guest sign-outs.");
  }
  if (!itemId) throw new Error("Please select an item to sign out.");

  const cleanName = String(studentName ?? "").trim();
  const cleanNum = String(studentNumber ?? "").trim();
  if (!cleanName || cleanName.length > 120) {
    throw new Error("Student name must be between 1 and 120 characters.");
  }
  if (!cleanNum || cleanNum.length > 32 || !/^[a-zA-Z0-9_-]+$/.test(cleanNum)) {
    throw new Error("Student number must be 1–32 alphanumeric characters.");
  }

  const validPeriod = validatePeriod(period);
  const validDays = validateDurationDays(durationDays);
  const validNotes = validateNotes(notes);

  const rawEmail = String(studentEmail ?? "").trim().toLowerCase();
  if (rawEmail && !isValidEmail(rawEmail)) {
    throw new Error("Please enter a valid student email address or leave it blank.");
  }

  const resolvedEmail =
    rawEmail || (/^\d+$/.test(cleanNum) ? `${cleanNum}@pdsb.net` : "");

  const itemRef = doc(db, ITEMS_COLLECTION, itemId);
  const newCheckoutRef = doc(collection(db, CHECKOUTS_COLLECTION));

  const durationMs = validDays * 24 * 60 * 60 * 1000;
  const dueDate = Timestamp.fromDate(new Date(Date.now() + durationMs));

  return await runTransaction(db, async (transaction) => {
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

    transaction.update(itemRef, {
      availableQuantity: itemData.availableQuantity - 1,
      lastCheckoutId: newCheckoutRef.id,
      updatedAt: serverTimestamp()
    });

    const newRecord = {
      id: newCheckoutRef.id,
      itemId: itemRef.id,
      itemCode: itemData.code,
      itemName: itemData.name,
      category: itemData.category || "General",
      userId: liveAuthUser.uid,
      isGuest: true,
      checkedOutByTeacher: (liveAuthUser.email || liveAuthUser.uid).toLowerCase(),
      studentEmail: resolvedEmail,
      studentName: cleanName,
      studentNumber: cleanNum,
      period: validPeriod,
      durationDays: validDays,
      checkedOutAt: serverTimestamp(),
      dueDate,
      returnedAt: null,
      status: "active",
      notes: validNotes
    };

    transaction.set(newCheckoutRef, newRecord);
    return { checkoutId: newCheckoutRef.id, item: itemData };
  });
}

/**
 * Calculates display state of a checkout (flags overdue and due-soon items).
 * @param {object} checkout
 * @returns {"returned" | "overdue" | "due-soon" | "active"}
 */
export function getCheckoutDisplayStatus(checkout) {
  if (checkout.status === "returned") return "returned";
  if (checkout.dueDate && checkout.dueDate.toDate) {
    const dueTime = checkout.dueDate.toDate().getTime();
    const now = Date.now();
    if (now > dueTime) return "overdue";
    if (dueTime - now <= 24 * 60 * 60 * 1000) return "due-soon";
  }
  return "active";
}

/**
 * Subscribes to real-time active checkouts for a specific student.
 * @param {string} studentUid
 * @param {function(Array<object>): void} onUpdate
 * @param {function(Error): void} [onError]
 * @returns {function(): void}
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
      const checkouts = snapshot.docs
        .map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data()
        }))
        .filter((co) => !co.isGuest);
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
 * Subscribes to ALL checkouts (active + returned) for a specific student.
 * @param {string} studentUid
 * @param {function({ active: Array<object>, returned: Array<object>, all: Array<object> }): void} onUpdate
 * @param {function(Error): void} [onError]
 * @returns {function(): void}
 */
export function subscribeToStudentCheckouts(studentUid, onUpdate, onError = console.error) {
  if (!isFirebaseConfigured() || !db || !studentUid) {
    onUpdate({ active: [], returned: [], all: [] });
    return () => {};
  }

  const q = query(
    collection(db, CHECKOUTS_COLLECTION),
    where("userId", "==", studentUid)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const all = snapshot.docs
        .map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data()
        }))
        .filter((co) => !co.isGuest);

      all.sort((a, b) => {
        const timeA = a.checkedOutAt?.toMillis ? a.checkedOutAt.toMillis() : 0;
        const timeB = b.checkedOutAt?.toMillis ? b.checkedOutAt.toMillis() : 0;
        return timeB - timeA;
      });

      const active = all.filter((c) => c.status === "active");
      const returned = all.filter((c) => c.status === "returned");
      onUpdate({ active, returned, all });
    },
    onError
  );
}

/**
 * Subscribes to ALL active checkouts across all students (Teacher Admin Panel).
 * @param {function(Array<object>): void} onUpdate
 * @param {function(Error): void} [onError]
 * @returns {function(): void}
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
 * Subscribes to full checkout history (Teacher Audit Logs / Reports).
 * @param {function(Array<object>): void} onUpdate
 * @param {number} [maxResults=100]
 * @param {function(Error): void} [onError]
 * @returns {function(): void}
 */
export function subscribeToCheckoutHistory(onUpdate, maxResults = 100, onError = console.error) {
  if (!isFirebaseConfigured() || !db) {
    onUpdate([]);
    return () => {};
  }

  const safeLimit = Math.min(500, Math.max(1, Number.parseInt(String(maxResults), 10) || 100));
  const q = query(
    collection(db, CHECKOUTS_COLLECTION),
    orderBy("checkedOutAt", "desc"),
    limit(safeLimit)
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
