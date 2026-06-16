import React, { useState, useEffect, useRef } from 'react';
import { Lock, Delete, CheckCircle2, KeyRound, ShieldCheck, AlertTriangle, Timer } from 'lucide-react';
import { User } from 'firebase/auth';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor }           from '@capacitor/core';
import ReauthModal from './ReauthModal';

interface LockScreenProps {
  user?: User | null;
  settings?: any;
  settingsLoaded?: boolean;
  onPinChanged?: (newPin: string) => Promise<void>;
}

// ── Storage keys ──────────────────────────────────────────────────────────────
const LS_ON            = 'sk_lock_on';
const LS_PIN           = 'sk_lock_pin';
const SS_AT            = 'sk_unlock_at';
const SS_BG            = 'sk_bg_at';
const LS_LOCKOUT_UNTIL = 'sk_lockout_until';
const LS_LOCKOUT_LEVEL = 'sk_lockout_level';

const GRACE_MS = 30_000;

// Escalating cooldown durations in seconds: 30s → 2 min → 10 min
const LOCKOUT_DURATIONS = [30, 120, 600];

function getInitialLockout(): { until: number; level: number } {
  try {
    const until = Number(localStorage.getItem(LS_LOCKOUT_UNTIL) || '0');
    const level = Number(localStorage.getItem(LS_LOCKOUT_LEVEL) || '0');
    return { until: until > Date.now() ? until : 0, level: Math.max(0, level) };
  } catch { return { until: 0, level: 0 }; }
}

function formatCountdown(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

function getInitialLocked(): boolean {
  try {
    if (localStorage.getItem(LS_ON) !== '1') return false;
    const pin = localStorage.getItem(LS_PIN) || '';
    if (pin.length !== 4) return false;
    const at = sessionStorage.getItem(SS_AT);
    if (at && Date.now() - Number(at) < GRACE_MS) return false;
    return true;
  } catch { return false; }
}

const KeyBtn: React.FC<{ label: string; onPress: (n: string) => void; disabled?: boolean }> = ({ label, onPress, disabled }) => (
  <button
    onClick={() => !disabled && onPress(label)}
    disabled={disabled}
    className="flex items-center justify-center font-black text-white text-[26px] rounded-full active:scale-90 transition-all duration-[120ms] disabled:opacity-40"
    style={{
      width: 76, height: 76,
      background: 'rgba(255,255,255,0.08)',
      border: '1px solid rgba(255,255,255,0.12)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 6px 20px rgba(0,0,0,0.35)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
    }}>
    {label}
  </button>
);

const AuroraGlows = () => (
  <>
    <div className="absolute top-[-12%] left-[-8%] w-[75vw] h-[75vw] rounded-full pointer-events-none"
      style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.2) 0%, transparent 65%)' }} />
    <div className="absolute bottom-[-8%] right-[-12%] w-[60vw] h-[60vw] rounded-full pointer-events-none"
      style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.13) 0%, transparent 65%)' }} />
    <div className="absolute top-[35%] right-[-8%] w-[40vw] h-[40vw] rounded-full pointer-events-none"
      style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 65%)' }} />
  </>
);

function getScreenStyle(isDark: boolean): React.CSSProperties {
  return {
    background: isDark
      ? 'linear-gradient(160deg, #07091e 0%, #0c0820 55%, #060c18 100%)'
      : 'linear-gradient(160deg, #eef2ff 0%, #f0f4ff 55%, #e8f0fe 100%)',
    paddingTop:    'max(28px, env(safe-area-inset-top, 28px))',
    paddingBottom: 'max(24px, env(safe-area-inset-bottom, 24px))',
  };
}

const LockScreen: React.FC<LockScreenProps> = ({ user, settings, settingsLoaded = false, onPinChanged }) => {
  const isDarkMode = settings?.preferences?.dark_mode ?? true;

  const rawSecurity    = settings?.security || {};
  const isEnabled      = rawSecurity?.enabled ?? rawSecurity?.app_lock_enabled ?? rawSecurity?.appLockEnabled ?? false;
  const savedPin       = typeof rawSecurity?.pin === 'string' ? rawSecurity.pin : '';
  const hasValidPin    = savedPin.length === 4;
  const idleTimeoutMin = Number(rawSecurity?.timeout) || 0;

  const [isLocked,      setIsLocked]      = useState(getInitialLocked);
  const [pin,           setPin]           = useState('');
  const [error,         setError]         = useState(false);
  const [shaking,       setShaking]       = useState(false);
  const [successAnim,   setSuccessAnim]   = useState(false);
  const [showReauth,    setShowReauth]    = useState(false);
  const [wrongAttempts, setWrongAttempts] = useState(0);

  // ── Brute-force lockout state ──────────────────────────────────────────────
  const initLockout = getInitialLockout();
  const [lockoutUntil, setLockoutUntil] = useState<number>(initLockout.until);
  const [lockoutLevel, setLockoutLevel] = useState<number>(initLockout.level);
  const [timeLeft,     setTimeLeft]     = useState<number>(
    initLockout.until > Date.now() ? Math.ceil((initLockout.until - Date.now()) / 1000) : 0
  );

  // ── Change-PIN mode state ─────────────────────────────────────────────────
  const [changePinStep,  setChangePinStep]  = useState<'idle' | 'enter' | 'confirm'>('idle');
  const [newPinBuffer,   setNewPinBuffer]   = useState('');
  const [changePinError, setChangePinError] = useState(false);
  const [changePinShake, setChangePinShake] = useState(false);
  const [savingPin,      setSavingPin]      = useState(false);
  const firstNewPinRef = useRef('');

  // ── Sync localStorage ─────────────────────────────────────────────────────
  // Guard on settingsLoaded: without this, the effect runs immediately with
  // DEFAULT_SETTINGS (isEnabled=false) and removes LS_ON/LS_PIN from storage
  // BEFORE real settings arrive, causing the lock to silently clear on cold start.
  useEffect(() => {
    if (!settingsLoaded) return;
    if (isEnabled && hasValidPin) {
      localStorage.setItem(LS_ON,  '1');
      localStorage.setItem(LS_PIN, savedPin);
    } else {
      localStorage.removeItem(LS_ON);
      localStorage.removeItem(LS_PIN);
    }
  }, [isEnabled, hasValidPin, savedPin, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded) return;
    if (!isEnabled || !hasValidPin) return;
    const at = sessionStorage.getItem(SS_AT);
    if (at && Date.now() - Number(at) < GRACE_MS) return;
    setIsLocked(true);
  }, [isEnabled, hasValidPin, settingsLoaded]);

  useEffect(() => {
    const lock = () => { if (isEnabled && hasValidPin) setIsLocked(true); };
    window.addEventListener('lockapp', lock);
    return () => window.removeEventListener('lockapp', lock);
  }, [isEnabled, hasValidPin]);

  useEffect(() => {
    if (!settingsLoaded) return;
    if (!isEnabled) {
      setIsLocked(false); setPin(''); setError(false); setShaking(false);
      sessionStorage.removeItem(SS_AT);
    }
  }, [isEnabled, settingsLoaded]);

  useEffect(() => {
    if (!isEnabled || !hasValidPin || idleTimeoutMin <= 0 || isLocked) return;
    const ms = idleTimeoutMin * 60_000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { sessionStorage.removeItem(SS_AT); setIsLocked(true); }, ms);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const;
    events.forEach(e => document.addEventListener(e, arm, { passive: true }));
    arm();
    return () => { if (timer) clearTimeout(timer); events.forEach(e => document.removeEventListener(e, arm)); };
  }, [isEnabled, hasValidPin, idleTimeoutMin, isLocked]);

  useEffect(() => {
    if (!isEnabled || !hasValidPin) return;
    const onBg = () => sessionStorage.setItem(SS_BG, Date.now().toString());
    const onFg = () => {
      const bg = sessionStorage.getItem(SS_BG);
      if (!bg) return;
      if (Date.now() - Number(bg) >= GRACE_MS) { sessionStorage.removeItem(SS_AT); setIsLocked(true); }
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') onBg(); else onFg(); };
    document.addEventListener('visibilitychange', onVisibility);
    let capHandle: { remove: () => Promise<void> } | null = null;
    if (Capacitor.isNativePlatform()) {
      CapacitorApp.addListener('appStateChange', state => {
        if (!state.isActive) onBg(); else onFg();
      }).then(h => { capHandle = h; }).catch(() => {});
    }
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (capHandle) capHandle.remove().catch(() => {});
    };
  }, [isEnabled, hasValidPin]);

  // ── Countdown timer for brute-force lockout ───────────────────────────────
  useEffect(() => {
    if (lockoutUntil === 0) { setTimeLeft(0); return; }
    const tick = () => {
      const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setTimeLeft(0);
        setLockoutUntil(0);
        localStorage.removeItem(LS_LOCKOUT_UNTIL);
        setWrongAttempts(0);
        setPin('');
      } else {
        setTimeLeft(remaining);
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [lockoutUntil]);

  // ── Unlock flow ───────────────────────────────────────────────────────────
  const vibrate = () => { if (navigator.vibrate) navigator.vibrate(35); };

  const isLockedOut = lockoutUntil > Date.now();

  const handlePress = (num: string) => {
    if (pin.length >= 4 || isLockedOut) return;
    vibrate();
    const next = pin + num;
    setPin(next);
    setError(false);
    if (next.length === 4) checkPin(next);
  };

  const handleBackspace = () => {
    if (!pin.length || isLockedOut) return;
    vibrate();
    setPin(p => p.slice(0, -1));
    setError(false);
  };

  const checkPin = (input: string) => {
    if (isLockedOut) return;
    const expected = savedPin || localStorage.getItem(LS_PIN) || '';
    if (input === expected) {
      setSuccessAnim(true);
      setWrongAttempts(0);
      // Reset lockout level on successful unlock
      setLockoutLevel(0);
      localStorage.removeItem(LS_LOCKOUT_UNTIL);
      localStorage.removeItem(LS_LOCKOUT_LEVEL);
      setTimeout(() => {
        sessionStorage.setItem(SS_AT, Date.now().toString());
        setIsLocked(false); setPin(''); setSuccessAnim(false);
      }, 380);
    } else {
      if (navigator.vibrate) navigator.vibrate([90, 45, 90]);
      setShaking(true); setError(true);
      const newAttempts = wrongAttempts + 1;
      setWrongAttempts(newAttempts);

      // Trigger lockout after 5 consecutive wrong attempts
      if (newAttempts >= 5) {
        const durSecs = LOCKOUT_DURATIONS[Math.min(lockoutLevel, LOCKOUT_DURATIONS.length - 1)];
        const until = Date.now() + durSecs * 1000;
        const nextLevel = Math.min(lockoutLevel + 1, LOCKOUT_DURATIONS.length - 1);
        setLockoutUntil(until);
        setLockoutLevel(nextLevel);
        setTimeLeft(durSecs);
        localStorage.setItem(LS_LOCKOUT_UNTIL, String(until));
        localStorage.setItem(LS_LOCKOUT_LEVEL, String(nextLevel));
        setWrongAttempts(0);
        if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 300]);
      }

      setTimeout(() => { setShaking(false); setPin(''); }, 460);
    }
  };

  // ── Change-PIN flow ───────────────────────────────────────────────────────
  const handleChangePinPress = (num: string) => {
    if (newPinBuffer.length >= 4 || savingPin) return;
    vibrate();
    const next = newPinBuffer + num;
    setNewPinBuffer(next);
    setChangePinError(false);

    if (next.length === 4) {
      if (changePinStep === 'enter') {
        firstNewPinRef.current = next;
        setTimeout(() => {
          setChangePinStep('confirm');
          setNewPinBuffer('');
        }, 220); // brief pause so user sees the 4th dot fill
      } else {
        // Confirm step
        if (next === firstNewPinRef.current) {
          doSaveNewPin(next);
        } else {
          if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
          setChangePinShake(true);
          setChangePinError(true);
          setTimeout(() => {
            setChangePinShake(false);
            setChangePinError(false);
            setNewPinBuffer('');
            setChangePinStep('enter');
            firstNewPinRef.current = '';
          }, 560);
        }
      }
    }
  };

  const handleChangePinBackspace = () => {
    if (!newPinBuffer.length || savingPin) return;
    vibrate();
    setNewPinBuffer(p => p.slice(0, -1));
    setChangePinError(false);
  };

  const doSaveNewPin = async (newPin: string) => {
    setSavingPin(true);
    try {
      await onPinChanged?.(newPin);
      // Also update localStorage immediately so next cold-start uses it
      localStorage.setItem(LS_PIN, newPin);
      sessionStorage.setItem(SS_AT, Date.now().toString());
      setIsLocked(false);
      setChangePinStep('idle');
      setNewPinBuffer('');
      setShowReauth(false);
      setWrongAttempts(0);
      firstNewPinRef.current = '';
    } catch {
      setChangePinError(true);
      setTimeout(() => setChangePinError(false), 1500);
    } finally {
      setSavingPin(false);
    }
  };

  const cancelChangePinMode = () => {
    setChangePinStep('idle');
    setNewPinBuffer('');
    setChangePinError(false);
    setChangePinShake(false);
    firstNewPinRef.current = '';
  };

  if (!isLocked) return null;

  // ── Change-PIN mode render ─────────────────────────────────────────────────
  if (changePinStep !== 'idle') {
    const cpDotColor = changePinError ? '#ef4444' : '#6366f1';
    const cpDotGlow  = changePinError ? 'rgba(239,68,68,0.7)' : 'rgba(99,102,241,0.7)';
    const isEnterStep = changePinStep === 'enter';

    return (
      <div className="lock-screen-root fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden" style={getScreenStyle(isDarkMode)}>
        <AuroraGlows />
        <div className="relative flex flex-col items-center w-full max-w-[320px] px-4 my-auto">

          {/* Icon */}
          <div className="mb-5 relative flex items-center justify-center">
            <div className="absolute w-[110px] h-[110px] rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.22) 0%, transparent 70%)' }} />
            <div className="relative w-[78px] h-[78px] rounded-[26px] flex items-center justify-center"
              style={{
                background: 'linear-gradient(145deg, #6366f1, #4f46e5)',
                boxShadow: '0 18px 44px rgba(99,102,241,0.38), inset 0 1px 0 rgba(255,255,255,0.22)',
              }}>
              {isEnterStep
                ? <KeyRound size={32} className="text-white" strokeWidth={2.5} />
                : <ShieldCheck size={32} className="text-white" strokeWidth={2.5} />}
            </div>
          </div>

          {/* Title */}
          <h2 className="text-[26px] font-black text-white mb-1" style={{ letterSpacing: '-0.045em' }}>
            {isEnterStep ? 'Set New PIN' : 'Confirm PIN'}
          </h2>
          <p className="text-[13px] mb-8" style={{ color: 'rgba(255,255,255,0.32)', fontWeight: 500 }}>
            {isEnterStep ? 'Choose a 4-digit PIN' : 'Re-enter your new PIN to confirm'}
          </p>

          {/* Dots */}
          <div className={`flex gap-5 mb-9 ${changePinShake ? 'animate-[lockshake_0.38s_ease-in-out]' : ''}`}>
            {[0, 1, 2, 3].map(i => (
              <div key={i}
                className="rounded-full transition-all duration-200"
                style={{
                  width: 14, height: 14,
                  background: i < newPinBuffer.length ? cpDotColor : 'rgba(255,255,255,0.14)',
                  transform:  `scale(${i < newPinBuffer.length ? 1.35 : 1})`,
                  boxShadow:  i < newPinBuffer.length && !changePinError ? `0 0 12px ${cpDotGlow}` : 'none',
                }} />
            ))}
          </div>

          {/* Weak PIN warning — shown while typing during enter step */}
          {isEnterStep && newPinBuffer.length >= 2 && (() => {
            const allSame = new Set(newPinBuffer.split('')).size === 1;
            const seqs = ['012','123','234','345','456','567','678','789','987','876','765','654','543','432','321'];
            const isSeq = newPinBuffer.length >= 3 && seqs.some(s => newPinBuffer.startsWith(s));
            if (!allSame && !isSeq) return null;
            return (
              <p className="text-[10px] font-bold mb-3 -mt-3 text-center" style={{ color: '#fbbf24' }}>
                ⚠ {allSame ? 'Avoid repeating the same digit' : 'Avoid sequential digits'}
              </p>
            );
          })()}

          {/* Keypad */}
          <div className="w-full flex flex-col gap-3">
            {[[1,2,3],[4,5,6],[7,8,9]].map(row => (
              <div key={row[0]} className="flex justify-between items-center">
                {row.map(n => <KeyBtn key={n} label={String(n)} onPress={handleChangePinPress} disabled={savingPin} />)}
              </div>
            ))}
            <div className="flex justify-between items-center">
              <div style={{ width: 76, height: 76 }} />
              <KeyBtn label="0" onPress={handleChangePinPress} disabled={savingPin} />
              <button
                onClick={handleChangePinBackspace}
                disabled={savingPin}
                className="flex items-center justify-center rounded-full active:scale-90 transition-all duration-[120ms] disabled:opacity-30"
                style={{ width: 76, height: 76, background: 'rgba(255,255,255,0.04)' }}>
                <Delete size={24} style={{ color: 'rgba(255,255,255,0.45)' }} />
              </button>
            </div>
          </div>

          {/* Status */}
          <div className="h-7 mt-1 flex items-center justify-center">
            {changePinError && !savingPin && (
              <p className="text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: '#ef4444' }}>
                {changePinStep === 'confirm' ? "PINs don't match — try again" : 'Failed to save PIN'}
              </p>
            )}
            {savingPin && (
              <p className="text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: '#6366f1' }}>
                Saving…
              </p>
            )}
          </div>

          {/* Cancel */}
          {!savingPin && (
            <button
              onClick={cancelChangePinMode}
              className="mt-2 text-[12px] font-bold transition-all active:scale-95 py-1"
              style={{ color: 'rgba(148,163,184,0.35)' }}>
              Cancel
            </button>
          )}
        </div>

        <style>{`
          @keyframes lockshake {
            0%,100% { transform: translateX(0)   }
            20%      { transform: translateX(-11px) }
            40%      { transform: translateX(11px)  }
            60%      { transform: translateX(-7px)  }
            80%      { transform: translateX(7px)   }
          }
        `}</style>
      </div>
    );
  }

  // ── Normal unlock render ───────────────────────────────────────────────────
  const dotColor = error ? '#ef4444' : successAnim ? '#10b981' : '#f59e0b';
  const dotGlow  = error ? 'rgba(239,68,68,0.7)' : successAnim ? 'rgba(16,185,129,0.7)' : 'rgba(245,158,11,0.7)';

  return (
    <div className="lock-screen-root fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden" style={getScreenStyle(isDarkMode)}>
      <AuroraGlows />

      <div className="relative flex flex-col items-center w-full max-w-[320px] px-4 my-auto">

        {/* Lock icon */}
        <div className="mb-5 relative flex items-center justify-center">
          <div className="absolute w-[110px] h-[110px] rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.2) 0%, transparent 70%)' }} />
          <div
            className="relative w-[78px] h-[78px] rounded-[26px] flex items-center justify-center"
            style={{
              background: successAnim
                ? 'linear-gradient(145deg, #10b981, #059669)'
                : 'linear-gradient(145deg, #f59e0b, #d97706)',
              boxShadow: successAnim
                ? '0 18px 44px rgba(16,185,129,0.45), inset 0 1px 0 rgba(255,255,255,0.22)'
                : '0 18px 44px rgba(245,158,11,0.38), inset 0 1px 0 rgba(255,255,255,0.22)',
              transition: 'all 0.3s ease',
            }}>
            {successAnim
              ? <CheckCircle2 size={34} className="text-white" />
              : <Lock size={32} className="text-white" strokeWidth={2.5} />}
          </div>
        </div>

        {/* Title */}
        <h2 className="text-[28px] font-black text-white mb-1" style={{ letterSpacing: '-0.045em' }}>
          {successAnim ? 'Unlocked!' : 'Locked'}
        </h2>
        <p className="text-[13px] mb-8" style={{ color: 'rgba(255,255,255,0.32)', fontWeight: 500 }}>
          Enter your 4-digit PIN
        </p>

        {/* PIN dots */}
        <div className={`flex gap-5 mb-9 ${shaking ? 'animate-[lockshake_0.38s_ease-in-out]' : ''}`}>
          {[0, 1, 2, 3].map(i => (
            <div key={i}
              className="rounded-full transition-all duration-200"
              style={{
                width: 14, height: 14,
                background: i < pin.length ? dotColor : 'rgba(255,255,255,0.14)',
                transform:  `scale(${i < pin.length ? 1.35 : 1})`,
                boxShadow:  i < pin.length && !error ? `0 0 12px ${dotGlow}` : 'none',
              }} />
          ))}
        </div>

        {/* Keypad — with lockout overlay */}
        <div className="w-full relative">
          <div className="flex flex-col gap-3">
            {[[1,2,3],[4,5,6],[7,8,9]].map(row => (
              <div key={row[0]} className="flex justify-between items-center">
                {row.map(n => <KeyBtn key={n} label={String(n)} onPress={handlePress} disabled={isLockedOut} />)}
              </div>
            ))}
            <div className="flex justify-between items-center">
              <div style={{ width: 76, height: 76 }} />
              <KeyBtn label="0" onPress={handlePress} disabled={isLockedOut} />
              <button
                onClick={handleBackspace}
                disabled={isLockedOut}
                className="flex items-center justify-center rounded-full active:scale-90 transition-all duration-[120ms] disabled:opacity-30"
                style={{ width: 76, height: 76, background: 'rgba(255,255,255,0.04)' }}>
                <Delete size={24} style={{ color: 'rgba(255,255,255,0.45)' }} />
              </button>
            </div>
          </div>

          {/* ── Lockout overlay ── */}
          {isLockedOut && (
            <div className="absolute inset-0 flex flex-col items-center justify-center rounded-3xl z-20"
              style={{ background: 'rgba(7,9,30,0.92)', backdropFilter: 'blur(12px)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
                style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
                <AlertTriangle size={26} style={{ color: '#f87171' }} />
              </div>
              <p className="text-white font-black text-[15px] mb-0.5 tracking-tight">Too many attempts</p>
              <p className="text-[11px] mb-4" style={{ color: 'rgba(148,163,184,0.55)' }}>
                {lockoutLevel === 1 ? 'Next lockout: 2 min' : lockoutLevel >= 2 ? 'Next lockout: 10 min' : 'Next lockout: 2 min'}
              </p>
              <div className="flex items-center gap-2 px-6 py-3 rounded-2xl"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
                <Timer size={18} style={{ color: '#f87171' }} />
                <span className="text-[28px] font-black tabular-nums" style={{ color: '#fca5a5', letterSpacing: '-0.03em' }}>
                  {formatCountdown(timeLeft)}
                </span>
              </div>
              <p className="text-[10px] mt-3 font-semibold uppercase tracking-widest" style={{ color: 'rgba(148,163,184,0.3)' }}>
                Try again after countdown
              </p>
            </div>
          )}
        </div>

        {/* Error */}
        <div className="h-7 mt-1 flex items-center justify-center">
          {error && !isLockedOut && (
            <p className="text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: '#ef4444' }}>
              {wrongAttempts >= 4 ? `Incorrect PIN — 1 attempt left` : wrongAttempts >= 3 ? `Incorrect PIN — 2 attempts left` : 'Incorrect PIN'}
            </p>
          )}
        </div>

        {/* Forgot PIN — shown only after 2+ wrong attempts */}
        {!isLockedOut && wrongAttempts >= 2 && user?.email && (
          <button
            onClick={() => setShowReauth(true)}
            className="mt-1 text-[12px] font-bold transition-all active:scale-95 py-1"
            style={{ color: 'rgba(96,165,250,0.55)' }}>
            Forgot PIN?
          </button>
        )}

        {showReauth && (
          <ReauthModal
            title="Verify Identity"
            subtitle="Confirm your account to set a new PIN"
            onVerified={() => { setShowReauth(false); setChangePinStep('enter'); setNewPinBuffer(''); }}
            onCancel={() => setShowReauth(false)}
          />
        )}
      </div>

      <style>{`
        @keyframes lockshake {
          0%,100% { transform: translateX(0)   }
          20%      { transform: translateX(-11px) }
          40%      { transform: translateX(11px)  }
          60%      { transform: translateX(-7px)  }
          80%      { transform: translateX(7px)   }
        }
      `}</style>
    </div>
  );
};

export default LockScreen;
