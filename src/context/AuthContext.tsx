import React, { createContext, useContext, useEffect, useState } from 'react';
import { GoogleTokenService } from '../services/googleTokenService';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
  signOut,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  User,
} from 'firebase/auth';
import { auth, db } from '../config/firebase';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';

const FIREBASE_HOSTING_URL = 'https://shopkeeper-1a3fc.firebaseapp.com';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  sendVerificationEmail: () => Promise<void>;
  reloadUser: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);
export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser]       = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAndCreateUser = async (u: User) => {
    try {
      const userRef  = doc(db, 'users', u.uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        // New user — write full profile. Admin panel Users page reads these fields.
        await setDoc(userRef, {
          email:       u.email,
          displayName: u.displayName || 'User',
          photoURL:    u.photoURL    || null,
          role:        'shopkeeper',
          createdAt:   Timestamp.now(),
          updatedAt:   Timestamp.now(),
        });
      } else {
        // Existing user — keep email/displayName/photoURL in sync (can change after OAuth re-auth)
        await setDoc(userRef, {
          email:       u.email,
          displayName: u.displayName || userSnap.data().displayName || 'User',
          photoURL:    u.photoURL    || userSnap.data().photoURL || null,
          updatedAt:   Timestamp.now(),
        }, { merge: true });
      }
    } catch (e) { console.warn('checkAndCreateUser:', e); }
  };

  const loginWithGoogle = async () => {
    if (Capacitor.isNativePlatform()) {
      let googleUser: any;
      try {
        const mod = await import('@codetrix-studio/capacitor-google-auth');
        const GoogleAuth = mod.GoogleAuth ?? (mod as any).default?.GoogleAuth ?? (mod as any).default;
        if (!GoogleAuth || typeof GoogleAuth.signIn !== 'function') {
          throw new Error('GoogleAuth plugin not initialized. See setup instructions.');
        }
        if (typeof GoogleAuth.initialize === 'function') {
          await GoogleAuth.initialize();
        }
        // Force account picker every time by signing out first
        try { await GoogleAuth.signOut(); } catch (_) {}
        googleUser = await GoogleAuth.signIn();
      } catch (pluginErr: any) {
        const msg: string = String(pluginErr?.message || pluginErr?.code || '');
        const cancelCodes = ['12501', 'SIGN_IN_CANCELLED', 'popup_closed_by_user'];
        if (cancelCodes.some(c => msg.includes(c))) return;
        const friendlyMsg = msg.includes('plugin') || msg.includes('not initialized')
          ? 'Google Sign-In not configured. Check setup instructions.'
          : msg.includes('network') || msg.includes('Network')
          ? 'Network error. Check your connection and try again.'
          : 'Google Sign-In failed: ' + (msg || 'Unknown error');
        throw new Error(friendlyMsg);
      }
      const idToken = googleUser?.authentication?.idToken;
      if (!idToken) {
        throw new Error('Google Sign-In returned no ID token. Check SHA-1 fingerprint in Firebase Console.');
      }
      try {
        const credential = GoogleAuthProvider.credential(idToken);
        const result      = await signInWithCredential(auth, credential);
        checkAndCreateUser(result.user).catch(e => console.warn('checkAndCreateUser:', e));
      } catch (firebaseErr: any) {
        if (firebaseErr.code === 'auth/account-exists-with-different-credential') {
          throw new Error('An account already exists with this email using a different sign-in method.');
        }
        throw firebaseErr;
      }
    } else {
      try {
        const provider = new GoogleAuthProvider();
        provider.addScope('https://www.googleapis.com/auth/drive.file');
        provider.addScope('https://www.googleapis.com/auth/contacts.readonly');
        provider.setCustomParameters({ prompt: 'select_account' });
        const result = await signInWithPopup(auth, provider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (credential?.accessToken) {
          GoogleTokenService.set(credential.accessToken, 3600, [
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/contacts.readonly',
          ]);
        }
        checkAndCreateUser(result.user).catch(e => console.warn('checkAndCreateUser:', e));
      } catch (error: any) {
        if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') return;
        if (error.code === 'auth/unauthorized-domain') throw new Error('Domain not authorized. Add it in Firebase Console → Auth → Authorized domains.');
        if (error.code === 'auth/popup-blocked') throw new Error('Popup blocked. Allow popups for this site and try again.');
        throw error;
      }
    }
  };

  const sendVerificationEmail = async () => {
    const cu = auth.currentUser;
    if (!cu) throw new Error('No signed-in user');
    try {
      await sendEmailVerification(cu, { url: FIREBASE_HOSTING_URL, handleCodeInApp: false });
    } catch (primaryErr: any) {
      const urlCodes = ['auth/unauthorized-continue-uri','auth/missing-continue-uri','auth/invalid-continue-uri','auth/argument-error'];
      if (urlCodes.includes(primaryErr?.code)) {
        await sendEmailVerification(cu);
      } else {
        throw primaryErr;
      }
    }
  };

  const reloadUser = async () => {
    if (auth.currentUser) {
      await auth.currentUser.reload();
      setUser({ ...auth.currentUser } as any);
    }
  };

  const sendPasswordReset = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email, { url: FIREBASE_HOSTING_URL, handleCodeInApp: false });
    } catch (err: any) {
      const urlCodes = ['auth/unauthorized-continue-uri','auth/missing-continue-uri','auth/invalid-continue-uri'];
      if (urlCodes.includes(err?.code)) {
        await sendPasswordResetEmail(auth, email);
      } else {
        throw err;
      }
    }
  };

  const logout = () => {
    // Clear active firm so user always returns to own account on next login
    localStorage.removeItem('active_firm_uid');
    GoogleTokenService.clear();
    return signOut(auth);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, loginWithGoogle, logout, sendVerificationEmail, reloadUser, sendPasswordReset }}>
      {children}
    </AuthContext.Provider>
  );
};





