import crypto from "crypto";
import admin from "firebase-admin";

function getFirestore() {
  if (!admin.apps.length) {
    throw new Error("Firebase Admin SDK is not initialized. Set up Firebase Admin credentials before using payments.");
  }
  return admin.firestore();
}

const collections = {
  payments: () => getFirestore().collection("payments"),
  cvs: () => getFirestore().collection("cvs"),
  tokens: () => getFirestore().collection("tokens"),
  accessLogs: () => getFirestore().collection("access_logs")
};

function hashToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

async function initDB() {
  const db = getFirestore();
  const ref = db.collection("_meta").doc("init");
  await ref.set({ initializedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return true;
}

async function createPayment(data) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const docId = data.order_id || `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  const ref = collections.payments().doc(docId);
  await ref.set({
    order_id: docId,
    cv_id: data.cv_id || null,
    method: data.method || null,
    user_id: data.user_id || null,
    amount: Number(data.amount || 0),
    currency: data.currency || "USD",
    status: data.status || "PENDING",
    raw: data.raw || null,
    max_uses: Number(data.max_uses || 1),
    createdAt: now,
    updatedAt: now
  }, { merge: true });
  const snapshot = await ref.get();
  return { id: ref.id, ...snapshot.data() };
}

async function listPayments({ limit = 50, offset = 0, user_id, cv_id } = {}) {
  let query = collections.payments().orderBy("createdAt", "desc");
  if (user_id) query = query.where("user_id", "==", user_id);
  if (cv_id) query = query.where("cv_id", "==", cv_id);
  if (offset) query = query.offset(offset);
  if (limit) query = query.limit(limit);
  const snapshot = await query.get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function getPaymentByOrderId(orderId) {
  const query = await collections.payments().where("order_id", "==", orderId).limit(1).get();
  if (query.empty) return null;
  const doc = query.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function updatePaymentByOrderId(orderId, updates = {}) {
  const query = await collections.payments().where("order_id", "==", orderId).limit(1).get();
  if (query.empty) return null;
  const doc = query.docs[0];
  const now = admin.firestore.FieldValue.serverTimestamp();
  await doc.ref.set({ ...updates, updatedAt: now }, { merge: true });
  const updated = await doc.ref.get();
  return { id: doc.id, ...updated.data() };
}

async function createCV({ cv_id, user_id, content }) {
  if (!cv_id) {
    throw new Error("cv_id is required to create a CV record");
  }
  const now = admin.firestore.FieldValue.serverTimestamp();
  const ref = collections.cvs().doc(cv_id);
  await ref.set({
    cv_id,
    user_id: user_id || null,
    content: content || "",
    createdAt: now,
    updatedAt: now
  }, { merge: true });
  const snapshot = await ref.get();
  return { id: ref.id, ...snapshot.data() };
}

async function getCVById(cvId) {
  const ref = collections.cvs().doc(cvId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  return { id: snapshot.id, ...snapshot.data() };
}

async function createTokenForPayment(orderId, ttlSeconds = 24 * 3600, { cv_id = null, user_id = null, maxUses = 1 } = {}) {
  if (!orderId) {
    throw new Error("orderId is required to create a token");
  }
  const rawToken = crypto.randomBytes(24).toString("hex");
  const tokenHash = hashToken(rawToken);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const docRef = collections.tokens().doc(tokenHash);
  await docRef.set({
    order_id: orderId,
    cv_id: cv_id || null,
    user_id: user_id || null,
    token_hash: tokenHash,
    max_uses: maxUses,
    usage_count: 0,
    used: false,
    expires_at: expiresAt,
    createdAt: now,
    updatedAt: now
  }, { merge: true });
  return { token: rawToken, expiresAt, maxUses };
}

async function getTokenRecord(token) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const ref = collections.tokens().doc(tokenHash);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  return { id: snapshot.id, ...snapshot.data() };
}

async function incrementTokenUsage(token) {
  const tokenHash = hashToken(token);
  const ref = collections.tokens().doc(tokenHash);
  return await admin.firestore().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      throw new Error("Token not found");
    }
    const data = snapshot.data();
    const now = new Date();
    if (data.expires_at && new Date(data.expires_at) < now) {
      throw new Error("Token expired");
    }
    if (data.used || (typeof data.max_uses === "number" && data.usage_count >= data.max_uses)) {
      throw new Error("Token usage limit reached");
    }
    const nextCount = (data.usage_count || 0) + 1;
    const update = {
      usage_count: nextCount,
      used: nextCount >= (data.max_uses || 1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    tx.set(ref, update, { merge: true });
    return nextCount;
  });
}

async function logAccess({ cv_id, user_id, token, ip, success, reason }) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const ref = collections.accessLogs().doc();
  await ref.set({
    cv_id: cv_id || null,
    user_id: user_id || null,
    token: token || null,
    ip: ip || null,
    success: Boolean(success),
    reason: reason || null,
    createdAt: now
  });
  return { id: ref.id };
}

async function getAccessLogsByCv(cvId) {
  const query = collections.accessLogs().where("cv_id", "==", cvId).orderBy("createdAt", "desc");
  const snapshot = await query.get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export default {
  initDB,
  createPayment,
  listPayments,
  getPaymentByOrderId,
  updatePaymentByOrderId,
  createCV,
  getCVById,
  createTokenForPayment,
  getTokenRecord,
  incrementTokenUsage,
  logAccess,
  getAccessLogsByCv
};
