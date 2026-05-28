/**
 * scrollMemory — Lightweight per-tab/view scroll position persistence
 *
 * Uses sessionStorage (not localStorage) because scroll offsets are
 * session-scoped — they don't need to survive process kill.
 *
 * Bounded at MAX_ENTRIES with FIFO eviction to stay memory-safe.
 *
 * Module 9, 11
 */

const SS_KEY     = 'scroll_mem_v1';
const MAX_ENTRIES = 25;

type ScrollMap = Record<string, number>;

// ── Internal helpers ──────────────────────────────────────────────────────────

function read(): ScrollMap {
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw);
    return (p && typeof p === 'object') ? p as ScrollMap : {};
  } catch { return {}; }
}

function write(map: ScrollMap): void {
  try { sessionStorage.setItem(SS_KEY, JSON.stringify(map)); } catch {}
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Save a scroll offset for a given key.
 * Keys are typically the active tab name ("inventory", "ledger", etc.).
 */
export function saveScrollPosition(key: string, top: number): void {
  const map  = read();
  const keys = Object.keys(map);
  // Evict oldest entry when at capacity and key is new
  if (keys.length >= MAX_ENTRIES && !(key in map)) {
    delete map[keys[0]];
  }
  map[key] = top;
  write(map);
}

/** Retrieve saved offset, or 0 if not found. */
export function getScrollPosition(key: string): number {
  return read()[key] ?? 0;
}

/** Remove a saved offset (e.g. when a list resets intentionally). */
export function clearScrollPosition(key: string): void {
  const map = read();
  delete map[key];
  write(map);
}

/** Wipe all saved positions (e.g. on logout). */
export function clearAllScrollPositions(): void {
  try { sessionStorage.removeItem(SS_KEY); } catch {}
}
