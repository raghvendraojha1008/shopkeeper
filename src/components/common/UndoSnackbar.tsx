/**
 * UNDO SNACKBAR  — Full-Fledge Soft Delete with 5-second Undo
 * ─────────────────────────────────────────────────────────────
 * Works WITH the existing TrashService:
 *  1. Caller removes item from local UI state immediately (optimistic)
 *  2. scheduleDelete() sets a 5-second timer
 *  3. User can tap UNDO → timer cancelled, item restored to local state
 *  4. After 5 s → actual TrashService.moveToTrash() fires
 *  5. If Firestore call fails → item is re-added to local state
 *
 * ── How to use in a view ───────────────────────────────────────────────────
 *  import { useSoftDelete } from '../common/UndoSnackbar';
 *  const { scheduleDelete } = useSoftDelete();
 *
 *  const handleDelete = (item) => {
 *    scheduleDelete({
 *      id         : item.id,
 *      collection : 'ledger_entries',
 *      itemName   : item.party_name,
 *      onOptimistic: () => setEntries(p => p.filter(e => e.id !== item.id)),
 *      onRestore   : () => setEntries(p => [...p, item].sort(...)),
 *      onCommit    : async () => { await TrashService.moveToTrash(uid, 'ledger_entries', item.id); },
 *    });
 *  };
 *
 * ── Place <UndoSnackbar /> once in App.tsx ─────────────────────────────────
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Trash2, RotateCcw } from 'lucide-react';
import { useEditPassword } from '../../context/EditPasswordContext';

const UNDO_MS = 5000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SoftDeleteOptions {
  id          : string;
  collection  : string;
  itemName    : string;
  /** Remove from local state NOW */
  onOptimistic: () => void;
  /** Restore to local state on UNDO */
  onRestore   : () => void;
  /** Run the actual Firestore delete after UNDO_MS */
  onCommit    : () => Promise<void>;
}

interface PendingDelete extends SoftDeleteOptions {
  expiresAt: number;
  timerId  : ReturnType<typeof setTimeout>;
}

// ─── Singleton store ──────────────────────────────────────────────────────────
// NOTE (Issue #5): pending/subs are module-level. This is intentional for
// cross-component coordination but requires explicit flush on sign-out to
// prevent pending timers firing against the wrong user's Firestore namespace.
// Call flushPendingDeletes() wherever you handle sign-out (e.g. App.tsx).

const pending = new Map<string, PendingDelete>();
const subs    = new Set<() => void>();
const notify  = () => subs.forEach(fn => { try { fn(); } catch {} });

/**
 * FIX (Issue #5): Cancel all in-flight soft-delete timers and clear state.
 * Must be called on user sign-out to prevent pending deletions from a previous
 * session firing against a different user's data namespace after re-login.
 *
 * Usage in App.tsx:
 *   import { flushPendingDeletes } from './components/common/UndoSnackbar';
 *   // call flushPendingDeletes() inside your sign-out handler
 */
export const flushPendingDeletes = (): void => {
  pending.forEach(p => clearTimeout(p.timerId));
  pending.clear();
  notify();
};

export const SoftDeleteService = {
  schedule(opts: SoftDeleteOptions): void {
    // Cancel any prior pending delete for same doc
    if (pending.has(opts.id)) {
      clearTimeout(pending.get(opts.id)!.timerId);
      pending.delete(opts.id);
    }

    // Optimistically remove from UI
    opts.onOptimistic();

    const timerId = setTimeout(async () => {
      pending.delete(opts.id);
      notify();
      try {
        await opts.onCommit();
      } catch (err) {
        console.error('[SoftDelete] Commit failed, reverting:', err);
        opts.onRestore();
      }
    }, UNDO_MS);

    pending.set(opts.id, {
      ...opts,
      expiresAt: Date.now() + UNDO_MS,
      timerId,
    });
    notify();
  },

  undo(id: string): boolean {
    const item = pending.get(id);
    if (!item) return false;
    clearTimeout(item.timerId);
    pending.delete(id);
    item.onRestore();
    notify();
    return true;
  },

  getAll(): PendingDelete[] { return Array.from(pending.values()); },

  subscribe(fn: () => void): () => void {
    subs.add(fn);
    return () => subs.delete(fn);
  },
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSoftDelete() {
  const { requireEditPassword } = useEditPassword();

  const scheduleDelete = useCallback(async (opts: SoftDeleteOptions) => {
    const ok = await requireEditPassword('delete');
    if (!ok) return;
    SoftDeleteService.schedule(opts);
  }, [requireEditPassword]);

  return { scheduleDelete };
}

// ─── Snackbar component ───────────────────────────────────────────────────────

export const UndoSnackbar: React.FC = () => {
  const [items, setItems]           = useState<PendingDelete[]>([]);
  const [progress, setProgress]     = useState<Record<string, number>>({});
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const unsub = SoftDeleteService.subscribe(() => setItems(SoftDeleteService.getAll()));
    setItems(SoftDeleteService.getAll());
    return unsub;
  }, []);

  // Animate countdown progress bars via rAF
  useEffect(() => {
    if (items.length === 0) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setProgress({});
      return;
    }
    const tick = () => {
      const now  = Date.now();
      const next: Record<string, number> = {};
      items.forEach(it => { next[it.id] = Math.max(0, ((it.expiresAt - now) / UNDO_MS) * 100); });
      setProgress(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [items]);

  if (items.length === 0) return null;

  return (
    <div className="undo-snackbar-root fixed left-3 right-3 z-[160] space-y-2 pointer-events-none"
      style={{ bottom: 'max(112px, calc(env(safe-area-inset-bottom, 0px) + 100px))' }}>
      {items.slice(0, 3).map(item => (
        <div key={item.id}
          className="flex items-center gap-3 px-4 py-3 rounded-[20px] pointer-events-auto relative overflow-hidden"
          style={{
            background    : 'var(--modal-bg)',
            border        : '1px solid var(--col-danger-28)',
            backdropFilter: 'blur(24px)',
            boxShadow     : '0 8px 32px var(--rgba-black-60)',
          }}>

          {/* Countdown bar */}
          <div className="absolute bottom-0 left-0 h-[2.5px] transition-none"
            style={{
              width     : `${progress[item.id] ?? 100}%`,
              background: 'linear-gradient(90deg, #ef4444, #f87171)',
              borderRadius: '0 0 0 20px',
            }} />

          {/* Icon */}
          <div className="p-2 rounded-[12px] flex-shrink-0"
            style={{ background: 'var(--col-danger-14)', border: '1px solid var(--col-danger-22)' }}>
            <Trash2 size={13} style={{ color: "var(--col-danger)" }} />
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-white truncate">{item.itemName}</p>
            <p className="text-app-xs" style={{ color: 'var(--text-muted)' }}>
              Moved to trash · {Math.ceil(Math.max(0, (item.expiresAt - Date.now()) / 1000))}s to undo
            </p>
          </div>

          {/* UNDO button */}
          <button
            onClick={() => SoftDeleteService.undo(item.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[12px] active:scale-95 transition-all flex-shrink-0"
            style={{ background: 'var(--col-info-18)', border: '1px solid var(--col-info-28)' }}>
            <RotateCcw size={11} style={{ color: "var(--col-info)" }} />
            <span className="text-app-sm font-black" style={{ color: "var(--col-info)" }}>UNDO</span>
          </button>
        </div>
      ))}
    </div>
  );
};

export default UndoSnackbar;








