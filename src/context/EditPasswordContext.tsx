import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react';
import { BackStack } from '../services/backStack';
import { Lock, Delete, X, Trash2 } from 'lucide-react';
import { useAuth } from './AuthContext';
import { useUI } from './UIContext';
import ReauthModal from '../components/common/ReauthModal';

interface EditPasswordContextType {
  requireEditPassword: (action?: 'edit' | 'delete') => Promise<boolean>;
  setEditPasswordSettings: (settings: { enabled: boolean; password: string }) => void;
}

const EditPasswordContext = createContext<EditPasswordContextType>({
  requireEditPassword: async () => true,
  setEditPasswordSettings: () => {},
});

export const useEditPassword = () => useContext(EditPasswordContext);

interface ModalState {
  visible: boolean;
  resolve: ((ok: boolean) => void) | null;
}

interface DeleteConfirmState {
  visible: boolean;
  resolve: ((ok: boolean) => void) | null;
}

export const EditPasswordProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { showToast } = useUI();
  const settingsRef = useRef<{ enabled: boolean; password: string }>({
    enabled: true,
    password: '1234',
  });

  const [modal, setModal] = useState<ModalState>({ visible: false, resolve: null });
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [showReauth, setShowReauth] = useState(false);
  const [wrongAttempts, setWrongAttempts] = useState(0);

  // ── New-PIN setup after re-auth ──────────────────────────────────────────
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [newPinSetup, setNewPinSetup] = useState('');
  const [newPinSetupConfirm, setNewPinSetupConfirm] = useState('');
  const [pinSetupError, setPinSetupError] = useState('');
  const pendingResolveRef = useRef<((ok: boolean) => void) | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>({ visible: false, resolve: null });

  const setEditPasswordSettings = useCallback((s: { enabled: boolean; password: string }) => {
    settingsRef.current = s;
  }, []);

  const requireEditPassword = useCallback((action: 'edit' | 'delete' = 'edit'): Promise<boolean> => {
    const { enabled, password } = settingsRef.current;

    // Password disabled:
    // - For edits: allow immediately
    // - For deletes: show a simple "Are you sure?" confirmation
    if (!enabled) {
      if (action === 'delete') {
        return new Promise((resolve) => {
          setDeleteConfirm({ visible: true, resolve });
        });
      }
      return Promise.resolve(true);
    }

    // Password enabled: show the PIN modal
    return new Promise((resolve) => {
      setPin('');
      setError(false);
      setShaking(false);
      setWrongAttempts(0);
      setModal({ visible: true, resolve });
    });
  }, []);

  const handleInput = (digit: string) => {
    if (pin.length >= 4) return;
    const next = pin + digit;
    setPin(next);
    setError(false);

    if (next.length === 4) {
      const stored = settingsRef.current.password || '1234';
      if (next === stored) {
        setWrongAttempts(0);
        setModal({ visible: false, resolve: null });
        modal.resolve?.(true);
      } else {
        if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
        setShaking(true);
        setError(true);
        setWrongAttempts(n => n + 1);
        setTimeout(() => { setShaking(false); setPin(''); }, 500);
      }
    }
  };

  const handleBackspace = () => {
    setPin(p => p.slice(0, -1));
    setError(false);
  };

  const handleCancel = () => {
    const res = modal.resolve;
    setModal({ visible: false, resolve: null });
    setPin('');
    setError(false);
    setShowReauth(false);
    setWrongAttempts(0);
    res?.(false);
  };

  // Register with central BackStack while the PIN modal is visible
  useEffect(() => {
    if (!modal.visible) return;
    const MODAL_ID = 'edit-password-modal';
    BackStack.register(MODAL_ID, handleCancel, 50);
    return () => BackStack.unregister(MODAL_ID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal.visible]);

  const handleReauthVerified = () => {
    // Save the pending resolve so we can call it after the new PIN is set
    pendingResolveRef.current = modal.resolve;
    setShowReauth(false);
    setPin('');
    setError(false);
    setNewPinSetup('');
    setNewPinSetupConfirm('');
    setPinSetupError('');
    setShowPinSetup(true);   // show inline "Set New PIN" UI
  };

  const handleConfirmNewPin = () => {
    if (newPinSetup.length !== 4 || !/^\d{4}$/.test(newPinSetup)) {
      setPinSetupError('PIN must be exactly 4 digits.');
      return;
    }
    if (newPinSetup !== newPinSetupConfirm) {
      setPinSetupError('PINs do not match. Try again.');
      return;
    }
    settingsRef.current = { ...settingsRef.current, password: newPinSetup };
    showToast('Data PIN updated successfully.', 'success');
    setShowPinSetup(false);
    setNewPinSetup('');
    setNewPinSetupConfirm('');
    setPinSetupError('');
    setWrongAttempts(0);
    const resolve = pendingResolveRef.current;
    pendingResolveRef.current = null;
    setModal({ visible: false, resolve: null });
    resolve?.(true);
  };

  const handleDeleteConfirm = () => {
    const res = deleteConfirm.resolve;
    setDeleteConfirm({ visible: false, resolve: null });
    res?.(true);
  };

  const handleDeleteCancel = () => {
    const res = deleteConfirm.resolve;
    setDeleteConfirm({ visible: false, resolve: null });
    res?.(false);
  };

  return (
    <EditPasswordContext.Provider value={{ requireEditPassword, setEditPasswordSettings }}>
      {children}

      {/* PIN Password Modal */}
      {modal.visible && (
        <div
          className="edit-password-root fixed inset-0 z-[9990] flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(12px)' }}
        >
          <div
            className="w-full max-w-[320px] rounded-[28px] p-6 flex flex-col items-center"
            style={{
              background: 'linear-gradient(160deg, #0f1230 0%, #0a0f28 100%)',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
            }}
          >
            <button
              onClick={handleCancel}
              className="self-end p-2 rounded-full active:scale-95 transition-all mb-2"
              style={{ background: 'rgba(255,255,255,0.07)' }}
            >
              <X size={16} style={{ color: 'rgba(148,163,184,0.6)' }} />
            </button>

            <div
              className="w-16 h-16 rounded-[22px] flex items-center justify-center mb-4"
              style={{
                background: 'linear-gradient(145deg,#6366f1,#8b5cf6)',
                boxShadow: '0 12px 32px rgba(99,102,241,0.4)',
              }}
            >
              <Lock size={28} className="text-white" />
            </div>

            <h2 className="text-xl font-black text-white mb-1" style={{ letterSpacing: '-0.03em' }}>
              Data Password
            </h2>
            <p className="text-xs mb-8" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Enter password to edit or delete
            </p>

            <div className={`flex gap-4 mb-8 ${shaking ? 'animate-[shake_0.3s_ease-in-out]' : ''}`}>
              {[0, 1, 2, 3].map(i => (
                <div
                  key={i}
                  className="w-4 h-4 rounded-full transition-all duration-200"
                  style={{
                    background:
                      i < pin.length
                        ? error
                          ? '#ef4444'
                          : '#6366f1'
                        : 'rgba(255,255,255,0.15)',
                    transform: i < pin.length ? 'scale(1.25)' : 'scale(1)',
                    boxShadow: i < pin.length && !error ? '0 0 10px rgba(99,102,241,0.7)' : 'none',
                  }}
                />
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3 w-full mb-3">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                <button
                  key={num}
                  onClick={() => handleInput(num.toString())}
                  className="aspect-square rounded-[18px] font-black text-white text-xl flex items-center justify-center active:scale-90 transition-all"
                  style={{
                    background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.09)',
                  }}
                >
                  {num}
                </button>
              ))}
              <div />
              <button
                onClick={() => handleInput('0')}
                className="aspect-square rounded-[18px] font-black text-white text-xl flex items-center justify-center active:scale-90 transition-all"
                style={{
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.09)',
                }}
              >
                0
              </button>
              <button
                onClick={handleBackspace}
                className="aspect-square rounded-[18px] flex items-center justify-center active:scale-90 transition-all"
                style={{ background: 'transparent' }}
              >
                <Delete size={22} style={{ color: 'rgba(255,255,255,0.35)' }} />
              </button>
            </div>

            <div className="h-6 flex items-center justify-center">
              {error && (
                <p
                  className="text-[11px] font-black uppercase tracking-[0.15em] animate-pulse"
                  style={{ color: '#ef4444' }}
                >
                  Wrong Password
                </p>
              )}
            </div>

            {/* Forgot Password — shown only after 2+ wrong attempts */}
            {wrongAttempts >= 2 && user?.email && (
              <button
                onClick={() => setShowReauth(true)}
                className="mt-1 text-[11px] font-bold active:scale-95 transition-all"
                style={{ color: 'rgba(96,165,250,0.65)' }}
              >
                Forgot Password?
              </button>
            )}

            {showReauth && (
              <ReauthModal
                title="Verify Identity"
                subtitle="Confirm your account to set a new data PIN"
                onVerified={handleReauthVerified}
                onCancel={() => setShowReauth(false)}
              />
            )}

            {/* ── New PIN setup (shown after successful re-auth) ─────────── */}
            {showPinSetup && (
              <div className="w-full mt-2 animate-in slide-in-from-bottom-4 duration-200">
                <p className="text-base font-black text-white mb-1 text-center">Set New Data PIN</p>
                <p className="text-[10px] text-center mb-4" style={{ color: 'rgba(148,163,184,0.5)' }}>
                  Choose a 4-digit PIN for editing &amp; deleting entries
                </p>

                {/* New PIN field */}
                <label className="block text-[10px] font-bold uppercase tracking-wider mb-1"
                  style={{ color: 'rgba(148,163,184,0.55)' }}>New PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="••••"
                  value={newPinSetup}
                  onChange={e => { setNewPinSetup(e.target.value.replace(/\D/g,'')); setPinSetupError(''); }}
                  className="w-full text-center text-2xl font-black tracking-[1rem] py-3 rounded-[14px] mb-3 outline-none bg-transparent"
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', letterSpacing: '0.8rem' }}
                />

                {/* Confirm PIN field */}
                <label className="block text-[10px] font-bold uppercase tracking-wider mb-1"
                  style={{ color: 'rgba(148,163,184,0.55)' }}>Confirm PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="••••"
                  value={newPinSetupConfirm}
                  onChange={e => { setNewPinSetupConfirm(e.target.value.replace(/\D/g,'')); setPinSetupError(''); }}
                  className="w-full text-center text-2xl font-black py-3 rounded-[14px] mb-2 outline-none"
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', letterSpacing: '0.8rem' }}
                />

                {pinSetupError && (
                  <p className="text-[11px] font-black text-center animate-pulse mb-2" style={{ color: '#f87171' }}>
                    {pinSetupError}
                  </p>
                )}

                <button
                  onClick={handleConfirmNewPin}
                  className="w-full py-3 rounded-[16px] font-black text-white text-sm active:scale-95 transition-all mt-2"
                  style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 8px 24px rgba(99,102,241,0.35)' }}
                >
                  Save PIN
                </button>
              </div>
            )}

            {!showPinSetup && (
            <button
              onClick={handleCancel}
              className="mt-3 text-xs font-bold"
              style={{ color: 'rgba(148,163,184,0.4)' }}
            >
              Cancel
            </button>
            )}
          </div>

          <style>{`
            @keyframes shake {
              0%,100%{transform:translateX(0)}
              20%{transform:translateX(-8px)}
              40%{transform:translateX(8px)}
              60%{transform:translateX(-6px)}
              80%{transform:translateX(6px)}
            }
          `}</style>
        </div>
      )}

      {/* Delete Confirmation Modal (when password protection is OFF) */}
      {deleteConfirm.visible && (
        <div
          className="edit-password-root fixed inset-0 z-[9990] flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)' }}
        >
          <div
            className="w-full max-w-[300px] rounded-[24px] p-6 flex flex-col items-center"
            style={{
              background: 'linear-gradient(160deg, #1a0a0a 0%, #120810 100%)',
              border: '1px solid rgba(239,68,68,0.25)',
              boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
            }}
          >
            <div
              className="w-14 h-14 rounded-[18px] flex items-center justify-center mb-4"
              style={{
                background: 'rgba(239,68,68,0.15)',
                border: '1px solid rgba(239,68,68,0.3)',
              }}
            >
              <Trash2 size={24} style={{ color: '#f87171' }} />
            </div>

            <h2 className="text-lg font-black text-white mb-2" style={{ letterSpacing: '-0.02em' }}>
              Delete Record?
            </h2>
            <p className="text-xs text-center mb-6" style={{ color: 'rgba(255,255,255,0.4)' }}>
              This will move the record to trash. You can undo within 5 seconds.
            </p>

            <div className="flex gap-3 w-full">
              <button
                onClick={handleDeleteCancel}
                className="flex-1 py-3 rounded-[14px] font-black text-sm active:scale-95 transition-all"
                style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(148,163,184,0.8)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="flex-1 py-3 rounded-[14px] font-black text-sm text-white active:scale-95 transition-all"
                style={{ background: 'linear-gradient(135deg,#dc2626,#ef4444)', boxShadow: '0 4px 16px rgba(239,68,68,0.4)' }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </EditPasswordContext.Provider>
  );
};
