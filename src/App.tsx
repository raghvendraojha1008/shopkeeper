import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import FirmSwitcher from './components/settings/FirmSwitcher';
import { Capacitor } from '@capacitor/core';

import { ApiService } from './services/api';
import { AutoBackupService } from './services/autoBackup';
import { AutoReminderService } from './services/autoReminderService';
import { RecurringService } from './services/recurringService';
import { DailySnapshotService } from './services/dailySnapshot';
import { AppSettings } from './types';
import { DEFAULT_SETTINGS } from './config/constants';
import { applyThemeToDocument, normalizeAppSettings } from './theme/theme';
import { AuthProvider, useAuth } from './context/AuthContext';
import { UIProvider, useUI } from './context/UIContext';
import { DataProvider, useData } from './context/DataContext';
import { useIsRestoring } from '@tanstack/react-query';
import { RoleProvider, useRole } from './context/RoleContext';
import { EditPasswordProvider, useEditPassword } from './context/EditPasswordContext';
import { SubscriptionProvider, useSubscription } from './context/SubscriptionContext';
import FeatureGate from './components/common/FeatureGate';
import { AnnouncementBanner } from './components/common/AnnouncementBanner';
import { hasAccess, TAB_FEATURE_GATE } from './utils/featureAccess';
import { App as CapacitorApp } from '@capacitor/app';
import { BackStack } from './services/backStack';
import { KeyboardProvider, useKeyboardContext } from './context/KeyboardContext';
import { isKeyboardCurrentlyOpen, dismissKeyboard } from './hooks/useKeyboard';
import { safeKeyboardInit } from './utils/nativeSafe';
import { saveNavState, restoreNavState } from './utils/navPersistence';
import { lifecycleManager } from './services/lifecycleManager';

// Auth & Loading
import LoginView, { EmailVerificationBanner } from './components/auth/LoginView';
import OnboardingView from './components/auth/OnboardingView';
import LoadingView from './components/views/LoadingView';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';

// Primary tab views — lazy-loaded to reduce initial bundle (these are the heaviest chunks)
const DashboardView        = lazy(() => import('./components/views/DashboardView'));
const InventoryView        = lazy(() => import('./components/views/InventoryView'));
const PartiesView          = lazy(() => import('./components/views/PartiesView'));
const SettingsView         = lazy(() => import('./components/views/SettingsView'));

// Secondary Views — lazy-loaded so they don't inflate the initial bundle
const LedgerView           = lazy(() => import('./components/views/LedgerView'));
const TransactionsView     = lazy(() => import('./components/views/TransactionsView'));
const ExpensesView         = lazy(() => import('./components/views/ExpensesView'));
const VehiclesView         = lazy(() => import('./components/views/VehiclesView'));
const ReportsView          = lazy(() => import('./components/views/ReportsView'));
const SalesDashboard       = lazy(() => import('./components/views/SalesDashboard'));
const PurchaseDashboard    = lazy(() => import('./components/views/PurchaseDashboard'));
const PendingView          = lazy(() => import('./components/views/PendingView'));
const ItemDetailView       = lazy(() => import('./components/views/ItemDetailView'));
const AdvancedAnalyticsDashboard = lazy(() => import('./components/views/AdvancedAnalyticsDashboard'));
const WasteView            = lazy(() => import('./components/views/WasteView'));
const GameTimelineView     = lazy(() => import('./components/views/GameTimelineView'));
const BulkImportView       = lazy(() => import('./components/views/BulkImportView'));
const PartyStatementView   = lazy(() => import('./components/views/PartyStatementView'));
const StockValuationView   = lazy(() => import('./components/views/StockValuationView'));
const POSBillingView       = lazy(() => import('./components/views/POSBillingView'));
const DailySnapshotView    = lazy(() => import('./components/views/DailySnapshotView'));

// Modals — lazy-loaded (only needed after user interaction)
const CommandModal    = lazy(() => import('./components/common/CommandModal'));
const ManualEntryModal = lazy(() => import('./components/modals/ManualEntryModal'));
const WhatsNewModal   = lazy(() => import('./components/common/WhatsNewModal'));

// LockScreen stays eager — it's a security gate that must render before user sees any content
import LockScreen from './components/common/LockScreen';
import { ScreenErrorBoundary } from './components/common/ErrorBoundary';

// Common
import { OfflineIndicator } from './components/common/OfflineIndicatorEnhanced';
// MODULE 5 — surface sync failures as real toasts (the OfflineIndicator banner
// auto-clears in 3s, which is too easy to miss for a real failure).
import { useSyncStatus } from './hooks/useOnlineStatus';
// FINAL MODULE — go-to-market: update prompt + lightweight telemetry.
import UpdateBanner from './components/common/UpdateBanner';
import { TelemetryService } from './services/telemetryService';
import { UndoSnackbar, flushPendingDeletes } from './components/common/UndoSnackbar';
import { initCountersForUser } from './utils/idGenerator';
import SeoHead from './components/common/SeoHead';

// Icons
import {
  LayoutDashboard, Package, Mic, Users, Settings
} from 'lucide-react';

// MODULE 5 — Sync error transparency.
// Mounted once near the top of the app shell. It watches the sync state and
// fires a single error toast on the syncing → "Sync failed..." transition.
// We deliberately DO NOT toast on success (the OfflineIndicator banner is
// enough) — only on failures, which the spec calls out as needing visible
// surfacing instead of a 3s auto-clearing message.
const SyncStatusToastBridge: React.FC = () => {
  const { syncMessage, isSyncing } = useSyncStatus();
  const { showToast } = useUI();
  // Track the last failure message we toasted so we don't fire repeatedly
  // for the same message during one app session.
  const lastFailureRef = useRef<string | null>(null);

  useEffect(() => {
    if (isSyncing) return;                     // wait until the sync attempt is over
    if (!syncMessage) {                        // banner cleared — reset so we can toast next failure
      lastFailureRef.current = null;
      return;
    }
    const isFailure = /fail/i.test(syncMessage);
    if (!isFailure) return;
    if (lastFailureRef.current === syncMessage) return; // already toasted this exact message

    lastFailureRef.current = syncMessage;
    showToast('Sync failed. Will retry automatically.', 'error');
  }, [syncMessage, isSyncing, showToast]);

  return null;
};

// FINAL MODULE — DAU pulse. Lives outside AppContent so it doesn't add a
// fresh subscription on every render; the effect runs once per signed-in
// user and the service itself dedups same-day repeat calls.
const useDailyOpenPulse = (userId: string | null | undefined) => {
  useEffect(() => {
    if (!userId) return;
    TelemetryService.trackDailyOpen(userId);
  }, [userId]);
};

// Helper that dispatches the custom event consumed by SettingsView to
// auto-select the Subscription sub-tab, then navigates to settings.
const goToSubscriptionTab = (setActiveTab: (tab: string) => void) => {
  window.dispatchEvent(new CustomEvent('navigateToSubscriptionTab'));
  setActiveTab('settings');
};

const AppContent = () => {
  const { isKeyboardOpen } = useKeyboardContext();
  const { user, loading: authLoading, logout } = useAuth();
  const { isAdmin, isStaff, role, adminUid, registrationComplete, markRegistrationComplete, loading: roleLoading, isViewingOtherFirm, activeFirm, pendingInvitations } = useRole();
  const { invalidateAll } = useData();
  const { setEditPasswordSettings } = useEditPassword();
  const { showToast } = useUI();
  const { subscription, loading: subscriptionLoading, globalConfig, liveFeatures } = useSubscription();
  // Keep refs so background service effects can read current values
  // without being re-added as deps (services throttle to once/day anyway).
  const subscriptionRef  = useRef(subscription);
  const globalConfigRef  = useRef(globalConfig);
  const liveFeaturesRef  = useRef(liveFeatures);
  useEffect(() => { subscriptionRef.current  = subscription;  }, [subscription]);
  useEffect(() => { globalConfigRef.current  = globalConfig;  }, [globalConfig]);
  useEffect(() => { liveFeaturesRef.current  = liveFeatures;  }, [liveFeatures]);
  const dataUid = adminUid || user?.uid || '';
  useDailyOpenPulse(dataUid || null);

  // ── Crash reporter context ────────────────────────────────────────────────
  // Write the logged-in UID and active screen name to window globals so the
  // crash reporter (bootstrapped in main.tsx before React mounts) can read
  // them lazily without needing direct access to React context.
  useEffect(() => {
    (window as any).__crashReporterUid__ = user?.uid ?? null;
    return () => { (window as any).__crashReporterUid__ = null; };
  }, [user]);

  // Cache pre-warm gate: true while PersistQueryClientProvider is rehydrating
  // the IndexedDB cache into the QueryClient memory. Until this completes,
  // queries have no data and every view renders its loading skeleton.
  // Gating here means we show LoadingView for the extra ~50-200 ms it takes
  // to restore the cache, then ALL screens open instantly with data.
  // For first-time users (empty cache) this resolves in <10 ms — no noticeable delay.
  const isRestoringCache = useIsRestoring();

  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  

  const [activeTab, setActiveTab] = useState('dashboard');
  // Keep the crash reporter informed of the active screen name
  useEffect(() => {
    (window as any).__crashReporterScreen__ = activeTab;
  }, [activeTab]);
  const [transactionsFilter, setTransactionsFilter] = useState<'received' | 'paid' | undefined>(undefined);
  const [pendingFilter, setPendingFilter] = useState<'receivable' | 'payable' | undefined>(undefined);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  

  // Modals
  const [showCommandModal, setShowCommandModal] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualEntryType, setManualEntryType] = useState<'sales' | 'purchases' | 'transactions' | 'inventory' | 'expenses' | 'vehicles' | 'parties'>('sales');
  const [manualEntryData, setManualEntryData] = useState<any>(null);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [selectedPartyStatement, setSelectedPartyStatement] = useState<any>(null);
  const [settingsIsOnSubPage, setSettingsIsOnSubPage] = useState(false);
  const [inventoryIsOnSubPage, setInventoryIsOnSubPage] = useState(false);
  const [partiesIsOnSubPage, setPartiesIsOnSubPage] = useState(false);

  // ── FIX: BulkImport and StockValuation use their OWN full-screen tab slot ──
  // Previously these were boolean overlays that rendered on top of the active tab,
  // but the main content div still showed through because nothing blocked it.
  // Solution: treat them as named tabs so only ONE view renders at a time.
  // This eliminates the blank-page bug without any changes to the views themselves.

  // Data for feature views (loaded on demand)
  const [partyStatementLedger, setPartyStatementLedger] = useState<any[]>([]);
  const [partyStatementTransactions, setPartyStatementTransactions] = useState<any[]>([]);
  const [partyStatementLoading, setPartyStatementLoading] = useState(false);
  // Request token to discard stale party-statement responses if the user taps
  // another party before the first fetch resolves.
  const partyStatementReqRef = useRef(0);
  const [stockValuationItems, setStockValuationItems] = useState<any[]>([]);
  const [stockValuationLedger, setStockValuationLedger] = useState<any[]>([]);
  const [stockValuationLoading, setStockValuationLoading] = useState(false);

  // ── Nav state persistence (Modules 2, 6) ────────────────────────────────────
  // Restore the user's last active tab once per login.  The ref guard prevents
  // double-restore if the user dependency re-fires (e.g. on token refresh).
  const navRestoredRef = useRef(false);
  useEffect(() => {
    if (!user || navRestoredRef.current) return;
    navRestoredRef.current = true;
    const saved = restoreNavState(user.uid);
    if (saved && saved !== 'dashboard') setActiveTab(saved);
  }, [user]);

  // Persist the active tab on every change so it survives background + process kill.
  useEffect(() => {
    if (!user) return;
    saveNavState(activeTab, user.uid);
  }, [activeTab, user]);

  // ── Lifecycle resume handler (Modules 10, 8) ────────────────────────────────
  // On foreground resume, if the app was backgrounded for > 5 minutes, lightly
  // invalidate queries so stale data is refreshed on the next component mount.
  // Shorter pauses are left to TanStack's own staleTime/refetchOnMount logic.
  useEffect(() => {
    if (!user) return;
    const cleanup = lifecycleManager.onForeground(() => {
      const bgMs = lifecycleManager.backgroundedMs;
      if (bgMs > 5 * 60 * 1000) invalidateAll(dataUid || user.uid);
    });
    return cleanup;
  }, [user, dataUid, invalidateAll]);

  // 1a. Per-firm settings — RELOAD whenever the viewed firm (dataUid) changes
  //     OR when the user signs in/out. Cheap, idempotent, safe to re-run.
  useEffect(() => {
    let mounted = true;
    const loadSettings = async () => {
      if (user) {
        try {
          initCountersForUser(user.uid);
          const effectiveUid = dataUid || user.uid;
          const s = await ApiService.settings.get(effectiveUid);
          if (mounted) {
            setAppSettings(normalizeAppSettings(s as AppSettings, DEFAULT_SETTINGS));
          }
        } catch (e) { console.error('Settings load failed', e); }
        finally { if (mounted) setSettingsLoaded(true); }
      } else if (!authLoading) {
        // User signed out — cancel pending soft-delete timers so they cannot
        // fire against the next user's Firestore namespace after re-login.
        flushPendingDeletes();
        if (mounted) setSettingsLoaded(true);
      }
    };
    loadSettings();
    return () => { mounted = false; };
  }, [user, authLoading, dataUid]);

  // 1b-i. Onboarding check — runs immediately (localStorage read, zero network cost).
  //        Previously this ran inside runDailyChecks which has a 3-second startup
  //        delay, causing the user to see the dashboard for ~3 s before onboarding
  //        appeared. Now it resolves in the same tick as auth.
  useEffect(() => {
    if (!user) { setShowOnboarding(false); return; }
    const lastSeenKey = `onboarding_last_seen_${user.uid}`;
    const lastSeen    = localStorage.getItem(lastSeenKey);
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    if (!lastSeen || (Date.now() - parseInt(lastSeen, 10)) > ONE_WEEK_MS) {
      setShowOnboarding(true);
    }
  }, [user]);

  // 1b-ii. Daily background services — bound ONLY to the authenticated user,
  //         NOT to dataUid.  Previously these re-fired every time a staff member
  //         switched which firm they were viewing, causing duplicate backup runs
  //         and reminder reschedules per firm-switch.
  useEffect(() => {
    if (!user) return;
    let mounted = true;
    const runDailyChecks = async () => {
      try {
        const effectiveUid = dataUid || user.uid;
        const email = user?.email || undefined;
        // AutoBackup — local file storage, available to all users
        AutoBackupService.checkAndRunDailyBackup(effectiveUid, email).catch(console.error);

        // DailySnapshot — premium: daily_snapshot
        if (hasAccess(subscriptionRef.current, 'daily_snapshot', globalConfigRef.current?.appMode, liveFeaturesRef.current)) {
          DailySnapshotService.checkAndRunDailySnapshot(effectiveUid, email).catch(console.error);
        }

        // Reminder scheduling needs the latest automation settings.
        const s = await ApiService.settings.get(effectiveUid);
        if (!mounted) return;

        // AutoReminder — premium: whatsapp_reminders
        if (hasAccess(subscriptionRef.current, 'whatsapp_reminders', globalConfigRef.current?.appMode, liveFeaturesRef.current)) {
          AutoReminderService.checkAndSchedule(
            effectiveUid,
            (s as AppSettings)?.automation || {},
            () => setActiveTab('pending-dashboard'),
          ).catch(console.error);
        }

        // Recurring transactions — auto-create any due entries (runs for all users)
        RecurringService.checkAndProcess(effectiveUid).catch(console.error);
      } catch (e) { console.error('Daily checks failed', e); }
    };
    // Defer daily checks by 3 s so they don't compete with the critical-path
    // data loads (React Query hydration + first Firestore fetches) that run
    // immediately on auth. Non-critical background work starts after first paint.
    const startTimer = setTimeout(runDailyChecks, 3000);
    return () => { mounted = false; clearTimeout(startTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]); // intentionally NOT depending on dataUid

  // 1c. Sync edit password settings to context whenever settings change.
  // The fallback intentionally reads from DEFAULT_SETTINGS (single source of
  // truth) instead of a hardcoded literal — that way, if the team ever
  // rotates the bundled default in constants.ts, the fallback follows suit
  // automatically without leaving stale "1234" copies scattered through the
  // codebase.
  useEffect(() => {
    const ep = appSettings.edit_password;
    setEditPasswordSettings({
      enabled : ep?.enabled !== false,
      password: ep?.password || DEFAULT_SETTINGS.edit_password?.password || '',
    });
  }, [appSettings, setEditPasswordSettings]);

  // 2. Dark Mode + Theme + StatusBar (unified reactive effect)
  // FORCE_DARK_MODE: set to false to re-enable the light/dark user toggle
  const FORCE_DARK_MODE = true;
  useEffect(() => {
    const isDark = FORCE_DARK_MODE || (appSettings.preferences?.dark_mode ?? false);
    if (isDark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    applyThemeToDocument({ ...appSettings, preferences: { ...(appSettings.preferences || {}), dark_mode: isDark } });
    if (Capacitor.isNativePlatform()) {
      import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
        StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
        StatusBar.setBackgroundColor({ color: '#0b0e1a' }).catch(() => {});
      }).catch(() => {});
    }
  }, [appSettings]);

  // 3. Shortcuts
  useEffect(() => {
    const handleVoice = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.code === 'Space') setShowCommandModal(true);
    };
    window.addEventListener('keydown', handleVoice);
    return () => window.removeEventListener('keydown', handleVoice);
  }, []);

  // Clear sub-screen state when the user navigates to a different tab
  // (e.g. bottom nav tap). Prevents stale overlays from appearing on
  // the wrong tab after hardware-back or direct tab switching.
  const prevActiveTabRef = useRef(activeTab);
  useEffect(() => {
    if (prevActiveTabRef.current !== activeTab) {
      // Left inventory — clear selected item
      if (prevActiveTabRef.current === 'inventory') setSelectedItem(null);
      // Left parties — clear party statement
      if (prevActiveTabRef.current === 'parties') {
        setSelectedPartyStatement(null);
        setPartyStatementLedger([]);
        setPartyStatementTransactions([]);
        setPartyStatementLoading(false);
        partyStatementReqRef.current++;
      }
      prevActiveTabRef.current = activeTab;
    }
  }, [activeTab]);

  // Keep refs in sync with latest state so the back-button handler always
  // reads current values without needing to re-register on every state change.
  const showManualRef          = useRef(showManualModal);
  const showCommandRef         = useRef(showCommandModal);
  const activeTabRef           = useRef(activeTab);
  const selectedItemRef        = useRef(selectedItem);
  const selectedPartyStmtRef   = useRef(selectedPartyStatement);
  useEffect(() => { showManualRef.current        = showManualModal;        }, [showManualModal]);
  useEffect(() => { showCommandRef.current       = showCommandModal;       }, [showCommandModal]);
  useEffect(() => { activeTabRef.current         = activeTab;              }, [activeTab]);
  useEffect(() => { selectedItemRef.current      = selectedItem;           }, [selectedItem]);
  useEffect(() => { selectedPartyStmtRef.current = selectedPartyStatement; }, [selectedPartyStatement]);

  // ── Stable ref to showToast for use inside the back-button handler ────────
  const showToastRef = useRef(showToast);
  useEffect(() => { showToastRef.current = showToast; }, [showToast]);

  // ── Tab navigation history (max 20 entries) ───────────────────────────────
  // Tracks every setActiveTab call so back can return to the real previous tab
  // rather than always jumping straight to dashboard.
  const tabHistoryRef = useRef<string[]>(['dashboard']);
  useEffect(() => {
    const hist = tabHistoryRef.current;
    if (hist[hist.length - 1] !== activeTab) {
      tabHistoryRef.current = [...hist, activeTab].slice(-20);
    }
  }, [activeTab]);

  // ── goBack: shared helper for every top-left back arrow in the app ────────
  // Pops tabHistoryRef so back always returns to the REAL previous tab instead
  // of hard-coding setActiveTab('dashboard') everywhere.  Deep-link filters are
  // cleared when returning to dashboard, matching the existing Android handler.
  const goBack = useCallback(() => {
    const hist = tabHistoryRef.current;
    if (hist.length > 1) {
      const newHist = hist.slice(0, -1);
      tabHistoryRef.current = newHist;
      const prevTab = newHist[newHist.length - 1];
      setActiveTab(prevTab);
      if (prevTab === 'dashboard') {
        setTransactionsFilter(undefined);
        setPendingFilter(undefined);
      }
    } else {
      setActiveTab('dashboard');
    }
  }, []); // stable: only reads refs and calls stable state-setters

  // ── "Press back again to exit" guard ─────────────────────────────────────
  const exitPressedRef = useRef(false);
  const exitTimerRef   = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    let listenerHandle: { remove: () => void } | null = null;
    const setupBackButton = async () => {
      listenerHandle = await CapacitorApp.addListener('backButton', () => {
        // Priority 0 — if keyboard is open, dismiss it first before any navigation
        if (isKeyboardCurrentlyOpen()) {
          dismissKeyboard();
          return;
        }

        // Priority 1 — dismiss topmost registered overlay (modal / dialog / sheet)
        if (BackStack.dismissTop()) return;

        // Priority 2 — exit party statement overlay
        if (selectedPartyStmtRef.current) {
          setSelectedPartyStatement(null);
          setPartyStatementLedger([]);
          setPartyStatementTransactions([]);
          setPartyStatementLoading(false);
          return;
        }

        // Priority 3 — exit inventory item detail view
        if (selectedItemRef.current && activeTabRef.current === 'inventory') {
          setSelectedItem(null);
          return;
        }

        // Priority 4 — navigate to previous tab via history
        // goBack() uses tabHistoryRef internally; only enter here if there IS history
        // so the exit guard (Priority 5) still fires when history is exhausted.
        if (tabHistoryRef.current.length > 1) {
          goBack();
          return;
        }

        // Priority 5 — exit app with "press back again" confirmation toast
        if (exitPressedRef.current) {
          clearTimeout(exitTimerRef.current);
          CapacitorApp.exitApp();
        } else {
          exitPressedRef.current = true;
          showToastRef.current('Press back again to exit', 'info');
          exitTimerRef.current = setTimeout(() => {
            exitPressedRef.current = false;
          }, 2000);
        }
      });
    };
    setupBackButton();
    return () => {
      listenerHandle?.remove();
      clearTimeout(exitTimerRef.current);
    };
  }, []); // register ONCE — refs keep the handler up-to-date without re-registering

  // Initialize Capacitor native plugins on first mount
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    // Keyboard: disable WebView scroll-assist + hide accessory bar
    // so our centralised keyboard manager has full control.
    safeKeyboardInit();
  }, []);

  const openManual = (type: any, data: any = null) => {
    setManualEntryType(type);
    setManualEntryData(data);
    setShowManualModal(true);
  };

  // ── FIX: StockValuation loads data THEN switches activeTab to 'stock-valuation'
  // so the full view occupies the entire viewport — no overlay issues.
  // Navigation guard: if no access, navigate anyway — FeatureGate renders upgrade prompt
  // and we skip the costly Firestore data-load entirely.
  const openStockValuation = async () => {
    if (!hasAccess(subscription, 'stock_valuation', globalConfig?.appMode, liveFeatures)) {
      setActiveTab('stock-valuation');
      return;
    }
    setStockValuationLoading(true);
    try {
      const [invSnap, ledgerSnap] = await Promise.all([
        ApiService.getAll(dataUid, 'inventory'),
        ApiService.getAll(dataUid, 'ledger_entries'),
      ]);
      setStockValuationItems(invSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })));
      setStockValuationLedger(ledgerSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })));
      setActiveTab('stock-valuation');
    } catch (e) {
      // Surface the failure to the user — silently swallowing it would leave
      // them on the dashboard wondering why the button "did nothing".
      console.error('StockValuation load failed', e);
      showToast('Could not load stock valuation. Check your connection and try again.', 'error');
    } finally {
      setStockValuationLoading(false);
    }
  };

  const openPartyStatement = async (party: any) => {
    // Bump the request token first so any in-flight previous request resolves
    // into a no-op below.  This prevents the classic "tap A, tap B, see B's
    // name with A's data" race on slow connections.
    const reqId = ++partyStatementReqRef.current;
    setSelectedPartyStatement(party);
    setPartyStatementLedger([]);
    setPartyStatementTransactions([]);
    setPartyStatementLoading(true);
    try {
      const [ledgerSnap, transSnap] = await Promise.all([
        ApiService.getAll(dataUid, 'ledger_entries'),
        ApiService.getAll(dataUid, 'transactions'),
      ]);
      // Discard the response if the user has since tapped a different party.
      if (reqId !== partyStatementReqRef.current) return;
      setPartyStatementLedger(ledgerSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })));
      setPartyStatementTransactions(transSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error('PartyStatement load failed', e);
    } finally {
      if (reqId === partyStatementReqRef.current) setPartyStatementLoading(false);
    }
  };

  // ── Navigation guard ───────────────────────────────────────────────────────
  // Wraps setActiveTab for any tab that requires a subscription feature.
  // FeatureGate renders the upgrade prompt; this guard prevents unnecessary
  // data-loads (e.g. stock valuation) when the user doesn't have access.
  const safeNavigate = (tab: string) => {
    const requiredFeature = TAB_FEATURE_GATE[tab];
    if (requiredFeature && !hasAccess(subscription, requiredFeature, globalConfig?.appMode, liveFeatures)) {
      setActiveTab(tab); // FeatureGate handles the upgrade prompt
      return;
    }
    setSelectedItem(null);
    setActiveTab(tab);
  };

  const handleQuickAction = (action: string) => {
    switch (action) {
      case 'sale':              openManual('sales');                break;
      case 'purchase':          openManual('purchases');            break;
      case 'transaction':       openManual('transactions');         break;
      case 'party':             openManual('parties');              break;
      case 'item':              openManual('inventory');            break;
      case 'expense':           openManual('expenses');             break;
      case 'bulk-import':       safeNavigate('bulk-import');        break;
      case 'stock-valuation':   openStockValuation();               break;
      default:
        safeNavigate(action);
        break;
    }
  };

  const handleToggleTheme = useCallback(async () => {
    if (!user) return;
    const newDark = !(appSettings.preferences?.dark_mode ?? false);
    const newSettings = normalizeAppSettings({
      ...appSettings,
      preferences: { ...(appSettings.preferences || {}), dark_mode: newDark }
    }, DEFAULT_SETTINGS);
    try {
      await ApiService.settings.save(dataUid || user.uid, newSettings);
      setAppSettings(newSettings);
    } catch (_) {}
  }, [appSettings, dataUid, user]);

  // FIX: invalidateAll is now correctly in scope from useData() above
  const handleRefresh = () => invalidateAll(dataUid);

  if (authLoading) return <LoadingView />;
  if (!user) return <LoginView />;

  // Wait for all critical data before rendering the full app shell.
  // This prevents: (a) lock-screen flash, (b) "set up my business" flash,
  // (c) theme/color jump, (d) partially-loaded dashboard cards.
  // isRestoringCache: also hold until IndexedDB cache is fully rehydrated into
  // the QueryClient — prevents per-view loading skeletons for returning users.
  if (!settingsLoaded || roleLoading || subscriptionLoading || isRestoringCache) return <LoadingView />;

  // If staff role doc exists but has no adminUid, fall through and let them use
  // the app as if they were a fresh user — they can accept an invitation later.

  if (showOnboarding && user) {
    return (
      <OnboardingView
        onComplete={() => {
          const lastSeenKey = `onboarding_last_seen_${user.uid}`;
          localStorage.setItem(lastSeenKey, Date.now().toString());
          setShowOnboarding(false);
          markRegistrationComplete();
        }}
      />
    );
  }

  // ── Helper: is a "feature tab" active (overrides normal tab rendering) ────
  const featureTab = activeTab === 'bulk-import' || activeTab === 'stock-valuation' || activeTab === 'staff-invitations' || activeTab === 'daily-snapshots' || activeTab === 'pos-billing';

  // ── Dynamic navigation: auto-hide bottom bar on non-nav pages ────────────
  // Tabs that have a direct button in the bottom nav bar.
  // Tabs that appear in the bottom nav.  'reports' is intentionally excluded
  // (see showBottomNav guard below) — keep it out of this list so the source
  // matches the actual UI surface and we don't regress by adding a stray
  // Reports button when that exclusion is later refactored.
  const NAV_TABS = ['dashboard', 'inventory', 'parties', 'settings'];
  // If dynamic_nav preference is enabled (default: true), hide when not on a nav tab.
  const dynamicNavEnabled = appSettings.preferences?.dynamic_nav !== false;
  // Hide on sub-pages inside inventory (item detail) and parties (party statement).
  const isOnSubPage =
    (activeTab === 'inventory' && (!!selectedItem || inventoryIsOnSubPage)) ||
    (activeTab === 'parties'   && (!!selectedPartyStatement || partiesIsOnSubPage)) ||
    (activeTab === 'settings'  && settingsIsOnSubPage);
  // Also hide bottom nav when the keyboard is open — the nav would otherwise
  // float above the keyboard, wasting precious screen space on short devices.
  // isOnSubPage is always respected regardless of dynamicNavEnabled.
  const showBottomNav = (!dynamicNavEnabled || NAV_TABS.includes(activeTab)) && !isOnSubPage && !isKeyboardOpen;

  // ── Tap-outside-to-dismiss keyboard ─────────────────────────────────────────
  // When the user taps anywhere that is NOT an input/textarea/select/button,
  // dismiss the software keyboard. This mirrors native Android behaviour.
  const handleTouchOutside = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isKeyboardCurrentlyOpen()) return;
    const target = e.target as HTMLElement;
    if (!target) return;
    const tag = target.tagName.toLowerCase();
    const isInteractive =
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      target.contentEditable === 'true' ||
      target.closest('input, textarea, select, [contenteditable]');
    if (!isInteractive) {
      dismissKeyboard();
    }
  };

  // Detect platform for Android-specific style overrides
  const isAndroid = Capacitor.getPlatform() === 'android';

  return (
    <div className="h-screen w-full text-foreground font-sans flex flex-col pt-safe"
      style={{ background: 'var(--app-bg)', maxWidth: '100vw', overflowX: 'hidden' }}
      onTouchStart={handleTouchOutside}>
      <SeoHead />
      <UpdateBanner />
      <OfflineIndicator />
      <SyncStatusToastBridge />
      {isViewingOtherFirm && activeFirm && (
        <div className="shrink-0 px-4 py-2 flex items-center gap-3" style={{ background: 'rgba(245,158,11,0.1)', borderBottom: '1px solid rgba(245,158,11,0.2)' }}>
          <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'rgba(245,158,11,0.2)' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/></svg>
          </div>
          <p className="text-[11px] font-black flex-1" style={{ color: '#fbbf24' }}>
            Viewing: {activeFirm.firmName} ({activeFirm.role})
          </p>
        </div>
      )}
      <EmailVerificationBanner />
      {/* WhatsNew disabled — will be re-enabled when update info is ready */}
      <UndoSnackbar />
      <LockScreen
        settings={appSettings}
        settingsLoaded={settingsLoaded}
        user={user}
        onPinChanged={async (newPin: string) => {
          const uid = dataUid || user?.uid;
          if (!uid) return;
          const newSettings = {
            ...appSettings,
            security: { ...(appSettings?.security || {}), pin: newPin },
          };
          const normalized = normalizeAppSettings(newSettings as any, DEFAULT_SETTINGS);
          await ApiService.settings.save(uid, normalized);
          setAppSettings(normalized);
        }}
      />
      <AnnouncementBanner subscriptionStatus={subscription?.status} />

      {/* MAIN VIEWPORT */}
      <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden relative"
        style={{ paddingBottom: showBottomNav ? 'calc(80px + env(safe-area-inset-bottom, 0px))' : 'env(safe-area-inset-bottom, 0px)' }}>
      {/* Module 2 — ScreenErrorBoundary: keyed by activeTab so it auto-resets
          on every navigation. Errors inside a screen are contained here;
          the bottom nav and global shell remain fully functional. */}
      <ScreenErrorBoundary
        key={activeTab}
        screenName={activeTab}
        onNavigateToDashboard={() => setActiveTab('dashboard')}
      >
      <Suspense fallback={<LoadingView />}>
        {/* ── FIX: BulkImportView as a proper full-tab view ─────────────────── */}
        {activeTab === 'bulk-import' && (
          <FeatureGate feature="bulk_import" onBack={goBack} onGoToSubscription={() => goToSubscriptionTab(setActiveTab)}>
            <BulkImportView
              user={{ ...user!, uid: dataUid }}
              settings={appSettings}
              onBack={goBack}
            />
          </FeatureGate>
        )}

        {/* ── FIX: StockValuationView as a proper full-tab view ─────────────── */}
        {activeTab === 'stock-valuation' && (
          <FeatureGate feature="stock_valuation" onBack={goBack} onGoToSubscription={() => goToSubscriptionTab(setActiveTab)}>
            <StockValuationView
              items={stockValuationItems}
              ledger={stockValuationLedger}
              settings={appSettings}
              onBack={() => {
                setActiveTab('dashboard');
                setStockValuationItems([]);
                setStockValuationLedger([]);
              }}
              onViewItem={(item) => {
                setSelectedItem(item);
                setActiveTab('inventory');
              }}
            />
          </FeatureGate>
        )}

        {/* ── Staff Invitations full-tab view ─────────────────────────── */}
        {activeTab === 'staff-invitations' && (
          <div className="h-full flex flex-col" style={{ background: 'var(--app-bg)' }}>
            <div className="shrink-0 px-4 pt-5 pb-4 flex items-center gap-3 border-b"
              style={{ background: 'rgba(var(--app-bg-rgb),0.95)', backdropFilter: 'blur(20px)', borderColor: 'rgba(255,255,255,0.06)' }}>
              <button onClick={() => setActiveTab('settings')} className="p-2 rounded-xl active:scale-95 transition-all"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(240,244,255,0.95)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
              </button>
              <div className="flex-1 min-w-0">
                <h1 className="font-black text-base text-[rgba(240,244,255,0.95)] tracking-tight">Invitations & Firms</h1>
                <p className="text-[10px] text-[rgba(148,163,184,0.45)]">Accept invites, switch accounts</p>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4" style={{ WebkitOverflowScrolling: 'touch', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}>
              <FirmSwitcher />
            </div>
          </div>
        )}

        {/* ── Daily Snapshot Archive ───────────────────────────────────── */}
        {activeTab === 'daily-snapshots' && (
          <FeatureGate feature="daily_snapshot" onBack={goBack} onGoToSubscription={() => goToSubscriptionTab(setActiveTab)}>
            <DailySnapshotView
              userId={dataUid}
              userEmail={user?.email || undefined}
              onBack={goBack}
            />
          </FeatureGate>
        )}

        {/* ── POS / Quick Billing — single-screen sale entry ───────────── */}
        {activeTab === 'pos-billing' && (
          <FeatureGate feature="pos_billing" onBack={goBack} onGoToSubscription={() => goToSubscriptionTab(setActiveTab)}>
            <POSBillingView
              user={{ ...user!, uid: dataUid }}
              appSettings={appSettings}
              onBack={goBack}
            />
          </FeatureGate>
        )}

        {/* ── All other tabs — only rendered when NOT a feature tab ─────────── */}
        {!featureTab && (
          <>
            {activeTab === 'dashboard' && (
              <DashboardView
                key="dashboard"
                user={{ ...user!, uid: dataUid }}
                appSettings={appSettings}
                onNavigate={(tab, params) => {
                  if (tab === 'transactions' && params?.typeFilter) {
                    setTransactionsFilter(params.typeFilter as 'received' | 'paid');
                  } else {
                    setTransactionsFilter(undefined);
                  }
                  if (tab === 'pending-dashboard' && params?.filter) {
                    setPendingFilter(params.filter as 'receivable' | 'payable');
                  } else if (tab !== 'pending-dashboard') {
                    setPendingFilter(undefined);
                  }
                  setActiveTab(tab);
                }}
                onQuickAction={handleQuickAction}
                onToggleTheme={handleToggleTheme}
              />
            )}

            {activeTab === 'inventory' && !selectedItem && (
              <InventoryView
                user={{ ...user!, uid: dataUid }}
                settings={appSettings}
                onAdd={() => openManual('inventory')}
                onEdit={(item) => openManual('inventory', item)}
                onBack={goBack}
                onViewItem={(item) => setSelectedItem(item)}
                onOpenWaste={() => setActiveTab('waste')}
                onOpenStockValuation={openStockValuation}
                onSubPageChange={setInventoryIsOnSubPage}
              />
            )}
            {activeTab === 'inventory' && selectedItem && (
              <ItemDetailView
                user={{ ...user!, uid: dataUid }}
                item={selectedItem}
                onBack={() => setSelectedItem(null)}
              />
            )}

            {/* Party Statement — scoped to parties tab to prevent bleed on hardware back */}
            {activeTab === 'parties' && selectedPartyStatement && partyStatementLoading && (
              <div className="flex flex-col h-full">
                <div className="px-4 py-3 flex items-center gap-3"
                  style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                  <button
                    onClick={() => {
                      partyStatementReqRef.current++; // cancel in-flight fetch
                      setSelectedPartyStatement(null);
                      setPartyStatementLedger([]);
                      setPartyStatementTransactions([]);
                      setPartyStatementLoading(false);
                    }}
                    className="text-white/70 text-sm font-bold">←</button>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-white/40">Party Statement</p>
                    <p className="text-sm font-bold text-white truncate max-w-[60vw]">
                      {selectedPartyStatement.name || selectedPartyStatement.party_name || '—'}
                    </p>
                  </div>
                </div>
                <div className="flex-1 flex items-center justify-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 rounded-full border-2 border-white/10 border-t-white/60 animate-spin" />
                    <p className="text-xs text-white/50 font-semibold">Loading statement…</p>
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'parties' && selectedPartyStatement && !partyStatementLoading && (
              <PartyStatementView
                party={selectedPartyStatement}
                ledger={partyStatementLedger}
                transactions={partyStatementTransactions}
                settings={appSettings}
                onBack={() => {
                  setSelectedPartyStatement(null);
                  setPartyStatementLedger([]);
                  setPartyStatementTransactions([]);
                }}
              />
            )}

            {!selectedPartyStatement && activeTab === 'parties' && (
              <PartiesView
                user={{ ...user!, uid: dataUid }}
                onAdd={() => openManual('parties')}
                onEdit={(item) => openManual('parties', item)}
                onBack={goBack}
                appSettings={appSettings}
                onViewStatement={openPartyStatement}
                onSubPageChange={setPartiesIsOnSubPage}
              />
            )}

            {activeTab === 'settings' && isAdmin && (
              <SettingsView
                user={{ ...user!, uid: dataUid }}
                appSettings={appSettings}
                onUpdateSettings={async (newSettings) => {
                  const normalized = normalizeAppSettings(newSettings, DEFAULT_SETTINGS);
                  const prevEnabled = !!appSettings.security?.enabled;
                  const nextEnabled = !!normalized.security?.enabled;
                  const prevPin = appSettings.security?.pin || '';
                  const nextPin = normalized.security?.pin || '';
                  if ((!prevEnabled && nextEnabled) || (prevPin !== nextPin && nextEnabled)) {
                    sessionStorage.removeItem('app_unlocked');
                  }
                  await ApiService.settings.save(dataUid || user.uid, normalized);
                  setAppSettings(normalized);
                }}
                onBack={goBack}
                onNavigate={(tab) => setActiveTab(tab)}
                onSubPageChange={setSettingsIsOnSubPage}
              />
            )}
            {activeTab === 'settings' && isStaff && (
              <div className="flex flex-col h-full">
                <div className="flex items-center gap-3 px-4 pt-6 pb-4">
                  <button onClick={() => setActiveTab('dashboard')} className="p-2.5 rounded-full active:scale-95 transition-all" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>
                  </button>
                  <h1 className="font-black text-lg text-[rgba(240,244,255,0.95)]">More</h1>
                </div>
                <div className="flex-1 overflow-y-auto px-4 space-y-3" style={{ WebkitOverflowScrolling: 'touch', minHeight: 0, paddingBottom: 'calc(96px + env(safe-area-inset-bottom, 0px))' }}>
                  {/* Invitations & Firms button */}
                  <button onClick={() => setActiveTab('staff-invitations')}
                    className="w-full flex items-center gap-4 p-4 rounded-[18px] active:scale-95 transition-all text-left"
                    style={{ background: 'rgba(244,114,182,0.08)', border: '1px solid rgba(244,114,182,0.2)' }}>
                    <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(244,114,182,0.15)' }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f472b6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/></svg>
                    </div>
                    <div className="flex-1">
                      <p className="font-black text-sm" style={{ color: '#f472b6' }}>Invitations & Firms</p>
                      <p className="text-[10px] text-[rgba(148,163,184,0.45)]">Accept invites, switch accounts</p>
                    </div>
                    {pendingInvitations.length > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black" style={{ background: 'rgba(244,114,182,0.2)', color: '#f472b6' }}>
                        {pendingInvitations.length}
                      </span>
                    )}
                  </button>

                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] px-1 mb-2">Your Access</p>
                  {[
                    { id: 'vehicles',      label: 'Vehicles',  sub: 'Fleet management',  iconColor: '#16a34a' },
                    { id: 'ledger',        label: 'Ledger',    sub: 'Party accounts',    iconColor: '#3b82f6' },
                    { id: 'transactions',  label: 'Payments',  sub: 'Cash transactions', iconColor: '#7c3aed' },
                    { id: 'waste',         label: 'Waste Log', sub: 'Discarded stock',   iconColor: '#ef4444' },
                    { id: 'game-timeline', label: 'Timeline',  sub: 'Activity history',  iconColor: '#4f46e5' },
                  ].map(({ id, label, sub, iconColor }) => (
                    <button key={id} onClick={() => setActiveTab(id)}
                      className="w-full flex items-center gap-4 p-4 rounded-[18px] active:scale-95 transition-all text-left"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}>
                      <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                      </div>
                      <div>
                        <p className="font-black text-sm" style={{ color: iconColor }}>{label}</p>
                        <p className="text-[10px] text-[rgba(148,163,184,0.45)]">{sub}</p>
                      </div>
                    </button>
                  ))}
                  <div className="pt-4 pb-2">
                    <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] text-center">Settings managed by admin</p>
                  </div>
                </div>
              </div>
            )}

            {/* Sub Views */}
            {activeTab === 'sales-dashboard' && <SalesDashboard user={{ ...user!, uid: dataUid }} onBack={goBack} />}
            {activeTab === 'purchase-dashboard' && <PurchaseDashboard user={{ ...user!, uid: dataUid }} onBack={goBack} />}
            {activeTab === 'pending-dashboard' && <PendingView user={{ ...user!, uid: dataUid }} onBack={() => { setPendingFilter(undefined); goBack(); }} appSettings={appSettings} initialFilter={pendingFilter} />}
            {activeTab === 'reports' && isAdmin && (
              <FeatureGate feature="reports" onBack={goBack} onGoToSubscription={() => goToSubscriptionTab(setActiveTab)}>
                <ReportsView user={{ ...user!, uid: dataUid }} onBack={goBack} />
              </FeatureGate>
            )}
            {activeTab === 'analytics' && isAdmin && (
              <FeatureGate feature="advanced_analytics" onBack={goBack} onGoToSubscription={() => goToSubscriptionTab(setActiveTab)}>
                <AdvancedAnalyticsDashboard
                  user={{ ...user!, uid: dataUid }}
                  ledgerData={[]}
                  expenseData={[]}
                  transactionData={[]}
                  inventoryData={[]}
                  settings={appSettings}
                  onBack={goBack}
                />
              </FeatureGate>
            )}
            {activeTab === 'reports' && isStaff && (
              <div className="flex flex-col h-full">
                <div className="flex items-center gap-3 px-4 pt-6 pb-4">
                  <button onClick={() => setActiveTab('dashboard')} className="p-2.5 rounded-full active:scale-95 transition-all" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>
                  </button>
                  <h1 className="font-black text-lg text-[rgba(240,244,255,0.95)]">Reports</h1>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-4">
                  <div className="w-16 h-16 rounded-[22px] flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
                  </div>
                  <div>
                    <p className="font-black text-base text-[rgba(203,213,225,0.75)]">Admin Only</p>
                    <p className="text-xs text-[rgba(148,163,184,0.45)] mt-1">Reports & analytics are accessible to admins only.</p>
                  </div>
                </div>
              </div>
            )}

            {/* Legacy views */}
            {activeTab === 'ledger' && <LedgerView user={{ ...user!, uid: dataUid }} onBack={goBack} appSettings={appSettings} />}
            {activeTab === 'transactions' && <TransactionsView user={{ ...user!, uid: dataUid }} onBack={() => { setTransactionsFilter(undefined); goBack(); }} appSettings={appSettings} initialTypeFilter={transactionsFilter} />}
            {activeTab === 'expenses' && isAdmin && <ExpensesView user={{ ...user!, uid: dataUid }} appSettings={appSettings} onAdd={() => openManual('expenses')} onEdit={(item) => openManual('expenses', item)} onBack={goBack} />}
            {activeTab === 'expenses' && isStaff && (
              <div className="flex flex-col h-full">
                <div className="flex items-center gap-3 px-4 pt-6 pb-4">
                  <button onClick={() => setActiveTab('dashboard')} className="p-2.5 rounded-full active:scale-95 transition-all" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>
                  </button>
                  <h1 className="font-black text-lg text-[rgba(240,244,255,0.95)]">Expenses</h1>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-4">
                  <div className="w-16 h-16 rounded-[22px] flex items-center justify-center" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12V22H4V12" /><path d="M22 7H2v5h20V7z" /><path d="M12 22V7" /><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" /><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" /></svg>
                  </div>
                  <div>
                    <p className="font-black text-base text-[rgba(203,213,225,0.75)]">Admin Only</p>
                    <p className="text-xs text-[rgba(148,163,184,0.45)] mt-1">Expense records are visible to admins only.</p>
                  </div>
                  <button onClick={() => handleQuickAction('expense')}
                    className="px-6 py-3 rounded-2xl text-white font-black text-sm active:scale-95 transition-all"
                    style={{ background: 'linear-gradient(135deg,#f59e0b,#d97706)', boxShadow: '0 4px 16px rgba(245,158,11,0.35)' }}>
                    + Add Expense
                  </button>
                </div>
              </div>
            )}
            {activeTab === 'vehicles' && <VehiclesView user={{ ...user!, uid: dataUid }} onAdd={() => openManual('vehicles')} onEdit={(item) => openManual('vehicles', item)} onBack={goBack} appSettings={appSettings} />}
            {activeTab === 'waste' && <WasteView user={{ ...user!, uid: dataUid }} onBack={goBack} />}
            {activeTab === 'game-timeline' && (
              <FeatureGate feature="game_timeline" onBack={goBack} onGoToSubscription={() => goToSubscriptionTab(setActiveTab)}>
                <GameTimelineView user={{ ...user!, uid: dataUid }} onBack={goBack} />
              </FeatureGate>
            )}
          </>
        )}
      </Suspense>
      </ScreenErrorBoundary>
      </main>

      {/* ═══ BENTO GLASS BOTTOM NAV ═══ */}
      {showBottomNav && <nav className="app-bottom-nav fixed bottom-0 left-0 right-0 z-50 pointer-events-none"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="mx-3 mb-2 pointer-events-auto">
          <div className="rounded-[28px] px-2 py-2 flex justify-between items-center relative"
            style={{
              background: 'linear-gradient(135deg, rgba(26,5,51,0.97) 0%, rgba(15,31,92,0.97) 55%, rgba(10,46,74,0.97) 100%)',
              backdropFilter: isAndroid ? 'none' : 'blur(32px)',
              WebkitBackdropFilter: isAndroid ? 'none' : 'blur(32px)',
              border: '1px solid rgba(99,130,210,0.18)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 2px 0 rgba(99,130,210,0.12) inset',
            }}>
            <div className="absolute top-0 left-8 right-8 h-px rounded-full" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)' }} />

            {[
              { id: 'dashboard', Icon: LayoutDashboard, label: 'Home' },
              { id: 'inventory', Icon: Package, label: 'Stock' },
            ].map(({ id, Icon, label }) => {
              const active = activeTab === id;
              return (
                <button key={id} onClick={() => setActiveTab(id)}
                  className="relative flex flex-col items-center gap-1 px-5 py-2.5 rounded-[22px] transition-all duration-300 min-w-[60px]"
                  style={active ? { transform: 'scale(1.05)' } : {}}>
                  {active && (
                    <>
                      <div className="absolute inset-0 rounded-[22px]" style={{ background: 'rgba(139,92,246,0.18)', border: '1px solid rgba(139,92,246,0.25)' }} />
                      <div className="absolute inset-0 rounded-[22px]" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(139,92,246,0.25), transparent 70%)' }} />
                    </>
                  )}
                  <Icon size={20} strokeWidth={active ? 2.5 : 1.8} className="relative z-10 transition-all duration-300"
                    style={{ color: active ? '#a78bfa' : 'rgba(148,163,184,0.6)', filter: active ? 'drop-shadow(0 0 8px rgba(167,139,250,0.7))' : 'none' }} />
                  <span className="text-[9px] font-black tracking-wider uppercase relative z-10"
                    style={{ color: active ? '#a78bfa' : 'rgba(148,163,184,0.45)' }}>{label}</span>
                </button>
              );
            })}

            {/* Center AI FAB */}
            <button onClick={() => setShowCommandModal(true)} className="relative flex-shrink-0 -translate-y-4">
              <div className="absolute -inset-3 rounded-[28px] blur-xl animate-pulse" style={{ background: 'rgba(167,139,250,0.3)' }} />
              <div className="relative w-[58px] h-[58px] rounded-[22px] flex items-center justify-center active:scale-90 transition-all duration-200"
                style={{ background: 'linear-gradient(145deg, #7c3aed, #4f46e5)', boxShadow: '0 12px 36px rgba(124,58,237,0.6), 0 4px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.25)', border: '1px solid rgba(167,139,250,0.4)' }}>
                <Mic size={22} className="text-white" strokeWidth={2} style={{ filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.5))' }} />
              </div>
              <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[8px] font-black tracking-widest uppercase whitespace-nowrap"
                style={{ color: 'rgba(167,139,250,0.6)' }}>AI</span>
            </button>

            {[
              { id: 'parties', Icon: Users, label: 'Parties' },
              ...(isAdmin ? [{ id: 'settings', Icon: Settings, label: 'More' }] : [{ id: 'reports', Icon: Settings, label: 'Reports' }]),
            ].map(({ id, Icon, label }) => {
              const active = activeTab === id;
              return (
                <button key={id} onClick={() => setActiveTab(id)}
                  className="relative flex flex-col items-center gap-1 px-5 py-2.5 rounded-[22px] transition-all duration-300 min-w-[60px]"
                  style={active ? { transform: 'scale(1.05)' } : {}}>
                  {active && (
                    <>
                      <div className="absolute inset-0 rounded-[22px]" style={{ background: 'rgba(139,92,246,0.18)', border: '1px solid rgba(139,92,246,0.25)' }} />
                      <div className="absolute inset-0 rounded-[22px]" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(139,92,246,0.25), transparent 70%)' }} />
                    </>
                  )}
                  <Icon size={20} strokeWidth={active ? 2.5 : 1.8} className="relative z-10 transition-all duration-300"
                    style={{ color: active ? '#a78bfa' : 'rgba(148,163,184,0.6)', filter: active ? 'drop-shadow(0 0 8px rgba(167,139,250,0.7))' : 'none' }} />
                  <span className="text-[9px] font-black tracking-wider uppercase relative z-10"
                    style={{ color: active ? '#a78bfa' : 'rgba(148,163,184,0.45)' }}>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>}

      <Suspense fallback={null}>
        <CommandModal isOpen={showCommandModal} onClose={() => setShowCommandModal(false)} user={{ ...user!, uid: dataUid }} />
      </Suspense>
      <Suspense fallback={null}>
        <ManualEntryModal
          isOpen={showManualModal}
          onClose={() => { setShowManualModal(false); setManualEntryData(null); }}
          type={manualEntryType}
          user={{ ...user!, uid: dataUid }}
          initialData={manualEntryData}
          appSettings={appSettings}
          onSuccess={() => { handleRefresh(); setShowManualModal(false); setManualEntryData(null); }}
        />
      </Suspense>
    </div>
  );
};

const App = () => (
  <HashRouter>
    <AuthProvider>
      <SubscriptionProvider>
        <UIProvider>
          <DataProvider>
            <RoleProvider>
              <EditPasswordProvider>
                <KeyboardProvider>
                  <AppContent />
                </KeyboardProvider>
              </EditPasswordProvider>
            </RoleProvider>
          </DataProvider>
        </UIProvider>
      </SubscriptionProvider>
    </AuthProvider>
  </HashRouter>
);

export default App;