/**
 * crashReporter — Production-grade crash reporting to Firestore
 *
 * Every caught error (from ErrorBoundary, window.onerror, unhandledrejection)
 * is written to two Firestore locations:
 *
 *   crash_logs/{docId}              — global, superAdmin-readable dashboard
 *   users/{uid}/crash_logs/{docId}  — per-user, follows user data lifecycle
 *
 * Design goals:
 *   • Fire-and-forget: never throws, never blocks the UI
 *   • Dedup: identical signature suppressed for 60 s within the session
 *   • Budget: hard cap of 100 unique crash writes per session
 *   • Minimal payload: stack capped at 3 KB, component stack at 1.5 KB
 *   • Offline-safe: Firestore's persistence layer queues writes when offline
 */

import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { APP_VERSION } from '../constants/appVersion';
import { Capacitor } from '@capacitor/core';

export type CrashSeverity = 'fatal' | 'error';

export interface CrashPayload {
  uid          : string;
  message      : string;
  stack        : string;
  component_stack ?: string;
  category     : string;
  screen      ?: string;
  severity     : CrashSeverity;
  resolved     : boolean;
  app_version  : string;
  platform     : string;
  user_agent   : string;
  device       : {
    screen_width  : number;
    screen_height : number;
    memory_gb    ?: number;
  };
  timestamp    : any;
}

// ── Internals ────────────────────────────────────────────────────────────────

let _getUid: () => string | null = () => null;
let _getScreen: () => string     = () => 'unknown';

const seenSigs   = new Map<string, number>();   // sig → last-seen epoch ms
const DEDUP_MS   = 60_000;                       // 60-second dedup window
let   budget     = 100;                          // hard write cap per session

function sig(category: string, message: string, screen: string): string {
  return `${category}:${screen}:${message.slice(0, 80)}`;
}

function truncate(s: string | undefined, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…[truncated]' : s;
}

function buildPayload(
  category  : string,
  error     : Error,
  context   : Record<string, unknown>,
  severity  : CrashSeverity,
): CrashPayload {
  const uid      = _getUid() || 'anonymous';
  const screen   = (context.screen as string) || _getScreen();
  const platform = Capacitor.getPlatform();

  const device: CrashPayload['device'] = {
    screen_width  : window.screen?.width  ?? 0,
    screen_height : window.screen?.height ?? 0,
  };
  const nav = navigator as any;
  if (nav.deviceMemory != null) device.memory_gb = nav.deviceMemory;

  return {
    uid,
    message         : truncate(error.message, 500),
    stack           : truncate(error.stack, 3000),
    component_stack : truncate(context.componentStack as string, 1500),
    category,
    screen,
    severity,
    resolved        : false,
    app_version     : APP_VERSION,
    platform,
    user_agent      : truncate(navigator.userAgent, 300),
    device,
    timestamp       : serverTimestamp(),
  };
}

async function persist(payload: CrashPayload): Promise<void> {
  try {
    const promises: Promise<any>[] = [
      addDoc(collection(db, 'crash_logs'), payload),
    ];
    if (payload.uid !== 'anonymous') {
      promises.push(
        addDoc(collection(db, `users/${payload.uid}/crash_logs`), payload),
      );
    }
    await Promise.all(promises);
  } catch {
    // Telemetry must never surface errors to the user.
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export const crashReporter = {
  /**
   * Call once during app bootstrap so the reporter can lazily resolve the
   * logged-in user UID and the active screen name without creating a hard
   * dependency on React context.
   */
  init(opts: { getUid: () => string | null; getScreen?: () => string }): void {
    _getUid    = opts.getUid;
    _getScreen = opts.getScreen ?? (() => 'unknown');
  },

  /**
   * Capture and persist a crash report.
   * Safe to call from anywhere — error boundaries, global handlers, etc.
   */
  capture(
    category  : string,
    error     : unknown,
    context   : Record<string, unknown> = {},
    severity  : CrashSeverity = 'error',
  ): void {
    const err = error instanceof Error ? error : new Error(String(error ?? 'unknown'));
    const screen = (context.screen as string) || _getScreen();
    const key = sig(category, err.message, screen);
    const now = Date.now();

    // Dedup: drop if the same signature was written within the window
    const last = seenSigs.get(key) ?? 0;
    if (last + DEDUP_MS > now) return;

    // Budget guard
    if (budget <= 0) return;

    seenSigs.set(key, now);
    budget--;

    const payload = buildPayload(category, err, context, severity);

    // Fire-and-forget — do NOT await in the caller
    void persist(payload);
  },

  /** Mark all budgets/dedup as reset (test helper, also used after logout). */
  resetSession(): void {
    seenSigs.clear();
    budget = 100;
  },
};
