/**
 * SyncQueueService  — simple offline queue backed by localStorage.
 *
 * CONTEXT: The codebase has three independent sync systems
 * (SyncQueueService, OfflineSyncService, OfflineQueueService).
 * The full architectural consolidation is a larger refactor; in the
 * meantime this file fixes the specific bugs reported:
 *
 * FIX 1: Added a lightweight subscribe/notify mechanism so consumers
 *   (useSyncStatus) can react to queue changes via a push callback
 *   instead of polling localStorage every second with setInterval.
 *
 * FIX 2: processQueue() now uses a module-level lock flag to prevent
 *   concurrent invocations.  Previously, if both SyncQueueService and
 *   OfflineSyncService fired on the 'online' event simultaneously, the
 *   same queue items could be written to Firestore twice, creating
 *   duplicate records.
 */

import { ApiService } from './api';
import { SyncLock } from './syncLock';
import { perfMonitor } from '../utils/perfMonitor';

export interface QueueItem {
  id: string;
  userId: string;
  operation: 'create' | 'update' | 'delete';
  collection: string;
  docId?: string;
  data: any;
  timestamp: number;
  priority: 'high' | 'normal' | 'low';
  retries: number;
  maxRetries: number;
  error?: string;
}

const QUEUE_KEY  = 'offline_sync_queue';
const MAX_RETRIES = 3;

// ── Push-subscription registry ────────────────────────────────────────────────
const listeners = new Set<() => void>();
function notify() { listeners.forEach(fn => { try { fn(); } catch {} }); }

// ── Concurrency lock (shared via SyncLock) ────────────────────────────────────

export const SyncQueueService = {

  // FIX 1: subscribe/unsubscribe for push-based queue updates.
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  addToQueue(
    userId: string,
    operation: 'create' | 'update' | 'delete',
    collection: string,
    data: any,
    docId?: string,
    priority: 'high' | 'normal' | 'low' = 'normal',
  ): QueueItem {
    const item: QueueItem = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      operation,
      collection,
      docId,
      data,
      timestamp: Date.now(),
      priority,
      retries: 0,
      maxRetries: MAX_RETRIES,
    };

    const queue = SyncQueueService.getQueue();
    queue.push(item);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    notify();
    return item;
  },

  getQueue(): QueueItem[] {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  getQueueCount(): number {
    return SyncQueueService.getQueue().length;
  },

  getUserQueue(userId: string): QueueItem[] {
    return SyncQueueService.getQueue().filter(item => item.userId === userId);
  },

  // FIX 2: Concurrency lock prevents two callers (e.g. two sync systems or
  // two online-event listeners) from processing the same queue simultaneously
  // and creating duplicate Firestore documents.
  async processQueue(
    userId: string,
    onProgress?: (processed: number, total: number) => void,
  ): Promise<{ success: number; failed: number; errors: Map<string, string> }> {
    const errors = new Map<string, string>();

    if (!SyncLock.acquire()) {
      // Concurrent call — silently skip; the in-progress run will finish.
      return { success: 0, failed: 0, errors };
    }
    let successCount = 0;
    let failedCount  = 0;
    const endRun = perfMonitor.start('sync.run');

    try {
      const queue = SyncQueueService.getUserQueue(userId);
      if (queue.length === 0) return { success: 0, failed: 0, errors };

      const sorted = [...queue].sort((a, b) => {
        const p = { high: 0, normal: 1, low: 2 };
        return (p[a.priority] - p[b.priority]) || (a.timestamp - b.timestamp);
      });

      for (let i = 0; i < sorted.length; i++) {
        const item = sorted[i];
        onProgress?.(i + 1, sorted.length);

        const endItem = perfMonitor.start('sync.item');
        try {
          if (item.operation === 'create') {
            await ApiService.add(userId, item.collection, item.data);
          } else if (item.operation === 'update' && item.docId) {
            await ApiService.update(userId, item.collection, item.docId, item.data);
          } else if (item.operation === 'delete' && item.docId) {
            await ApiService.delete(userId, item.collection, item.docId);
          }
          // Remove the item from localStorage immediately after a successful
          // write — NOT batched at the end — so that if the app is killed
          // mid-loop the already-committed items are never replayed on the
          // next start, which would create duplicate Firestore documents.
          SyncQueueService.removeFromQueue(item.id);
          successCount++;
        } catch (error: any) {
          item.retries++;
          const errorMsg = error?.message || 'Unknown error';

          const current = SyncQueueService.getQueue();
          const qi = current.find(q => q.id === item.id);
          if (qi) {
            qi.retries = item.retries;
            if (qi.retries >= qi.maxRetries) {
              qi.error = errorMsg;
              errors.set(item.id, errorMsg);
              failedCount++;
              // FINAL MODULE — log when an item exhausts its retries so we can
              // spot recurring sync issues (auth scope, schema drift, etc.).
              // Lazy-import to avoid a circular dep through firebase config.
              import('./telemetryService').then(({ TelemetryService }) => {
                TelemetryService.logError(userId, 'sync',
                  `Sync gave up after ${qi.maxRetries} retries: ${errorMsg}`,
                  { collection: item.collection, op: item.operation, docId: item.docId });
              }).catch(() => { /* telemetry must never throw */ });
            }
            localStorage.setItem(QUEUE_KEY, JSON.stringify(current));
          }
        } finally {
          endItem();
        }
      }
    } finally {
      endRun();
      SyncLock.release();
      notify();
    }

    return { success: successCount, failed: failedCount, errors };
  },

  removeFromQueue(itemId: string): void {
    const filtered = SyncQueueService.getQueue().filter(item => item.id !== itemId);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(filtered));
    notify();
  },

  clearQueue(): void {
    localStorage.removeItem(QUEUE_KEY);
    notify();
  },

  clearUserQueue(userId: string): void {
    const filtered = SyncQueueService.getQueue().filter(item => item.userId !== userId);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(filtered));
    notify();
  },

  getFailedItems(userId: string): QueueItem[] {
    return SyncQueueService.getUserQueue(userId).filter(item => item.error);
  },

  async retryFailed(
    userId: string,
    onProgress?: (processed: number, total: number) => void,
  ) {
    const queue = SyncQueueService.getQueue();
    queue
      .filter(item => item.userId === userId && item.error)
      .forEach(item => { item.error = undefined; item.retries = 0; });
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    notify();
    return SyncQueueService.processQueue(userId, onProgress);
  },
};

