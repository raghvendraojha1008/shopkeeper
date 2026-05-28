/**
 * queryPersistStorage  — AsyncStorage-shaped IndexedDB wrapper for the React
 * Query persister.
 *
 * Why IndexedDB (not localStorage):
 *   • localStorage is a 5–10 MB hard cap and is synchronous, which blocks the
 *     main thread on every read. A shopkeeper with thousands of items + months
 *     of ledger entries would blow past that limit and stutter the UI.
 *   • IndexedDB is async and effectively unbounded (browser quota — typically
 *     hundreds of MB), perfect for full-collection caching of inventory,
 *     parties, ledger, transactions, waste.
 *
 * We use `idb-keyval` (≈600 B gzipped) because the cache only ever stores ONE
 * blob keyed by query-cache id — there's no need for a full schema or indexes.
 * The `AsyncStorage` interface (`getItem`/`setItem`/`removeItem`) is exactly
 * what `@tanstack/query-async-storage-persister` expects.
 *
 * Module 4 — Persisted State Recovery:
 *   • Detects corrupted / unparseable blobs on getItem
 *   • Auto-clears the corrupt entry so the app starts fresh rather than looping
 *   • Guards against schema mismatches by validating the top-level structure
 */

import { get, set, del, createStore } from 'idb-keyval';
import { errorLogger } from '../utils/errorLogger';

// Dedicated DB + store so we don't clash with anything else the app might
// stash in IndexedDB later (Capacitor plugins, Firebase persistence, etc.).
const dbStore = createStore('shopkeeper-cache', 'react-query');

// ── Cache integrity check ─────────────────────────────────────────────────────

/**
 * Lightweight structure validation for a dehydrated React Query cache blob.
 * The persister stores JSON with a top-level `clientState` object.
 * Returns false if the blob is clearly malformed.
 */
function isValidCacheBlob(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw);
    // React Query persister format: { clientState: { queries: [...] } }
    if (typeof parsed !== 'object' || parsed === null) return false;
    if ('clientState' in parsed) {
      const cs = parsed.clientState;
      if (typeof cs !== 'object' || cs === null) return false;
      if ('queries' in cs && !Array.isArray(cs.queries)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ── Storage adapter ───────────────────────────────────────────────────────────

export const indexedDBStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      const value = await get<string>(key, dbStore);
      if (value === undefined || value === null) return null;

      // Module 4: validate the blob before handing it to the persister.
      // A corrupted blob (truncated write, schema mismatch, etc.) would cause
      // React Query to enter an error/loading loop.  Returning null forces a
      // clean rebuild from Firebase instead.
      if (typeof value === 'string' && !isValidCacheBlob(value)) {
        errorLogger.log(
          'storage',
          new Error('React Query cache blob is malformed — clearing'),
          { key },
          'queryPersistStorage',
        );
        // Best-effort async clear; don't await to stay non-blocking
        del(key, dbStore).catch(() => {});
        return null;
      }

      return value;
    } catch (e) {
      // IDB can fail in private-mode Safari, locked-down browsers, storage
      // quota exceeded, etc.  Returning null lets the persister skip
      // rehydration gracefully and the app falls back to a fresh Firebase fetch.
      errorLogger.log('storage', e, { key, op: 'get' }, 'queryPersistStorage');
      return null;
    }
  },

  setItem: async (key: string, value: string): Promise<void> => {
    try {
      // Don't bother persisting a clearly invalid blob
      if (!value || typeof value !== 'string') return;
      await set(key, value, dbStore);
    } catch (e) {
      errorLogger.log('storage', e, { key, op: 'set' }, 'queryPersistStorage');
    }
  },

  removeItem: async (key: string): Promise<void> => {
    try {
      await del(key, dbStore);
    } catch (e) {
      errorLogger.log('storage', e, { key, op: 'remove' }, 'queryPersistStorage');
    }
  },
};
