/**
 * cacheGuard — Safe localStorage / IndexedDB hydration guards
 *
 * Protects against:
 * • JSON parse failures on corrupted blobs
 * • Schema mismatches after app updates
 * • localStorage quota / SecurityError exceptions
 * • Corrupted sync queue arrays
 */

import { errorLogger } from './errorLogger';

// ── Safe JSON parse ───────────────────────────────────────────────────────────

export function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw || raw === 'undefined' || raw === 'null') return fallback;
  try {
    const v = JSON.parse(raw);
    return (v === null || v === undefined) ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

// ── Safe localStorage ─────────────────────────────────────────────────────────

export function safeLocalGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    if (typeof fallback === 'boolean')  return (raw === 'true') as unknown as T;
    if (typeof fallback === 'number')   {
      const n = Number(raw);
      return isNaN(n) ? fallback : n as unknown as T;
    }
    if (typeof fallback === 'string')   return raw as unknown as T;
    return safeParse(raw, fallback);
  } catch (e) {
    errorLogger.log('storage', e, { key }, 'cacheGuard');
    return fallback;
  }
}

export function safeLocalSet(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    return true;
  } catch (e) {
    errorLogger.log('storage', e, { key }, 'cacheGuard');
    return false;
  }
}

export function safeLocalRemove(key: string): void {
  try { localStorage.removeItem(key); } catch {}
}

// ── Corruption detection ──────────────────────────────────────────────────────

/** Returns true if the offline sync queue exists but is not a valid array */
export function isQueueCorrupted(): boolean {
  try {
    const raw = localStorage.getItem('osync_queue_v3');
    if (!raw) return false;
    const q = JSON.parse(raw);
    return !Array.isArray(q);
  } catch {
    return true;
  }
}

// ── Selective cache clearing ──────────────────────────────────────────────────

export function clearSyncCache(): void {
  ['osync_queue_v3', 'osync_conflicts_v3'].forEach(safeLocalRemove);
  errorLogger.log('storage', new Error('Sync cache cleared'), {}, 'cacheGuard.clearSyncCache');
}

/** Async best-effort clear of the IndexedDB React Query cache blob */
export function clearQueryCache(): void {
  import('idb-keyval')
    .then(({ del, createStore }) => {
      const store = createStore('shopkeeper-cache', 'react-query');
      return del('rq-cache-v1', store);
    })
    .catch(() => {/* IDB may be unavailable — silent */});
}

export function clearAllCaches(): void {
  const KEYS = [
    'osync_queue_v3',
    'osync_conflicts_v3',
    'insight_margins',
    'insight_profit_overrides',
    'insight_unlocked_at',
    'app_schema_v',
  ];
  KEYS.forEach(safeLocalRemove);
  clearQueryCache();
}

// ── Schema version migration ──────────────────────────────────────────────────

const SCHEMA_KEY     = 'app_schema_v';
const SCHEMA_VERSION = 2;

/**
 * Run once at app startup.
 * Bumps the schema version stamp and runs any one-time migrations.
 * Safe to call multiple times — idempotent.
 */
export function checkAndMigrateSchema(): void {
  try {
    const stored = parseInt(localStorage.getItem(SCHEMA_KEY) ?? '0', 10);
    if (stored < SCHEMA_VERSION) {
      // v1→v2: no destructive migration needed; just stamp the new version
      safeLocalSet(SCHEMA_KEY, SCHEMA_VERSION);
    }
    // Repair: if the sync queue is corrupt, wipe it so the app doesn't loop
    if (isQueueCorrupted()) {
      clearSyncCache();
    }
  } catch (e) {
    errorLogger.log('storage', e, {}, 'cacheGuard.migrate');
  }
}
