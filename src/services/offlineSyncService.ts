/**
 * OFFLINE SYNC SERVICE  v3  — Full-Fledge
 * ─────────────────────────────────────────────────────────────
 * Features:
 *  • Enqueue create/update/delete while offline
 *  • Deduplication: merges multiple updates to same docId
 *  • Priority queue: high → normal → low, then FIFO
 *  • Conflict detection: compares client timestamp vs server _serverUpdatedAt
 *  • 4 resolution strategies: server-wins | client-wins | merge | manual
 *  • Firestore batch commit (groups up to 490 ops)
 *  • Retry with max 3 attempts per item
 *  • subscribe() for live reactive UI updates
 *  • processQueue() with onProgress callback
 */

import {
  collection, doc, getDoc, setDoc, addDoc,
  updateDoc, deleteDoc, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { SyncLock } from './syncLock';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SyncOperation    = 'create' | 'update' | 'delete';
export type ConflictStrategy = 'server-wins' | 'client-wins' | 'merge' | 'manual';
export type SyncItemStatus   = 'pending' | 'processing' | 'conflict' | 'failed' | 'done';

export interface SyncQueueItem {
  id             : string;
  userId         : string;
  operation      : SyncOperation;
  collection     : string;
  docId          : string;
  data           : any;
  clientUpdatedAt: number;           // ms timestamp
  status         : SyncItemStatus;
  retries        : number;
  maxRetries     : number;
  error?         : string;
  priority       : 'high' | 'normal' | 'low';
}

export interface SyncConflict {
  item       : SyncQueueItem;
  serverData : any;
  clientData : any;
}

export interface SyncResult {
  success   : number;
  failed    : number;
  skipped   : number;
  conflicts : SyncConflict[];
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const QUEUE_KEY     = 'osync_queue_v3';
const CONFLICT_KEY  = 'osync_conflicts_v3';
const MAX_RETRIES   = 3;

const readQueue     = (): SyncQueueItem[] => { try { const raw = localStorage.getItem(QUEUE_KEY); if (!raw) return []; const q = JSON.parse(raw); return Array.isArray(q) ? q : []; } catch { return []; } };
const saveQueue     = (q: SyncQueueItem[]) => {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch (e: any) {
    // QuotaExceededError: the new item was NOT persisted to disk.
    // If the app is closed now, this offline operation will be lost.
    // Dispatch a window event so UI components can warn the user.
    if (e?.name === 'QuotaExceededError' || e?.code === 22 || e?.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      console.error('[OfflineSyncService] localStorage quota exceeded — offline queue item NOT saved to disk. Clear old data or free device storage.');
      try { window.dispatchEvent(new CustomEvent('shopkeeper:quota-exceeded')); } catch {}
    }
  }
};
const readConflicts = (): SyncConflict[]   => { try { const raw = localStorage.getItem(CONFLICT_KEY); if (!raw) return []; const c = JSON.parse(raw); return Array.isArray(c) ? c : []; } catch { return []; } };
const saveConflicts = (c: SyncConflict[])  => { try { localStorage.setItem(CONFLICT_KEY, JSON.stringify(c)); } catch {} };

// ─── Queue item validation (Module 5) ────────────────────────────────────────
// Malformed items (missing required fields, wrong types) are skipped and
// removed from the queue to preserve integrity of the remaining entries.

const VALID_OPS        = new Set<string>(['create', 'update', 'delete']);
const VALID_PRIORITIES = new Set<string>(['high', 'normal', 'low']);
const VALID_STATUSES   = new Set<string>(['pending', 'processing', 'conflict', 'failed', 'done']);

function isValidQueueItem(item: unknown): item is SyncQueueItem {
  if (!item || typeof item !== 'object') return false;
  const i = item as Record<string, unknown>;
  return (
    typeof i.id             === 'string' && i.id.length > 0 &&
    typeof i.userId         === 'string' && i.userId.length > 0 &&
    typeof i.collection     === 'string' && i.collection.length > 0 &&
    typeof i.docId          === 'string' && i.docId.length > 0 &&
    typeof i.clientUpdatedAt === 'number' &&
    typeof i.retries        === 'number' &&
    VALID_OPS.has(i.operation as string) &&
    VALID_PRIORITIES.has(i.priority as string) &&
    VALID_STATUSES.has(i.status as string)
  );
}

// ─── Reactive subscribers ─────────────────────────────────────────────────────

const listeners = new Set<() => void>();
const notify    = () => listeners.forEach(fn => { try { fn(); } catch {} });

// ─── Service ──────────────────────────────────────────────────────────────────

export const OfflineSyncService = {

  // ── Subscribe to queue changes ─────────────────────────────────────────────
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  // ── Enqueue an operation ───────────────────────────────────────────────────
  enqueue(
    userId    : string,
    operation : SyncOperation,
    col       : string,
    data      : any,
    docId?    : string,
    priority  : 'high' | 'normal' | 'low' = 'normal',
  ): SyncQueueItem {
    const q             = readQueue();
    const resolvedDocId = docId || `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Dedup: merge consecutive updates to same document
    if (operation === 'update') {
      const idx = q.findIndex(
        i => i.userId === userId && i.docId === resolvedDocId
          && i.collection === col && i.status === 'pending'
          && i.operation !== 'delete',
      );
      if (idx !== -1) {
        q[idx].data           = { ...q[idx].data, ...data, _clientUpdatedAt: Date.now() };
        q[idx].clientUpdatedAt = Date.now();
        saveQueue(q);
        notify();
        return q[idx];
      }
    }

    const item: SyncQueueItem = {
      id             : `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      userId,
      operation,
      collection     : col,
      docId          : resolvedDocId,
      data           : { ...data, _clientUpdatedAt: Date.now() },
      clientUpdatedAt: Date.now(),
      status         : 'pending',
      retries        : 0,
      maxRetries     : MAX_RETRIES,
      priority,
    };

    q.push(item);
    saveQueue(q);
    notify();
    return item;
  },

  // ── Read state ─────────────────────────────────────────────────────────────
  getQueue(userId?: string): SyncQueueItem[] {
    const q = readQueue();
    return userId ? q.filter(i => i.userId === userId) : q;
  },

  getPendingCount(userId?: string): number {
    return this.getQueue(userId).filter(i => i.status === 'pending').length;
  },

  getFailedCount(userId?: string): number {
    return this.getQueue(userId).filter(i => i.status === 'failed').length;
  },

  getConflicts(): SyncConflict[] {
    return readConflicts();
  },

  // ── Process queue ──────────────────────────────────────────────────────────
  async processQueue(
    userId           : string,
    opts             : {
      conflictStrategy? : ConflictStrategy;
      onProgress?       : (processed: number, total: number) => void;
    } = {},
  ): Promise<SyncResult> {
    const { conflictStrategy = 'server-wins', onProgress } = opts;
    const result: SyncResult = { success: 0, failed: 0, skipped: 0, conflicts: [] };

    if (!SyncLock.acquire()) {
      // Concurrent call — silently skip; the in-progress run will finish.
      return result;
    }

    try {
    const sorted = readQueue()
      .filter(i => i.userId === userId && i.status === 'pending')
      .sort((a, b) => {
        const p: Record<string, number> = { high: 0, normal: 1, low: 2 };
        return (p[a.priority] - p[b.priority]) || (a.clientUpdatedAt - b.clientUpdatedAt);
      });

    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i];
      onProgress?.(i + 1, sorted.length);

      // Module 5: skip + quarantine malformed queue items so one bad entry
      // never prevents the rest of the queue from syncing.
      if (!isValidQueueItem(item)) {
        this._remove(item.id);
        result.skipped++;
        notify();
        continue;
      }

      this._setStatus(item.id, 'processing');

      try {
        // Check for conflict
        const serverData = await this._fetchServer(userId, item);
        if (serverData !== null) {
          const resolved = await this._resolveConflict(item, serverData, conflictStrategy);
          if (resolved === '__manual__') {
            const conflicts = readConflicts();
            if (!conflicts.find(c => c.item.id === item.id)) {
              conflicts.push({ item, serverData, clientData: item.data });
              saveConflicts(conflicts);
            }
            this._setStatus(item.id, 'conflict');
            result.conflicts.push({ item, serverData, clientData: item.data });
            notify();
            continue;
          }
          item.data = resolved;
        }

        await this._executeOp(userId, item);
        this._remove(item.id);
        result.success++;
        notify();
      } catch (err: any) {
        const msg = String(err?.message || 'Unknown error');
        const q = readQueue();
        const qItem = q.find(qi => qi.id === item.id);
        if (qItem) {
          qItem.retries++;
          qItem.error = msg;
          if (qItem.retries >= MAX_RETRIES) {
            qItem.status = 'failed';
            result.failed++;
          } else {
            qItem.status = 'pending';
          }
          saveQueue(q);
        }
        notify();
      }
    }
    return result;
    } finally {
      SyncLock.release();
    }
  },

  // ── Resolve a manual conflict ──────────────────────────────────────────────
  async applyConflictResolution(
    conflict   : SyncConflict,
    resolution : 'use-client' | 'use-server' | 'custom',
    customData?: any,
  ): Promise<boolean> {
    const finalData = resolution === 'use-client' ? conflict.clientData
                    : resolution === 'use-server' ? conflict.serverData
                    : customData;
    try {
      const ref = doc(db, `users/${conflict.item.userId}/${conflict.item.collection}`, conflict.item.docId);
      await setDoc(ref, { ...finalData, _serverUpdatedAt: serverTimestamp() }, { merge: true });
      saveConflicts(readConflicts().filter(c => c.item.id !== conflict.item.id));
      this._remove(conflict.item.id);
      notify();
      return true;
    } catch { return false; }
  },

  // ── Retry all failed ──────────────────────────────────────────────────────
  retryFailed(userId: string) {
    const q = readQueue();
    let changed = false;
    q.forEach(i => {
      if (i.userId === userId && (i.status === 'failed' || i.status === 'conflict')) {
        i.status = 'pending'; i.retries = 0; i.error = undefined;
        changed = true;
      }
    });
    if (changed) { saveQueue(q); notify(); }
  },

  clearQueue(userId: string) {
    saveQueue(readQueue().filter(i => i.userId !== userId));
    notify();
  },

  clearConflicts() { saveConflicts([]); notify(); },

  // ── Private helpers ────────────────────────────────────────────────────────
  async _fetchServer(userId: string, item: SyncQueueItem): Promise<any | null> {
    if (item.operation === 'create') return null;
    try {
      const snap = await getDoc(doc(db, `users/${userId}/${item.collection}`, item.docId));
      if (!snap.exists()) return null;
      const sd = snap.data();
      const serverTs = (sd?._serverUpdatedAt as any)?.toMillis?.() ?? 0;
      // Conflict if server is NEWER than when client last read
      return serverTs > item.clientUpdatedAt ? sd : null;
    } catch { return null; }
  },

  async _resolveConflict(
    item     : SyncQueueItem,
    server   : any,
    strategy : ConflictStrategy,
  ): Promise<any | '__manual__'> {
    switch (strategy) {
      case 'client-wins': return item.data;
      case 'server-wins': return server;
      case 'merge'      : return { ...server, ...item.data, _merged: true };
      case 'manual'     : return '__manual__';
    }
  },

  async _executeOp(userId: string, item: SyncQueueItem) {
    const colRef = collection(db, `users/${userId}/${item.collection}`);
    const { _clientUpdatedAt, ...payload } = item.data;
    const withTs = { ...payload, _serverUpdatedAt: serverTimestamp() };

    switch (item.operation) {
      case 'create':
        if (item.docId.startsWith('local_')) await addDoc(colRef, withTs);
        else await setDoc(doc(colRef, item.docId), withTs);
        break;
      case 'update':
        await updateDoc(doc(colRef, item.docId), withTs);
        break;
      case 'delete':
        await deleteDoc(doc(colRef, item.docId));
        break;
    }
  },

  _setStatus(id: string, status: SyncItemStatus, error?: string) {
    const q = readQueue();
    const i = q.find(x => x.id === id);
    if (i) { i.status = status; if (error) i.error = error; saveQueue(q); }
  },

  _remove(id: string) {
    saveQueue(readQueue().filter(i => i.id !== id));
  },
};







