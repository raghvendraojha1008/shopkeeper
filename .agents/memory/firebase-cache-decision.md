---
name: Firebase cache mode — persistentLocalCache with forceOwnership
description: Why the app uses persistentLocalCache+forceOwnership instead of memoryLocalCache, and the failure modes of each.
---

## Current setting (correct)
```typescript
localCache: persistentLocalCache({
  tabManager: persistentSingleTabManager({ forceOwnership: true }),
})
```

## Why NOT memoryLocalCache
`memoryLocalCache` sends every write directly to the network. If the network is unavailable or slow for even a moment, `batch.commit()` hangs until `withWriteTimeout` fires. This puts entries in the SyncQueue. The SyncQueue only retries on offline→online event — if the device was already "online but slow", sync never retries and entries are stuck as "pending" forever. This happened repeatedly in production.

## Why persistentLocalCache + forceOwnership: true
- Writes land in local IndexedDB in < 100 ms regardless of network state.
- Firestore SDK queues network sync internally and retries automatically.
- `forceOwnership: true` forces the tab to claim the IndexedDB lock immediately, preventing the "previous crashed WebView session left lock unreleased" hang. This was the original bug that caused the switch to memoryLocalCache. It was a lock-release bug, not an IndexedDB fundamental issue.
- `persistentSingleTabManager` is correct for Capacitor Android WebView — always exactly one WebView instance.

## withWriteTimeout after this change
`withWriteTimeout` is kept at 8 s as a safety net for genuine IndexedDB corruption or quota exceeded. With persistentLocalCache it should NEVER fire under normal conditions. If it does fire, the SyncQueue catches it as before.

## DO NOT switch back to memoryLocalCache
The "pendingSync forever" issue is the direct consequence of memoryLocalCache. If a future developer sees IndexedDB issues, the correct fix is to increase `forceOwnership` protection or clear the IndexedDB store — not to switch to memoryLocalCache.
