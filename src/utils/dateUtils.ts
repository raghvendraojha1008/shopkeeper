/**
 * Shared date-parsing utility for Shopkeeper V2.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Firestore returns Timestamp objects with a `.toDate()` method.  When React
 * Query persists the cache to IndexedDB and then rehydrates it, those Timestamps
 * are serialised as plain objects `{ seconds: N, nanoseconds: N }` — the
 * prototype (and therefore `.toDate()`) is lost.  Every previous copy of
 * `parseRecordDate` in the codebase only guarded against the live Timestamp
 * case; it passed the serialised object straight to `new Date(...)` which
 * produces an Invalid Date.  Calling `.toISOString()` on an Invalid Date throws
 * `RangeError: Invalid time value`, which is caught by ScreenErrorBoundary and
 * renders the "Something went wrong on this screen" message across every view
 * that displays dates from cached data.
 *
 * This module is the single source of truth for safe date parsing.
 */

/**
 * Converts any raw date value stored in Firestore records to a valid JS Date.
 * Handles all known formats:
 *  - null / undefined                    → epoch (new Date(0))
 *  - Live Firestore Timestamp            → .toDate()
 *  - Serialised Timestamp {seconds,ns}  → milliseconds calculation
 *  - ISO string ("2024-05-01T00:00:00Z") → new Date(s)
 *  - Date-only string ("2024-05-01")     → local midnight
 *  - Anything else                       → epoch (safe fallback, never throws)
 */
export function parseDateSafe(raw: any): Date {
  if (!raw) return new Date(0);

  if (typeof raw.toDate === 'function') return raw.toDate();

  if (typeof raw === 'object' && typeof raw.seconds === 'number') {
    const ms = raw.seconds * 1000 + Math.floor((raw.nanoseconds || 0) / 1e6);
    return new Date(ms);
  }

  const s = String(raw);
  if (s === 'null' || s === 'undefined' || s === '[object Object]') return new Date(0);
  if (s.includes('T')) return new Date(s);

  const parts = s.split('-');
  if (parts.length === 3) {
    const [y, m, d] = parts.map(Number);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) return new Date(y, m - 1, d);
  }

  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? new Date(0) : fallback;
}

/**
 * Stable record comparator.
 *
 * Primary key  : `date` (YYYY-MM-DD string) — day-level granularity.
 * Secondary key: `created_at` (ISO datetime) — records added on the same
 *                calendar day are ordered by the moment they were recorded,
 *                preserving entry order across all list views and exports.
 *
 * Returns negative when a was earlier (a < b), positive when a was later.
 * Usage:
 *   ascending  (oldest first, e.g. PDF / running balance): .sort(compareByDateThenCreated)
 *   descending (newest first, e.g. list views):            .sort((a,b) => compareByDateThenCreated(b,a))
 */
export function compareByDateThenCreated(a: any, b: any): number {
  // Slice to 10 chars so both "2024-05-01" and "2024-05-01T..." compare correctly.
  const dA = (a.date  || '').slice(0, 10);
  const dB = (b.date  || '').slice(0, 10);
  if (dA !== dB) return dA < dB ? -1 : 1;

  // Same calendar date — use created_at for insertion-order stability.
  const cA = a.created_at ? parseDateSafe(a.created_at).getTime() : 0;
  const cB = b.created_at ? parseDateSafe(b.created_at).getTime() : 0;
  return cA - cB;
}

/**
 * Returns a "YYYY-MM-DD" string for the given raw date value.
 * Never throws — falls back to "1970-01-01" for unparseable inputs.
 */
export function toDateStrSafe(raw: any): string {
  const d = parseDateSafe(raw);
  if (isNaN(d.getTime())) return '1970-01-01';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
