/**
 * SubscriptionService — production data layer for subscription management.
 *
 * Architecture role: DATA LAYER
 *   - Execution layer (hasAccess, FeatureGate, SubscriptionContext) reads
 *     subscription state and enforces access.
 *   - This service owns ALL Firestore writes for subscription data.
 *   - Future Super Admin Panel calls these methods directly.
 *   - Payment gateway updates go through updateSubscription(source='payment').
 *
 * Firestore schema:
 *   plans/{planId}                     — plan configuration (admin-editable)
 *   config/global                      — global subscription config
 *   users/{uid}/subscription/current   — per-user subscription record
 *   subscription_logs/{auto}           — immutable audit trail
 *
 * IMPORTANT:
 *   Never write to user subscription docs directly in any other file.
 *   Always call this service to ensure audit logging and schema consistency.
 */

import {
  doc, getDoc, setDoc, addDoc,
  collection, getDocs, Timestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';

// ── Firestore paths ───────────────────────────────────────────────────────────
const PLANS_COL    = 'plans';
const CONFIG_COL   = 'config';
const AUDIT_COL    = 'subscription_logs';

const planDocRef    = (planId: string) => doc(db, PLANS_COL, planId);
const configDocRef  = ()               => doc(db, CONFIG_COL, 'global');
const userSubDocRef = (uid: string)    => doc(db, 'users', uid, 'subscription', 'current');
const auditColRef   = ()               => collection(db, AUDIT_COL);

// ── Public types ──────────────────────────────────────────────────────────────

/** A plan record from the plans/{planId} Firestore collection. */
export interface Plan {
  id: string;
  name: string;
  price: number;
  currency: 'INR';
  durationDays: number;
  /** Feature key strings — matches FeatureKey values in featureAccess.ts */
  features: string[];
  isActive: boolean;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

/** Global subscription configuration from config/global. */
export interface GlobalConfig {
  freeTrialEnabled: boolean;
  trialDurationDays: number;
  /** Default plan assigned on first sign-up. */
  defaultPlan: string;
  gracePeriodDays: number;
  /** 'free' = no paid plans, 'paid' = all paid, 'hybrid' = both. */
  appMode: 'free' | 'paid' | 'hybrid';
}

/**
 * Full v2 Firestore subscription document schema.
 * `plan` is the legacy field (string planId); `planId` is the v2 canonical field.
 * Both are written to ensure backward compatibility with older app versions.
 */
export interface SubscriptionRecord {
  planId: string;
  plan: string;
  status: 'active' | 'trial' | 'expired' | 'grace';
  startDate: Timestamp | null;
  endDate: Timestamp | null;
  /** Precomputed: endDate + gracePeriodDays. Null for perpetual-free plans. */
  graceEndDate: Timestamp | null;
  trialUsed: boolean;
  autoRenew: boolean;
  paymentId: string | null;
  /** Who created / last modified this record. */
  source: 'system' | 'admin' | 'payment';
  /** True for users on the ₹0 launch promotion. */
  introOffer?: boolean;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

/** Immutable audit log entry written on every subscription mutation. */
export interface SubscriptionAuditLog {
  userId: string;
  /**
   * Action values must match the admin panel contract exactly.
   * Admin-panel-written: 'grant' | 'upgrade' | 'downgrade' | 'admin_override' | 'extend' | 'cancel' | 'admin_reset_trial'
   * Main-app-written:    'trial_start' | 'payment_success' | 'auto_expire' | 'auto_grace' | 'renewal' | 'renewal_failed'
   */
  action:
    | 'grant' | 'upgrade' | 'downgrade' | 'admin_override' | 'extend' | 'cancel' | 'admin_reset_trial'
    | 'trial_start' | 'payment_success' | 'auto_expire' | 'auto_grace' | 'renewal' | 'renewal_failed';
  previousState: Record<string, any> | null;
  newState: Record<string, any>;
  performedBy: 'system' | 'admin';
  timestamp: Timestamp;
}

// ── Static defaults ───────────────────────────────────────────────────────────
// Used for seeding Firestore on first run and as offline fallback.
// These mirror PLAN_FEATURES in featureAccess.ts — keep in sync.

const ALL_PRO_FEATURES = [
  'basic', 'waste_tracking', 'analytics', 'advanced_analytics',
  'reports', 'pos_billing', 'bulk_import', 'stock_valuation',
  'game_timeline', 'whatsapp_reminders', 'multi_user', 'daily_snapshot',
];

export const DEFAULT_PLANS: Record<string, Omit<Plan, 'id'>> = {
  free: {
    name: 'Free',
    price: 0,
    currency: 'INR',
    durationDays: 36500, // ~100 years — effectively perpetual
    features: ['basic', 'waste_tracking'],
    isActive: true,
    createdAt: null,
    updatedAt: null,
  },
  pro: {
    name: 'Pro',
    price: 299,
    currency: 'INR',
    durationDays: 30,
    features: ALL_PRO_FEATURES,
    isActive: true,
    createdAt: null,
    updatedAt: null,
  },
  enterprise: {
    name: 'Enterprise',
    price: 999,
    currency: 'INR',
    durationDays: 30,
    features: ALL_PRO_FEATURES,
    isActive: true,
    createdAt: null,
    updatedAt: null,
  },
};

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  freeTrialEnabled: false,
  trialDurationDays: 14,
  defaultPlan: 'pro',        // ₹0 launch: all new users get Pro
  gracePeriodDays: 3,
  appMode: 'hybrid',
};

// ── SubscriptionService ───────────────────────────────────────────────────────

export const SubscriptionService = {

  // ── Plans collection ──────────────────────────────────────────────────────

  /** Fetch all active plans. Falls back to DEFAULT_PLANS on error. */
  async getPlans(): Promise<Plan[]> {
    try {
      const snap = await getDocs(collection(db, PLANS_COL));
      if (snap.empty) {
        return Object.entries(DEFAULT_PLANS).map(([id, p]) => ({ id, ...p } as Plan));
      }
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as Plan));
    } catch {
      return Object.entries(DEFAULT_PLANS).map(([id, p]) => ({ id, ...p } as Plan));
    }
  },

  /** Fetch a single plan by ID. Falls back to DEFAULT_PLANS. */
  async getPlan(planId: string): Promise<Plan | null> {
    try {
      const snap = await getDoc(planDocRef(planId));
      if (snap.exists()) return { id: snap.id, ...snap.data() } as Plan;
    } catch {}
    return DEFAULT_PLANS[planId]
      ? ({ id: planId, ...DEFAULT_PLANS[planId] } as Plan)
      : null;
  },

  // ── Global config ─────────────────────────────────────────────────────────

  /** Fetch global subscription config. Falls back to DEFAULT_GLOBAL_CONFIG. */
  async getGlobalConfig(): Promise<GlobalConfig> {
    try {
      const snap = await getDoc(configDocRef());
      if (snap.exists()) return { ...DEFAULT_GLOBAL_CONFIG, ...snap.data() } as GlobalConfig;
    } catch {}
    return DEFAULT_GLOBAL_CONFIG;
  },

  // ── User subscription CRUD ────────────────────────────────────────────────

  /** Read a user's subscription doc. Returns null if not found. */
  async getUserSubscription(userId: string): Promise<SubscriptionRecord | null> {
    try {
      const snap = await getDoc(userSubDocRef(userId));
      if (!snap.exists()) return null;
      return SubscriptionService._normalizeRecord(snap.data());
    } catch {
      return null;
    }
  },

  /**
   * Creates a subscription for a user via admin grant or payment confirmation.
   *
   * ⚠️  SECURITY: `source === 'system'` is explicitly rejected.
   *     The frontend must NEVER auto-create subscriptions for new users.
   *     New users with no subscription doc are treated as Free by the app.
   *     All subscription creation must go through:
   *       • Backend payment webhook  (source = 'payment')
   *       • Super-admin panel grant  (source = 'admin')
   *
   * @param userId  - Firebase Auth UID
   * @param planId  - Plan ID to activate
   * @param source  - must be 'admin' or 'payment'
   * @param config  - current GlobalConfig
   */
  async createSubscription(
    userId: string,
    planId: string = 'pro',
    source: 'admin' | 'payment' = 'admin',
    config: GlobalConfig = DEFAULT_GLOBAL_CONFIG,
  ): Promise<SubscriptionRecord> {
    if ((source as string) === 'system') {
      throw new Error(
        '[SubscriptionService] createSubscription: source "system" is not allowed on the client. ' +
        'New users default to Free. Subscriptions must be created by the backend or admin panel.',
      );
    }

    const now           = Timestamp.now();
    const gracePeriodMs = config.gracePeriodDays * 24 * 60 * 60 * 1000;

    const effectivePlanId = planId || config.defaultPlan || 'pro';
    const plan = await SubscriptionService.getPlan(effectivePlanId).catch(() => null)
      ?? ({ ...DEFAULT_PLANS.pro, id: 'pro' } as Plan);

    const durationMs   = plan.durationDays * 24 * 60 * 60 * 1000;
    const endDate      = Timestamp.fromMillis(Date.now() + durationMs);
    const graceEndDate = Timestamp.fromMillis(endDate.toMillis() + gracePeriodMs);

    const record: SubscriptionRecord = {
      planId:     effectivePlanId,
      plan:       effectivePlanId,
      status:     'active',
      startDate:  now,
      endDate,
      graceEndDate,
      trialUsed:  false,
      autoRenew:  false,
      paymentId:  null,
      source,
      introOffer: false,
      createdAt:  now,
      updatedAt:  now,
    };

    await setDoc(userSubDocRef(userId), record);
    await SubscriptionService._writeAuditLog({
      userId,
      action:        'grant',
      previousState: null,
      newState:      record as Record<string, any>,
      performedBy:   source,
    });

    return record;
  },

  /**
   * Merge-updates any fields on a user's subscription doc.
   * Always writes source + updatedAt. Logs every change.
   */
  async updateSubscription(
    userId: string,
    updates: Partial<SubscriptionRecord>,
    source: 'system' | 'admin' = 'system',
  ): Promise<void> {
    const previous = await SubscriptionService.getUserSubscription(userId);
    const payload  = { ...updates, source, updatedAt: Timestamp.now() };
    try {
      await setDoc(userSubDocRef(userId), payload, { merge: true });
      await SubscriptionService._writeAuditLog({
        userId,
        action: 'admin_override',
        previousState: previous as Record<string, any> | null,
        newState: payload as Record<string, any>,
        performedBy: source === 'admin' ? 'admin' : 'system',
      });
    } catch (e) {
      console.warn('[SubscriptionService] updateSubscription failed:', e);
      throw e;
    }
  },

  /**
   * Downgrades a user to the free plan after expiry.
   * Called by SubscriptionContext when it detects an expired subscription.
   */
  async downgradeToFree(userId: string): Promise<void> {
    const previous = await SubscriptionService.getUserSubscription(userId).catch(() => null);
    const payload: Partial<SubscriptionRecord> = {
      status: 'expired',
      planId: 'free',
      plan: 'free',
      source: 'system',
      updatedAt: Timestamp.now(),
    };
    try {
      await setDoc(userSubDocRef(userId), payload, { merge: true });
      await SubscriptionService._writeAuditLog({
        userId,
        action: 'auto_expire',
        previousState: previous as Record<string, any> | null,
        newState: payload as Record<string, any>,
        performedBy: 'system',
      });
    } catch (e) {
      console.warn('[SubscriptionService] downgradeToFree failed (non-fatal):', e);
    }
  },

  /**
   * System: mark subscription as 'grace' when now > endDate && now <= graceEndDate.
   * Called by SubscriptionContext when it detects the grace window.
   * Writes audit log action 'auto_grace' per admin panel contract.
   */
  async autoGrace(userId: string): Promise<void> {
    const current = await SubscriptionService.getUserSubscription(userId).catch(() => null);
    const payload: Partial<SubscriptionRecord> = {
      status:    'grace',
      source:    'system',
      updatedAt: Timestamp.now(),
    };
    try {
      await setDoc(userSubDocRef(userId), payload, { merge: true });
      await SubscriptionService._writeAuditLog({
        userId,
        action:        'auto_grace',
        previousState: current as Record<string, any> | null,
        newState:      payload as Record<string, any>,
        performedBy:   'system',
      });
    } catch (e) {
      console.warn('[SubscriptionService] autoGrace failed (non-fatal):', e);
    }
  },

  /**
   * Pure validation: given a subscription record, compute the effective
   * status and whether the user is in the grace window.
   * Does NOT write to Firestore.
   */
  validateSubscription(
    record: Partial<SubscriptionRecord>,
    gracePeriodDays: number = DEFAULT_GLOBAL_CONFIG.gracePeriodDays,
  ): { effectiveStatus: SubscriptionRecord['status']; isInGrace: boolean } {
    const endDate = record.endDate;
    if (!endDate) {
      return { effectiveStatus: (record.status ?? 'active') as SubscriptionRecord['status'], isInGrace: false };
    }
    const now            = Date.now();
    const endMs          = endDate.toMillis();
    const gracePeriodMs  = gracePeriodDays * 24 * 60 * 60 * 1000;

    if (now <= endMs)              return { effectiveStatus: (record.status ?? 'active') as SubscriptionRecord['status'], isInGrace: false };
    if (now <= endMs + gracePeriodMs) return { effectiveStatus: 'grace', isInGrace: true };
    return                                { effectiveStatus: 'expired', isInGrace: false };
  },

  // ── Admin extension points ────────────────────────────────────────────────
  // Future Super Admin Panel calls these. Never call setDoc directly in admin code.

  /**
   * Admin: override any subscription field. Marked source='admin'.
   * Writes full audit log entry.
   */
  async adminUpdateUserSubscription(
    userId: string,
    payload: Partial<SubscriptionRecord>,
  ): Promise<void> {
    return SubscriptionService.updateSubscription(
      userId,
      { ...payload, source: 'admin' },
      'admin',
    );
  },

  /**
   * Admin: extend a user's subscription by N days from today (or current endDate,
   * whichever is later). Reactivates if expired.
   *
   * @param gracePeriodDays - live value from config/global (falls back to DEFAULT if omitted).
   */
  async adminExtendSubscription(
    userId: string,
    days: number,
    gracePeriodDays: number = DEFAULT_GLOBAL_CONFIG.gracePeriodDays,
  ): Promise<void> {
    const current = await SubscriptionService.getUserSubscription(userId);
    if (!current) throw new Error(`[SubscriptionService] No subscription for user ${userId}`);

    const baseMs       = current.endDate ? Math.max(current.endDate.toMillis(), Date.now()) : Date.now();
    const newEndDate   = Timestamp.fromMillis(baseMs + days * 24 * 60 * 60 * 1000);
    const graceMs      = gracePeriodDays * 24 * 60 * 60 * 1000;
    const newGraceEnd  = Timestamp.fromMillis(newEndDate.toMillis() + graceMs);

    const payload: Partial<SubscriptionRecord> = {
      endDate:      newEndDate,
      graceEndDate: newGraceEnd,
      status:       'active',
      source:       'admin',
      updatedAt:    Timestamp.now(),
    };

    try {
      await setDoc(userSubDocRef(userId), payload, { merge: true });
      await SubscriptionService._writeAuditLog({
        userId,
        action: 'extend',
        previousState: current as Record<string, any>,
        newState: payload as Record<string, any>,
        performedBy: 'admin',
      });
    } catch (e) {
      console.warn('[SubscriptionService] adminExtendSubscription failed:', e);
      throw e;
    }
  },

  /**
   * Admin: move a user to a different plan immediately.
   * Auto-detects upgrade vs downgrade for the audit log.
   */
  async adminChangePlan(userId: string, planId: string): Promise<void> {
    const [current, targetPlan] = await Promise.all([
      SubscriptionService.getUserSubscription(userId),
      SubscriptionService.getPlan(planId),
    ]);
    if (!targetPlan) throw new Error(`[SubscriptionService] Plan '${planId}' not found`);

    const prevFeatureCount   = DEFAULT_PLANS[current?.planId ?? 'free']?.features.length ?? 2;
    const targetFeatureCount = targetPlan.features.length;
    const action             = targetFeatureCount >= prevFeatureCount ? 'upgrade' : 'downgrade';

    const payload: Partial<SubscriptionRecord> = {
      planId,
      plan: planId,
      status: 'active',
      source: 'admin',
      updatedAt: Timestamp.now(),
    };

    try {
      await setDoc(userSubDocRef(userId), payload, { merge: true });
      await SubscriptionService._writeAuditLog({
        userId,
        action,
        previousState: current as Record<string, any> | null,
        newState: payload as Record<string, any>,
        performedBy: 'admin',
      });
    } catch (e) {
      console.warn('[SubscriptionService] adminChangePlan failed:', e);
      throw e;
    }
  },

  /**
   * Admin: cancel and downgrade a user to Free immediately.
   * Sets autoRenew = false, status = expired, plan = free.
   */
  async adminCancelSubscription(userId: string): Promise<void> {
    const current = await SubscriptionService.getUserSubscription(userId).catch(() => null);
    const payload: Partial<SubscriptionRecord> = {
      status:    'expired',
      planId:    'free',
      plan:      'free',
      autoRenew: false,
      source:    'admin',
      updatedAt: Timestamp.now(),
    };
    try {
      await setDoc(userSubDocRef(userId), payload, { merge: true });
      await SubscriptionService._writeAuditLog({
        userId,
        action: 'cancel',
        previousState: current as Record<string, any> | null,
        newState: payload as Record<string, any>,
        performedBy: 'admin',
      });
    } catch (e) {
      console.warn('[SubscriptionService] adminCancelSubscription failed:', e);
      throw e;
    }
  },

  // ── First-run seeding ─────────────────────────────────────────────────────
  // These are called once on app start (fire-and-forget).
  // Idempotent: check for existence before writing.

  /** Seed the plans collection from DEFAULT_PLANS if it is empty. */
  async seedDefaultPlans(): Promise<void> {
    try {
      for (const [planId, planData] of Object.entries(DEFAULT_PLANS)) {
        const ref  = planDocRef(planId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          await setDoc(ref, {
            ...planData,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
          });
        }
      }
    } catch (e) {
      console.warn('[SubscriptionService] seedDefaultPlans failed (non-fatal):', e);
    }
  },

  /** Seed the global config doc if it doesn't exist. */
  async seedGlobalConfig(): Promise<void> {
    try {
      const ref  = configDocRef();
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          ...DEFAULT_GLOBAL_CONFIG,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
      }
    } catch (e) {
      console.warn('[SubscriptionService] seedGlobalConfig failed (non-fatal):', e);
    }
  },

  // ── Internal helpers ──────────────────────────────────────────────────────

  /** Write an immutable audit log entry. Fire-and-forget; never throws. */
  async _writeAuditLog(
    entry: Omit<SubscriptionAuditLog, 'timestamp'>,
  ): Promise<void> {
    try {
      // JSON round-trip strips undefined, Timestamp instances, and non-serialisable values
      const safeSerialise = (v: any) => (v ? JSON.parse(JSON.stringify(v)) : null);
      await addDoc(auditColRef(), {
        userId:        entry.userId,
        action:        entry.action,
        previousState: safeSerialise(entry.previousState),
        newState:      safeSerialise(entry.newState),
        performedBy:   entry.performedBy,
        timestamp:     Timestamp.now(),
      });
    } catch (e) {
      console.warn('[SubscriptionService] Audit log write failed (non-fatal):', e);
    }
  },

  /** Normalize a raw Firestore doc into a typed SubscriptionRecord. */
  _normalizeRecord(data: Record<string, any>): SubscriptionRecord {
    return {
      planId:       data.planId  ?? data.plan  ?? 'free',
      plan:         data.plan    ?? data.planId ?? 'free',
      status:       data.status  ?? 'active',
      startDate:    data.startDate    ?? null,
      endDate:      data.endDate      ?? null,
      graceEndDate: data.graceEndDate ?? null,
      trialUsed:    data.trialUsed    ?? false,
      autoRenew:    data.autoRenew    ?? false,
      paymentId:    data.paymentId    ?? null,
      source:       data.source       ?? 'system',
      introOffer:   data.introOffer,
      createdAt:    data.createdAt    ?? null,
      updatedAt:    data.updatedAt    ?? null,
    };
  },
};
