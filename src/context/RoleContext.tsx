import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, where, updateDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from './AuthContext';

export type AppRole = 'admin' | 'staff';

export interface FirmAccess {
  firmUid: string;        // The admin UID whose data namespace to use
  firmName: string;       // Display name of the firm
  role: AppRole;          // Role granted by that firm
  invitedBy: string;      // Email of the admin who invited
}

export interface PendingInvitation {
  id: string;             // Invitation doc ID (the code)
  firmName: string;
  invitedByName: string;
  adminUid: string;
  role: AppRole;
  createdAt: string;
  expiresAt: string;
}

interface RoleContextType {
  role: AppRole;
  loading: boolean;
  isAdmin: boolean;
  isStaff: boolean;
  isFounder: boolean;
  adminUid: string | null;
  founderUid: string | null;
  setUserRole: (uid: string, role: AppRole) => Promise<void>;
  deleteUser: (uid: string) => Promise<void>;
  allUsers: { uid: string; email: string; role: AppRole; is_founder?: boolean }[];
  refreshUsers: () => Promise<void>;
  registrationComplete: boolean;
  markRegistrationComplete: () => void;
  // Multi-firm
  firmAccesses: FirmAccess[];
  activeFirm: FirmAccess | null;
  isViewingOtherFirm: boolean;
  switchToFirm: (firmUid: string) => void;
  switchToOwnAccount: () => void;
  pendingInvitations: PendingInvitation[];
  acceptInvitation: (invitationId: string) => Promise<void>;
  declineInvitation: (invitationId: string) => Promise<void>;
  refreshInvitations: () => Promise<void>;
  leaveFirm: (firmUid: string) => Promise<void>;
}

const RoleContext = createContext<RoleContextType>({
  role: 'staff',
  loading: true,
  isAdmin: false,
  isStaff: true,
  isFounder: false,
  adminUid: null,
  founderUid: null,
  setUserRole: async () => {},
  deleteUser: async () => {},
  allUsers: [],
  refreshUsers: async () => {},
  registrationComplete: false,
  markRegistrationComplete: () => {},
  firmAccesses: [],
  activeFirm: null,
  isViewingOtherFirm: false,
  switchToFirm: () => {},
  switchToOwnAccount: () => {},
  pendingInvitations: [],
  acceptInvitation: async () => {},
  declineInvitation: async () => {},
  refreshInvitations: async () => {},
  leaveFirm: async () => {},
});

export const useRole = () => useContext(RoleContext);

const ACTIVE_FIRM_KEY = 'active_firm_uid';

export const RoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [role, setRole] = useState<AppRole>('staff');
  const [adminUid, setAdminUid] = useState<string | null>(null);
  const [founderUid, setFounderUid] = useState<string | null>(null);
  const [isFounder, setIsFounder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [allUsers, setAllUsers] = useState<{ uid: string; email: string; role: AppRole; is_founder?: boolean }[]>([]);
  const [registrationComplete, setRegistrationComplete] = useState(false);

  // Multi-firm state
  const [firmAccesses, setFirmAccesses] = useState<FirmAccess[]>([]);
  const [activeFirm, setActiveFirm] = useState<FirmAccess | null>(null);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);

  // Load role + firm accesses
  useEffect(() => {
    if (!user) {
      setLoading(false);
      // Clear firm state when logged out
      setActiveFirm(null);
      setFirmAccesses([]);
      setPendingInvitations([]);
      return;
    }

    const fetchRole = async () => {
      try {
        // ALWAYS load user's OWN role first (their independent account)
        const roleRef = doc(db, 'user_roles', user.uid);
        const snap = await getDoc(roleRef);

        if (snap.exists()) {
          const data = snap.data();
          // Use the user's own role as baseline
          const ownRole = data.role as AppRole;
          setRole(ownRole);
          setIsFounder(!!data.is_founder);
          if (data.is_founder) setFounderUid(user.uid);
          // Always set adminUid to own uid first — firm switch overrides later
          setAdminUid(user.uid);
        } else {
          // New user — always create as independent admin AND founder
          await setDoc(roleRef, {
            user_id: user.uid,
            email: user.email,
            role: 'admin',
            is_founder: true,
            created_at: new Date().toISOString(),
          });
          setRole('admin');
          setAdminUid(user.uid);
          setFounderUid(user.uid);
          setIsFounder(true);
        }

        // Load firm accesses
        await loadFirmAccesses();
      } catch (e) {
        console.error('Role fetch error:', e);
        setRole('admin');
        setAdminUid(user.uid);
      } finally {
        setLoading(false);
      }
    };

    fetchRole();
  }, [user]);

  // Load firm accesses for current user
  const loadFirmAccesses = useCallback(async () => {
    if (!user) return;
    try {
      const q = query(collection(db, 'firm_accesses'), where('user_id', '==', user.uid));
      const snap = await getDocs(q);
      const accesses: FirmAccess[] = snap.docs.map(d => {
        const data = d.data();
        return {
          firmUid: data.firm_uid,
          firmName: data.firm_name || 'Unknown Firm',
          role: (data.role || 'staff') as AppRole,
          invitedBy: data.invited_by || '',
        };
      });
      setFirmAccesses(accesses);

      // Restore active firm from localStorage
      const savedFirmUid = localStorage.getItem(ACTIVE_FIRM_KEY);
      if (savedFirmUid && savedFirmUid !== user.uid) {
        const match = accesses.find(a => a.firmUid === savedFirmUid);
        if (match) {
          setActiveFirm(match);
          setAdminUid(match.firmUid);
          setRole(match.role);
        } else {
          // Firm access was revoked, clear it
          localStorage.removeItem(ACTIVE_FIRM_KEY);
        }
      }
    } catch (e) {
      console.error('Failed to load firm accesses:', e);
    }
  }, [user]);

  // Load pending invitations for current user's email
  const refreshInvitations = useCallback(async () => {
    if (!user?.email) return;
    try {
      const q = query(
        collection(db, 'invitations'),
        where('email', '==', user.email),
        where('status', '==', 'pending')
      );
      const snap = await getDocs(q);
      const now = new Date();
      const invites: PendingInvitation[] = snap.docs
        .map(d => {
          const data = d.data();
          return {
            id: d.id,
            firmName: data.firm_name || 'Unknown Firm',
            invitedByName: data.invited_by_name || 'Admin',
            adminUid: data.created_by || '',
            role: (data.role || 'staff') as AppRole,
            createdAt: data.created_at || '',
            expiresAt: data.expires_at || '',
          };
        })
        .filter(inv => new Date(inv.expiresAt) > now);
      setPendingInvitations(invites);
    } catch (e) {
      console.error('Failed to load invitations:', e);
    }
  }, [user]);

  useEffect(() => {
    if (user) refreshInvitations();
  }, [user, refreshInvitations]);

  // Accept invitation
  const acceptInvitation = useCallback(async (invitationId: string) => {
    if (!user) return;
    const inv = pendingInvitations.find(i => i.id === invitationId);
    if (!inv) throw new Error('Invitation not found');

    // Create firm_access doc
    const accessDocId = `${user.uid}_${inv.adminUid}`;
    await setDoc(doc(db, 'firm_accesses', accessDocId), {
      user_id: user.uid,
      user_email: user.email,
      firm_uid: inv.adminUid,
      firm_name: inv.firmName,
      role: inv.role,
      invited_by: inv.invitedByName,
      accepted_at: new Date().toISOString(),
    });

    // Also create a user_roles entry for this user under the admin's namespace
    // so the admin can see them in their user list
    const staffRoleId = `${user.uid}_firm_${inv.adminUid}`;
    await setDoc(doc(db, 'user_roles', staffRoleId), {
      user_id: user.uid,
      email: user.email,
      role: inv.role,
      admin_uid: inv.adminUid,
      created_at: new Date().toISOString(),
      is_firm_access: true,
    });

    // Mark invitation as accepted
    await updateDoc(doc(db, 'invitations', invitationId), {
      status: 'accepted',
      accepted_at: new Date().toISOString(),
      accepted_by: user.uid,
    });

    // Refresh lists
    await loadFirmAccesses();
    await refreshInvitations();
  }, [user, pendingInvitations, loadFirmAccesses, refreshInvitations]);

  // Decline invitation
  const declineInvitation = useCallback(async (invitationId: string) => {
    await updateDoc(doc(db, 'invitations', invitationId), {
      status: 'declined',
      declined_at: new Date().toISOString(),
    });
    await refreshInvitations();
  }, [refreshInvitations]);

  // Switch to another firm's data
  const switchToFirm = useCallback((firmUid: string) => {
    const access = firmAccesses.find(a => a.firmUid === firmUid);
    if (!access) return;
    localStorage.setItem(ACTIVE_FIRM_KEY, firmUid);
    // Full reload to reset all data contexts
    window.location.reload();
  }, [firmAccesses]);

  // Switch back to own account
  const switchToOwnAccount = useCallback(() => {
    localStorage.removeItem(ACTIVE_FIRM_KEY);
    window.location.reload();
  }, []);

  // Leave a firm
  const leaveFirm = useCallback(async (firmUid: string) => {
    if (!user) return;
    const accessDocId = `${user.uid}_${firmUid}`;
    await deleteDoc(doc(db, 'firm_accesses', accessDocId));

    // If currently viewing this firm, switch back
    if (activeFirm?.firmUid === firmUid) {
      localStorage.removeItem(ACTIVE_FIRM_KEY);
      window.location.reload();
      return;
    }
    await loadFirmAccesses();
  }, [user, activeFirm, loadFirmAccesses]);

  const isViewingOtherFirm = activeFirm !== null;

  const setUserRole = useCallback(async (uid: string, newRole: AppRole) => {
    // Check if target is founder — founders cannot be demoted
    const targetDoc = await getDoc(doc(db, 'user_roles', uid));
    if (targetDoc.exists() && targetDoc.data().is_founder) {
      throw new Error('Cannot change the role of the firm founder');
    }
    const roleRef = doc(db, 'user_roles', uid);
    await setDoc(roleRef, { role: newRole }, { merge: true });
    if (user && uid === user.uid) setRole(newRole);
  }, [user]);

  const deleteUser = useCallback(async (uid: string) => {
    if (user && uid === user.uid) throw new Error('Cannot delete yourself');
    // Check if target is founder — founders cannot be deleted
    const targetDoc = await getDoc(doc(db, 'user_roles', uid));
    if (targetDoc.exists() && targetDoc.data().is_founder) {
      throw new Error('Cannot delete the firm founder');
    }
    await deleteDoc(doc(db, 'user_roles', uid));
    setAllUsers(prev => prev.filter(u => u.uid !== uid));
  }, [user]);

  const refreshUsers = useCallback(async () => {
    if (!user) return;
    try {
      // Only fetch users that belong to this admin's firm
      // The admin themselves + users with admin_uid pointing to this admin
      const snap = await getDocs(collection(db, 'user_roles'));
      const currentAdminUid = adminUid || user.uid;
      setAllUsers(
        snap.docs
          .filter(d => {
            if (d.id === '__admin_sentinel__') return false;
            const data = d.data();
            // Show: the admin themselves, or users invited by this admin
            return d.id === currentAdminUid || data.admin_uid === currentAdminUid;
          })
          .map(d => ({
            uid: d.id,
            email: d.data().email || '',
            role: d.data().role as AppRole,
            is_founder: !!d.data().is_founder,
          }))
      );
    } catch (e) {
      console.error('Failed to fetch users:', e);
    }
  }, [user, adminUid]);

  useEffect(() => {
    if (role === 'admin' && user) refreshUsers();
  }, [role, user, refreshUsers]);

  const markRegistrationComplete = useCallback(() => {
    setRegistrationComplete(true);
  }, []);

  return (
    <RoleContext.Provider value={{
      role,
      loading,
      isAdmin: role === 'admin',
      isStaff: role === 'staff',
      isFounder,
      adminUid,
      founderUid,
      setUserRole,
      deleteUser,
      allUsers,
      refreshUsers,
      registrationComplete,
      markRegistrationComplete,
      firmAccesses,
      activeFirm,
      isViewingOtherFirm,
      switchToFirm,
      switchToOwnAccount,
      pendingInvitations,
      acceptInvitation,
      declineInvitation,
      refreshInvitations,
      leaveFirm,
    }}>
      {children}
    </RoleContext.Provider>
  );
};
