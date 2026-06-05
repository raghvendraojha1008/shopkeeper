import React, { useState, useEffect, useLayoutEffect, useRef, lazy, Suspense } from 'react';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import { saveScrollPosition, getScrollPosition } from '../../utils/scrollMemory';
import { User } from 'firebase/auth';
import { 
  User as UserIcon, Lock, Database, LogOut, ArrowLeft, ChevronRight,
  List, Check, Settings as SettingsIcon, Users,
  FileText as FileTextIcon, Building2, HardDrive, Crown, Terminal,
} from 'lucide-react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { auth } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useSubscription } from '../../context/SubscriptionContext';
import { useBackHandler } from '../../services/useBackHandler';
import { AppSettings } from '../../types';
import { haptic } from '../../utils/haptics';
import { APP_VERSION } from '../../constants/appVersion';

// IMPORT SUB-COMPONENTS
import { LoadingButton } from '../settings/SettingsCommon';
import { ProfileTab, GeneralTab, ListsTab, SecurityTab } from '../settings/SettingsTabs';
import { SettingsDataZone } from '../settings/SettingsDataZone';
import UserManagement from '../settings/UserManagement';
import InvoiceTemplateSettings from '../settings/InvoiceTemplateSettings';
import FirmSwitcher from '../settings/FirmSwitcher';
import { SubscriptionTab } from '../settings/SubscriptionTab';
const CrashLogsView = lazy(() => import('../admin/CrashLogsView'));

interface SettingsViewProps {
  user: User;
  appSettings: AppSettings;
  onUpdateSettings: (s: AppSettings) => Promise<void>;
  onBack: () => void;
  onNavigate: (tab: string) => void;
  onSubPageChange?: (isOnSubPage: boolean) => void;
}

type SettingsSection = 'menu' | 'profile' | 'general' | 'invoice' | 'users' | 'lists' | 'security' | 'data' | 'invitations' | 'subscription' | 'developer';

const SECTIONS: { id: SettingsSection; label: string; sub: string; icon: React.ElementType; color: string; bg: string }[] = [
  { id: 'profile',      label: 'Firm Profile',      sub: 'Business name, address, GSTIN',   icon: UserIcon,       color: '#60a5fa', bg: 'rgba(59,130,246,0.12)' },
  { id: 'general',      label: 'General',            sub: 'Theme, currency, preferences',    icon: SettingsIcon,   color: '#a78bfa', bg: 'rgba(139,92,246,0.12)' },
  { id: 'invoice',      label: 'Invoice Template',   sub: 'Logo, footer, tax settings',      icon: FileTextIcon,   color: '#34d399', bg: 'rgba(16,185,129,0.12)' },
  { id: 'invitations',  label: 'Invitations & Firms', sub: 'Accept invites, switch firms',  icon: Building2,      color: '#f472b6', bg: 'rgba(244,114,182,0.12)' },
  { id: 'users',        label: 'Users & Access',     sub: 'Staff accounts, permissions',     icon: Users,          color: '#f472b6', bg: 'rgba(244,114,182,0.12)' },
  { id: 'lists',        label: 'Custom Lists',       sub: 'Categories, units, tags',         icon: List,           color: '#fbbf24', bg: 'rgba(245,158,11,0.12)' },
  { id: 'security',     label: 'Security',           sub: 'PIN lock, auto-lock timer',       icon: Lock,           color: '#f87171', bg: 'rgba(239,68,68,0.12)' },
  { id: 'data',         label: 'Data & Backup',      sub: 'Export, import, reset',           icon: Database,       color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
  { id: 'subscription', label: 'Subscription',       sub: 'Free plan · Upgrade to Pro',      icon: Crown,          color: '#fbbf24', bg: 'rgba(245,158,11,0.12)' },
];

const SettingsView: React.FC<SettingsViewProps> = ({ user, appSettings, onUpdateSettings, onBack, onNavigate, onSubPageChange }) => {
  const { logout } = useAuth();
  const { showToast } = useUI();
  const { subscription, globalConfig } = useSubscription();
  
  const [activeSection, setActiveSection] = useState<SettingsSection>('menu');
  const menuScrollRef = useScrollMemory('settings-menu');
  // Per-section scroll memory — key changes when activeSection changes, which
  // triggers the hook's key-change path: saves old position, restores new one.
  const subScrollRef  = useScrollMemory(`settings-sub-${activeSection}`);
  const [loading, setLoading] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [displayVersion, setDisplayVersion] = useState(APP_VERSION);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    auth.currentUser?.getIdTokenResult()
      .then(r => setIsSuperAdmin(!!r.claims.superAdmin))
      .catch(() => {});
  }, [user]);

  // On native Android/iOS fetch the actual installed build version so the
  // Settings screen always reflects what the user really has installed.
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      CapacitorApp.getInfo()
        .then(info => { if (info.version) setDisplayVersion(info.version); })
        .catch(() => { /* fallback to APP_VERSION constant */ });
    }
  }, []);
  
  const [formData, setFormData] = useState<any>(
    JSON.parse(JSON.stringify(appSettings || { security: {} }))
  );

  // FIX: Track whether the user has unsaved local edits.
  // Only sync from the parent prop when there are NO local edits
  // (i.e. on first open or after a successful save), so typing
  // doesn't get wiped by parent re-renders.
  const isDirtyRef = useRef(false);

  useEffect(() => {
    if (appSettings && !isDirtyRef.current) {
      setFormData(JSON.parse(JSON.stringify(appSettings)));
    }
  }, [appSettings]);

  useEffect(() => {
    const handler = () => {
      setActiveSection('subscription');
    };
    window.addEventListener('navigateToSubscriptionTab', handler);
    return () => window.removeEventListener('navigateToSubscriptionTab', handler);
  }, []);

  // Wrap setFormData so we can mark the form as dirty whenever the user edits anything
  const setFormDataWithDirty = (updater: any) => {
    isDirtyRef.current = true;
    setFormData(updater);
  };

  const handleSave = async () => {
    setLoading(true);
    haptic.medium();
    try {
      await onUpdateSettings(formData);
      // After a successful save the local state IS in sync with the parent,
      // so we can safely accept future prop updates again.
      isDirtyRef.current = false;
      showToast('Settings Saved', 'success');
      haptic.success();
    } catch (e) {
      console.error(e);
      showToast('Save failed. Try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Notify parent when entering/leaving a sub-page (hides bottom nav)
  useEffect(() => {
    onSubPageChange?.(activeSection !== 'menu');
    return () => { onSubPageChange?.(false); };
  }, [activeSection, onSubPageChange]);

  // Reset dirty flag when navigating away (back to menu = discard local edits)
  const handleBackToMenu = () => {
    // Save the current sub-section scroll BEFORE it unmounts (ref still valid here)
    if (subScrollRef.current) {
      saveScrollPosition(`settings-sub-${activeSection}`, subScrollRef.current.scrollTop);
    }
    isDirtyRef.current = false;
    // Re-sync with latest saved settings when user navigates back
    setFormData(JSON.parse(JSON.stringify(appSettings || { security: {} })));
    setActiveSection('menu');
  };

  // Save menu scroll position, then navigate into a sub-section.
  // useScrollMemory's useEffect cleanup does NOT fire for conditional renders
  // within a persistent component — must save explicitly here while the element
  // is still in the DOM (before setActiveSection re-renders it away).
  const handleSectionClick = (id: SettingsSection) => {
    if (menuScrollRef.current) {
      saveScrollPosition('settings-menu', menuScrollRef.current.scrollTop);
    }
    setActiveSection(id);
  };

  // Restore menu scroll position after returning from a sub-section.
  // useScrollMemory's useLayoutEffect only fires on key change or component
  // mount — neither happens here since SettingsView stays mounted throughout.
  // We therefore drive restoration manually whenever activeSection flips back to 'menu'.
  const menuRafRef   = useRef<number | null>(null);
  const menuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLayoutEffect(() => {
    if (activeSection !== 'menu') return;
    const saved = getScrollPosition('settings-menu');
    if (saved <= 0) return;
    const apply = () => { if (menuScrollRef.current) menuScrollRef.current.scrollTop = saved; };
    apply();
    menuRafRef.current   = requestAnimationFrame(() => { apply(); menuRafRef.current = null; });
    menuTimerRef.current = setTimeout(() => { apply(); menuTimerRef.current = null; }, 120);
    return () => {
      if (menuRafRef.current)   { cancelAnimationFrame(menuRafRef.current);  menuRafRef.current = null; }
      if (menuTimerRef.current) { clearTimeout(menuTimerRef.current);         menuTimerRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

  // Register Android hardware back handler when a sub-section is open
  useBackHandler(handleBackToMenu, activeSection !== 'menu', 5);

  const handleLogout = () => {
    haptic.medium();
    setShowLogoutConfirm(true);
  };

  const confirmLogout = async () => {
    setShowLogoutConfirm(false);
    await logout();
  };

  // Security saves immediately via its own onSave prop — no global Save button needed.
  const needsSave = activeSection !== 'menu' && activeSection !== 'users' && activeSection !== 'data' && activeSection !== 'invitations' && activeSection !== 'subscription' && activeSection !== 'security' && activeSection !== 'developer';
  const currentSection = SECTIONS.find(s => s.id === activeSection);

  // ── MENU PAGE ──────────────────────────────────────────────────────────────
  if (activeSection === 'menu') {
    return (
      <div className="h-full flex flex-col" style={{ background: 'var(--app-bg)' }}>

        {/* Logout Confirmation Modal */}
        {showLogoutConfirm && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center px-4"
            style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
            <div className="logout-confirm-card w-full max-w-sm rounded-[28px] p-6"
              style={{ background: 'rgba(16,20,40,0.98)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
              <div className="w-12 h-12 rounded-[16px] flex items-center justify-center mx-auto mb-4"
                style={{ background: 'rgba(239,68,68,0.12)' }}>
                <LogOut size={22} style={{ color: '#f87171' }} />
              </div>
              <h3 className="text-base font-black text-white text-center mb-1">Log Out?</h3>
              <p className="text-xs text-center mb-5" style={{ color: 'rgba(148,163,184,0.6)' }}>
                You will be signed out of your account.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setShowLogoutConfirm(false)}
                  className="flex-1 py-3 rounded-[16px] font-black text-sm active:scale-95 transition-all"
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(203,213,225,0.8)' }}>
                  Cancel
                </button>
                <button onClick={confirmLogout}
                  className="flex-1 py-3 rounded-[16px] font-black text-sm text-white active:scale-95 transition-all"
                  style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)', boxShadow: '0 8px 24px rgba(239,68,68,0.35)' }}>
                  Log Out
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Header */}
        <div className="shrink-0 px-4 pt-5 pb-4 flex items-center gap-3 border-b"
          style={{ background: 'rgba(var(--app-bg-rgb),0.95)', backdropFilter: 'blur(20px)', borderColor: 'rgba(255,255,255,0.06)' }}>
          <button onClick={onBack} className="p-2 rounded-xl active:scale-95 transition-all"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <ArrowLeft size={18} className="text-[rgba(240,244,255,0.95)]" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-black text-lg text-[rgba(240,244,255,0.95)] tracking-tight">Settings</h1>
            <p className="text-[10px] text-[rgba(148,163,184,0.5)] truncate">{user.email}</p>
          </div>
        </div>

        {/* Section list */}
        <div ref={menuScrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5" style={{ WebkitOverflowScrolling: 'touch', paddingBottom: 'calc(96px + env(safe-area-inset-bottom, 0px))' }}>
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[rgba(148,163,184,0.4)] px-1 mb-3">Configure your app</p>
          {SECTIONS.filter(s => !(s.id === 'subscription' && (globalConfig === null || globalConfig.appMode === 'free'))).map(({ id, label, sub, icon: Icon, color, bg }) => {
            let displaySub = sub;
            if (id === 'subscription') {
              const plan = subscription?.plan;
              const status = subscription?.status;
              if (!plan || plan === 'free') {
                displaySub = 'Free plan · Upgrade to Pro';
              } else if (status === 'active') {
                displaySub = `${plan.charAt(0).toUpperCase() + plan.slice(1)} plan · Active`;
              } else if (status === 'trial') {
                displaySub = `${plan.charAt(0).toUpperCase() + plan.slice(1)} plan · Trial`;
              } else if (status === 'grace') {
                displaySub = `${plan.charAt(0).toUpperCase() + plan.slice(1)} plan · Grace period`;
              } else if (status === 'expired') {
                displaySub = `${plan.charAt(0).toUpperCase() + plan.slice(1)} plan · Expired · Renew`;
              }
            }
            return (
              <button key={id} onClick={() => handleSectionClick(id)}
                className="w-full flex items-center gap-4 p-4 rounded-[20px] active:scale-[0.98] transition-all text-left"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="w-11 h-11 rounded-[16px] flex items-center justify-center flex-shrink-0" style={{ background: bg }}>
                  <Icon size={19} style={{ color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-sm text-[rgba(240,244,255,0.9)]">{label}</p>
                  <p className="text-[10px] text-[rgba(148,163,184,0.45)] truncate">{displaySub}</p>
                </div>
                <ChevronRight size={16} style={{ color: 'rgba(148,163,184,0.3)', flexShrink: 0 }} />
              </button>
            );
          })}

          {/* Daily Data Archive */}
          <button onClick={() => onNavigate('daily-snapshots')}
            className="w-full flex items-center gap-4 p-4 rounded-[20px] active:scale-[0.98] transition-all text-left"
            style={{ background: 'rgba(52,211,153,0.05)', border: '1px solid rgba(52,211,153,0.15)' }}>
            <div className="w-11 h-11 rounded-[16px] flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(52,211,153,0.1)' }}>
              <HardDrive size={19} style={{ color: '#34d399' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-black text-sm" style={{ color: '#34d399' }}>Daily Data Archive</p>
              <p className="text-[10px] text-[rgba(148,163,184,0.45)] truncate">Last 7 days · CSV · Survives reinstall</p>
            </div>
            <ChevronRight size={16} style={{ color: 'rgba(52,211,153,0.3)', flexShrink: 0 }} />
          </button>

          {/* Developer Console — superAdmin only */}
          {isSuperAdmin && (
            <button onClick={() => handleSectionClick('developer')}
              className="w-full flex items-center gap-4 p-4 rounded-[20px] active:scale-[0.98] transition-all text-left"
              style={{ background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.18)' }}>
              <div className="w-11 h-11 rounded-[16px] flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(99,102,241,0.12)' }}>
                <Terminal size={19} style={{ color: '#818cf8' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-sm" style={{ color: '#818cf8' }}>Developer Console</p>
                <p className="text-[10px] text-[rgba(148,163,184,0.45)] truncate">Crash logs · Download · Mark resolved</p>
              </div>
              <ChevronRight size={16} style={{ color: 'rgba(99,102,241,0.3)', flexShrink: 0 }} />
            </button>
          )}

          {/* Version + Logout */}
          <div className="pt-4 space-y-2">
            <button onClick={handleLogout}
              className="w-full flex items-center gap-4 p-4 rounded-[20px] active:scale-[0.98] transition-all text-left"
              style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.12)' }}>
              <div className="w-11 h-11 rounded-[16px] flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(239,68,68,0.1)' }}>
                <LogOut size={19} style={{ color: '#f87171' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-sm" style={{ color: '#f87171' }}>Logout</p>
                <p className="text-[10px] text-[rgba(148,163,184,0.4)]">Sign out of your account</p>
              </div>
            </button>
            <p className="text-center text-[9px] text-[rgba(148,163,184,0.2)] font-bold uppercase tracking-widest pt-2">
              Version {displayVersion} · Shopkeeper
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── DEVELOPER CONSOLE — full-screen, no SettingsView header wrapper ───────
  // CrashLogsView has its own header (back button + title + download).
  // Wrapping it in the sub-page layout produces a double-header ("page inside
  // page"). Render it directly so it fills the h-full container cleanly.
  if (activeSection === 'developer') {
    return (
      <div className="h-full flex flex-col" style={{ background: 'var(--app-bg)' }}>
        <Suspense fallback={
          <div className="flex items-center justify-center h-full">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        }>
          <CrashLogsView onBack={handleBackToMenu} />
        </Suspense>
      </div>
    );
  }

  // ── SUB-PAGE ───────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--app-bg)' }}>
      {/* Sub-page header */}
      <div className="shrink-0 px-4 pt-5 pb-4 flex items-center gap-3 border-b"
        style={{ background: 'rgba(var(--app-bg-rgb),0.95)', backdropFilter: 'blur(20px)', borderColor: 'rgba(255,255,255,0.06)' }}>
        <button onClick={handleBackToMenu} className="p-2 rounded-xl active:scale-95 transition-all"
          style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <ArrowLeft size={18} className="text-[rgba(240,244,255,0.95)]" />
        </button>
        {currentSection && (
          <div className="w-9 h-9 rounded-[12px] flex items-center justify-center flex-shrink-0"
            style={{ background: currentSection.bg }}>
            <currentSection.icon size={16} style={{ color: currentSection.color }} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="font-black text-base text-[rgba(240,244,255,0.95)] tracking-tight">
            {currentSection?.label ?? 'Settings'}
          </h1>
          <p className="text-[10px] text-[rgba(148,163,184,0.45)] truncate">
            {currentSection?.sub}
          </p>
        </div>
        {needsSave && (
          <LoadingButton loading={loading} onClick={handleSave} icon={Check} label="Save"
            className="py-2 px-4 rounded-xl font-black text-sm text-white"
            style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }} />
        )}
      </div>

      {/* Content */}
      <div ref={subScrollRef} className="flex-1 overflow-y-auto p-4 space-y-5" style={{ WebkitOverflowScrolling: 'touch', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}>
        {activeSection === 'profile'  && <ProfileTab formData={formData} setFormData={setFormDataWithDirty} userEmail={user.email} />}
        {activeSection === 'general'  && <GeneralTab formData={formData} setFormData={setFormDataWithDirty} />}
        {activeSection === 'invoice'  && <InvoiceTemplateSettings settings={formData} onUpdateSettings={async (s: any) => { setFormDataWithDirty(s); }} />}
        {activeSection === 'users'    && <UserManagement />}
        {activeSection === 'invitations' && <FirmSwitcher />}
        {activeSection === 'lists'    && <ListsTab formData={formData} setFormData={setFormDataWithDirty} />}
        {activeSection === 'security' && <SecurityTab
            formData={formData}
            setFormData={setFormDataWithDirty}
            user={user}
            onSave={async (newSettings: any) => {
              isDirtyRef.current = false;
              await onUpdateSettings(newSettings);
            }}
          />}
        {activeSection === 'data'     && <SettingsDataZone user={user} />}
        {activeSection === 'subscription' && <SubscriptionTab />}
      </div>
    </div>
  );
};

export default SettingsView;