---
name: Offline duplicate write fix
description: Root causes of duplicate records when saving offline and how they were fixed with idempotent pre-generated IDs.
---

# Offline Duplicate Write Fix

## Root Causes

### 1. ManualEntryModal — Firestore SDK + SyncQueueService double-write
ManualEntryModal.handleSubmit always called ApiService.batchSave() regardless of online state.
When offline, Firestore SDK (memoryLocalCache) queued the write in its own in-memory pending buffer.
After 15 s WRITE_TIMEOUT fired and the same ops were also added to SyncQueueService.
When connectivity returned: both the SDK's internal flush AND SyncQueueService.processQueue() wrote → duplicate.

### 2. POSBillingView — WRITE_TIMEOUT showed error instead of queuing safely
On Android WebView navigator.onLine stays true even when offline. So isOffline = false and
ApiService.add() was called. On WRITE_TIMEOUT the catch only rolled back and showed an error.
If the user retried, a second write was initiated → both completed on reconnect → duplicate.

### 3. Two separate queue storage keys
SyncQueueService → 'offline_sync_queue' in localStorage.
OfflineSyncService → 'osync_queue_v3' in localStorage.
Both use SyncLock but they're separate queues. Items in both drain sequentially, so if the
same record ever ended up in both (via different code paths), it was written twice.

## Fix — Idempotent writes via pre-generated document IDs

**Why it works**: SyncQueueService calls setDocById → setDoc(doc(db, path, id), data).
If the Firestore SDK's in-memory write already resolved the same document, the second setDoc
is a same-ID overwrite of identical data — not a new document. One record ever exists.

### src/services/api.ts
- Added generateDocId() exported helper (20-char Firestore-compatible random ID, pure client-side).
- Added ApiService.setDocById(uid, col, id, data) — uses setDoc to a specific document ID, idempotent.
- Modified ApiService.batchSave: if op.id is supplied for an 'add' op, uses setDoc(doc(db, path, op.id)).

### src/services/syncQueue.ts — processQueue
For operation === 'create' with a docId present: calls ApiService.setDocById instead of ApiService.add.
Without docId: falls back to ApiService.add (backward-compatible with old queue items).

### src/components/modals/ManualEntryModal.tsx — handleSubmit
1. Pre-generates client-side IDs (generateDocId()) for every 'add' batchOp BEFORE writing.
2. Adds !navigator.onLine fast-path: skips Firestore entirely, queues to SyncQueueService with pre-generated IDs.
3. WRITE_TIMEOUT fallback queues to SyncQueueService with the SAME pre-generated IDs → idempotent.

### src/components/views/POSBillingView.tsx — persist()
1. Pre-generates ledgerDocId = generateDocId() before any write.
2. Offline: SyncQueueService.addToQueue(..., ledgerDocId).
3. Online: ApiService.setDocById(..., ledgerDocId, payload) instead of ApiService.add.
4. WRITE_TIMEOUT in online path: falls back to SyncQueueService with SAME ID — no duplicate.
   Shows "Saving in background" (not an error). No data loss on flaky network.
