/**
 * draftStorage — Form draft save / restore / invalidate
 *
 * Drafts survive:
 *   • app background           (sessionStorage + localStorage)
 *   • process death            (localStorage)
 *   • accidental screen close  (localStorage)
 *
 * Each draft is stored with:
 *   • schema version  — reject stale schemas after app updates
 *   • userId          — prevent cross-account draft bleed
 *   • timestamp       — expiry guard (default 24 h)
 *   • data            — the serialized form state
 *
 * Size guard: drafts > MAX_SIZE_BYTES are silently dropped so one large
 * form can't corrupt or exhaust localStorage.
 *
 * Modules: 3, 6, 7, 14
 */

import { errorLogger } from './errorLogger';

const DRAFT_VERSION  = 1;
const DRAFT_PREFIX   = 'draft_v1_';
const DEFAULT_EXPIRY = 24 * 60 * 60 * 1000;   // 24 h
const MAX_SIZE_BYTES = 120 * 1024;             // 120 KB hard limit

interface DraftEntry<T> {
  v   : number;       // schema version
  uid?: string;       // owner uid
  ts  : number;       // saved timestamp (ms)
  d   : T;            // payload
}

function storageKey(formKey: string): string {
  return `${DRAFT_PREFIX}${formKey}`;
}

// ── Save ──────────────────────────────────────────────────────────────────────

/**
 * Persist a form draft. Returns `true` on success, `false` on size/write failure.
 * Calls are cheap — debounce in the calling hook, not here.
 */
export function saveDraft<T>(
  formKey  : string,
  data     : T,
  opts     : { uid?: string } = {},
): boolean {
  try {
    const entry: DraftEntry<T> = { v: DRAFT_VERSION, uid: opts.uid, ts: Date.now(), d: data };
    const json = JSON.stringify(entry);
    if (json.length > MAX_SIZE_BYTES) {
      errorLogger.log('storage', new Error(`Draft too large (${json.length} B)`), { formKey }, 'draftStorage');
      return false;
    }
    localStorage.setItem(storageKey(formKey), json);
    return true;
  } catch (e) {
    errorLogger.log('storage', e, { formKey }, 'draftStorage');
    return false;
  }
}

// ── Restore ───────────────────────────────────────────────────────────────────

export interface DraftResult<T> {
  data    : T | null;
  ageMs   : number;
  found   : boolean;
}

/**
 * Restore a saved draft.  Returns `{ found: false }` if:
 * • No draft exists
 * • Draft is expired
 * • uid mismatch
 * • Schema version mismatch
 * • JSON parse failure
 */
export function restoreDraft<T>(
  formKey  : string,
  opts     : { uid?: string; expiryMs?: number } = {},
): DraftResult<T> {
  const MISS: DraftResult<T> = { data: null, ageMs: 0, found: false };

  try {
    const raw = localStorage.getItem(storageKey(formKey));
    if (!raw) return MISS;

    const entry: DraftEntry<T> = JSON.parse(raw);

    // Schema version guard
    if (entry.v !== DRAFT_VERSION) { clearDraft(formKey); return MISS; }

    // User guard
    if (opts.uid && entry.uid && opts.uid !== entry.uid) { clearDraft(formKey); return MISS; }

    // Expiry guard
    const ageMs  = Date.now() - (entry.ts ?? 0);
    const expiry = opts.expiryMs ?? DEFAULT_EXPIRY;
    if (ageMs > expiry) { clearDraft(formKey); return MISS; }

    return { data: entry.d, ageMs, found: true };
  } catch (e) {
    errorLogger.log('storage', e, { formKey }, 'draftStorage.restore');
    clearDraft(formKey);
    return MISS;
  }
}

// ── Clear ─────────────────────────────────────────────────────────────────────

/** Invalidate a draft — call this on successful form submission. */
export function clearDraft(formKey: string): void {
  try { localStorage.removeItem(storageKey(formKey)); } catch {}
}

/** Clear all drafts owned by a specific user (call on logout). */
export function clearAllDraftsForUser(uid: string): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(DRAFT_PREFIX)) continue;
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const e = JSON.parse(raw) as DraftEntry<unknown>;
        if (e.uid === uid) keysToRemove.push(k);
      } catch {}
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch {}
}
