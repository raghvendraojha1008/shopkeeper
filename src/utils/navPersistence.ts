/**
 * navPersistence — Navigation state persistence
 *
 * Persists the active tab to:
 * • sessionStorage  — survives background + tab-switch (fast read)
 * • localStorage    — survives process death (slower, but cross-session)
 *
 * On restore, the most recent session-storage value wins.
 *
 * Tabs that require preloaded data ('stock-valuation') are silently
 * redirected to dashboard on restore so the app never resumes into a
 * broken / empty state.
 *
 * Module 2, 6
 */

const SS_KEY  = 'nav_ss_v1';      // sessionStorage key
const LS_KEY  = 'nav_ls_v1';      // localStorage  key
const MAX_AGE = 24 * 60 * 60 * 1000;  // 24 h — stale after this

// These tabs require an explicit data-load trigger before rendering.
// Restoring into them would show blank content, so we redirect to dashboard.
const PRELOAD_REQUIRED = new Set(['stock-valuation']);

interface NavState {
  tab : string;
  ts  : number;
  uid?: string;
}

// ── Write ─────────────────────────────────────────────────────────────────────

export function saveNavState(tab: string, uid?: string): void {
  const state: NavState = { tab, ts: Date.now(), uid };
  const json = JSON.stringify(state);
  try { sessionStorage.setItem(SS_KEY, json); } catch {}
  try { localStorage.setItem(LS_KEY,  json); } catch {}
}

// ── Read ──────────────────────────────────────────────────────────────────────

export function restoreNavState(uid?: string): string | null {
  let raw: string | null = null;

  // sessionStorage has priority (freshest)
  try { raw = sessionStorage.getItem(SS_KEY); } catch {}
  if (!raw) {
    try { raw = localStorage.getItem(LS_KEY); } catch {}
  }
  if (!raw) return null;

  try {
    const s: NavState = JSON.parse(raw);

    // Stale check
    if (!s.ts || Date.now() - s.ts > MAX_AGE) return null;

    // User mismatch — don't restore for a different account
    if (uid && s.uid && uid !== s.uid) return null;

    if (!s.tab) return null;

    // Tabs that need preloading → fall back to dashboard
    if (PRELOAD_REQUIRED.has(s.tab)) return 'dashboard';

    return s.tab;
  } catch {
    return null;
  }
}

// ── Clear ─────────────────────────────────────────────────────────────────────

export function clearNavState(): void {
  try { sessionStorage.removeItem(SS_KEY); } catch {}
  try { localStorage.removeItem(LS_KEY);  } catch {}
}
