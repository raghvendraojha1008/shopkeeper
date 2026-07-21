import React, { useEffect, useState } from 'react';
import { Mail, Copy, Trash2, Clock, CheckCircle, AlertCircle, Loader2, Link2, Send, Building2 } from 'lucide-react';
import { db } from '../../config/firebase';
import { collection, query, where, getDocs, doc, deleteDoc, updateDoc, setDoc, getDoc } from 'firebase/firestore';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { AppRole } from '../../context/RoleContext';
import { ApiService } from '../../services/api';

interface Invitation {
  id: string;
  email: string;
  status: 'pending' | 'accepted' | 'declined';
  role: AppRole;
  created_at: string;
  expires_at: string;
  invitation_link: string;
  firm_name: string;
}

const InvitationManager: React.FC = () => {
  const { user } = useAuth();
  const { confirm, showToast } = useUI();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AppRole>('staff');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [copiedId, setCopiedId] = useState('');
  const [firmName, setFirmName] = useState('Your Firm');

  useEffect(() => {
    loadInvitations();
    loadFirmName();
  }, [user]);

  const loadFirmName = async () => {
    if (!user) return;
    try {
      const settings = await ApiService.settings.get(user.uid);
      if (settings?.profile?.firm_name) setFirmName(settings.profile.firm_name);
    } catch {}
  };

  const loadInvitations = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const q = query(collection(db, 'invitations'), where('created_by', '==', user.uid));
      const snap = await getDocs(q);
      setInvitations(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Invitation[]);
    } catch {} finally { setLoading(false); }
  };

  const [lastCreatedLink, setLastCreatedLink] = useState('');

  const createInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !user) { setInviteError('Email is required'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail)) { setInviteError('Invalid email format'); return; }

    setInviteLoading(true); setInviteError(''); setInviteSuccess(''); setLastCreatedLink('');
    try {
      const arr = new Uint8Array(8);
      crypto.getRandomValues(arr);
      const code = Array.from(arr, b => b.toString(36).padStart(2, '0')).join('').toUpperCase().slice(0, 10);
      const expiresAt = new Date(); expiresAt.setDate(expiresAt.getDate() + 7);
      const adminName = user.displayName || user.email?.split('@')[0] || 'Admin';
      const link = `${window.location.origin}${window.location.pathname}#/?invite=${code}`;

      await setDoc(doc(db, 'invitations', code), {
        email: inviteEmail,
        status: 'pending',
        role: inviteRole,
        created_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        created_by: user.uid,
        invited_by_name: adminName,
        firm_name: firmName,
        invitation_link: link,
      });

      // Auto-copy link to clipboard
      try { await navigator.clipboard.writeText(link); } catch {}

      // Try to share via native share API (mobile)
      const shareData = {
        title: `${firmName} — Staff Invitation`,
        text: `You've been invited to join "${firmName}" as ${inviteRole}. Open this link to accept:\n`,
        url: link,
      };
      if (navigator.share && navigator.canShare?.(shareData)) {
        try { await navigator.share(shareData); } catch {}
      }

      setLastCreatedLink(link);
      setInviteSuccess(`Invitation created for ${inviteEmail}!\nLink copied to clipboard — share it with them via WhatsApp, SMS, or any messaging app.`);
      setInviteEmail('');
      setInviteRole('staff');
      await loadInvitations();
    } catch {
      setInviteError('Failed to create invitation.');
    } finally { setInviteLoading(false); }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    showToast('Link copied!', 'success');
    setTimeout(() => setCopiedId(''), 2000);
  };

  const deleteInvitation = async (id: string) => {
    if (!await confirm('Delete Invitation', 'Delete this invitation?')) return;
    await deleteDoc(doc(db, 'invitations', id));
    setInvitations(invitations.filter(i => i.id !== id));
  };

  const isExpired = (at: string) => new Date(at) < new Date();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Mail size={18} className="text-blue-500" />
        <h3 className="font-black text-sm">Send Invitations</h3>
      </div>

      {/* FORM */}
      <form onSubmit={createInvitation} className="bg-[var(--col-info-06)] p-4 rounded-2xl border border-[var(--col-info-25)] space-y-3">
        {inviteError && <div className="bg-[var(--col-danger-15)] text-red-400 p-2 rounded-lg text-xs font-bold flex items-center gap-2 border border-[var(--col-danger-25)]"><AlertCircle size={14}/>{inviteError}</div>}
        {inviteSuccess && (
          <div className="bg-[var(--col-emerald-15)] text-emerald-400 p-3 rounded-lg text-xs font-bold border border-[var(--col-emerald-25)] space-y-2">
            <div className="flex items-start gap-1.5 whitespace-pre-line">
              <CheckCircle size={14} className="flex-shrink-0 mt-0.5"/>{inviteSuccess}
            </div>
            {lastCreatedLink && (
              <div className="flex items-center gap-2">
                <input readOnly value={lastCreatedLink} className="flex-1 text-app-sm bg-[var(--rgba-black-35)] border border-emerald-500/20 rounded px-2 py-1 text-emerald-300 font-mono truncate" />
                <button onClick={() => copyToClipboard(lastCreatedLink, 'new')} className="p-1.5 bg-emerald-500/20 rounded text-emerald-400 flex-shrink-0">
                  {copiedId === 'new' ? <CheckCircle size={12}/> : <Copy size={12}/>}
                </button>
              </div>
            )}
          </div>
        )}
        <div className="relative">
          <Mail className="absolute left-3 top-3 text-slate-400" size={16}/>
          <input type="email" placeholder="Staff email address"
            className="w-full border border-white/12 rounded-lg p-2 pl-9 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all bg-[var(--rgba-white-05)] text-[var(--text-secondary)]"
            value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
        </div>
        <div className="flex items-center gap-3">
          <select
            value={inviteRole}
            onChange={e => setInviteRole(e.target.value as AppRole)}
            className="flex-1 border border-white/12 rounded-lg p-2 text-xs font-bold outline-none bg-[var(--rgba-white-05)] text-[var(--text-secondary)]"
          >
            <option value="staff">Staff</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit" disabled={inviteLoading}
            className="flex-1 text-white py-2 rounded-lg font-bold text-xs transition-all active:scale-95 disabled:opacity-70 flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}>
            {inviteLoading ? <Loader2 className="animate-spin" size={14}/> : <Send size={14}/>}
            Send Invite
          </button>
        </div>
        <p className="text-app-sm font-medium text-[var(--text-muted)] leading-relaxed">
          The invited user will see this in their Invitations section when they log in. You can also share the invite link directly.
        </p>
      </form>

      {/* LIST */}
      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-6"><Loader2 className="animate-spin mx-auto text-slate-400" size={20}/></div>
        ) : invitations.length === 0 ? (
          <div className="p-4 rounded-lg text-center" style={{background:'var(--rgba-white-04)'}}>
            <p className="text-xs text-[var(--text-muted)]">No invitations sent yet</p>
          </div>
        ) : invitations.map(inv => (
          <div key={inv.id} className={`p-3 rounded-lg border ${
            inv.status === 'accepted' ? 'bg-[var(--col-emerald-08)] border-[var(--col-emerald-25)]'
            : inv.status === 'declined' ? 'bg-[var(--col-danger-05)] border-[var(--col-danger-15)]'
            : isExpired(inv.expires_at) ? 'bg-[var(--col-danger-08)] border-[var(--col-danger-25)]'
            : 'border-white/10'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold truncate">{inv.email}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-app-sm font-bold px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--rgba-white-06)', color: 'var(--text-muted)' }}>
                    {(inv.role || 'staff').toUpperCase()}
                  </span>
                  {inv.status === 'accepted'
                    ? <span className="flex items-center gap-1 text-xs text-emerald-400 font-bold"><CheckCircle size={12}/>Accepted</span>
                    : inv.status === 'declined'
                    ? <span className="flex items-center gap-1 text-xs text-red-400 font-bold"><AlertCircle size={12}/>Declined</span>
                    : isExpired(inv.expires_at)
                    ? <span className="flex items-center gap-1 text-xs text-red-400 font-bold"><AlertCircle size={12}/>Expired</span>
                    : <span className="flex items-center gap-1 text-xs text-[var(--text-muted)] font-bold"><Clock size={12}/>Pending</span>}
                </div>
              </div>
              {inv.status === 'pending' && !isExpired(inv.expires_at) && (
                <div className="flex items-center gap-1">
                  <button onClick={() => copyToClipboard(inv.invitation_link, inv.id)}
                    className="p-1.5 bg-[var(--col-info-12)] text-blue-400 rounded transition-colors" title="Copy link">
                    {copiedId === inv.id ? <CheckCircle size={14}/> : <Copy size={14}/>}
                  </button>
                  <button onClick={() => deleteInvitation(inv.id)}
                    className="p-1.5 bg-[var(--col-danger-12)] text-red-400 rounded transition-colors" title="Delete">
                    <Trash2 size={14}/>
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default InvitationManager;
