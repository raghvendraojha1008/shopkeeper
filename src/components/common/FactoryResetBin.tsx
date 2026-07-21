import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { ArrowLeft, Archive, RotateCcw, Clock, Shield, RefreshCw, AlertTriangle } from 'lucide-react';
import { FactoryResetBinService } from '../../services/factoryResetBin';
import { ApiService } from '../../services/api';
import { useUI } from '../../context/UIContext';

interface FactoryResetBinProps {
  user: User;
  onBack: () => void;
}

function daysLeft(expiresAt: string): number {
  const diff = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 3600 * 1000)));
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

const FactoryResetBin: React.FC<FactoryResetBinProps> = ({ user, onBack }) => {
  const { showToast, confirm } = useUI();
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const [pinPrompt, setPinPrompt] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null);
  const [storedPin, setStoredPin] = useState<string | null>(null);

  useEffect(() => {
    loadSnapshots();
    loadPin();
  }, []);

  const loadSnapshots = async () => {
    setLoading(true);
    try {
      const list = await FactoryResetBinService.listSnapshots(user.uid);
      setSnapshots(list);
    } catch (e) {
      showToast('Failed to load factory reset bin', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadPin = async () => {
    try {
      const settings = await ApiService.settings.get(user.uid);
      setStoredPin(settings?.security?.pin || null);
    } catch (_) {}
  };

  const initiateRestore = async (resetId: string) => {
    if (storedPin) {
      setPendingRestoreId(resetId);
      setPinInput('');
      setPinPrompt(true);
    } else {
      const ok = await confirm('Restore Factory Reset Backup?', 'This will restore all your data from this snapshot. Current data will be overwritten.');
      if (ok) doRestore(resetId);
    }
  };

  const handlePinConfirm = async () => {
    if (pinInput !== storedPin) {
      showToast('Incorrect PIN', 'error');
      return;
    }
    setPinPrompt(false);
    if (pendingRestoreId) doRestore(pendingRestoreId);
    setPendingRestoreId(null);
    setPinInput('');
  };

  const doRestore = async (resetId: string) => {
    setRestoringId(resetId);
    try {
      await FactoryResetBinService.restoreSnapshot(user.uid, resetId);
      showToast('Data restored successfully. Reloading…', 'success');
      setTimeout(() => window.location.reload(), 2000);
    } catch (e) {
      showToast('Restore failed', 'error');
      setRestoringId(null);
    }
  };

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--app-bg)', color: 'var(--text-primary)' }}>
      <div className="px-4 pb-4 flex items-center gap-3 border-b border-white/10 shrink-0"
        style={{ background: 'linear-gradient(135deg,var(--col-danger-18),rgba(185,28,28,0.12))', paddingTop: 'max(16px, calc(env(safe-area-inset-top, 0px) + 12px))' }}>
        <button onClick={onBack} className="p-2 rounded-full active:scale-90 transition-all"
          style={{ background: 'var(--rgba-white-08)', border: '1px solid var(--glass-border)' }}>
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h2 className="font-black text-base">Factory Reset Bin</h2>
          <p className="text-app-sm text-red-400 font-bold uppercase tracking-wider">Auto-deleted after 30 days</p>
        </div>
        <Archive size={20} className="text-red-400" />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="flex items-start gap-3 p-3 rounded-xl mb-2"
          style={{ background: 'var(--col-danger-07)', border: '1px solid var(--col-danger-25)' }}>
          <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-app-md text-red-300">
            Snapshots saved automatically before each factory reset. Kept for 30 days. Not deletable. PIN required to restore.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw size={22} className="animate-spin text-red-400" />
          </div>
        ) : snapshots.length === 0 ? (
          <div className="text-center py-16">
            <Archive size={36} className="mx-auto mb-3 opacity-20" />
            <p className="font-bold text-[var(--text-muted)] text-sm">No factory reset snapshots</p>
            <p className="text-app-md text-[var(--text-muted)] mt-1">A snapshot is saved automatically before every factory reset.</p>
          </div>
        ) : (
          snapshots.map(snap => {
            const days = daysLeft(snap.expires_at);
            const isRestoring = restoringId === snap.id;
            return (
              <div key={snap.id} className="rounded-2xl border overflow-hidden"
                style={{ background: 'var(--rgba-white-03)', border: '1px solid var(--glass-border)' }}>
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Archive size={14} className="text-red-400" />
                    <span className="font-black text-sm text-red-300">
                      Reset on {fmtDate(snap.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-app-md text-slate-400 mb-3">
                    <span className="flex items-center gap-1">
                      <Clock size={11} />
                      {days > 0 ? `Expires in ${days} day${days !== 1 ? 's' : ''}` : 'Expires today'}
                    </span>
                    <span>{snap.total_items ?? '?'} records</span>
                  </div>

                  <div className="w-full rounded-full h-1 mb-3" style={{ background: 'var(--rgba-white-06)' }}>
                    <div className="h-full rounded-full transition-all"
                      style={{
                        width: `${(days / 30) * 100}%`,
                        background: days > 10 ? "var(--col-emerald)" : days > 5 ? "var(--col-amber)" : "var(--col-red)",
                      }} />
                  </div>

                  <button
                    onClick={() => initiateRestore(snap.id)}
                    disabled={isRestoring}
                    className="w-full py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
                    style={{ background: 'var(--col-emerald-15)', border: '1px solid var(--col-emerald-35)', color: "var(--col-success)" }}>
                    {isRestoring
                      ? <><RefreshCw size={14} className="animate-spin" /> Restoring…</>
                      : <><RotateCcw size={14} /> Restore This Snapshot</>}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {pinPrompt && (
        <div className="fixed inset-0 bg-black/80 z-[120] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="w-full max-w-xs rounded-2xl border border-emerald-500/30 overflow-hidden"
            style={{ background: 'var(--modal-bg)' }}>
            <div className="p-5" style={{ borderBottom: '1px solid var(--glass-border)' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: 'var(--col-emerald-12)', border: '1px solid var(--col-emerald-25)' }}>
                  <Shield size={18} className="text-emerald-400" />
                </div>
                <div>
                  <h3 className="font-black text-sm" style={{ color: 'var(--text-primary)' }}>Enter App Lock PIN</h3>
                  <p className="text-app-sm text-slate-400 mt-0.5">Required to restore factory reset data</p>
                </div>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <input
                type="number"
                inputMode="numeric"
                maxLength={4}
                value={pinInput}
                onChange={e => { if (e.target.value.length <= 4) setPinInput(e.target.value); }}
                placeholder="4-digit PIN"
                className="w-full px-4 py-3 rounded-xl text-center text-xl font-black tracking-widest outline-none"
                style={{ background: 'var(--rgba-white-06)', border: '1px solid var(--glass-border)', color: 'white' }}
                onKeyDown={e => { if (e.key === 'Enter' && pinInput.length === 4) handlePinConfirm(); }}
                autoFocus
              />
              <div className="flex gap-3">
                <button
                  onClick={() => { setPinPrompt(false); setPinInput(''); setPendingRestoreId(null); }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
                  style={{ background: 'var(--rgba-white-06)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                  Cancel
                </button>
                <button
                  onClick={handlePinConfirm}
                  disabled={pinInput.length !== 4}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-40"
                  style={{ background: 'var(--col-emerald-25)', border: '1px solid var(--col-emerald-35)', color: "var(--col-success)" }}>
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FactoryResetBin;
