import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { doc, collection, setDoc, Timestamp, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { App as CapacitorApp }  from '@capacitor/app';
import { Capacitor }            from '@capacitor/core';
import { useAuth } from './AuthContext';
import {
  SubscriptionService,
  Plan,
  GlobalConfig,
  DEFAULT_GLOBAL_CONFIG,
  DEFAULT_PLANS,
} from '../services/subscriptionService';

// ── Exported types ────────────────────────────────────────────────────────────

export type SubscriptionPlan   = 'free' | 'pro' | 'enterprise';
export type SubscriptionStatus = 'active' | 'trial' | 'expired' | 'grace';

/**
 * In-memory subscription model.
 *
 * v2 fields (planId, source, graceEndDate, introOffer) are optional so that
 * existing Firestore docs without them still parse correctly.
 * New docs written by SubscriptionService always include all fields.
 */
export interface Subscription {
  /** Legacy plan name field — kept for backward compat with existing UI code. */
  plan: SubscriptionPlan;
  /** v2: canonical ID referencing plans/{planId} in Firestore. */
  planId?: string;
  status: SubscriptionStatus;
  startDate:    Timestamp | null;
  endDate:      Timestamp | null;
  /** v2: precomputed grace period end date. */
  graceEndDate?: Timestamp | null;
  trialUsed:    boolean;
  autoRenew:    boolean;
  paymentId:    string | null;
  /** v2: who created / last modified this record. */
  source?: 'system' | 'admin' | 'payment';
  /** v2: true for ₹0 launch promo users. Used by hasAccess() for migration. */
  introOffer?: boolean;
  createdAt:    Timestamp | null;
  updatedAt:    Timestamp | null;
}

// Re-export Plan and GlobalConfig so consumers can type-import them from here.
export type { Plan, GlobalConfig };

interface SubscriptionContextType {
  subscription:     Subscription | null;
  loading:          boolean;
  isInGracePeriod:  boolean;
  /** All plans from Firestore plans/ collection — kept live via onSnapshot. */
  plans:            Plan[];
  /** Global subscription config from config/global — live via onSnapshot. */
  globalConfig:     GlobalConfig | null;
  /**
   * Live features for the current user's plan.
   * Derived from plans[] at render time. Use this (not the static PLAN_FEATURES map)
   * when calling hasAccess() so admin plan edits propagate without an app restart.
   */
  liveFeatures:     string[] | undefined;
  /** Manual refresh — the onSnapshot listener already keeps state live. */
  refresh:          () => void;
  /** Alias for refresh — use in admin-facing code for clarity. */
  refreshSubscription: () => void;
}

const SubscriptionContext = createContext<SubscriptionContextType>({
  subscription:        null,
  loading:             true,
  isInGracePeriod:     false,
  plans:               [],
  globalConfig:        null,
  liveFeatures:        undefined,
  refresh:             () => {},
  refreshSubscription: () => {},
});

export const useSubscription = () => useContext(SubscriptionContext);

// ── Constants ─────────────────────────────────────────────────────────────────

const GRACE_PERIOD_MS        = DEFAULT_GLOBAL_CONFIG.gracePeriodDays * 24 * 60 * 60 * 1000;
const EXPIRY_CHECK_INTERVAL  = 60_000; // 60 seconds
const CACHE_KEY = (uid: string) => `sk_sub_v1_${uid}`;

// SECURITY: offline default is always FREE — never elevate access without a verified Firestore source
const FREE_DEFAULT: Subscription = {
  plan:        'free',
  planId:      'free',
  status:      'active',
  startDate:   null,
  endDate:     null,
  graceEndDate: null,
  trialUsed:   false,
  autoRenew:   false,
  paymentId:   null,
  source:      'system',
  createdAt:   null,
  updatedAt:   null,
};

// ── Timestamp helpers ─────────────────────────────────────────────────────────

function rehydrateTimestamp(raw: any): Timestamp | null {
  if (!raw) return null;
  if (raw instanceof Timestamp) return raw;
  if (typeof raw.seconds === 'number') return new Timestamp(raw.seconds, raw.nanoseconds ?? 0);
  if (typeof raw === 'string' || typeof raw === 'number') {
    try { return Timestamp.fromMillis(new Date(raw).getTime()); } catch { return null; }
  }
  return null;
}

// ── localStorage cache ────────────────────────────────────────────────────────

function loadCached(uid: string): Subscription | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY(uid));
    if (!raw) return null;
    const p = JSON.parse(raw);
    return {
      plan:         p.plan         ?? 'free',
      planId:       p.planId       ?? p.plan ?? 'free',
      status:       p.status       ?? 'active',
      startDate:    rehydrateTimestamp(p.startDate),
      endDate:      rehydrateTimestamp(p.endDate),
      graceEndDate: rehydrateTimestamp(p.graceEndDate),
      trialUsed:    p.trialUsed    ?? false,
      autoRenew:    p.autoRenew    ?? false,
      paymentId:    p.paymentId    ?? null,
      source:       p.source       ?? 'system',
      introOffer:   p.introOffer,
      createdAt:    rehydrateTimestamp(p.createdAt),
      updatedAt:    rehydrateTimestamp(p.updatedAt),
    };
  } catch { return null; }
}

function saveCache(uid: string, sub: Subscription): void {
  try { localStorage.setItem(CACHE_KEY(uid), JSON.stringify(sub)); } catch {}
}

// ── Status helpers ────────────────────────────────────────────────────────────

/**
 * Recompute the effective subscription status from timestamps.
 *
 * State machine per admin panel contract:
 *   now <= endDate                → rawStatus (active / trial)
 *   endDate < now <= graceEndDate → 'grace'
 *   now > graceEndDate            → 'expired'
 *
 * This handles subscriptions where Firestore still stores 'active' but the
 * validity period has passed — the app transitions through grace → expired
 * automatically without waiting for an admin action.
 */
function computeStatus(
  endDate:      Timestamp | null,
  graceEndDate: Timestamp | null | undefined,
  rawStatus:    SubscriptionStatus,
  gracePeriodMs: number,
): SubscriptionStatus {
  if (!endDate) return rawStatus;
  const now = Date.now();
  if (now <= endDate.toMillis()) return rawStatus; // still valid
  const graceEnd = graceEndDate?.toMillis() ?? (endDate.toMillis() + gracePeriodMs);
  if (now <= graceEnd) return 'grace';
  return 'expired';
}

/**
 * Determine if a subscription is currently in its grace period.
 * Accepts both 'grace' (Firestore-stored) and 'expired' (computed) statuses.
 */
function computeGrace(
  endDate:      Timestamp | null,
  graceEndDate: Timestamp | null | undefined,
  status:       SubscriptionStatus,
  gracePeriodMs: number,
): boolean {
  if (status === 'grace') return true;
  if (status !== 'expired') return false;
  const now = Date.now();
  if (graceEndDate) return now <= graceEndDate.toMillis();
  if (!endDate) return false;
  return (now - endDate.toMillis()) <= gracePeriodMs;
}

// ── normalizeDoc ──────────────────────────────────────────────────────────────
// Converts a raw Firestore data object into a typed Subscription.
// Handles both legacy docs (only `plan` field) and v2 docs (have `planId`).

function normalizeDoc(data: Record<string, any>, gracePeriodMs: number = GRACE_PERIOD_MS): Subscription {
  const endDate      = rehydrateTimestamp(data.endDate);
  const graceEndDate = rehydrateTimestamp(data.graceEndDate);
  const rawStatus    = (data.status as SubscriptionStatus) ?? 'active';
  const status       = computeStatus(endDate, graceEndDate, rawStatus, gracePeriodMs);
  return {
    plan:         (data.plan ?? data.planId ?? 'free') as SubscriptionPlan,
    planId:       data.planId ?? data.plan ?? 'free',
    status,
    startDate:    rehydrateTimestamp(data.startDate),
    endDate,
    graceEndDate,
    trialUsed:    data.trialUsed   ?? false,
    autoRenew:    data.autoRenew   ?? false,
    paymentId:    data.paymentId   ?? null,
    source:       data.source      ?? 'system',
    introOffer:   data.introOffer,
    createdAt:    rehydrateTimestamp(data.createdAt),
    updatedAt:    rehydrateTimestamp(data.updatedAt),
  };
}

// ── SubscriptionProvider ──────────────────────────────────────────────────────

export const SubscriptionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();

  const [subscription,       setSubscription]       = useState<Subscription | null>(null);
  const [subscriptionLoaded, setSubscriptionLoaded] = useState(false);
  const [loading,            setLoading]            = useState(true);
  const [isInGracePeriod,    setIsInGracePeriod]    = useState(false);
  const [plans,              setPlans]              = useState<Plan[]>([]);
  const [globalConfig,       setGlobalConfig]       = useState<GlobalConfig | null>(null);
  const [globalConfigLoaded, setGlobalConfigLoaded] = useState(false);

  const unsubListenerRef      = useRef<(() => void) | null>(null);
  const unsubGlobalConfigRef  = useRef<(() => void) | null>(null);
  const unsubPlansRef         = useRef<(() => void) | null>(null);
  const expiryTimerRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  // Starts at the static default; updated to config.gracePeriodDays once globalConfig loads.
  const gracePeriodMsRef      = useRef<number>(GRACE_PERIOD_MS);
  // Always-current GlobalConfig ref — safe to read inside async callbacks
  // without stale-closure issues (no need to add to dep arrays).
  const globalConfigRef       = useRef<GlobalConfig>(DEFAULT_GLOBAL_CONFIG);
  // Track the endDate of the last grace write to prevent duplicate Firestore writes.
  const graceWrittenForRef    = useRef<number | null>(null);

  // ── Global data: plans + config/global ───────────────────────────────────
  // Both use onSnapshot so admin changes propagate instantly to all open sessions.
  useEffect(() => {
    let mounted = true;

    // Seed Firestore schema on first run — idempotent, fire-and-forget
    SubscriptionService.seedDefaultPlans().catch(() => {});
    SubscriptionService.seedGlobalConfig().catch(() => {});

    // plans/ — real-time listener so feature changes propagate immediately
    const unsubPlans = onSnapshot(
      collection(db, 'plans'),
      (snap) => {
        if (!mounted) return;
        if (snap.empty) {
          setPlans(Object.entries(DEFAULT_PLANS).map(([id, p]) => ({ id, ...p } as Plan)));
        } else {
          setPlans(snap.docs.map(d => ({ id: d.id, ...d.data() } as Plan)));
        }
      },
      () => {
        // Non-fatal fallback to static defaults
        if (mounted) setPlans(Object.entries(DEFAULT_PLANS).map(([id, p]) => ({ id, ...p } as Plan)));
      },
    );
    unsubPlansRef.current = unsubPlans;

    // config/global — real-time listener
    // Safety timeout: if Firestore never responds (offline first boot with no cache),
    // unblock the loading gate after 4 s so the app isn't stuck on a spinner forever.
    const configTimeoutId = setTimeout(() => {
      if (mounted) setGlobalConfigLoaded(true);
    }, 4000);

    const unsubConfig = onSnapshot(
      doc(db, 'config', 'global'),
      (snap) => {
        const data: GlobalConfig = snap.exists()
          ? { ...DEFAULT_GLOBAL_CONFIG, ...(snap.data() as Partial<GlobalConfig>) }
          : DEFAULT_GLOBAL_CONFIG;
        if (mounted) {
          setGlobalConfig(data);
          setGlobalConfigLoaded(true);
          clearTimeout(configTimeoutId);
          gracePeriodMsRef.current = data.gracePeriodDays * 24 * 60 * 60 * 1000;
          globalConfigRef.current  = data; // always-current for async callbacks
        }
      },
      () => {
        // Non-fatal — keep DEFAULT_GLOBAL_CONFIG as fallback, but unblock loading gate
        if (mounted) setGlobalConfigLoaded(true);
        clearTimeout(configTimeoutId);
      },
    );
    unsubGlobalConfigRef.current = unsubConfig;

    return () => {
      mounted = false;
      unsubPlansRef.current?.();
      unsubPlansRef.current = null;
      unsubGlobalConfigRef.current?.();
      unsubGlobalConfigRef.current = null;
    };
  }, []);

  // ── Per-user subscription listener ───────────────────────────────────────

  const applySubscription = useCallback((sub: Subscription, uid: string) => {
    const grace = computeGrace(sub.endDate, sub.graceEndDate, sub.status, gracePeriodMsRef.current);
    setSubscription(sub);
    setIsInGracePeriod(grace);
    saveCache(uid, sub);

    // Grace window detected — write status: 'grace' to Firestore so admin panel audit trail
    // and admin dashboard show the correct state. Deduplicated by endDate to avoid loops.
    if (sub.status === 'grace') {
      const endMs = sub.endDate?.toMillis() ?? null;
      if (endMs !== null && graceWrittenForRef.current !== endMs) {
        graceWrittenForRef.current = endMs;
        SubscriptionService.autoGrace(uid).catch(() => {});
      }
    }

    // Route expiry writes through SubscriptionService so they are audited
    if (sub.status === 'expired') {
      graceWrittenForRef.current = null; // reset for next subscription cycle
      SubscriptionService.downgradeToFree(uid).catch(() => {});
    }
  }, []);

  /**
   * Shared expiry-check logic.
   *
   * Called by:
   *  • the 60-second setInterval (background heartbeat)
   *  • the Capacitor appStateChange listener (app comes to foreground on iOS/Android)
   *  • the visibilitychange listener (browser tab becomes visible on web)
   *
   * Using a shared callback means all three paths run identical logic — no drift.
   */
  const runExpiryTick = useCallback((uid: string) => {
    setSubscription(prev => {
      if (!prev) return prev;
      const newStatus = computeStatus(prev.endDate, prev.graceEndDate, prev.status, gracePeriodMsRef.current);
      if (newStatus !== prev.status) {
        const recomputed = { ...prev, status: newStatus };
        const grace = computeGrace(
          recomputed.endDate, recomputed.graceEndDate,
          recomputed.status, gracePeriodMsRef.current,
        );
        setIsInGracePeriod(grace);
        saveCache(uid, recomputed);
        if (recomputed.status === 'grace') {
          const endMs = recomputed.endDate?.toMillis() ?? null;
          if (endMs !== null && graceWrittenForRef.current !== endMs) {
            graceWrittenForRef.current = endMs;
            SubscriptionService.autoGrace(uid).catch(() => {});
          }
        }
        if (recomputed.status === 'expired') {
          graceWrittenForRef.current = null;
          SubscriptionService.downgradeToFree(uid).catch(() => {});
        }
        return recomputed;
      }
      setIsInGracePeriod(computeGrace(
        prev.endDate, prev.graceEndDate, prev.status, gracePeriodMsRef.current,
      ));
      return prev;
    });
  }, []);

  const setupExpiryTimer = useCallback((uid: string) => {
    if (expiryTimerRef.current) clearInterval(expiryTimerRef.current);
    expiryTimerRef.current = setInterval(() => runExpiryTick(uid), EXPIRY_CHECK_INTERVAL);
  }, [runExpiryTick]);

  // Ref holding the Capacitor plugin listener handle so we can .remove() it on cleanup.
  const capacitorListenerRef = useRef<{ remove: () => Promise<void> } | null>(null);

  /**
   * Foreground listener — fires runExpiryTick immediately when the user returns
   * to the app after it has been backgrounded for minutes or hours.
   *
   * Without this, a subscription that expired while the app was in the background
   * would remain "active" in memory until the next 60-second interval tick.
   *
   * Two listeners for two environments:
   *   • Capacitor (iOS / Android): App.addListener('appStateChange', …)
   *   • Web (browser tab):         document.visibilitychange
   */
  const setupForegroundListener = useCallback((uid: string) => {
    let cleanedUp = false;

    // --- Web: visibilitychange ---
    const onVisibility = () => {
      if (document.visibilityState === 'visible') runExpiryTick(uid);
    };
    document.addEventListener('visibilitychange', onVisibility);

    // --- Capacitor native: appStateChange ---
    if (Capacitor.isNativePlatform()) {
      CapacitorApp.addListener('appStateChange', state => {
        if (state.isActive) runExpiryTick(uid);
      })
        .then(handle => {
          if (cleanedUp) {
            handle.remove().catch(() => {});
          } else {
            capacitorListenerRef.current = handle;
          }
        })
        .catch(() => {});
    }

    // Return cleanup — sets flag so a late-arriving Capacitor handle is
    // immediately removed even if teardown() already ran before it resolved.
    return () => {
      cleanedUp = true;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [runExpiryTick]);

  const teardown = useCallback(() => {
    if (unsubListenerRef.current)  { unsubListenerRef.current();  unsubListenerRef.current  = null; }
    if (expiryTimerRef.current)    { clearInterval(expiryTimerRef.current); expiryTimerRef.current = null; }
    if (capacitorListenerRef.current) {
      capacitorListenerRef.current.remove().catch(() => {});
      capacitorListenerRef.current = null;
    }
  }, []);

  useEffect(() => {
    teardown();

    if (!user) {
      setSubscription(null);
      setIsInGracePeriod(false);
      setSubscriptionLoaded(false);
      setLoading(false);
      return;
    }

    const uid = user.uid;
    setSubscriptionLoaded(false);
    graceWrittenForRef.current = null;

    // Immediately hydrate from cache so UI is never blank when offline
    const cached = loadCached(uid);
    if (cached) {
      const recomputed = {
        ...cached,
        status: computeStatus(cached.endDate, cached.graceEndDate, cached.status, gracePeriodMsRef.current),
      };
      setSubscription(recomputed);
      setIsInGracePeriod(computeGrace(recomputed.endDate, recomputed.graceEndDate, recomputed.status, gracePeriodMsRef.current));
    }

    let firstSnapshot = true;

    // Listener for subscription doc. If it doesn't exist (new user),
    // onSnapshot still fires with snap.exists() === false.
    // ⚠️ Error handler catches Firestore watch errors (e.g., permission denied).
    const unsub = onSnapshot(
      doc(db, 'users', uid, 'subscription', 'current'),
      (snap) => {
        try {
          if (snap.exists()) {
            const normalized = normalizeDoc(snap.data(), gracePeriodMsRef.current);
            applySubscription(normalized, uid);
          } else {
            // No subscription doc: user defaults to FREE (read-only fallback).
            // ❌ NO AUTOMATIC GRANT (trial / promo)
            // ✅ User must pay OR admin must grant via panel
            applySubscription(FREE_DEFAULT, uid);
          }
        } catch (docError: any) {
          console.warn('[Subscription] Error processing snapshot:', docError);
          const fallback = loadCached(uid) ?? FREE_DEFAULT;
          const recomputed = {
            ...fallback,
            status: computeStatus(fallback.endDate, fallback.graceEndDate, fallback.status, gracePeriodMsRef.current),
          };
          setSubscription(recomputed);
          setIsInGracePeriod(computeGrace(recomputed.endDate, recomputed.graceEndDate, recomputed.status, gracePeriodMsRef.current));
        }

        if (firstSnapshot) {
          firstSnapshot = false;
          setSubscriptionLoaded(true);
        }
      },
      (error: any) => {
        console.warn('[Subscription] Firestore listener error:', error?.code, error?.message);
        if (firstSnapshot) {
          firstSnapshot = false;
          // Firestore error (e.g., permission denied) — fall back to cached/free
          const fallback   = loadCached(uid) ?? FREE_DEFAULT;
          const recomputed = {
            ...fallback,
            status: computeStatus(fallback.endDate, fallback.graceEndDate, fallback.status, gracePeriodMsRef.current),
          };
          setSubscription(recomputed);
          setIsInGracePeriod(computeGrace(recomputed.endDate, recomputed.graceEndDate, recomputed.status, gracePeriodMsRef.current));
          setSubscriptionLoaded(true);
        }
      },
    );

    unsubListenerRef.current = unsub;
    setupExpiryTimer(uid);
    const cleanupForeground = setupForegroundListener(uid);

    return () => {
      teardown();
      cleanupForeground();
    };
  }, [user, applySubscription, setupExpiryTimer, setupForegroundListener, teardown]);

  // Gate the public `loading` flag on BOTH the user subscription snapshot AND
  // the globalConfig snapshot having arrived.  This ensures feature gates
  // (e.g. subscription tab visibility) are evaluated against real server config
  // before the dashboard renders — eliminating first-login subscription flicker.
  useEffect(() => {
    if (!user) return; // no-user branch sets loading=false directly above
    setLoading(!subscriptionLoaded || !globalConfigLoaded);
  }, [user, subscriptionLoaded, globalConfigLoaded]);

  const refresh = useCallback(() => {
    if (!user) return;
    const cached = loadCached(user.uid);
    if (cached) {
      const recomputed = {
        ...cached,
        status: computeStatus(cached.endDate, cached.graceEndDate, cached.status, gracePeriodMsRef.current),
      };
      setSubscription(recomputed);
      setIsInGracePeriod(computeGrace(recomputed.endDate, recomputed.graceEndDate, recomputed.status, gracePeriodMsRef.current));
    }
  }, [user]);

  // Derive live plan features for the current subscription — used by hasAccess()
  // callers to gate features against Firestore data rather than the static map.
  const planId      = subscription?.planId ?? subscription?.plan ?? 'free';
  const liveFeatures = plans.find(p => p.id === planId)?.features;

  return (
    <SubscriptionContext.Provider value={{
      subscription,
      loading,
      isInGracePeriod,
      plans,
      globalConfig,
      liveFeatures,
      refresh,
      refreshSubscription: refresh,
    }}>
      {children}
    </SubscriptionContext.Provider>
  );
};
