---
name: SyncQueue pending-forever fix
description: SyncQueue only re-syncs on offline→online event; entries stay "pending" forever if the device was online-but-slow when the write timed out.
---

## The Problem
`SyncQueueService` retries queued writes when `useSyncStatus` detects an `online` event (network reconnect). If the device was **already online** (just slow/congested) when `WRITE_TIMEOUT` fired, the online event never fires again — entries sit in the queue as "pending" indefinitely, even after the network recovers.

## The Fix
After `SyncQueueService.addToQueue(...)` in the WRITE_TIMEOUT catch block, immediately schedule a background processQueue attempt:
```typescript
setTimeout(() => {
  SyncQueueService.processQueue(user.uid).catch(() => {});
}, 1000);
```
`processQueue` uses a `SyncLock` internally — concurrent calls are safe; the second call silently no-ops if a sync is already running.

The 1-second delay gives the network a brief breathing room before retrying during the same congestion window.

## Context
- Firebase uses `memoryLocalCache()` — writes go directly to network (no local IndexedDB persistence). When offline or slow, `batch.commit()` hangs until `withWriteTimeout` fires.
- `WRITE_TIMEOUT_MS` was increased from 15 s → 60 s to reduce false positives on slow-but-functional networks.
- `SyncQueueService.processQueue(userId)` is the correct public method to trigger an immediate sync attempt.

**Why:** The online-event-only retry was designed for true offline→online transitions. It doesn't cover the "online but temporarily congested" case, which is the common failure mode on this Android device.
