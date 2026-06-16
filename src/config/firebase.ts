import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
} from 'firebase/firestore';

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

export { getFunctions, httpsCallable } from 'firebase/functions';

// OFFLINE-FIRST: persistentLocalCache + persistentSingleTabManager
//
// Every write goes to IndexedDB first (< 100 ms) and resolves immediately,
// regardless of network state. Firestore then syncs to the server in the
// background. If the device is offline, writes queue inside the Firestore SDK
// and are replayed the moment connectivity returns — no custom SyncQueue needed
// for writes.
//
// forceOwnership: true — forces the tab to claim the IndexedDB lock immediately.
// Without this, a previous crashed/killed WebView session that didn't release
// its lock causes the new session to hang waiting. On Android this is the root
// cause of the "IndexedDB hang" that originally triggered the switch to
// memoryLocalCache. With forceOwnership we avoid that hang without giving up
// offline persistence.
//
// Single-tab manager is correct for Capacitor / Android WebView — there is
// always exactly one WebView instance and never multiple concurrent browser tabs.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentSingleTabManager({ forceOwnership: true }),
  }),
});
