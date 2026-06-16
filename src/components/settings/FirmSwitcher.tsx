import React, { useState } from 'react';
import {
  Building2, ArrowLeftRight, Check, X, Bell, LogOut, Crown, Users,
  Loader2, ChevronRight, Shield, ShieldCheck, Clock, AlertCircle
} from 'lucide-react';
import { useRole, FirmAccess, PendingInvitation } from '../../context/RoleContext';
import { useUI } from '../../context/UIContext';
import { useAuth } from '../../context/AuthContext';

const FirmSwitcher: React.FC = () => {
  const {
    firmAccesses, activeFirm, isViewingOtherFirm,
    switchToFirm, switchToOwnAccount, pendingInvitations,
    acceptInvitation, declineInvitation, refreshInvitations, leaveFirm
  } = useRole();
  const { user } = useAuth();
  const { confirm, showToast } = useUI();
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [leavingFirm, setLeavingFirm] = useState<string | null>(null);

  const handleAccept = async (inv: PendingInvitation) => {
    setAcceptingId(inv.id);
    try {
      await acceptInvitation(inv.id);
      showToast(`Joined ${inv.firmName} as ${inv.role}!`, 'success');
    } catch (e: any) {
      showToast(e.message || 'Failed to accept', 'error');
    } finally {
      setAcceptingId(null);
    }
  };

  const handleDecline = async (inv: PendingInvitation) => {
    setDecliningId(inv.id);
    try {
      await declineInvitation(inv.id);
      showToast('Invitation declined', 'success');
    } catch {
      showToast('Failed to decline', 'error');
    } finally {
      setDecliningId(null);
    }
  };

  const handleSwitchToFirm = async (access: FirmAccess) => {
    if (!await confirm(
      'Switch Firm',
      `Switch to "${access.firmName}"? The app will reload with their data.`
    )) return;
    showToast(`Switching to ${access.firmName}...`, 'success');
    setTimeout(() => switchToFirm(access.firmUid), 800);
  };

  const handleSwitchBack = async () => {
    if (!await confirm(
      'Switch to Own Account',
      'Switch back to your own account? The app will reload.'
    )) return;
    showToast('Switching to your account...', 'success');
    setTimeout(() => switchToOwnAccount(), 800);
  };

  const handleLeaveFirm = async (access: FirmAccess) => {
    if (!await confirm(
      'Leave Firm',
      `Leave "${access.firmName}"? You will lose access to their data.`
    )) return;
    setLeavingFirm(access.firmUid);
    try {
      await leaveFirm(access.firmUid);
      showToast(`Left ${access.firmName}`, 'success');
    } catch {
      showToast('Failed to leave firm', 'error');
    } finally {
      setLeavingFirm(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Current Account Banner */}
      {isViewingOtherFirm && activeFirm && (
        <div className="p-4 rounded-2xl border" style={{
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.25)'
        }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(245,158,11,0.15)' }}>
              <Building2 size={18} style={{ color: '#fbbf24' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black text-[rgba(240,244,255,0.95)]">
                Viewing: {activeFirm.firmName}
              </p>
              <p className="text-[10px] text-[rgba(148,163,184,0.5)]">
                Role: {activeFirm.role.toUpperCase()} · Invited by {activeFirm.invitedBy}
              </p>
            </div>
          </div>
          <button
            onClick={handleSwitchBack}
            className="w-full py-2.5 rounded-xl font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
            style={{
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              color: '#fff',
              boxShadow: '0 4px 12px rgba(245,158,11,0.3)',
            }}
          >
            <ArrowLeftRight size={14} />
            Switch to My Own Account
          </button>
        </div>
      )}

      {/* Pending Invitations */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Bell size={16} style={{ color: '#f472b6' }} />
          <h3 className="font-black text-sm text-[rgba(240,244,255,0.9)]">
            Pending Invitations
          </h3>
          {pendingInvitations.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black"
              style={{ background: 'rgba(244,114,182,0.2)', color: '#f472b6' }}>
              {pendingInvitations.length}
            </span>
          )}
        </div>

        {pendingInvitations.length === 0 ? (
          <div className="p-4 rounded-xl text-center" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <p className="text-[11px] text-[rgba(148,163,184,0.45)]">No pending invitations</p>
          </div>
        ) : (
          <div className="space-y-2">
            {pendingInvitations.map(inv => (
              <div key={inv.id} className="p-3.5 rounded-2xl border"
                style={{ background: 'rgba(244,114,182,0.06)', border: '1px solid rgba(244,114,182,0.18)' }}>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(244,114,182,0.15)' }}>
                    <Building2 size={16} style={{ color: '#f472b6' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black text-[rgba(240,244,255,0.9)]">{inv.firmName}</p>
                    <p className="text-[10px] text-[rgba(148,163,184,0.5)]">
                      Invited by {inv.invitedByName} · Role: {inv.role.toUpperCase()}
                    </p>
                    <p className="text-[9px] text-[rgba(148,163,184,0.35)] mt-0.5 flex items-center gap-1">
                      <Clock size={9} /> Expires {new Date(inv.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => handleAccept(inv)}
                    disabled={acceptingId === inv.id}
                    className="flex-1 py-2 rounded-xl font-black text-xs text-white flex items-center justify-center gap-1.5 active:scale-95 transition-all disabled:opacity-60"
                    style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
                  >
                    {acceptingId === inv.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    Accept
                  </button>
                  <button
                    onClick={() => handleDecline(inv)}
                    disabled={decliningId === inv.id}
                    className="flex-1 py-2 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all disabled:opacity-60"
                    style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}
                  >
                    {decliningId === inv.id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Firm Accesses */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Users size={16} style={{ color: '#60a5fa' }} />
          <h3 className="font-black text-sm text-[rgba(240,244,255,0.9)]">
            Firm Access
          </h3>
        </div>

        {/* Own account card */}
        <div className={`p-3.5 rounded-2xl border mb-2 ${!isViewingOtherFirm ? 'ring-2 ring-indigo-500/40' : ''}`}
          style={{
            background: !isViewingOtherFirm ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${!isViewingOtherFirm ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.08)'}`
          }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(99,102,241,0.15)' }}>
              <Crown size={16} style={{ color: '#818cf8' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black text-[rgba(240,244,255,0.9)]">My Account</p>
              <p className="text-[10px] text-[rgba(148,163,184,0.5)]">
                {user?.email} · ADMIN
              </p>
            </div>
            {!isViewingOtherFirm ? (
              <span className="px-2.5 py-1 rounded-lg text-[10px] font-black"
                style={{ background: 'rgba(99,102,241,0.2)', color: '#818cf8' }}>
                ACTIVE
              </span>
            ) : (
              <button onClick={handleSwitchBack}
                className="px-3 py-1.5 rounded-lg text-[10px] font-black active:scale-95 transition-all"
                style={{ background: 'rgba(99,102,241,0.12)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)' }}>
                Switch
              </button>
            )}
          </div>
        </div>

        {/* Other firm cards */}
        {firmAccesses.length === 0 ? (
          <div className="p-4 rounded-xl text-center" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <p className="text-[11px] text-[rgba(148,163,184,0.45)]">
              No firm access yet. Accept an invitation to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {firmAccesses.map(access => {
              const isActive = activeFirm?.firmUid === access.firmUid;
              return (
                <div key={access.firmUid}
                  className={`p-3.5 rounded-2xl border ${isActive ? 'ring-2 ring-amber-500/40' : ''}`}
                  style={{
                    background: isActive ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${isActive ? 'rgba(245,158,11,0.25)' : 'rgba(255,255,255,0.08)'}`
                  }}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{ background: 'rgba(245,158,11,0.12)' }}>
                      <Building2 size={16} style={{ color: '#fbbf24' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-[rgba(240,244,255,0.9)]">{access.firmName}</p>
                      <p className="text-[10px] text-[rgba(148,163,184,0.5)]">
                        Role: {access.role.toUpperCase()} · By {access.invitedBy}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {isActive ? (
                        <span className="px-2.5 py-1 rounded-lg text-[10px] font-black"
                          style={{ background: 'rgba(245,158,11,0.2)', color: '#fbbf24' }}>
                          ACTIVE
                        </span>
                      ) : (
                        <button onClick={() => handleSwitchToFirm(access)}
                          className="px-3 py-1.5 rounded-lg text-[10px] font-black active:scale-95 transition-all"
                          style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.2)' }}>
                          Switch
                        </button>
                      )}
                      <button onClick={() => handleLeaveFirm(access)}
                        disabled={leavingFirm === access.firmUid}
                        className="p-1.5 rounded-lg active:scale-95 transition-all"
                        style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171' }}
                        title="Leave firm">
                        {leavingFirm === access.firmUid ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="rounded-2xl p-3.5" style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.15)' }}>
        <p className="text-[10px] font-bold leading-relaxed" style={{ color: 'rgba(147,197,253,0.7)' }}>
          💡 <strong>How it works:</strong> When you switch to another firm, the app reloads with their data.
          Your role determines what you can see and do. Switch back anytime to access your own data.
        </p>
      </div>
    </div>
  );
};

export default FirmSwitcher;
