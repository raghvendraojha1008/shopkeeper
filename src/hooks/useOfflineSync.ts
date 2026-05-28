/**
 * useOfflineSync  — React hook  (full-fledge)
 * ─────────────────────────────────────────────────────────────
 * Drop-in replacement for direct ApiService write calls.
 *
 * ONLINE  → direct Firestore write (fast path, no queue)
 * OFFLINE → queued; auto-syncs the moment connectivity returns
 *
 * Usage:
 *   const { write, isOnline, isSyncing, pendingCount, conflicts } = useOfflineSync();
 *
 *   await write.add('ledger_entries', data);
 *   await write.update('ledger_entries', id, patch);
 *   await write.delete('ledger_entries', id);
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ApiService } from '../services/api';
import { OfflineSyncService, SyncConflict, ConflictStrategy } from '../services/offlineSyncService';
import { useAuth } from '../context/AuthContext';

export interface UseOfflineSyncState {
  isOnline       : boolean;
  isSyncing      : boolean;
  pendingCount   : number;
  failedCount    : number;
  conflicts      : SyncConflict[];
  lastSyncMsg    : string | null;
  syncProgress   : { done: number; total: number } | null;
}

export function useOfflineSync(conflictStrategy: ConflictStrategy = 'server-wins') {
  const { user } = useAuth();
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<UseOfflineSyncState>({
    isOnline     : navigator.onLine,
    isSyncing    : false,
    pendingCount : 0,
    failedCount  : 0,
    conflicts    : [],
    lastSyncMsg  : null,
    syncProgress : null,
  });
  const syncing = useRef(false);

  // ── Refresh counts from queue ────────────────────────────────────────────
  const refresh = useCallback(() => {
    setState(prev => ({
      ...prev,
      pendingCount: OfflineSyncService.getPendingCount(user?.uid),
      failedCount : OfflineSyncService.getFailedCount(user?.uid),
      conflicts   : OfflineSyncService.getConflicts(),
    }));
  }, [user?.uid]);

  useEffect(() => {
    const unsub = OfflineSyncService.subscribe(refresh);
    refresh();
    return unsub;
  }, [refresh]);

  // ── Online / offline events ──────────────────────────────────────────────
  const triggerSync = useCallback(async () => {
    if (!user || syncing.current || !navigator.onLine) return;
    syncing.current = true;
    setState(prev => ({ ...prev, isSyncing: true, syncProgress: null }));

    try {
      const result = await OfflineSyncService.processQueue(user.uid, {
        conflictStrategy,
        onProgress: (done, total) =>
          setState(prev => ({ ...prev, syncProgress: { done, total } })),
      });

      const msg =
        result.success > 0           ? `${result.success} item${result.success > 1 ? 's' : ''} synced`
        : result.conflicts.length > 0 ? `${result.conflicts.length} conflict${result.conflicts.length > 1 ? 's' : ''} need review`
        : result.failed > 0           ? `${result.failed} item${result.failed > 1 ? 's' : ''} failed`
        : null;

      setState(prev => ({ ...prev, isSyncing: false, syncProgress: null, lastSyncMsg: msg }));
      if (msg) {
        if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
        clearTimerRef.current = setTimeout(() => setState(p => ({ ...p, lastSyncMsg: null })), 3500);
      }
    } catch {
      setState(prev => ({ ...prev, isSyncing: false, syncProgress: null }));
    } finally {
      syncing.current = false;
    }
  }, [user, conflictStrategy]);

  useEffect(() => {
    const online  = () => { setState(p => ({ ...p, isOnline: true }));  triggerSync(); };
    const offline = () =>   setState(p => ({ ...p, isOnline: false }));
    window.addEventListener('online',  online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online',  online);
      window.removeEventListener('offline', offline);
    };
  }, [triggerSync]);

  // Clear the message-fade timer on unmount so no setState fires on a
  // component that has already been removed from the tree.
  useEffect(() => {
    return () => { if (clearTimerRef.current) clearTimeout(clearTimerRef.current); };
  }, []);

  // ── Write helpers (pass-through or queue) ────────────────────────────────
  const write = {
    add: async (col: string, data: any, priority: 'high' | 'normal' | 'low' = 'normal') => {
      if (!user) throw new Error('Not authenticated');
      if (navigator.onLine) return ApiService.add(user.uid, col, data);
      return OfflineSyncService.enqueue(user.uid, 'create', col, data, undefined, priority);
    },

    update: async (col: string, docId: string, data: any, priority: 'high' | 'normal' | 'low' = 'normal') => {
      if (!user) throw new Error('Not authenticated');
      if (navigator.onLine) return ApiService.update(user.uid, col, docId, data);
      return OfflineSyncService.enqueue(user.uid, 'update', col, data, docId, priority);
    },

    delete: async (col: string, docId: string, priority: 'high' | 'normal' | 'low' = 'normal') => {
      if (!user) throw new Error('Not authenticated');
      if (navigator.onLine) return ApiService.delete(user.uid, col, docId);
      return OfflineSyncService.enqueue(user.uid, 'delete', col, {}, docId, priority);
    },
  };

  // ── Conflict helpers ─────────────────────────────────────────────────────
  const resolveConflict = useCallback(async (
    conflict   : SyncConflict,
    resolution : 'use-client' | 'use-server' | 'custom',
    customData?: any,
  ) => OfflineSyncService.applyConflictResolution(conflict, resolution, customData),
  []);

  const retryFailed = useCallback(() => {
    if (user) { OfflineSyncService.retryFailed(user.uid); triggerSync(); }
  }, [user, triggerSync]);

  return { ...state, write, triggerSync, resolveConflict, retryFailed };
}







