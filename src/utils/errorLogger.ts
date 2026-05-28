/**
 * errorLogger — Structured, rate-limited error logging
 *
 * Dev  : verbose grouped output with full stack trace
 * Prod : minimal single-line, no stack exposed to console
 * Both : rolling in-memory buffer (50 entries) for diagnostics
 *        + rate-limit identical signatures to 1 log per 30 s
 *        + fires crashReporter.capture() for persistence to Firestore
 */

import { crashReporter } from '../services/crashReporter';

export type ErrorCategory =
  | 'render'      // React render / lifecycle errors
  | 'async'       // Unhandled promise rejections
  | 'network'     // Connectivity / fetch failures
  | 'auth'        // Authentication / permission failures
  | 'storage'     // localStorage / IndexedDB failures
  | 'sync'        // Offline sync queue failures
  | 'native'      // Capacitor / native plugin failures
  | 'chunk'       // Dynamic import / code-split failures
  | 'validation'  // Bad input / schema mismatch
  | 'unknown';

export interface LogEntry {
  category  : ErrorCategory;
  message   : string;
  timestamp : number;
  context  ?: Record<string, unknown>;
  source   ?: string;
}

const IS_DEV           = import.meta.env.DEV;
const MAX_BUFFER       = 50;
const RATE_LIMIT_MS    = 30_000;

const buffer           : LogEntry[]          = [];
const recentSignatures : Map<string, number> = new Map();

function sig(cat: ErrorCategory, msg: string): string {
  return `${cat}:${msg.slice(0, 80)}`;
}

// Categories that should be persisted to Firestore as crash reports
// (chunk errors are not crashes; auth/network noise is too high-volume)
const PERSIST_CATEGORIES: Set<ErrorCategory> = new Set([
  'render', 'async', 'storage', 'sync', 'native', 'validation', 'unknown',
]);

export const errorLogger = {
  log(
    category : ErrorCategory,
    error    : unknown,
    context ?: Record<string, unknown>,
    source  ?: string,
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    const key     = sig(category, message);
    const now     = Date.now();

    // Rate-limit: skip if same signature was logged within the window
    const last = recentSignatures.get(key) ?? 0;
    if (last + RATE_LIMIT_MS > now) return;
    recentSignatures.set(key, now);

    const entry: LogEntry = { category, message, timestamp: now, context, source };
    buffer.push(entry);
    if (buffer.length > MAX_BUFFER) buffer.shift();

    if (IS_DEV) {
      const label = `%c[${category.toUpperCase()}]${source ? ` (${source})` : ''}`;
      console.group(label, 'color:#f87171;font-weight:bold');
      console.error(error);
      if (context && Object.keys(context).length) console.debug('ctx:', context);
      console.groupEnd();
    } else {
      // Prod: single-line only, no stack traces
      console.warn(`[ERR:${category}] ${message}`);
    }

    // Persist render/crash-level errors to Firestore for developer review
    if (PERSIST_CATEGORIES.has(category)) {
      const severity = category === 'render' ? 'fatal' : 'error';
      crashReporter.capture(
        category,
        error,
        { ...context, source },
        severity,
      );
    }
  },

  /** Return a snapshot of the recent log buffer for diagnostics */
  getRecent(): LogEntry[] { return [...buffer]; },

  /** Flush buffer + signature map (useful in tests / diagnostics) */
  clear(): void {
    buffer.length = 0;
    recentSignatures.clear();
  },
};
