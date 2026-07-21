import React, { useState } from 'react';
import { Shield, Eye, EyeOff, X, AlertCircle, LogOut } from 'lucide-react';
import {
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  EmailAuthProvider,
  GoogleAuthProvider,
} from 'firebase/auth';
import { useAuth } from '../../context/AuthContext';

interface ReauthModalProps {
  onVerified: () => void;
  onCancel: () => void;
  title?: string;
  subtitle?: string;
}

const ReauthModal: React.FC<ReauthModalProps> = ({
  onVerified,
  onCancel,
  title = 'Verify Your Identity',
  subtitle = 'Confirm your account to reset the PIN',
}) => {
  const { user, logout } = useAuth();
  const [password, setPassword]             = useState('');
  const [showPw, setShowPw]                 = useState(false);
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState('');
  const [showSignOutFallback, setShowSignOutFallback] = useState(false);

  const isGoogle = user?.providerData?.some(p => p.providerId === 'google.com');

  const handleEmail = async () => {
    if (!user?.email || !password.trim()) return;
    setLoading(true);
    setError('');
    try {
      const cred = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, cred);
      onVerified();
    } catch (e: any) {
      setError(
        e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential'
          ? 'Incorrect password. Try again.'
          : 'Verification failed. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    setShowSignOutFallback(false);
    try {
      const provider = new GoogleAuthProvider();
      await reauthenticateWithPopup(user, provider);
      onVerified();
    } catch (e: any) {
      if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') {
        // User dismissed — no error to show
      } else if (
        e.code === 'auth/web-storage-unsupported' ||
        e.code === 'auth/popup-blocked' ||
        e.code === 'auth/internal-error' ||
        (typeof e.message === 'string' && (
          e.message.includes('missing-initial-state') ||
          e.message.includes('missing_initial_state') ||
          e.message.includes('sessionStorage')
        ))
      ) {
        setError(
          'Your browser blocked the Google sign-in popup (storage restrictions). ' +
          'Sign out below and sign back in to verify your identity, then try again.'
        );
        setShowSignOutFallback(true);
      } else {
        setError('Google verification failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    onCancel();
  };

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-5"
      style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(16px)' }}
    >
      <div
        className="w-full max-w-[320px] rounded-[28px] p-6 flex flex-col"
        style={{
          background: 'var(--modal-bg)',
          border: '1px solid var(--glass-border)',
          boxShadow: '0 24px 64px var(--rgba-black-70)',
        }}
      >
        <div className="flex justify-between items-start mb-5">
          <div
            className="w-12 h-12 rounded-[16px] flex items-center justify-center flex-shrink-0"
            style={{
              background: 'linear-gradient(145deg,#6366f1,#8b5cf6)',
              boxShadow: '0 8px 24px var(--col-accent-40)',
            }}
          >
            <Shield size={22} className="text-white" />
          </div>
          <button
            onClick={onCancel}
            className="p-2 rounded-full"
            style={{ background: 'var(--rgba-white-07)' }}
          >
            <X size={16} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        <h2 className="text-lg font-black mb-1" style={{ letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>
          {title}
        </h2>
        <p className="text-xs mb-5" style={{ color:  'var(--rgba-white-35)' }}>
          {subtitle}
        </p>

        {isGoogle ? (
          <div className="flex flex-col gap-3">
            <button
              onClick={handleGoogle}
              disabled={loading}
              className="w-full py-3.5 rounded-[16px] flex items-center justify-center gap-3 font-black text-sm text-white active:scale-95 transition-all disabled:opacity-60"
              style={{ background:  'var(--rgba-white-09)', border: '1px solid var(--glass-border)' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="var(--col-google-blue)" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="var(--col-google-green)" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="var(--col-google-yellow)" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                <path fill="var(--col-google-red)" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              {loading ? 'Verifying…' : 'Verify with Google'}
            </button>

            {error && (
              <div
                className="flex flex-col gap-2 px-3 py-2.5 rounded-xl"
                style={{ background: 'var(--col-danger-15)', border: '1px solid var(--col-danger-25)' }}
              >
                <div className="flex items-start gap-2">
                  <AlertCircle size={13} style={{ color: "var(--col-danger)", flexShrink: 0, marginTop: 1 }} />
                  <p className="text-app-md font-semibold leading-relaxed" style={{ color: "var(--col-danger)" }}>{error}</p>
                </div>

                {showSignOutFallback && (
                  <button
                    onClick={handleSignOut}
                    className="w-full mt-1 py-2.5 rounded-[12px] flex items-center justify-center gap-2 font-black text-app-lg active:scale-95 transition-all"
                    style={{ background: 'var(--col-danger-18)', color: "var(--col-danger)", border: '1px solid var(--col-danger-35)' }}
                  >
                    <LogOut size={13} />
                    Sign Out &amp; Re-authenticate
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="relative mb-3">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleEmail()}
                placeholder="Your account password"
                autoFocus
                className="w-full px-4 py-3.5 rounded-[14px] text-sm font-semibold outline-none pr-12"
                style={{
                  background: 'var(--rgba-white-07)',
                  border: `1px solid ${error ? 'var(--col-danger-50)' :  'var(--rgba-white-12)'}`,
                  color: 'var(--text-primary)',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
              >
                {showPw
                  ? <EyeOff size={16} style={{ color: 'var(--text-muted)' }} />
                  : <Eye size={16} style={{ color: 'var(--text-muted)' }} />}
              </button>
            </div>

            {error && (
              <div
                className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl"
                style={{ background: 'var(--col-danger-15)', border: '1px solid var(--col-danger-25)' }}
              >
                <AlertCircle size={13} style={{ color: "var(--col-danger)", flexShrink: 0 }} />
                <p className="text-app-md font-semibold" style={{ color: "var(--col-danger)" }}>{error}</p>
              </div>
            )}

            <button
              onClick={handleEmail}
              disabled={loading || !password.trim()}
              className="w-full py-3.5 rounded-[16px] font-black text-sm text-white active:scale-95 transition-all disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg,#4f46e5,#7c3aed)',
                boxShadow: '0 4px 16px var(--col-indigo-40)',
              }}
            >
              {loading ? 'Verifying…' : 'Verify & Reset PIN'}
            </button>
          </>
        )}

        <button
          onClick={onCancel}
          className="mt-4 text-xs font-bold text-center"
          style={{ color: 'var(--text-muted)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default ReauthModal;
