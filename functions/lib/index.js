"use strict";
/**
 * Shopkeeper — Firebase Cloud Functions
 * Payment verification backend
 *
 * Functions:
 *   createOrder          — callable: creates a Razorpay order, returns orderId + keyId
 *   verifyPayment        — callable: verifies Razorpay signature, writes subscription
 *   confirmManualPayment — callable: activates subscription for UPI / bank / cash
 *   razorpayWebhook      — HTTPS: receives Razorpay webhook events
 *
 * Environment variables (set via `firebase functions:config:set` or Secret Manager):
 *   RAZORPAY_KEY_ID       — Razorpay publishable key  (safe to log, NOT secret)
 *   RAZORPAY_KEY_SECRET   — Razorpay private secret   (NEVER expose to frontend)
 *   RAZORPAY_WEBHOOK_SECRET — Webhook signing secret  (NEVER expose to frontend)
 *
 * Deploy:
 *   cd functions && npm run build
 *   firebase deploy --only functions
 *
 * Set secrets:
 *   firebase functions:secrets:set RAZORPAY_KEY_ID
 *   firebase functions:secrets:set RAZORPAY_KEY_SECRET
 *   firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.razorpayWebhook = exports.confirmManualPayment = exports.verifyPayment = exports.createOrder = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const admin = __importStar(require("firebase-admin"));
const crypto = __importStar(require("crypto"));
const razorpay_1 = __importDefault(require("razorpay"));
admin.initializeApp();
const db = admin.firestore();
// ── Secrets (Firebase Secret Manager — never hardcoded) ───────────────────────
const RZP_KEY_ID = (0, params_1.defineSecret)('RAZORPAY_KEY_ID');
const RZP_KEY_SECRET = (0, params_1.defineSecret)('RAZORPAY_KEY_SECRET');
const RZP_WEBHOOK_SECRET = (0, params_1.defineSecret)('RAZORPAY_WEBHOOK_SECRET');
// ── Firestore paths ────────────────────────────────────────────────────────────
const userSubRef = (uid) => db.collection('users').doc(uid).collection('subscription').doc('current');
const auditColRef = () => db.collection('subscription_logs');
const planRef = (planId) => db.collection('plans').doc(planId);
const configRef = () => db.collection('config').doc('global');
// ── Helpers ────────────────────────────────────────────────────────────────────
async function fetchPlan(planId) {
    const snap = await planRef(planId).get();
    if (!snap.exists || !snap.data()?.isActive) {
        throw new https_1.HttpsError('not-found', `Plan '${planId}' not found or inactive`);
    }
    return snap.data();
}
async function fetchConfig() {
    const snap = await configRef().get();
    return snap.exists ? { gracePeriodDays: 3, ...snap.data() } : { gracePeriodDays: 3 };
}
/**
 * Build a full subscription record.
 * Renewal: extends from max(now, existingEndDate) so active users don't lose time.
 */
function buildSubscriptionRecord(opts) {
    const now = Date.now();
    const baseMs = opts.existingEndMs ? Math.max(now, opts.existingEndMs) : now;
    const endMs = baseMs + opts.planDoc.durationDays * 86400000;
    const graceMs = endMs + opts.gracePeriodDays * 86400000;
    const nowTs = admin.firestore.Timestamp.fromMillis(now);
    return {
        planId: opts.planId,
        plan: opts.planId,
        status: 'active',
        startDate: admin.firestore.Timestamp.fromMillis(now),
        endDate: admin.firestore.Timestamp.fromMillis(endMs),
        graceEndDate: admin.firestore.Timestamp.fromMillis(graceMs),
        trialUsed: opts.trialUsed ?? false,
        autoRenew: false,
        paymentId: opts.paymentId,
        source: 'payment',
        introOffer: opts.planDoc.price === 0,
        createdAt: opts.existingCreatedAt ?? nowTs,
        updatedAt: nowTs,
    };
}
/**
 * Idempotently write subscription + audit log in a Firestore transaction.
 * If paymentId already stored → returns without writing (safe retry).
 */
async function writeSubscriptionIdempotent(opts) {
    const { userId, record, action, paymentMethod } = opts;
    const subRef = userSubRef(userId);
    const auditRef = auditColRef().doc();
    return db.runTransaction(async (tx) => {
        const existing = await tx.get(subRef);
        if (existing.exists && existing.data()?.paymentId === record.paymentId) {
            return { alreadyActivated: true };
        }
        const previousState = existing.exists ? existing.data() ?? null : null;
        tx.set(subRef, record); // full overwrite — no stale fields
        tx.set(auditRef, {
            userId,
            action,
            previousState,
            newState: { ...record, paymentMethod: paymentMethod ?? null },
            performedBy: 'system',
            timestamp: admin.firestore.Timestamp.now(),
        });
        return { alreadyActivated: false };
    });
}
// ══════════════════════════════════════════════════════════════════════════════
// CALLABLE: createOrder
// Frontend calls this before opening the Razorpay checkout modal.
// Returns orderId, amount, currency, keyId — NEVER keySecret.
// ══════════════════════════════════════════════════════════════════════════════
exports.createOrder = (0, https_1.onCall)({ secrets: [RZP_KEY_ID, RZP_KEY_SECRET] }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Login required');
    const { planId } = request.data;
    if (!planId)
        throw new https_1.HttpsError('invalid-argument', 'planId required');
    const [plan, config] = await Promise.all([fetchPlan(planId), fetchConfig()]);
    void config; // config available for future use (e.g. discount logic)
    const rzp = new razorpay_1.default({
        key_id: RZP_KEY_ID.value(),
        key_secret: RZP_KEY_SECRET.value(),
    });
    const order = await rzp.orders.create({
        amount: plan.price * 100, // paise
        currency: plan.currency || 'INR',
        notes: { planId, userId: request.auth.uid },
    });
    return {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: RZP_KEY_ID.value(), // SAFE — publishable key only
        planName: plan.name,
    };
});
// ══════════════════════════════════════════════════════════════════════════════
// CALLABLE: verifyPayment
// Frontend sends Razorpay response here. Backend verifies HMAC signature,
// then writes subscription. Frontend is NOT trusted as the final authority.
// ══════════════════════════════════════════════════════════════════════════════
exports.verifyPayment = (0, https_1.onCall)({ secrets: [RZP_KEY_SECRET] }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Login required');
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, planId, } = request.data;
    // ── 1. Verify HMAC-SHA256 signature ─────────────────────────────────────
    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expected = crypto
        .createHmac('sha256', RZP_KEY_SECRET.value())
        .update(body)
        .digest('hex');
    if (expected !== razorpay_signature) {
        throw new https_1.HttpsError('permission-denied', 'Invalid payment signature');
    }
    // ── 2. Build + write subscription ───────────────────────────────────────
    const uid = request.auth.uid;
    const [plan, config, existingSub] = await Promise.all([
        fetchPlan(planId),
        fetchConfig(),
        userSubRef(uid).get(),
    ]);
    const existingData = existingSub.exists ? existingSub.data() : undefined;
    const existingEndMs = existingData?.endDate?.toMillis();
    const existingCreatedAt = existingData?.createdAt;
    const record = buildSubscriptionRecord({
        planId,
        planDoc: plan,
        paymentId: razorpay_payment_id,
        gracePeriodDays: config.gracePeriodDays,
        existingEndMs,
        trialUsed: existingData?.trialUsed ?? false,
        existingCreatedAt,
    });
    const result = await writeSubscriptionIdempotent({
        userId: uid,
        record,
        action: 'payment_success',
        paymentMethod: 'razorpay',
    });
    return {
        success: true,
        alreadyActivated: result.alreadyActivated,
        endDate: record.endDate.toMillis(),
    };
});
// ══════════════════════════════════════════════════════════════════════════════
// CALLABLE: confirmManualPayment
// Handles UPI / bank transfer / cash — no signature to verify.
// Backend generates a canonical paymentId and writes with action='manual_payment'.
// ══════════════════════════════════════════════════════════════════════════════
exports.confirmManualPayment = (0, https_1.onCall)({ secrets: [] }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Login required');
    const { planId, paymentMethod, referenceNote, } = request.data;
    if (!planId)
        throw new https_1.HttpsError('invalid-argument', 'planId required');
    if (!paymentMethod)
        throw new https_1.HttpsError('invalid-argument', 'paymentMethod required');
    const uid = request.auth.uid;
    const prefixMap = { upi: 'upi', bank_transfer: 'bank', cash: 'cash' };
    const paymentId = `${prefixMap[paymentMethod]}_${Date.now()}`;
    const [plan, config, existingSub] = await Promise.all([
        fetchPlan(planId),
        fetchConfig(),
        userSubRef(uid).get(),
    ]);
    const existingData = existingSub.exists ? existingSub.data() : undefined;
    const existingEndMs = existingData?.endDate?.toMillis();
    const existingCreatedAt = existingData?.createdAt;
    const record = buildSubscriptionRecord({
        planId,
        planDoc: plan,
        paymentId,
        gracePeriodDays: config.gracePeriodDays,
        existingEndMs,
        trialUsed: existingData?.trialUsed ?? false,
        existingCreatedAt,
    });
    // Stamp any reference note into the audit log's newState
    const result = await writeSubscriptionIdempotent({
        userId: uid,
        record: { ...record },
        action: 'manual_payment',
        paymentMethod,
    });
    if (!result.alreadyActivated && referenceNote) {
        // Append referenceNote to audit entry — fire-and-forget (not critical path)
        auditColRef().add({
            userId: uid,
            action: 'manual_payment_note',
            note: referenceNote,
            paymentId,
            performedBy: 'system',
            timestamp: admin.firestore.Timestamp.now(),
        }).catch(() => { });
    }
    return {
        success: true,
        paymentId,
        alreadyActivated: result.alreadyActivated,
        endDate: record.endDate.toMillis(),
    };
});
// ══════════════════════════════════════════════════════════════════════════════
// HTTPS: razorpayWebhook
// Razorpay posts here on payment.captured / payment.failed / subscription events.
// Validates X-Razorpay-Signature header before touching Firestore.
// This ensures subscription is written even if the frontend crashes or goes offline.
// ══════════════════════════════════════════════════════════════════════════════
exports.razorpayWebhook = (0, https_1.onRequest)({ secrets: [RZP_WEBHOOK_SECRET, RZP_KEY_SECRET] }, async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method not allowed');
        return;
    }
    // ── 1. Verify webhook signature ──────────────────────────────────────────
    const signature = req.headers['x-razorpay-signature'];
    const body = JSON.stringify(req.body);
    const expected = crypto
        .createHmac('sha256', RZP_WEBHOOK_SECRET.value())
        .update(body)
        .digest('hex');
    if (!signature || signature !== expected) {
        console.warn('[webhook] Invalid signature');
        res.status(400).json({ error: 'Invalid signature' });
        return;
    }
    const event = req.body?.event;
    const payload = req.body?.payload;
    // ── 2. payment.captured ─────────────────────────────────────────────────
    if (event === 'payment.captured') {
        const payment = payload?.payment?.entity;
        if (!payment) {
            res.status(200).json({ ok: true });
            return;
        }
        const paymentId = payment.id;
        const notes = payment.notes;
        const userId = notes?.userId;
        const planId = notes?.planId;
        if (!userId || !planId) {
            console.warn('[webhook] Missing userId/planId in payment notes', notes);
            res.status(200).json({ ok: true }); // 200 so Razorpay doesn't retry
            return;
        }
        try {
            // If verifyPayment callable already wrote the subscription, idempotency guard skips write.
            const [plan, config, existingSub] = await Promise.all([
                fetchPlan(planId),
                fetchConfig(),
                userSubRef(userId).get(),
            ]);
            const existingData = existingSub.exists ? existingSub.data() : undefined;
            const record = buildSubscriptionRecord({
                planId,
                planDoc: plan,
                paymentId,
                gracePeriodDays: config.gracePeriodDays,
                existingEndMs: existingData?.endDate?.toMillis(),
                trialUsed: existingData?.trialUsed ?? false,
                existingCreatedAt: existingData?.createdAt,
            });
            const result = await writeSubscriptionIdempotent({
                userId,
                record,
                action: 'payment_success',
                paymentMethod: 'razorpay',
            });
            console.info(`[webhook] payment.captured ${paymentId} for ${userId} — alreadyActivated=${result.alreadyActivated}`);
        }
        catch (err) {
            console.error('[webhook] payment.captured write failed:', err);
            // Still return 200 — Razorpay will retry on non-2xx. We don't want infinite retries for plan-not-found etc.
        }
        res.status(200).json({ ok: true });
        return;
    }
    // ── 3. payment.failed ────────────────────────────────────────────────────
    if (event === 'payment.failed') {
        const payment = payload?.payment?.entity;
        const notes = payment?.notes;
        const userId = notes?.userId;
        const planId = notes?.planId;
        if (userId) {
            await auditColRef().add({
                userId,
                action: 'payment_failed',
                previousState: null,
                newState: {
                    planId: planId ?? null,
                    reason: payment?.error_description ?? 'unknown',
                    paymentId: payment?.id ?? null,
                },
                performedBy: 'system',
                timestamp: admin.firestore.Timestamp.now(),
            }).catch(() => { });
        }
        res.status(200).json({ ok: true });
        return;
    }
    // Unknown event — acknowledge so Razorpay doesn't retry
    res.status(200).json({ ok: true, ignored: event });
});
//# sourceMappingURL=index.js.map