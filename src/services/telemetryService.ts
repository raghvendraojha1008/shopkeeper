/**
 * telemetryService — lightweight feedback / analytics / error logging.
 *
 * One service handles all three because the spec explicitly asks for "lightweight"
 * and these all share the same plumbing (Firestore subcollection under the user,
 * timestamp + version stamp, fire-and-forget so telemetry can never break the
 * main flow).
 *
 * Storage layout (all under the user's namespace, so it follows the user's data
 * lifecycle — delete user → delete telemetry):
 *
 *   users/{uid}/feedback/{auto}            — bug reports, feature suggestions, ratings
 *   users/{uid}/usage_stats/{YYYY-MM-DD}   — one doc per day with DAU / counters
 *   users/{uid}/error_logs/{auto}          — failed API / sync / PDF events
 *
 * Quota notes:
 *   - usage_stats writes 1 doc per day per user (DAU set), then ~3-10 small
 *     incrementUpdates (invoice / screen views) — deliberately tiny.
 *   - error_logs are deduplicated in-session by hash(scope:message) so a flapping
 *     API doesn't write 1000 docs. Hard cap of 50 unique errors per session.
 *   - feedback writes one doc per submit — user-initiated, bounded.
 */

import {
  collection, doc, addDoc, setDoc, updateDoc,
  serverTimestamp, increment,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { APP_VERSION } from '../constants/appVersion';

// ── Types ────────────────────────────────────────────────────────────────────
export type FeedbackType = 'bug' | 'feature' | 'rating';

export interface FeedbackPayload {
  type    : FeedbackType;
  message : string;
  rating ?: number;     // 1-5, only for type === 'rating'
  screen ?: string;     // where the user was when they hit "Send feedback"
}

export type ScreenName = 'pos' | 'inventory' | 'reports' | 'parties' | 'ledger' | 'settings' | 'dashboard';
export type ErrorScope = 'api' | 'sync' | 'pdf' | 'backup' | 'auth' | 'unknown';

// ── Internals ────────────────────────────────────────────────────────────────
const todayKey = (): string => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

// In-session dedup so we don't double-count screen views when React re-renders,
// and so we don't write 50 identical error docs when an API endpoint is dead.
const seenScreenViewsToday = new Set<string>();   // "uid:date:screen"
const loggedErrorHashes    = new Set<string>();   // "scope:message"
const loggedDailyOpens     = new Set<string>();   // "uid:date"
let   errorBudget          = 50;                  // hard cap per session

const safeRun = async (label: string, fn: () => Promise<void>): Promise<void> => {
  try {
    await fn();
  } catch (e) {
    // Telemetry is best-effort — never throw from here. Use console.warn so
    // it shows up in dev but doesn't trip ErrorBoundary or break the caller.
    // eslint-disable-next-line no-console
    console.warn(`[telemetry] ${label} write failed (non-fatal):`, e);
  }
};

// Initialise (or merge into) today's stats doc. Uses setDoc with merge so the
// first call of the day creates it and subsequent calls just touch last_active_at.
const ensureTodayDoc = async (uid: string): Promise<string> => {
  const date = todayKey();
  const ref = doc(db, `users/${uid}/usage_stats/${date}`);
  await setDoc(ref, {
    date,
    app_version    : APP_VERSION,
    last_active_at : serverTimestamp(),
    dau            : true,
  }, { merge: true });
  return date;
};

// ── Public API ───────────────────────────────────────────────────────────────
export const TelemetryService = {
  // ── Feedback (user-initiated) ─────────────────────────────────────────────
  async submitFeedback(uid: string, payload: FeedbackPayload): Promise<boolean> {
    let ok = false;
    await safeRun('submitFeedback', async () => {
      // Strip undefined fields — Firestore rejects them.
      const row: Record<string, any> = {
        type        : payload.type,
        message     : (payload.message || '').slice(0, 2000),  // hard cap
        timestamp   : serverTimestamp(),
        app_version : APP_VERSION,
      };
      if (payload.rating !== undefined) row.rating = payload.rating;
      if (payload.screen)               row.screen = payload.screen;

      await addDoc(collection(db, `users/${uid}/feedback`), row);
      ok = true;
    });
    return ok;
  },

  // ── Analytics: DAU ────────────────────────────────────────────────────────
  // Call once per app open. In-session dedup so quick auth re-renders don't
  // re-write. The merge-set in Firestore is itself idempotent for the day.
  async trackDailyOpen(uid: string): Promise<void> {
    const date = todayKey();
    const sessionKey = `${uid}:${date}`;
    if (loggedDailyOpens.has(sessionKey)) return;
    loggedDailyOpens.add(sessionKey);
    await safeRun('trackDailyOpen', async () => { await ensureTodayDoc(uid); });
  },

  // ── Analytics: Invoice created ────────────────────────────────────────────
  async trackInvoice(uid: string): Promise<void> {
    await safeRun('trackInvoice', async () => {
      const date = await ensureTodayDoc(uid);
      const ref = doc(db, `users/${uid}/usage_stats/${date}`);
      await updateDoc(ref, { invoices_created: increment(1) });
    });
  },

  // ── Analytics: Screen view ────────────────────────────────────────────────
  // Counts session-opens of a screen, not re-renders. Useful to answer
  // "which features do users actually use?" without quota explosion.
  async trackScreen(uid: string, screen: ScreenName): Promise<void> {
    const date = todayKey();
    const key = `${uid}:${date}:${screen}`;
    if (seenScreenViewsToday.has(key)) return;
    seenScreenViewsToday.add(key);
    await safeRun(`trackScreen:${screen}`, async () => {
      const d = await ensureTodayDoc(uid);
      const ref = doc(db, `users/${uid}/usage_stats/${d}`);
      await updateDoc(ref, { [`screen_views.${screen}`]: increment(1) });
    });
  },

  // ── Error logging ─────────────────────────────────────────────────────────
  // Dedup by hash(scope:message) within the session so a flapping endpoint
  // doesn't burn quota. Hard cap of 50 unique errors/session as a safety net.
  async logError(
    uid: string,
    scope: ErrorScope,
    message: string,
    context?: Record<string, any>,
  ): Promise<void> {
    const key = `${scope}:${message}`;
    if (loggedErrorHashes.has(key)) return;
    if (errorBudget <= 0) return;
    loggedErrorHashes.add(key);
    errorBudget--;

    await safeRun('logError', async () => {
      const row: Record<string, any> = {
        scope,
        message     : (message || '').slice(0, 1000),
        timestamp   : serverTimestamp(),
        app_version : APP_VERSION,
      };
      if (context) {
        // JSON-stringify defensively so non-serialisable values don't break the write.
        try { row.context = JSON.parse(JSON.stringify(context)); }
        catch { row.context = { _serialise_failed: true }; }
      }
      await addDoc(collection(db, `users/${uid}/error_logs`), row);
    });
  },

  // ── Subscription: feature blocked ────────────────────────────────────────
  // Called from FeatureGate when a user hits an access wall. Deduped per
  // (feature, session) so rapid re-renders don't inflate counts.
  async trackFeatureBlocked(uid: string, feature: string, plan: string): Promise<void> {
    const key = `blocked:${feature}`;
    if (loggedErrorHashes.has(key)) return;
    loggedErrorHashes.add(key);
    await safeRun('trackFeatureBlocked', async () => {
      const d = await ensureTodayDoc(uid);
      const ref = doc(db, `users/${uid}/usage_stats/${d}`);
      await updateDoc(ref, {
        [`feature_blocked.${feature}`]: increment(1),
        [`feature_blocked_plan`]: plan,
      });
    });
  },

  // Test-only / debug helper. Resets in-session dedup so we can verify
  // tracking from DevTools without reloading.
  __resetSessionDedup__() {
    seenScreenViewsToday.clear();
    loggedErrorHashes.clear();
    loggedDailyOpens.clear();
    errorBudget = 50;
  },
};

// Expose on window in dev so we can poke at it from DevTools without imports.
if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV === true
    && typeof window !== 'undefined') {
  (window as any).__telemetry__ = TelemetryService;
}
