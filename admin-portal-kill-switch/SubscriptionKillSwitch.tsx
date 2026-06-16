/**
 * SubscriptionKillSwitch — Admin Portal Component
 *
 * Lets a super-admin toggle the global subscription system on or off.
 * When switched OFF → sets config/global.appMode = 'free'
 *   → ALL users get full Pro features regardless of subscription.
 * When switched ON  → sets config/global.appMode = 'hybrid'
 *   → Normal subscription checks resume.
 *
 * Password-protected: requires @Vashudev108 before any state change.
 * Password prompt is styled to match the app's lock screen aesthetic.
 *
 * USAGE — drop this component anywhere in the admin portal, e.g.:
 *   import SubscriptionKillSwitch from './SubscriptionKillSwitch';
 *   <SubscriptionKillSwitch db={db} />
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  doc,
  getDoc,
  updateDoc,
  onSnapshot,
  Firestore,
} from 'firebase/firestore';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Props {
  db: Firestore;
}

type Status = 'idle' | 'loading' | 'saving' | 'success' | 'error';

// ── Constants ──────────────────────────────────────────────────────────────────

const KILL_SWITCH_PASSWORD = '@Vashudev108';
const MODE_OFF = 'free';
const MODE_ON  = 'hybrid';
const GLOBAL_CONFIG_REF = (db: Firestore) => doc(db, 'config', 'global');

// ── Inline styles (no Tailwind dependency) ────────────────────────────────────

const S = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    background: 'rgba(0,0,0,0.85)',
    backdropFilter: 'blur(18px)',
  },
  screen: {
    background: 'linear-gradient(160deg, #07091e 0%, #0c0820 55%, #060c18 100%)',
    borderRadius: 28,
    padding: '36px 28px 32px',
    width: '100%',
    maxWidth: 380,
    position: 'relative' as const,
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.07)',
    boxShadow: '0 32px 80px rgba(0,0,0,0.9)',
  },
  // Aurora glow blobs
  aurora1: {
    position: 'absolute' as const,
    top: -60, left: -60, width: 220, height: 220,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(99,102,241,0.18) 0%, transparent 70%)',
    pointerEvents: 'none' as const,
  },
  aurora2: {
    position: 'absolute' as const,
    bottom: -40, right: -40, width: 180, height: 180,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(139,92,246,0.14) 0%, transparent 70%)',
    pointerEvents: 'none' as const,
  },
  iconWrap: {
    width: 72, height: 72, borderRadius: 22,
    background: 'linear-gradient(145deg, #6366f1, #4f46e5)',
    boxShadow: '0 16px 40px rgba(99,102,241,0.38), inset 0 1px 0 rgba(255,255,255,0.22)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    marginBottom: 18, marginLeft: 'auto', marginRight: 'auto',
    fontSize: 30,
  },
  title: {
    fontWeight: 900, fontSize: 22, color: '#fff',
    textAlign: 'center' as const, marginBottom: 4,
    letterSpacing: '-0.04em',
  },
  subtitle: {
    fontSize: 13, color: 'rgba(255,255,255,0.32)',
    textAlign: 'center' as const, fontWeight: 500,
    marginBottom: 22, lineHeight: 1.5,
  },
  label: {
    fontSize: 10, fontWeight: 700, color: 'rgba(148,163,184,0.55)',
    letterSpacing: '0.14em', textTransform: 'uppercase' as const,
    display: 'block', marginBottom: 7,
  },
  inputWrap: { position: 'relative' as const, marginBottom: 6 },
  input: {
    width: '100%',
    padding: '13px 44px 13px 16px',
    borderRadius: 14,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.06)',
    color: '#fff',
    fontSize: 15,
    outline: 'none',
    boxSizing: 'border-box' as const,
    fontWeight: 600,
    letterSpacing: '0.08em',
  },
  inputError: {
    border: '1px solid rgba(239,68,68,0.5)',
  },
  eyeBtn: {
    position: 'absolute' as const,
    right: 12, top: '50%', transform: 'translateY(-50%)',
    background: 'none', border: 'none',
    color: 'rgba(148,163,184,0.5)', cursor: 'pointer',
    fontSize: 13, fontWeight: 600, padding: 0,
  },
  errMsg: {
    fontSize: 12, color: '#f87171', fontWeight: 700,
    marginBottom: 14, textAlign: 'center' as const,
  },
  btnRow: { display: 'flex', gap: 10, marginTop: 18 },
  btnCancel: {
    flex: 1, padding: '13px 0', borderRadius: 14,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.07)',
    color: 'rgba(226,232,240,0.7)',
    fontWeight: 800, fontSize: 14, cursor: 'pointer',
  },
  btnConfirmDisable: {
    flex: 1, padding: '13px 0', borderRadius: 14, border: 'none',
    background: 'linear-gradient(135deg, #ef4444, #dc2626)',
    boxShadow: '0 8px 24px rgba(239,68,68,0.35)',
    color: '#fff', fontWeight: 900, fontSize: 14, cursor: 'pointer',
  },
  btnConfirmEnable: {
    flex: 1, padding: '13px 0', borderRadius: 14, border: 'none',
    background: 'linear-gradient(135deg, #22c55e, #16a34a)',
    boxShadow: '0 8px 24px rgba(34,197,94,0.32)',
    color: '#fff', fontWeight: 900, fontSize: 14, cursor: 'pointer',
  },
};

// ── Component ──────────────────────────────────────────────────────────────────

const SubscriptionKillSwitch: React.FC<Props> = ({ db }) => {
  const [appMode,     setAppMode]     = useState<string>('hybrid');
  const [status,      setStatus]      = useState<Status>('loading');
  const [errorMsg,    setErrorMsg]    = useState('');
  const [showPrompt,  setShowPrompt]  = useState(false);
  const [password,    setPassword]    = useState('');
  const [pwError,     setPwError]     = useState('');
  const [pendingMode, setPendingMode] = useState<string | null>(null);
  const [showPw,      setShowPw]      = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Real-time listener ───────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(
      GLOBAL_CONFIG_REF(db),
      (snap) => {
        if (snap.exists()) setAppMode(snap.data().appMode ?? 'hybrid');
        setStatus('idle');
      },
      (err) => { setErrorMsg('Failed to read config: ' + err.message); setStatus('error'); },
    );
    return unsub;
  }, [db]);

  useEffect(() => {
    if (showPrompt) setTimeout(() => inputRef.current?.focus(), 80);
  }, [showPrompt]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const requestToggle = () => {
    if (status === 'saving') return;
    setPendingMode(appMode === MODE_OFF ? MODE_ON : MODE_OFF);
    setPassword(''); setPwError(''); setShowPrompt(true);
  };

  const confirmToggle = async () => {
    if (password !== KILL_SWITCH_PASSWORD) {
      setPwError('Incorrect password — try again');
      setPassword('');
      inputRef.current?.focus();
      return;
    }
    if (!pendingMode) return;
    setShowPrompt(false); setStatus('saving'); setErrorMsg('');
    try {
      await updateDoc(GLOBAL_CONFIG_REF(db), { appMode: pendingMode });
      setStatus('success');
      setTimeout(() => setStatus('idle'), 2500);
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Failed to update config.');
      setStatus('error');
    }
  };

  const cancelPrompt = () => {
    setShowPrompt(false); setPendingMode(null); setPassword(''); setPwError('');
  };

  // ── Derived ──────────────────────────────────────────────────────────────
  const isOff     = appMode === MODE_OFF;
  const isLoading = status === 'loading';
  const isSaving  = status === 'saving';

  // ── Card ──────────────────────────────────────────────────────────────────
  return (
    <>
      <div style={{
        background: isOff
          ? 'linear-gradient(135deg, #fef3c7, #fde68a)'
          : 'linear-gradient(135deg, #dcfce7, #bbf7d0)',
        border: isOff ? '2px solid #f59e0b' : '2px solid #22c55e',
        borderRadius: 16, padding: '20px 24px', maxWidth: 480,
        position: 'relative', fontFamily: 'inherit',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{
            width: 14, height: 14, borderRadius: '50%',
            background: isOff ? '#f59e0b' : '#22c55e',
            boxShadow: isOff ? '0 0 0 4px rgba(245,158,11,0.2)' : '0 0 0 4px rgba(34,197,94,0.2)',
            flexShrink: 0,
          }} />
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 900, fontSize: 15, color: '#111', margin: 0 }}>
              Subscription System Kill Switch
            </p>
            <p style={{ fontSize: 12, color: '#555', margin: '2px 0 0' }}>
              {isOff
                ? '⚠️ KILL SWITCH ON — All users have full free access'
                : '✅ Subscription system active — normal checks apply'}
            </p>
          </div>
        </div>

        <div style={{
          display: 'inline-block',
          background: isOff ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)',
          border: isOff ? '1px solid rgba(245,158,11,0.5)' : '1px solid rgba(34,197,94,0.5)',
          borderRadius: 999, padding: '3px 12px',
          fontSize: 11, fontWeight: 700,
          color: isOff ? '#92400e' : '#15803d', marginBottom: 16,
        }}>
          {isLoading ? 'Loading…' : isOff ? 'SUBSCRIPTIONS DISABLED' : 'SUBSCRIPTIONS ENABLED'}
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.55)', borderRadius: 10,
          padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#444', lineHeight: 1.6,
        }}>
          {isOff ? (
            <><strong>Kill switch is ON.</strong> <code style={{ fontSize: 11 }}>config/global.appMode</code> = <code style={{ fontSize: 11 }}>"free"</code>.<br />
              All users get full Pro access. The Subscription section is hidden in app Settings.</>
          ) : (
            <><strong>Subscription system is active.</strong> <code style={{ fontSize: 11 }}>config/global.appMode</code> = <code style={{ fontSize: 11 }}>"hybrid"</code>.<br />
              Free users see paywalls. Kill switch grants everyone instant full access.</>
          )}
        </div>

        {errorMsg && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#dc2626', marginBottom: 12 }}>
            {errorMsg}
          </div>
        )}
        {status === 'success' && (
          <div style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#15803d', marginBottom: 12, fontWeight: 600 }}>
            ✓ Config updated — changes applied to all users in real-time.
          </div>
        )}

        <button
          onClick={requestToggle}
          disabled={isLoading || isSaving}
          style={{
            width: '100%', padding: '12px 20px', borderRadius: 10, border: 'none',
            background: isOff ? 'linear-gradient(135deg,#22c55e,#16a34a)' : 'linear-gradient(135deg,#ef4444,#dc2626)',
            color: '#fff', fontWeight: 800, fontSize: 14,
            cursor: isLoading || isSaving ? 'not-allowed' : 'pointer',
            opacity: isLoading || isSaving ? 0.6 : 1, transition: 'all 0.15s',
          }}
        >
          {isSaving ? 'Saving…' : isOff ? '✅ Re-enable Subscription System' : '⛔ Disable Subscription System (Kill Switch)'}
        </button>
        <p style={{ fontSize: 10, color: '#888', textAlign: 'center', marginTop: 8, marginBottom: 0 }}>
          Password required · Changes apply globally in real-time
        </p>
      </div>

      {/* ── Lock-screen style password modal ─────────────────────────────── */}
      {showPrompt && (
        <div style={S.overlay} onClick={e => e.target === e.currentTarget && cancelPrompt()}>
          <div style={S.screen}>
            {/* Aurora glows */}
            <div style={S.aurora1} />
            <div style={S.aurora2} />

            {/* Icon */}
            <div style={S.iconWrap}>
              {pendingMode === MODE_OFF ? '⛔' : '✅'}
            </div>

            {/* Title */}
            <p style={S.title}>Admin Confirm</p>
            <p style={S.subtitle}>
              {pendingMode === MODE_OFF
                ? 'This disables the subscription system.\nAll users get free Pro access immediately.'
                : 'This re-enables the subscription system.\nPaywalls will return for Free users.'}
            </p>

            {/* Password field */}
            <label style={S.label}>Admin Password</label>
            <div style={S.inputWrap}>
              <input
                ref={inputRef}
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setPwError(''); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') confirmToggle();
                  if (e.key === 'Escape') cancelPrompt();
                }}
                placeholder="Enter admin password"
                style={{ ...S.input, ...(pwError ? S.inputError : {}) }}
              />
              <button type="button" onClick={() => setShowPw(v => !v)} style={S.eyeBtn}>
                {showPw ? 'Hide' : 'Show'}
              </button>
            </div>

            {pwError && <p style={S.errMsg}>⚠ {pwError}</p>}

            <div style={S.btnRow}>
              <button onClick={cancelPrompt} style={S.btnCancel}>Cancel</button>
              <button
                onClick={confirmToggle}
                style={pendingMode === MODE_OFF ? S.btnConfirmDisable : S.btnConfirmEnable}>
                {pendingMode === MODE_OFF ? 'Disable' : 'Enable'}
              </button>
            </div>

            <p style={{ fontSize: 10, color: 'rgba(148,163,184,0.25)', textAlign: 'center', marginTop: 16, marginBottom: 0 }}>
              Password required · Shopkeeper Admin
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default SubscriptionKillSwitch;
