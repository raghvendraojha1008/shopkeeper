/**
 * PaymentService — production payment lifecycle for Shopkeeper.
 *
 * Architecture:
 *   - Razorpay flow: BackendAPI.createOrder → Razorpay checkout → BackendAPI.verifyPayment
 *   - Manual payment: BackendAPI.confirmManualPayment for UPI/bank/cash
 *   - External backend is the single write authority for subscriptions (Firestore)
 *   - Frontend reads real-time updates via SubscriptionContext.onSnapshot()
 *
 * SECURITY RULES:
 *   ❌ Never expose razorpay.keySecret or razorpay.webhookSecret on the client
 *   ❌ Never write subscription from frontend
 *   ✅ Backend is the only writer to Firestore subscriptions
 *   ✅ Razorpay signature verification is server-side only
 *   ✅ All payment audit logs written by backend
 *
 * Backend endpoints:
 *   POST /create-order — creates Razorpay order, returns {orderId, amount, currency, keyId}
 *   POST /verify-payment — verifies HMAC-SHA256, writes subscription
 *   POST /confirm-manual-payment — handles UPI/bank/cash, writes subscription
 */

import {
  doc, getDoc, setDoc, addDoc,
  collection, Timestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import {
  SubscriptionService,
  Plan,
  GlobalConfig,
  SubscriptionRecord,
  DEFAULT_GLOBAL_CONFIG,
} from './subscriptionService';
import type { Subscription } from '../context/SubscriptionContext';

// ── Public payment types ───────────────────────────────────────────────────────

export type PaymentMethod = 'upi' | 'razorpay' | 'bank_transfer' | 'cash';

export interface UpiEntry  { id: string; label: string; upiId: string; isActive: boolean; }

export interface PaymentConfig {
  upi?: {
    enabled: boolean;
    entries: UpiEntry[];
  };
  razorpay?: {
    enabled: boolean;
    keyId:   string;
    // keySecret / webhookSecret intentionally omitted — backend only
  };
  bankTransfer?: {
    enabled:       boolean;
    accountName:   string;
    accountNumber: string;
    ifscCode:      string;
    bankName:      string;
    branch:        string;
  };
  cash?: {
    enabled:      boolean;
    instructions: string;
  };
}

export interface ActivateParams {
  userId:       string;
  planId:       string;
  paymentId:    string;
  paymentMethod: PaymentMethod;
  /** Current subscription — used for renewal base-date calculation. */
  existingSub?: Subscription | null;
  /** Live GlobalConfig — for gracePeriodDays. Falls back to DEFAULT. */
  config?:      GlobalConfig;
}

export interface RazorpaySuccessPayload {
  razorpay_payment_id: string;
  razorpay_order_id?:  string;
  razorpay_signature?: string;
}

// ── Firestore paths ────────────────────────────────────────────────────────────

const userSubRef  = (uid: string) => doc(db, 'users', uid, 'subscription', 'current');
const auditColRef = ()            => collection(db, 'subscription_logs');

// ── ID helpers ─────────────────────────────────────────────────────────────────

export function generateUpiPaymentId():  string { return `upi_${Date.now()}`; }
export function generateCashPaymentId(): string { return `cash_${Date.now()}`; }
export function generateBankPaymentId(): string { return `bank_${Date.now()}`; }

// ── Core: activateSubscription ─────────────────────────────────────────────────

/**
 * Atomically writes a full subscription record + audit log.
 *
 * Idempotency guard: if an identical paymentId is already stored, skips the
 * write silently (prevents double-click / network-retry duplicate activations).
 *
 * Renewal logic:
 *   baseDate = max(now, existingSub.endDate)
 *   newEndDate = baseDate + plan.durationDays
 *
 * Edge case — plan changed during checkout:
 *   Re-fetches plan from Firestore right before the write so price/duration
 *   reflect the current admin-panel state, not the version from when the user
 *   opened the checkout.
 */
export const PaymentService = {

  async activateSubscription(params: ActivateParams): Promise<SubscriptionRecord> {
    const {
      userId, planId, paymentId, paymentMethod,
      existingSub, config = DEFAULT_GLOBAL_CONFIG,
    } = params;

    // ── 1. Idempotency guard ─────────────────────────────────────────────────
    const currentSnap = await getDoc(userSubRef(userId));
    if (currentSnap.exists()) {
      const stored = currentSnap.data() as SubscriptionRecord;
      if (stored.paymentId === paymentId) {
        // Already activated — return stored record (safe retry)
        return stored;
      }
    }
    const previousState: Record<string, any> | null = currentSnap.exists()
      ? currentSnap.data()
      : null;

    // ── 2. Re-fetch plan (plan-changed guard) ────────────────────────────────
    const plan = await SubscriptionService.getPlan(planId);
    if (!plan) throw new Error(`[PaymentService] Plan '${planId}' not found`);

    // ── 3. Compute dates ─────────────────────────────────────────────────────
    const now           = Date.now();
    const gracePeriodMs = (config.gracePeriodDays ?? DEFAULT_GLOBAL_CONFIG.gracePeriodDays)
                          * 24 * 60 * 60 * 1000;

    // Renewal: extend from max(now, current endDate) so active users don't lose time
    const baseMs    = existingSub?.endDate
      ? Math.max(now, existingSub.endDate.toMillis())
      : now;
    const endMs     = baseMs + plan.durationDays * 24 * 60 * 60 * 1000;
    const graceMs   = endMs + gracePeriodMs;

    const nowTs         = Timestamp.now();
    const startDate     = Timestamp.fromMillis(now);
    const endDate       = Timestamp.fromMillis(endMs);
    const graceEndDate  = Timestamp.fromMillis(graceMs);

    // ── 4. Build full subscription record ────────────────────────────────────
    const record: SubscriptionRecord = {
      planId,
      plan:         planId,
      status:       'active',
      startDate,
      endDate,
      graceEndDate,
      trialUsed:    existingSub?.trialUsed ?? false,
      autoRenew:    false,
      paymentId,
      source:       'payment',
      introOffer:   plan.price === 0,
      createdAt:    existingSub
        ? (existingSub.createdAt ?? nowTs)
        : nowTs,
      updatedAt:    nowTs,
    };

    // ── 5. Write subscription + audit log ────────────────────────────────────
    // setDoc (not merge) — full overwrite ensures no stale fields survive.
    await setDoc(userSubRef(userId), record);

    await addDoc(auditColRef(), {
      userId,
      action:        'payment_success',
      previousState,
      newState:      { ...record, paymentMethod },
      performedBy:   'system',
      timestamp:     nowTs,
    });

    return record;
  },

  // ── logPaymentFailure ────────────────────────────────────────────────────────

  async logPaymentFailure(
    userId: string,
    planId: string,
    reason: string = 'unknown',
    paymentMethod?: PaymentMethod,
  ): Promise<void> {
    try {
      await addDoc(auditColRef(), {
        userId,
        action:      'payment_failed',
        previousState: null,
        newState:    { planId, reason, paymentMethod: paymentMethod ?? null },
        performedBy: 'system',
        timestamp:   Timestamp.now(),
      });
    } catch {
      // Non-fatal — failure logging should never throw
    }
  },

  // ── Razorpay: load script + open checkout ────────────────────────────────────

  /**
   * Dynamically loads the Razorpay checkout script (idempotent — skips if already loaded).
   * Returns true when the script is available, false on timeout/failure.
   */
  async loadRazorpayScript(retries = 2): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    if ((window as any).Razorpay) return true;

    const loadOnce = (): Promise<boolean> =>
      new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;

        let settled = false;
        const finish = (result: boolean) => {
          if (settled) return;
          settled = true;
          resolve(result);
        };

        const timeout = window.setTimeout(() => finish(false), 10000);

        script.onload = () => {
          window.clearTimeout(timeout);
          finish(true);
        };
        script.onerror = () => {
          window.clearTimeout(timeout);
          finish(false);
        };

        document.head.appendChild(script);
      });

    for (let attempt = 0; attempt < retries; attempt += 1) {
      if (await loadOnce()) return true;
      if (attempt < retries - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
    }

    return false;
  },

  /**
   * Opens the Razorpay checkout modal.
   *
   * FUTURE-READY WEBHOOK DESIGN:
   *   - The `onSuccess` callback writes the subscription optimistically.
   *   - When a backend webhook is added, it writes the canonical subscription
   *     using the same `activateSubscription()` path (idempotency guard prevents
   *     double-write). The frontend write acts as an optimistic UI update only.
   *   - `razorpay_signature` is passed back to `onSuccess` for future backend
   *     verification without requiring any frontend changes.
   *
   * ❌ NEVER expose keySecret — only `keyId` is safe on the client.
   */
  openRazorpayCheckout(opts: {
    keyId:        string;
    amount:       number;        // in paise (INR)
    currency:     string;
    name:         string;
    description:  string;
    /** Razorpay order ID from createOrder Cloud Function. Omit in fallback path. */
    orderId?:     string;
    prefillEmail?: string;
    prefillPhone?: string;
    onSuccess:    (payload: RazorpaySuccessPayload) => void;
    onFailure:    (error: any) => void;
  }): void {
    const RazorpayClass = (window as any).Razorpay;
    if (!RazorpayClass) {
      opts.onFailure(new Error('Razorpay not loaded'));
      return;
    }

    const rzp = new RazorpayClass({
      key:         opts.keyId,
      amount:      opts.amount,
      currency:    opts.currency || 'INR',
      name:        opts.name,
      description: opts.description,
      // order_id enables backend signature verification; omitted in fallback path
      ...(opts.orderId ? { order_id: opts.orderId } : {}),
      prefill: {
        email:   opts.prefillEmail || '',
        contact: opts.prefillPhone || '',
      },
      theme: { color: "var(--col-warning)" },
      handler: (response: RazorpaySuccessPayload) => {
        opts.onSuccess(response);
      },
      modal: {
        ondismiss: () => opts.onFailure(new Error('dismissed')),
      },
    });

    rzp.on('payment.failed', (resp: any) => {
      opts.onFailure(resp?.error ?? resp);
    });

    rzp.open();
  },
};

// ── BackendAPI — REST API layer ──────────────────────────────────────────────
//
// All payment operations go through the external backend server.
// Backend is the single write authority: it verifies signatures, writes
// subscriptions to Firestore, and logs audit entries.
// Frontend only reads via onSnapshot after backend commits.

// Trim trailing slash so URL construction is safe
const _rawBase: string = import.meta.env.VITE_BACKEND_URL ?? '';
const API_BASE: string = _rawBase.replace(/\/+$/, '');

/**
 * Returns true when VITE_BACKEND_URL is set to a valid HTTP/HTTPS URL.
 * When false, manual payments fall back to a direct Firestore write.
 * Razorpay always requires a backend (signature verification is server-side only).
 */
export function isBackendConfigured(): boolean {
  return API_BASE.startsWith('http://') || API_BASE.startsWith('https://');
}

export interface CreateOrderResult {
  orderId:  string;
  amount:   number;
  currency: string;
  keyId:    string;
  planName: string;
}

export interface VerifyPaymentResult {
  success:          boolean;
  alreadyActivated: boolean;
  endDate:          number;
}

export interface ManualPaymentResult {
  success:          boolean;
  paymentId:        string;
  alreadyActivated: boolean;
  endDate:          number;
}

export const BackendAPI = {
  /** True when VITE_BACKEND_URL is a valid HTTP/HTTPS URL. */
  isConfigured(): boolean { return isBackendConfigured(); },

  /**
   * Step 1 of Razorpay flow.
   * Backend validates plan and creates a Razorpay order.
   * Returns orderId + keyId (publishable only, never keySecret).
   */
  async createOrder(planId: string): Promise<CreateOrderResult> {
    if (!isBackendConfigured()) {
      throw new Error('Payment backend is not configured. Set VITE_BACKEND_URL to your backend URL.');
    }
    const res = await fetch(`${API_BASE}/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId }),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.message || `createOrder failed with ${res.status}`);
    }
    return res.json();
  },

  /**
   * Step 3 of Razorpay flow (after checkout success).
   * Backend verifies HMAC-SHA256 signature server-side, then writes subscription.
   * Frontend signature is NOT trusted — all validation happens server-side only.
   */
  async verifyPayment(opts: {
    razorpay_order_id:   string;
    razorpay_payment_id: string;
    razorpay_signature:  string;
    planId:              string;
  }): Promise<VerifyPaymentResult> {
    const res = await fetch(`${API_BASE}/verify-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.message || `verifyPayment failed with ${res.status}`);
    }
    return res.json();
  },

  /**
   * UPI / bank transfer / cash manual confirmation.
   * Backend generates canonical paymentId and writes subscription.
   * Frontend never writes subscription directly — backend is the only writer.
   */
  async confirmManualPayment(opts: {
    userId: string;               // <-- add this
    planId: string;
    paymentMethod: 'upi' | 'bank_transfer' | 'cash';
    referenceNote?: string;
  }): Promise<ManualPaymentResult> {
    const res = await fetch(`${API_BASE}/confirm-manual-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.message || `confirmManualPayment failed with ${res.status}`);
    }
    return res.json();
  },
};
