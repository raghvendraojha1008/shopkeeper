import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentSingleTabManager } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';


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

// Android WebView only supports single tab - multipleTab manager crashes the app
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentSingleTabManager({ forceOwnership: true })
  })
});






