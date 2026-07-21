import React, { useState, useEffect } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { auth, db } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import {
  ShieldCheck, LogIn, UserPlus, AlertCircle, Loader2, Mail,
  Users, Lock, CheckCircle, LinkIcon, KeyRound, ArrowLeft,
  MailCheck, RefreshCw, Eye, EyeOff,
} from 'lucide-react';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';

/* ─── tiny reusable glass input ─────────────────────────────────────────── */
const GlassInput: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { icon: React.FC<any> }> = ({ icon: Icon, ...props }) => (
  <div className="relative">
    <Icon className="absolute left-3.5 top-3.5 pointer-events-none" size={15} style={{ color: 'var(--col-violet-70)' }} />
    <input
      {...props}
      className="w-full pl-10 pr-4 py-3.5 text-sm font-bold outline-none placeholder-indigo-300/40 text-white rounded-[18px] transition-all"
      style={{ background: 'var(--rgba-white-07)', border: '1px solid var(--glass-border)' }}
    />
  </div>
);

/* ─── password input with eye toggle ──────────────────────────────────────── */
const PasswordInput: React.FC<{
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  icon?: React.FC<any>;
}> = ({ placeholder = 'Password', value, onChange, autoComplete, icon: Icon = Lock }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Icon className="absolute left-3.5 top-3.5 pointer-events-none" size={15} style={{ color: 'var(--col-violet-70)' }} />
      <input
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="w-full pl-10 pr-10 py-3.5 text-sm font-bold outline-none placeholder-indigo-300/40 text-white rounded-[18px] transition-all"
        style={{ background: 'var(--rgba-white-07)', border: '1px solid var(--glass-border)' }}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-all active:scale-90"
        style={{ color: 'var(--col-violet-50)' }}
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
};

/* ─── aurora background ──────────────────────────────────────────────────── */
const Aurora = () => (
  <div className="absolute inset-0 pointer-events-none">
    <div className="absolute top-[-10%] left-[-5%] w-[90vw] h-[90vw] rounded-full opacity-25"
      style={{ background: 'radial-gradient(circle, var(--col-accent-70) 0%, transparent 60%)' }} />
    <div className="absolute top-[40%] right-[-15%] w-[60vw] h-[60vw] rounded-full opacity-20"
      style={{ background: 'radial-gradient(circle, var(--col-violet-85) 0%, transparent 65%)' }} />
    <div className="absolute bottom-[10%] left-[-5%] w-[50vw] h-[50vw] rounded-full opacity-15"
      style={{ background: 'radial-gradient(circle, var(--col-info-60) 0%, transparent 65%)' }} />
    <div className="absolute inset-0 opacity-[0.04]"
      style={{ backgroundImage: 'linear-gradient(var(--rgba-white-50) 1px,transparent 1px),linear-gradient(90deg,var(--rgba-white-50) 1px,transparent 1px)', backgroundSize: '48px 48px' }} />
  </div>
);

/* ─── logo mark ──────────────────────────────────────────────────────────── */
const LogoMark = () => (
  <div className="relative inline-block mb-5">
    <div className="absolute -inset-3 rounded-[40px] opacity-50"
      style={{ background: 'radial-gradient(circle, rgba(99,102,241,1), transparent)' }} />
    <div className="relative w-[88px] h-[88px] rounded-[30px] flex items-center justify-center"
      style={{ background: 'linear-gradient(145deg, #4f46e5, #7c3aed)', boxShadow: '0 20px 50px var(--col-indigo-55), inset 0 1px 0 var(--rgba-white-25)', border: '1px solid var(--glass-border)' }}>
      <ShieldCheck size={40} className="text-white" strokeWidth={1.5} />
    </div>
    <div className="absolute -top-2 -right-2 w-7 h-7 rounded-full flex items-center justify-center"
      style={{ background: 'linear-gradient(135deg,#f59e0b,#ef4444)', boxShadow: '0 4px 12px var(--col-warning-50)', border: '2px solid #07091a' }}>
      <span className="text-app-sm font-black text-white">✦</span>
    </div>
  </div>
);

/* ─── error banner ───────────────────────────────────────────────────────── */
const ErrorBanner: React.FC<{ msg: string }> = ({ msg }) => (
  <div className="w-full mb-4 px-4 py-3 rounded-[16px] flex items-center gap-2"
    style={{ background: 'var(--col-danger-15)', border: '1px solid var(--col-danger-35)' }}>
    <AlertCircle size={15} style={{ color: "var(--col-danger-light)", flexShrink: 0 }} />
    <span className="text-app-xl font-bold" style={{ color: "var(--col-danger-light)" }}>{msg}</span>
  </div>
);

/* ─── success banner ─────────────────────────────────────────────────────── */
const SuccessBanner: React.FC<{ msg: string }> = ({ msg }) => (
  <div className="w-full mb-4 px-4 py-3 rounded-[16px] flex items-center gap-2"
    style={{ background: 'var(--col-emerald-15)', border: '1px solid var(--col-emerald-35)' }}>
    <CheckCircle size={15} style={{ color: "var(--col-success-light)", flexShrink: 0 }} />
    <span className="text-app-xl font-bold" style={{ color: "var(--col-success-light)" }}>{msg}</span>
  </div>
);

/* ═══════════════════════════════════════════════════════════════════════════
   FORGOT PASSWORD SCREEN
═══════════════════════════════════════════════════════════════════════════ */
const ForgotPasswordScreen: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { sendPasswordReset } = useAuth();
  const [email, setEmail]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [sent, setSent]         = useState(false);
  const [error, setError]       = useState('');

  const handleSubmit = async () => {
    if (!email.trim()) { setError('Please enter your email address.'); return; }
    setLoading(true); setError('');
    try {
      await sendPasswordReset(email.trim());
      setSent(true);
    } catch (e: any) {
      if (e.code === 'auth/user-not-found') {
        setError('No account found with this email.');
      } else {
        setError('Failed to send reset email. Please try again.');
      }
    } finally { setLoading(false); }
  };

  return (
    <div className="login-view-root auth-page-bg flex flex-col relative overflow-hidden" style={{ minHeight: '100dvh' }}>
      <Aurora />
      <div className="relative flex flex-col items-center justify-center flex-1 px-6 py-12">
        <button onClick={onBack} className="self-start mb-6 flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--col-violet-70)' }}>
          <ArrowLeft size={16} /> Back to Sign In
        </button>

        <div className="mb-8 text-center">
          <div className="w-20 h-20 rounded-[28px] flex items-center justify-center mx-auto mb-4"
            style={{ background: 'var(--col-accent-15)', border: '1px solid var(--col-accent-35)' }}>
            <KeyRound size={36} style={{ color: "var(--col-indigo)" }} />
          </div>
          <h1 className="text-2xl font-black text-white mb-1">Forgot Password?</h1>
          <p className="text-sm font-medium" style={{ color: 'var(--col-violet-60)' }}>
            We'll send a reset link to your email
          </p>
        </div>

        {error && <ErrorBanner msg={error} />}
        {sent && <SuccessBanner msg={`Reset link sent to ${email}. Check your inbox (and spam folder).`} />}

        {!sent ? (
          <div className="w-full rounded-[28px] p-5 space-y-3"
            style={{ background: 'var(--rgba-white-06)', border: '1px solid var(--glass-border)', backdropFilter: 'blur(8px)' }}>
            <GlassInput
              icon={Mail} type="email" placeholder="Your email address"
              value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
            <button
              onClick={handleSubmit} disabled={loading}
              className="w-full py-3.5 text-white font-black text-sm rounded-[18px] flex items-center justify-center gap-2.5 transition-all active:scale-[0.97] disabled:opacity-60 mt-1"
              style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', boxShadow: '0 8px 24px var(--col-indigo-45)' }}>
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Mail size={17} />}
              Send Reset Link
            </button>
          </div>
        ) : (
          <div className="w-full text-center space-y-4">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
              style={{ background: 'var(--col-emerald-15)', border: '1px solid var(--col-emerald-35)' }}>
              <MailCheck size={28} style={{ color: "var(--col-success)" }} />
            </div>
            <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
              Didn't receive it? Check spam, or{' '}
              <button onClick={() => setSent(false)} className="font-black underline" style={{ color: "var(--col-indigo)" }}>
                try again
              </button>
            </p>
            <button onClick={onBack} className="w-full py-3 rounded-[18px] text-sm font-bold"
              style={{ background: 'var(--rgba-white-07)', border: '1px solid var(--glass-border)', color:   'var(--rgba-white-70)' }}>
              Back to Sign In
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   EMAIL VERIFICATION BANNER  (shown inside app when email not verified)
═══════════════════════════════════════════════════════════════════════════ */
// ── Persistence helpers for email-verify banner frequency control ──────────
const VERIFY_PREFIX         = 'evb_';   // email verify banner
const DISMISS_COUNT_KEY     = (uid: string) => `${VERIFY_PREFIX}${uid}_dc`;
const LAST_SHOWN_KEY        = (uid: string) => `${VERIFY_PREFIX}${uid}_ls`;
const MAX_DISMISSALS        = 3;
const SHOW_INTERVAL_MS      = 7 * 24 * 60 * 60 * 1000; // 1 week

function shouldShowBanner(uid: string): boolean {
  const count = parseInt(localStorage.getItem(DISMISS_COUNT_KEY(uid)) ?? '0', 10);
  if (count >= MAX_DISMISSALS) return false;
  const lastShown = parseInt(localStorage.getItem(LAST_SHOWN_KEY(uid)) ?? '0', 10);
  return Date.now() - lastShown >= SHOW_INTERVAL_MS;
}

function recordBannerShown(uid: string) {
  localStorage.setItem(LAST_SHOWN_KEY(uid), String(Date.now()));
}

function recordBannerDismissed(uid: string) {
  const count = parseInt(localStorage.getItem(DISMISS_COUNT_KEY(uid)) ?? '0', 10);
  localStorage.setItem(DISMISS_COUNT_KEY(uid), String(count + 1));
}
// ────────────────────────────────────────────────────────────────────────────

export const EmailVerificationBanner: React.FC = () => {
  const { user, sendVerificationEmail, reloadUser, logout } = useAuth();
  const [sending, setSending]       = useState(false);
  const [checking, setChecking]     = useState(false);
  const [sent, setSent]             = useState(false);
  const [verified, setVerified]     = useState(false);
  const [error, setError]           = useState('');
  const [dismissed, setDismissed]   = useState(false);

  const isEmailProvider = user?.providerData?.some(p => p.providerId === 'password');

  // Decide once on mount (or when user changes) whether the banner is allowed to show
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    if (!user?.uid || !isEmailProvider || user.emailVerified) return;
    if (shouldShowBanner(user.uid)) {
      setAllowed(true);
      recordBannerShown(user.uid);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // Poll every 5 s — auto-dismiss once Firebase confirms verification
  useEffect(() => {
    if (!user || user.emailVerified) return;
    const interval = setInterval(async () => {
      try {
        await reloadUser();
        if (auth.currentUser?.emailVerified) { setVerified(true); clearInterval(interval); }
      } catch (_) {}
    }, 5000);
    return () => clearInterval(interval);
  }, [user]);

  // Don't show for Google / already-verified accounts, or when frequency rules suppress it
  if (!user || user.emailVerified || verified || !isEmailProvider || dismissed || !allowed) return null;

  const handleResend = async () => {
    setSending(true); setError(''); setSent(false);
    try {
      await sendVerificationEmail();
      setSent(true);
      setTimeout(() => setSent(false), 5000);
    } catch (e: any) {
      setError(e.code === 'auth/too-many-requests'
        ? 'Too many requests. Wait a few minutes.'
        : 'Failed to send. Please try again.');
    } finally { setSending(false); }
  };

  /** Manual "I already clicked the link" check */
  const handleCheckStatus = async () => {
    setChecking(true); setError('');
    try {
      await reloadUser();
      if (auth.currentUser?.emailVerified) {
        setVerified(true);   // banner will hide
      } else {
        setError('Not verified yet. Click the link in your email first.');
        setTimeout(() => setError(''), 4000);
      }
    } catch (_) {
      setError('Check failed. Try again.');
      setTimeout(() => setError(''), 3000);
    } finally { setChecking(false); }
  };

  return (
    <div className="w-full z-50 px-3 pt-2 pb-1"
      style={{ background: 'rgba(var(--app-bg-rgb),0.97)', borderBottom: '1px solid var(--col-warning-35)', boxSizing: 'border-box', overflow: 'hidden' }}>
      <div className="flex items-center gap-2 p-2.5 rounded-2xl"
        style={{ background: 'var(--col-warning-15)', border: '1px solid var(--col-warning-25)' }}>
        <MailCheck size={13} style={{ color: "var(--col-warning)", flexShrink: 0 }} />
        <div className="flex-1 min-w-0 overflow-hidden">
          <p className="text-app-md font-black truncate" style={{ color: "var(--col-warning)" }}>
            Verify your email to continue
          </p>
          {error && <p className="text-app-sm text-red-400 font-bold truncate">{error}</p>}
          {sent && <p className="text-app-sm text-emerald-400 font-bold">✓ Email sent!</p>}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Check Status — lets user confirm after clicking their email link */}
          <button onClick={handleCheckStatus} disabled={checking || sending}
            className="flex items-center gap-1 px-2 py-1 rounded-xl text-app-sm font-black transition-all active:scale-90"
            style={{ background: 'var(--col-emerald-25)', color: "var(--col-success)", border: '1px solid var(--col-emerald-35)' }}>
            {checking ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle size={10} />}
            {checking ? '…' : 'Done?'}
          </button>
          {/* Resend */}
          <button onClick={handleResend} disabled={sending || checking}
            className="flex items-center gap-1 px-2 py-1 rounded-xl text-app-sm font-black transition-all active:scale-90"
            style={{ background: 'var(--col-warning-25)', color: "var(--col-warning)", border: '1px solid var(--col-warning-35)' }}>
            {sending ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            {sending ? '…' : 'Resend'}
          </button>
          <button
            onClick={() => {
              if (user?.uid) recordBannerDismissed(user.uid);
              setDismissed(true);
            }}
            className="text-app-md font-bold px-1.5 py-1"
            style={{ color: 'var(--text-muted)' }}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN LOGIN VIEW
═══════════════════════════════════════════════════════════════════════════ */
const LoginView = () => {
  const { loginWithGoogle, sendVerificationEmail } = useAuth();
  const [isLogin, setIsLogin]               = useState(true);
  const [email, setEmail]                   = useState('');
  const [password, setPassword]             = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError]                   = useState('');
  const [successMsg, setSuccessMsg]         = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [invitationDetails, setInvitationDetails] = useState<{
    invitedEmail: string; invitedBy: string; firmName: string
  } | null>(null);
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [showForgot, setShowForgot]         = useState(false);
  // After signup: show "verify your email" screen
  const [showVerifyScreen, setShowVerifyScreen] = useState(false);
  const [verifyResending, setVerifyResending]   = useState(false);
  const [verifyResent, setVerifyResent]         = useState(false);

  useEffect(() => {
    const hashSearch = window.location.hash.includes('?')
      ? new URLSearchParams(window.location.hash.split('?')[1]) : null;
    const params = hashSearch || new URLSearchParams(window.location.search);
    const code = params.get('invite');
    if (code) { setInvitationCode(code); validateInvitation(code); }
  }, []);

  const validateInvitation = async (code: string) => {
    try {
      const inviteRef  = doc(db, 'invitations', code);
      const inviteSnap = await getDoc(inviteRef);
      if (!inviteSnap.exists()) { setError('Invalid or expired invitation link.'); return; }
      const data = inviteSnap.data();
      if (data.status === 'accepted') { setError('This invitation has already been used.'); return; }
      if (data.expires_at && new Date(data.expires_at) < new Date()) { setError('This invitation has expired.'); return; }
      setInvitationDetails({
        invitedEmail: data.email,
        invitedBy:   data.invited_by_name || 'Admin',
        firmName:    data.firm_name || 'Your Firm',
      });
      setEmail(data.email);
    } catch { setError('Error validating invitation. Please try again.'); }
  };

  const handleGoogle = async () => {
    try {
      setIsGoogleLoading(true); setError('');
      await loginWithGoogle();
    } catch (err: any) {
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        setError(err.message || 'Google Sign-In failed.');
      }
    } finally { setIsGoogleLoading(false); }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setError('Please fill all fields'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }

    try {
      setIsEmailLoading(true); setError('');
      const userCred = await createUserWithEmailAndPassword(auth, email, password);
      const role = invitationDetails ? 'staff' : 'admin';

      const roleDocData: any = {
        user_id: userCred.user.uid, email, role,
        created_at: new Date().toISOString(),
      };
      if (role === 'staff' && invitationCode) {
        const inviteSnap = await getDoc(doc(db, 'invitations', invitationCode));
        if (inviteSnap.exists()) roleDocData.admin_uid = inviteSnap.data().created_by;
      }
      await setDoc(doc(db, 'user_roles', userCred.user.uid), roleDocData);
      await setDoc(doc(db, 'users', userCred.user.uid), {
        email, displayName: email.split('@')[0],
        createdAt: new Date().toISOString(), role,
      }, { merge: true });

      if (invitationCode) {
        await updateDoc(doc(db, 'invitations', invitationCode), {
          status: 'accepted', accepted_at: new Date().toISOString(),
        });
      }

      // Send verification email
      try { await sendVerificationEmail(); } catch (verifyErr) { console.error('Verification email error:', verifyErr); }

      // Show verify screen instead of staying on login
      setShowVerifyScreen(true);
      setEmail(''); setPassword(''); setConfirmPassword(''); setInvitationCode(''); setInvitationDetails(null);
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') setError('Account already exists. Please login.');
      else if (err.code === 'auth/weak-password') setError('Password should be at least 6 characters.');
      else setError('Registration failed. Please try again.');
    } finally { setIsEmailLoading(false); }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setError('Please fill all fields'); return; }
    try {
      setIsEmailLoading(true); setError('');
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      if (['auth/invalid-credential','auth/user-not-found','auth/wrong-password'].includes(err.code)) {
        setError('Invalid email or password.');
      } else { setError('Authentication failed. Please try again.'); }
    } finally { setIsEmailLoading(false); }
  };

  // ── Screens ────────────────────────────────────────────────────────────────
  if (showForgot) return <ForgotPasswordScreen onBack={() => setShowForgot(false)} />;

  if (showVerifyScreen) return (
    <div className="login-view-root auth-page-bg flex flex-col relative overflow-hidden" style={{ minHeight: '100dvh' }}>
      <Aurora />
      <div className="relative flex flex-col items-center justify-center flex-1 px-6 py-12">
        <div className="w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6"
          style={{ background: 'var(--col-emerald-15)', border: '2px solid var(--col-emerald-35)' }}>
          <MailCheck size={40} style={{ color: "var(--col-success)" }} />
        </div>
        <h2 className="text-2xl font-black text-white mb-2 text-center">Check your email</h2>
        <p className="text-sm font-semibold text-center mb-8" style={{ color: 'var(--text-muted)' }}>
          We sent a verification link to your email address. Click the link to activate your account.
        </p>

        {verifyResent && <SuccessBanner msg="Verification email re-sent! Check your inbox." />}

        <div className="w-full rounded-[24px] p-5 space-y-3"
          style={{ background: 'var(--rgba-white-05)', border: '1px solid var(--glass-border)', backdropFilter: 'blur(8px)' }}>
          <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--rgba-white-04)' }}>
            <CheckCircle size={16} style={{ color: "var(--col-success)" }} />
            <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
              Account created! Click the link in your email, then tap the button below.
            </p>
          </div>

          {/* Primary CTA: "I've clicked the link — check my status" */}
          <button
            onClick={async () => {
              setVerifyResending(true); setVerifyResent(false);
              try {
                const { reload } = await import('firebase/auth');
                if (auth.currentUser) {
                  await reload(auth.currentUser);
                  if (auth.currentUser.emailVerified) {
                    // Verified! Go straight to Sign In so onAuthStateChanged picks it up
                    setShowVerifyScreen(false); setIsLogin(true);
                    return;
                  }
                }
                setVerifyResent(false);
                // Not verified yet — show feedback
                alert("Not verified yet. Please click the link in your email first.");
              } catch { /* ignore */ }
              setVerifyResending(false);
            }}
            disabled={verifyResending}
            className="w-full py-3.5 rounded-[18px] text-sm font-black flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #10b981, #059669)', color: 'white', boxShadow: '0 6px 20px var(--col-emerald-35)' }}>
            {verifyResending ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
            I've Verified — Continue
          </button>

          {/* Resend */}
          <button
            onClick={async () => {
              setVerifyResending(true); setVerifyResent(false);
              try { await sendVerificationEmail(); setVerifyResent(true); } catch {}
              setVerifyResending(false);
            }}
            disabled={verifyResending}
            className="w-full py-3 rounded-[18px] text-sm font-black flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-60"
            style={{ background: 'var(--col-accent-25)', color: "var(--col-violet)", border: '1px solid var(--col-accent-35)' }}>
            {verifyResending ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Resend Verification Email
          </button>
          <button
            onClick={() => { setShowVerifyScreen(false); setIsLogin(true); }}
            className="w-full py-3 rounded-[18px] text-sm font-black flex items-center justify-center gap-2"
            style={{ background: 'var(--rgba-white-07)', color:   'var(--rgba-white-60)', border: '1px solid var(--glass-border)' }}>
            <LogIn size={16} /> Back to Sign In
          </button>
        </div>
      </div>
    </div>
  );

  if (invitationDetails) return (
    <div className="login-view-root auth-page-bg flex flex-col relative overflow-hidden" style={{ minHeight: '100dvh' }}>
      <Aurora />
      <div className="relative flex flex-col items-center justify-center flex-1 px-6 py-12 overflow-y-auto">
        <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mb-6">
          <LinkIcon size={40} className="text-emerald-600" />
        </div>
      <h1 className="text-2xl font-black text-[var(--text-secondary)] mb-2">You're Invited!</h1>
      <p className="text-slate-500 mb-8 text-sm font-medium text-center max-w-sm">
        {invitationDetails.invitedBy} has invited you to join {invitationDetails.firmName} as a Staff Member
      </p>
      <div className="w-full bg-emerald-50 border border-emerald-200 p-4 rounded-2xl mb-6">
        <div className="flex items-center gap-3 mb-3">
          <CheckCircle size={20} className="text-emerald-600" />
          <p className="text-sm font-bold text-[var(--text-primary)]">Signing up as Staff</p>
        </div>
        <p className="text-xs text-slate-600 ml-7 leading-relaxed">
          You'll have access to Dashboard, Inventory (read-only), Parties, and Sales. Admin manages your permissions.
        </p>
      </div>
      {error && <ErrorBanner msg={error} />}
      <form onSubmit={handleCreateAccount} className="w-full space-y-3 mb-6">
        <div className="relative">
          <Mail className="absolute left-3 top-3.5 text-slate-400" size={18} />
          <input type="email" placeholder="Email Address"
            className="w-full bg-[var(--rgba-white-05)] border border-white/12 rounded-xl p-3 pl-10 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500 transition-all text-[var(--text-secondary)]"
            value={email} disabled />
        </div>
        <PasswordInput
          placeholder="Create Password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          icon={ShieldCheck}
        />
        <PasswordInput
          placeholder="Confirm Password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
          icon={CheckCircle}
        />
        <button type="submit" disabled={isEmailLoading}
          className="w-full bg-emerald-600 text-white py-3.5 rounded-xl font-bold text-sm shadow-lg shadow-emerald-200 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-70">
          {isEmailLoading ? <Loader2 className="animate-spin" /> : <CheckCircle size={20} />}
          Accept Invitation & Create Account
        </button>
      </form>
      </div>
    </div>
  );

  // ── Main login/register ────────────────────────────────────────────────────
  return (
    <div className="login-view-root auth-page-bg flex flex-col relative overflow-hidden" style={{ minHeight: '100dvh' }}>
      <Aurora />
      <div className="relative flex flex-col items-center justify-center flex-1 px-6 py-12">
        <div className="mb-10 text-center">
          <LogoMark />
          <h1 className="text-app-d4 font-black text-white tracking-tight mb-1" style={{ letterSpacing: '-0.04em' }}>
            {isLogin ? 'Welcome back' : 'Get started'}
          </h1>
          <p className="text-sm font-medium" style={{ color: 'var(--col-violet-70)' }}>
            {isLogin ? 'Sign in to your ledger' : invitationCode ? 'Complete your registration' : 'Create your business account'}
          </p>
        </div>

        {error && <ErrorBanner msg={error} />}
        {successMsg && <SuccessBanner msg={successMsg} />}

        <form onSubmit={isLogin ? handleLogin : handleCreateAccount} className="w-full rounded-[28px] p-5 mb-4 space-y-3"
          style={{ background: 'var(--rgba-white-06)', border: '1px solid var(--glass-border)', backdropFilter: 'blur(8px)', boxShadow: '0 16px 48px var(--rgba-black-40), inset 0 1px 0 var(--rgba-white-10)' }}>
          <GlassInput icon={Mail} type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
          <PasswordInput
            placeholder="Password"
            value={password}
            onChange={setPassword}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
          />
          {!isLogin && (
            <PasswordInput
              placeholder="Confirm password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              icon={CheckCircle}
            />
          )}

          {isLogin && (
            <div className="flex justify-end -mt-1">
              <button type="button" onClick={() => { setShowForgot(true); setError(''); }}
                className="text-app-md font-bold transition-colors"
                style={{ color: 'var(--col-violet-70)' }}>
                Forgot password?
              </button>
            </div>
          )}

          <button type="submit"
            disabled={isEmailLoading || isGoogleLoading}
            className="w-full py-3.5 text-white font-black text-sm rounded-[18px] flex items-center justify-center gap-2.5 transition-all active:scale-[0.97] disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', boxShadow: '0 8px 24px var(--col-indigo-45)', marginTop: '4px' }}>
            {isEmailLoading ? <Loader2 size={18} className="animate-spin" /> : (isLogin ? <LogIn size={17} /> : <UserPlus size={17} />)}
            {isLogin ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="relative w-full mb-4 flex items-center gap-3">
          <div className="flex-1 h-px" style={{ background: 'var(--rgba-white-08)' }} />
          <span className="text-app-sm uppercase tracking-[0.2em] font-bold" style={{ color: 'var(--col-violet-50)' }}>or</span>
          <div className="flex-1 h-px" style={{ background: 'var(--rgba-white-08)' }} />
        </div>

        <button onClick={handleGoogle} disabled={isGoogleLoading || isEmailLoading}
          className="w-full py-3.5 rounded-[20px] font-bold text-sm flex items-center justify-center gap-3 transition-all active:scale-[0.97] disabled:opacity-60"
          style={{ background: 'var(--rgba-white-08)', border: '1px solid var(--glass-border)', backdropFilter: 'blur(8px)', color:  'var(--rgba-white-85)' }}>
          {isGoogleLoading ? <Loader2 size={18} className="animate-spin" style={{ color: 'var(--col-accent-70)' }} /> : (
            <svg width="20" height="20" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
              <path fill="var(--col-google-red)" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="var(--col-google-blue)" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="var(--col-google-yellow)" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="var(--col-google-green)" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
          )}
          Continue with Google
        </button>

        <p className="text-center mt-6 text-sm" style={{ color: 'var(--col-violet-60)' }}>
          {isLogin ? "New here?" : "Have an account?"}
          <button onClick={() => { setIsLogin(!isLogin); setError(''); setSuccessMsg(''); setPassword(''); setConfirmPassword(''); }}
            className="ml-2 font-black transition-colors" style={{ color: 'var(--col-violet-15)' }}>
            {isLogin ? 'Create account' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
};

export default LoginView;







