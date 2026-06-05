/**
 * useFormDraft<T>
 *
 * Manages form state with automatic draft persistence.
 * Drafts are debounce-saved to localStorage and survive app background,
 * process death, and accidental screen close.
 *
 * Usage:
 *   const { values, setField, clearDraft, isDraftRestored } = useFormDraft(
 *     'pos-cart-uid123',
 *     { cart: [], partyName: '' },
 *     { uid: user.uid, isEdit: false },
 *   );
 *
 * API:
 *   values          — current form state (restored or fresh)
 *   setValues(v)    — replace all values
 *   setField(k, v)  — update one field
 *   isDraftRestored — true if this render came from a saved draft
 *   draftAgeMs      — age of restored draft in ms (0 if none)
 *   clearDraft()    — invalidate persisted draft (call on successful save)
 *
 * Module 3, 14
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { saveDraft, restoreDraft, clearDraft as _clearDraft } from '../utils/draftStorage';
import { useUI } from '../context/UIContext';

export interface UseFormDraftOptions {
  /** Firebase uid — prevents cross-account draft bleed */
  uid            ?: string;
  /** Debounce interval in ms before writing to localStorage. Default 1500. */
  saveDebounceMs ?: number;
  /** Show a "Draft restored" toast on mount. Default true. */
  showToast      ?: boolean;
  /** Draft expiry in ms. Default 24 h. */
  expiryMs       ?: number;
  /**
   * Set to true when the form opens with existing data (edit mode).
   * This prevents accidentally overwriting real data with a stale draft.
   */
  isEdit         ?: boolean;
}

export function useFormDraft<T extends Record<string, unknown>>(
  formKey : string,
  initial : T,
  opts    : UseFormDraftOptions = {},
): {
  values         : T;
  setValues      : (next: T | ((prev: T) => T)) => void;
  setField       : <K extends keyof T>(field: K, value: T[K]) => void;
  isDraftRestored: boolean;
  draftAgeMs     : number;
  clearDraft     : () => void;
} {
  const {
    uid,
    saveDebounceMs  = 1500,
    showToast: showT = true,
    expiryMs,
    isEdit          = false,
  } = opts;

  const { showToast } = useUI();

  // ── Initial value — attempt draft restore once ────────────────────────────
  const initResult  = useRef<{ values: T; ageMs: number; found: boolean } | null>(null);

  if (initResult.current === null) {
    if (isEdit) {
      initResult.current = { values: initial, ageMs: 0, found: false };
    } else {
      const r = restoreDraft<T>(formKey, { uid, expiryMs });
      initResult.current = r.found
        ? { values: r.data!, ageMs: r.ageMs, found: true }
        : { values: initial, ageMs: 0,        found: false };
    }
  }

  const [values,          setValuesRaw]     = useState<T>(initResult.current.values);
  const [isDraftRestored, setIsDraftRestored] = useState(initResult.current.found);
  const [draftAgeMs,      setDraftAgeMs]    = useState(initResult.current.ageMs);

  // ── Show restore toast once after mount ───────────────────────────────────
  useEffect(() => {
    if (!isDraftRestored || !showT) return;
    const mins = Math.round(draftAgeMs / 60_000);
    const label =
      mins < 2   ? 'just now'
      : mins < 60 ? `${mins}m ago`
      : `${Math.round(mins / 60)}h ago`;
    showToast(`Draft restored (saved ${label})`, 'info');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  // ── Debounced save ────────────────────────────────────────────────────────
  const saveTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSave = useCallback((next: T) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveDraft(formKey, next, { uid });
    }, saveDebounceMs);
  }, [formKey, uid, saveDebounceMs]);

  // ── Public API ────────────────────────────────────────────────────────────

  const setValues = useCallback((next: T | ((prev: T) => T)) => {
    setValuesRaw(prev => {
      const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      scheduleSave(v);
      return v;
    });
  }, [scheduleSave]);

  const setField = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setValues(prev => ({ ...prev, [field]: value }));
  }, [setValues]);

  const clearDraft = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    _clearDraft(formKey);
    setIsDraftRestored(false);
    setDraftAgeMs(0);
  }, [formKey]);

  // ── Cleanup timer on unmount ──────────────────────────────────────────────
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  return { values, setValues, setField, isDraftRestored, draftAgeMs, clearDraft };
}
