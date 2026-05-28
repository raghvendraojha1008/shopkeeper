import React, { useEffect, useState } from 'react';
import { Users, Shield, ShieldCheck, RefreshCw, Mail, Trash2, Edit2, X, Check, Crown } from 'lucide-react';
import { useRole, AppRole } from '../../context/RoleContext';
import { db } from '../../config/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { useUI } from '../../context/UIContext';
import InvitationManager from './InvitationManager';

const UserManagement: React.FC = () => {
  const { allUsers, setUserRole, deleteUser, refreshUsers, isAdmin, isFounder } = useRole();
  const { confirm, showToast } = useUI();

  // Edit state
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  useEffect(() => { refreshUsers(); }, [refreshUsers]);

  const handleRoleChange = async (uid: string, newRole: AppRole, userObj: typeof allUsers[0]) => {
    if (userObj.is_founder) {
      showToast('Cannot change the founder\'s role', 'error');
      return;
    }
    try {
      await setUserRole(uid, newRole);
      showToast('Role updated', 'success');
      await refreshUsers();
    } catch (err: any) {
      showToast(err.message || 'Failed to update role', 'error');
    }
  };

  const handleDeleteUser = async (uid: string, email: string, userObj: typeof allUsers[0]) => {
    if (userObj.is_founder) {
      showToast('Cannot remove the firm founder', 'error');
      return;
    }
    if (!await confirm('Remove User', `Remove ${email} from the system? They will lose access to this firm.`)) return;
    try {
      await deleteUser(uid);
      showToast(`${email} removed`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to remove user', 'error');
    }
  };

  const handleStartEdit = (u: { uid: string; email: string; displayName?: string }) => {
    setEditingUid(u.uid);
    setEditName(u.displayName || u.email.split('@')[0]);
  };

  const handleSaveEdit = async (uid: string) => {
    try {
      await updateDoc(doc(db, 'user_roles', uid), { display_name: editName });
      await updateDoc(doc(db, 'users', uid), { displayName: editName });
      showToast('Name updated', 'success');
      setEditingUid(null);
      await refreshUsers();
    } catch (err) {
      showToast('Failed to update name', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={18} className="text-indigo-500" />
          <h3 className="font-black text-sm">User Management</h3>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refreshUsers} className="p-2 rounded-lg text-slate-500 hover:text-slate-700 transition-colors active:scale-95">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* USER LIST */}
      {allUsers.length === 0 ? (
        <p className="text-xs text-[rgba(148,163,184,0.45)] text-center py-6">No users found</p>
      ) : (
        <div className="space-y-2">
          {allUsers.map(u => (
            <div key={u.uid} className={`p-3 rounded-2xl border ${u.is_founder ? 'border-amber-500/30 bg-[rgba(245,158,11,0.05)]' : 'border-white/10'}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={`p-2 rounded-xl flex-shrink-0 ${u.is_founder ? 'bg-[rgba(245,158,11,0.15)]' : u.role === 'admin' ? 'bg-[rgba(99,102,241,0.15)]' : 'bg-[rgba(245,158,11,0.15)]'}`}>
                    {u.is_founder ? <Crown size={16} className="text-amber-500" /> : u.role === 'admin' ? <ShieldCheck size={16} className="text-indigo-500" /> : <Shield size={16} className="text-amber-500" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    {editingUid === u.uid ? (
                      <div className="flex items-center gap-2">
                        <input
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          className="flex-1 text-sm font-bold border border-indigo-300 rounded-lg px-2 py-1 outline-none bg-[rgba(255,255,255,0.06)] text-[rgba(240,244,255,0.95)]"
                          autoFocus
                        />
                        <button onClick={() => handleSaveEdit(u.uid)} className="p-1 bg-green-100 text-green-600 rounded"><Check size={14}/></button>
                        <button onClick={() => setEditingUid(null)} className="p-1 rounded glass-icon-btn text-[rgba(148,163,184,0.45)]"><X size={14}/></button>
                      </div>
                    ) : (
                      <p className="text-sm font-bold truncate">{(u as any).displayName || u.email}</p>
                    )}
                    <p className="text-[10px] font-bold text-[rgba(148,163,184,0.45)]">
                      {u.email} · <span className="uppercase">{u.role}</span>
                      {u.is_founder && <span className="ml-1 text-amber-400">· FOUNDER</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {u.is_founder ? (
                    <span className="text-[10px] font-black text-amber-400/60 px-2 py-1.5 rounded-lg bg-[rgba(245,158,11,0.08)] border border-amber-500/20">
                      FOUNDER
                    </span>
                  ) : (
                    <>
                      <select
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.uid, e.target.value as AppRole, u)}
                        className="text-xs font-bold bg-[rgba(255,255,255,0.06)] text-[rgba(203,213,225,0.75)] px-2 py-1.5 rounded-lg border border-white/12 outline-none cursor-pointer"
                      >
                        <option value="admin">Admin</option>
                        <option value="staff">Staff</option>
                      </select>
                      <button
                        onClick={() => handleStartEdit(u as any)}
                        className="p-1.5 bg-[rgba(59,130,246,0.12)] text-blue-400 rounded-lg hover:bg-[rgba(59,130,246,0.2)] transition-colors active:scale-95"
                        title="Edit display name"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={() => handleDeleteUser(u.uid, u.email, u)}
                        className="p-1.5 bg-[rgba(239,68,68,0.12)] text-red-400 rounded-lg hover:bg-[rgba(239,68,68,0.2)] transition-colors active:scale-95"
                        title="Remove user"
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-[rgba(99,102,241,0.08)] p-4 rounded-2xl border border-[rgba(99,102,241,0.2)]">
        <h4 className="text-xs font-black text-indigo-300 uppercase tracking-wider mb-3">Role Permissions</h4>
        <div className="space-y-3">
          <div className="p-3 rounded-xl">
            <p className="text-[11px] font-bold mb-1.5">👑 Founder — Permanent Owner</p>
            <ul className="text-[10px] text-[rgba(148,163,184,0.6)] space-y-1 ml-4">
              <li>✓ Cannot be demoted, deleted, or removed</li>
              <li>✓ Full admin access + firm ownership</li>
            </ul>
          </div>
          <div className="p-3 rounded-xl">
            <p className="text-[11px] font-bold mb-1.5">👨‍💼 Admin — Full Access</p>
            <ul className="text-[10px] text-[rgba(148,163,184,0.6)] space-y-1 ml-4">
              <li>✓ All features, settings, reports, expenses</li>
              <li>✓ Invite users and manage roles</li>
              <li>✓ Edit/Delete any records</li>
            </ul>
          </div>
          <div className="p-3 rounded-xl">
            <p className="text-[11px] font-bold mb-1.5">👤 Staff — Limited Access</p>
            <ul className="text-[10px] text-[rgba(148,163,184,0.6)] space-y-1 ml-4">
              <li>✓ Dashboard, Parties, Sales, Inventory (read)</li>
              <li>✗ Settings, Reports, Expenses</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 pt-4">
        <InvitationManager />
      </div>
    </div>
  );
};

export default UserManagement;
