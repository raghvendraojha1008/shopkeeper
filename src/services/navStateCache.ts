/**
 * NavStateCache — lightweight in-memory cache for per-view UI state.
 *
 * Stores ephemeral values (search terms, filters, active tabs, scroll positions)
 * so they survive tab switches (views unmount/remount on navigation).
 *
 * Intentionally NOT persisted to localStorage — cleared on app reload, which
 * is correct behaviour for a mobile app session.
 */

const stateMap = new Map<string, unknown>();
const scrollMap = new Map<string, number>();

export const NavStateCache = {
  // ── Arbitrary UI state ────────────────────────────────────────────────────

  save<T>(key: string, value: T): void {
    stateMap.set(key, value);
  },

  get<T>(key: string, fallback: T): T {
    return stateMap.has(key) ? (stateMap.get(key) as T) : fallback;
  },

  clear(key: string): void {
    stateMap.delete(key);
  },

  // ── Scroll positions ──────────────────────────────────────────────────────

  saveScroll(key: string, y: number): void {
    scrollMap.set(key, y);
  },

  getScroll(key: string): number {
    return scrollMap.get(key) ?? 0;
  },

  clearScroll(key: string): void {
    scrollMap.delete(key);
  },
};
