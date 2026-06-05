import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore';

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyASml4ZvZb2yuN0ZMyk0Ql4_bjusR-k0zE",
  authDomain: "shopkeeper-1a3fc.firebaseapp.com",
  projectId: "shopkeeper-1a3fc",
  storageBucket: "shopkeeper-1a3fc.firebasestorage.app",
  messagingSenderId: "935080418890",
  appId: "1:935080418890:web:460d2f3e074a8e5ceb10b3"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Firebase Functions — used by PaymentService to call backend Cloud Functions.
// getFunctions() is lazy; safe to import even when functions aren't deployed yet.
export { getFunctions, httpsCallable } from 'firebase/functions';

// ROOT FIX — switched from persistentLocalCache → memoryLocalCache
//
// WHY: persistentLocalCache routes every Firestore write through IndexedDB first.
// On Android WebView under memory pressure this IndexedDB lock can hang
// indefinitely — the Promise from batch.commit() / setDoc() never resolves AND
// never rejects, permanently freezing the "Saving…" button.
//
// WHY IT IS SAFE: This app has its own complete offline stack that is entirely
// independent of Firestore's built-in offline persistence:
//
//   • TanStack Query v5 + idb-keyval (queryPersistStorage.ts)
//       → Caches all business data reads (parties, ledger, inventory, etc.)
//         in the app's own IndexedDB store.  A cold-start while offline
//         serves the full 7-day cached dataset immediately — no Firestore
//         IndexedDB needed.
//
//   • SyncQueueService (syncQueue.ts)
//       → Durable localStorage queue for offline writes.  Every create /
//         update / delete made while offline (or on WRITE_TIMEOUT) is queued
//         and replayed automatically when connectivity returns.
//
//   • useOptimisticMutation + ManualEntryModal
//       → UI reflects writes immediately (optimistic update) regardless of
//         network state.  No Firestore offline write queue required.
//
// With memoryLocalCache, Firestore writes go directly to the network (fast,
// no IndexedDB intermediary) and the 15-second WRITE_TIMEOUT in api.ts
// provides a final safety net for any transient network failure.
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache(),
});
