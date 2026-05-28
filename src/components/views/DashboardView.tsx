import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { parseDateSafe } from '../../utils/dateUtils';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { NotificationService } from '../../services/notificationService';
import { User } from 'firebase/auth';
import {
  TrendingUp, TrendingDown, Plus, Upload,
  Wallet, ArrowRightLeft, FileText, BookOpen, Lock, Truck, Trash2,
  Lightbulb, Calendar, ChevronDown, ChevronUp, ArrowUpRight, ArrowDownLeft,
  Clock, Footprints, LogOut, BarChart3, ChevronLeft, ChevronRight,
  Filter, X, ShoppingCart, PackagePlus, ReceiptText, BarChart2, CheckCircle2,
  Users, Eye, EyeOff, Sun, Moon,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { useRole } from '../../context/RoleContext';
import { useUI } from '../../context/UIContext';
import { useSubscription } from '../../context/SubscriptionContext';
import { hasAccess, FeatureKey } from '../../utils/featureAccess';
import { ApiService } from '../../services/api';
import { AppSettings } from '../../types';
import { QuickActionButton, MetricCard } from './DashboardWidgets';
import InsightModal from '../modals/InsightModal';
import SalesChart from '../charts/SalesChart';
import CategoryPieChart from '../charts/CategoryPieChart';
import LowStockWidget from '../widgets/LowStockWidget';
import DashboardAnalyticsWidget from '../widgets/DashboardAnalyticsWidget';
import ReorderWidget from '../widgets/ReorderWidget';
import SmartRemindersWidget from '../widgets/SmartRemindersWidget';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import { useIsDark as useIsDarkHook } from '../../hooks/useIsDark';

interface DashboardViewProps {
  user: User;
  appSettings: AppSettings;
  onNavigate: (tab: string, params?: Record<string, string>) => void;
  onQuickAction?: (action: string) => void;
  onToggleTheme?: () => void;
}

type PeriodMode = 'business-year' | 'month' | 'custom';

interface PeriodFilter {
  mode: PeriodMode;
  monthYear: number;
  monthMonth: number;
  customStart: string;
  customEnd: string;
}

function getCurrentBusinessYear(): { start: Date; end: Date; label: string } {
  const now = new Date();
  const y   = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    start: new Date(y, 3, 1),
    end:   new Date(y + 1, 2, 31, 23, 59, 59),
    label: `FY ${y}-${String(y + 1).slice(2)}`,
  };
}

// FIX: Removed the unused `y` variable that was computed and immediately discarded.
function getDefaultPeriod(): PeriodFilter {
  const now = new Date();
  return {
    mode:        'business-year',
    monthYear:   now.getFullYear(),
    monthMonth:  now.getMonth(),
    customStart: '',
    customEnd:   '',
  };
}

function getPeriodDateRange(p: PeriodFilter): { start: Date; end: Date; label: string } {
  if (p.mode === 'business-year') return getCurrentBusinessYear();
  if (p.mode === 'month') {
    const start = new Date(p.monthYear, p.monthMonth, 1);
    const end   = new Date(p.monthYear, p.monthMonth + 1, 0, 23, 59, 59);
    const label = start.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    return { start, end, label };
  }
  const start = p.customStart ? new Date(p.customStart + 'T00:00:00') : new Date(0);
  const end   = p.customEnd   ? new Date(p.customEnd   + 'T23:59:59') : new Date();
  const fmt   = (s: string) => s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : '?';
  return { start, end, label: `${fmt(p.customStart)} – ${fmt(p.customEnd)}` };
}

function parseRecordDate(raw: any): Date {
  return parseDateSafe(raw);
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const PeriodFilterPanel: React.FC<{
  filter: PeriodFilter;
  onChange: (f: PeriodFilter) => void;
  onClose: () => void;
}> = ({ filter, onChange, onClose }) => {
  const [local, setLocal] = useState<PeriodFilter>(filter);
  const isDark = useIsDarkHook();

  const prevMonth = () => setLocal(p => {
    const d = new Date(p.monthYear, p.monthMonth - 1, 1);
    return { ...p, monthYear: d.getFullYear(), monthMonth: d.getMonth() };
  });
  const nextMonth = () => setLocal(p => {
    const d = new Date(p.monthYear, p.monthMonth + 1, 1);
    return { ...p, monthYear: d.getFullYear(), monthMonth: d.getMonth() };
  });
  const apply = () => { onChange(local); onClose(); };

  return (
    <div className="period-filter-panel rounded-3xl p-4 space-y-4" style={{ background: 'rgba(15,20,40,0.97)', border: '1px solid rgba(139,92,246,0.25)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
      <div className="flex gap-1.5 p-1 rounded-2xl" style={{ background: 'rgba(255,255,255,0.06)' }}>
        {([
          { key: 'business-year', label: 'Business Year' },
          { key: 'month',         label: 'Month' },
          { key: 'custom',        label: 'Custom' },
        ] as { key: PeriodMode; label: string }[]).map(({ key, label }) => (
          <button key={key} onClick={() => setLocal(p => ({ ...p, mode: key }))}
            className="flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-wide transition-all"
            style={local.mode === key
              ? { background: 'rgba(139,92,246,0.35)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.4)' }
              : { color: 'rgba(148,163,184,0.5)' }}>
            {label}
          </button>
        ))}
      </div>

      {local.mode === 'business-year' && (
        <div className="flex items-center gap-3 p-3 rounded-2xl" style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)' }}>
          <Calendar size={16} style={{ color: '#a78bfa' }} />
          <div>
            <p className="text-xs font-black" style={{ color: '#a78bfa' }}>{getCurrentBusinessYear().label}</p>
            <p className="text-[9px] font-semibold" style={{ color: 'rgba(148,163,184,0.5)' }}>Apr 1 – Mar 31 (Indian FY)</p>
          </div>
        </div>
      )}

      {local.mode === 'month' && (
        <div className="flex items-center justify-between gap-2">
          <button onClick={prevMonth} className="p-2.5 rounded-xl active:scale-90 transition-all" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <ChevronLeft size={16} style={{ color: 'rgba(148,163,184,0.7)' }} />
          </button>
          <p className="text-sm font-black" style={{ color: 'rgba(226,232,240,0.95)' }}>{MONTHS[local.monthMonth]} {local.monthYear}</p>
          <button onClick={nextMonth} className="p-2.5 rounded-xl active:scale-90 transition-all" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <ChevronRight size={16} style={{ color: 'rgba(148,163,184,0.7)' }} />
          </button>
        </div>
      )}

      {local.mode === 'custom' && (
        <div className="space-y-2">
          {(['customStart', 'customEnd'] as const).map((field, i) => (
            <div key={field}>
              <p className="text-[9px] font-black uppercase tracking-widest mb-1.5" style={{ color: 'rgba(148,163,184,0.4)' }}>{i === 0 ? 'From' : 'To'}</p>
              <div className="relative">
                <input type="date" value={(local as any)[field]}
                  onChange={e => setLocal(p => ({ ...p, [field]: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl text-sm font-bold outline-none pr-8"
                  style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: (local as any)[field] ? 'rgba(226,232,240,0.9)' : 'rgba(148,163,184,0.35)', colorScheme: isDark ? 'dark' : 'light' }}
                />
                {(local as any)[field] && (
                  <button
                    type="button"
                    onClick={() => setLocal(p => ({ ...p, [field]: '' }))}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ background: 'rgba(239,68,68,0.18)', border: '1px solid rgba(239,68,68,0.25)' }}
                  >
                    <X size={9} style={{ color: '#f87171' }} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <button onClick={apply}
        className="w-full py-3 rounded-2xl text-sm font-black flex items-center justify-center gap-2 active:scale-95 transition-all"
        style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', color: 'white', boxShadow: '0 4px 16px rgba(79,70,229,0.4)' }}>
        <Filter size={15} /> Apply Filter
      </button>
    </div>
  );
};

// ── Getting Started master list (priority-ordered) ────────────────────────────
// Each step has a feature key so we can filter by the user's current plan.
// Steps with feature 'basic' are always available on free plans.
interface GettingStartedStep {
  id: string;
  icon: React.FC<any>;
  label: string;
  sub: string;
  feature: FeatureKey;
  nav?: string;
  quickAction?: string;
}

const GETTING_STARTED_ALL: GettingStartedStep[] = [
  { id: 'add-product',  icon: PackagePlus,    label: 'Add your first product',     sub: 'Go to Inventory and add an item',         feature: 'basic',              nav: 'inventory'       },
  { id: 'first-sale',   icon: TrendingUp,     label: 'Record your first sale',     sub: 'Create a sale entry in your ledger',      feature: 'basic',              quickAction: 'sale'    },
  { id: 'add-party',    icon: Users,          label: 'Add a customer or party',    sub: 'Manage your customers and suppliers',     feature: 'basic',              nav: 'parties'         },
  { id: 'payment',      icon: ArrowRightLeft, label: 'Record a payment',           sub: 'Track money received or paid out',        feature: 'basic',              quickAction: 'transaction' },
  { id: 'expense',      icon: Wallet,         label: 'Log an expense',             sub: 'Track your day-to-day business costs',    feature: 'basic',              quickAction: 'expense' },
  { id: 'quick-bill',   icon: ReceiptText,    label: 'Create your first bill',     sub: 'Quick Bill for fast counter sales',       feature: 'pos_billing',        nav: 'pos-billing'     },
  { id: 'reports',      icon: BarChart2,      label: 'Check your GST reports',     sub: 'View GSTR-1 exports and tax summaries',   feature: 'reports',            nav: 'reports'         },
  { id: 'analytics',    icon: BarChart3,      label: 'Explore analytics',          sub: 'Visualise sales and profit trends',       feature: 'advanced_analytics', nav: 'analytics'       },
  { id: 'bulk-import',  icon: Upload,         label: 'Import your data',           sub: 'Bulk import inventory & parties via CSV', feature: 'bulk_import',        nav: 'bulk-import'     },
  { id: 'stock-val',    icon: TrendingUp,     label: 'Value your stock',           sub: 'Real-time inventory value & breakdown',   feature: 'stock_valuation',    nav: 'stock-valuation' },
  { id: 'timeline',     icon: Clock,          label: 'View activity timeline',     sub: 'Full audit trail of all activity',        feature: 'game_timeline',      nav: 'game-timeline'   },
];

const DashboardView: React.FC<DashboardViewProps> = ({ user, appSettings, onNavigate, onQuickAction, onToggleTheme }) => {
  const isDark = appSettings?.preferences?.dark_mode ?? false;
  const { useLowStockItems } = useData();
  const { data: lowStockItems } = useLowStockItems(user.uid);
  const { isAdmin, isStaff, role } = useRole();
  const { logout } = useAuth();
  const { showToast } = useUI();
  const { subscription, globalConfig, liveFeatures } = useSubscription();

  // FIX: Dashboard was making 4 additional independent unbounded Firestore reads
  // every time it opened, bypassing the React Query cache in DataContext entirely.
  // We now use the cached hooks from DataContext for all data that is already
  // available there (parties, inventory, waste) and keep the direct reads only
  // for ledger/expenses/transactions which need ALL historical records (not just
  // a single page) for the dashboard metrics calculation.
  //
  // The four direct reads below remain because the dashboard must aggregate data
  // across ALL time (for pending receivable/payable and recent activity), while
  // the paginated DataContext hooks only return 20 docs per page.
  // A future improvement would be to lift this into a dedicated dashboard query.
  const [allLedger,       setAllLedger]       = useState<any[]>([]);
  const [allExpenses,     setAllExpenses]      = useState<any[]>([]);
  const [allTransactions, setAllTransactions]  = useState<any[]>([]);
  const [inventoryData,   setInventoryData]    = useState<any[]>([]);
  const [loading,         setLoading]          = useState(true);

  const [periodFilter,     setPeriodFilter]    = useState<PeriodFilter>(getDefaultPeriod);
  const [showFilterPanel,  setShowFilterPanel] = useState(false);
  const scrollRef = useScrollMemory('dashboard');
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // ── Hide-amounts privacy feature ──────────────────────────────────────────
  // Reads the hide_amounts preference; user can tap the eye icon to temporarily
  // reveal without going to Settings (re-hides on next mount).
  const hideAmountsPref = !!appSettings?.preferences?.hide_amounts;
  const [amountsVisible, setAmountsVisible] = useState(!hideAmountsPref);
  // Sync when the setting changes (e.g. user goes to Settings and toggles)
  useEffect(() => { setAmountsVisible(!hideAmountsPref); }, [hideAmountsPref]);
  const shouldHide = hideAmountsPref && !amountsVisible;
  // Helper: returns masked text or formatted ₹ value
  const amt = (val: number) =>
    shouldHide ? '••••' : `₹${Math.round(val).toLocaleString('en-IN')}`;

  const [recentFilter,     setRecentFilter]    = useState<'today' | 'yesterday' | 'week'>('today');
  const [showInsight,      setShowInsight]     = useState(false);
  const [showCharts,       setShowCharts]      = useState(false);
  const [showAnalytics,    setShowAnalytics]   = useState(false);
  const [showReminders,    setShowReminders]   = useState(true);
  const [expandedId,       setExpandedId]      = useState<string | null>(null);

  // ── Getting Started per-step done tracking + 5-open / dismiss logic ──────
  const GS_DONE_KEY      = `gs_done_${user.uid}`;
  const GS_OPENS_KEY     = `gs_opens_${user.uid}`;
  const GS_DISMISSED_KEY = `gs_dismissed_${user.uid}`;

  const [doneSteps, setDoneSteps] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(GS_DONE_KEY) ?? '[]');
      return new Set<string>(saved);
    } catch { return new Set<string>(); }
  });

  // gsHidden = true  → box is permanently hidden (dismissed by user or >5 opens)
  const [gsHidden, setGsHidden] = useState<boolean>(() => {
    try {
      if (localStorage.getItem(GS_DISMISSED_KEY) === '1') return true;
      const opens = parseInt(localStorage.getItem(GS_OPENS_KEY) ?? '0', 10);
      return opens > 5;
    } catch { return false; }
  });

  // Increment open counter once per mount
  useEffect(() => {
    if (gsHidden) return;
    try {
      const opens = parseInt(localStorage.getItem(GS_OPENS_KEY) ?? '0', 10) + 1;
      localStorage.setItem(GS_OPENS_KEY, String(opens));
      if (opens > 5) setGsHidden(true);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismissGettingStarted = useCallback(() => {
    try { localStorage.setItem(GS_DISMISSED_KEY, '1'); } catch {}
    setGsHidden(true);
  }, [GS_DISMISSED_KEY]);

  const markStepDone = useCallback((stepId: string) => {
    setDoneSteps(prev => {
      const next = new Set(prev);
      next.add(stepId);
      try { localStorage.setItem(GS_DONE_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, [GS_DONE_KEY]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const [lSnap, eSnap, tSnap, iSnap] = await Promise.all([
          ApiService.getAll(user.uid, 'ledger_entries'),
          ApiService.getAll(user.uid, 'expenses'),
          ApiService.getAll(user.uid, 'transactions'),
          ApiService.getAll(user.uid, 'inventory'),
        ]);
        if (!mounted) return;
        setAllLedger(lSnap.docs.map((d: any) => ({ id: d.id, ...d.data(), docType: 'ledger' })));
        setAllExpenses(eSnap.docs.map((d: any) => ({ id: d.id, ...d.data(), docType: 'expense' })));
        setAllTransactions(tSnap.docs.map((d: any) => ({ id: d.id, ...d.data(), docType: 'transaction' })));
        setInventoryData(iSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error(err);
        if (mounted) showToast('Failed to load dashboard data. Check your connection.', 'error');
      }
      finally { if (mounted) setLoading(false); }
    };
    load();
    return () => { mounted = false; };
  }, [user.uid]);

  const { start: periodStart, end: periodEnd, label: periodLabel } = useMemo(
    () => getPeriodDateRange(periodFilter),
    [periodFilter],
  );

  const ledgerData = useMemo(() =>
    allLedger.filter(l => { const d = parseRecordDate(l.date); return d >= periodStart && d <= periodEnd; }),
    [allLedger, periodStart, periodEnd],
  );

  const expenseData = useMemo(() =>
    allExpenses.filter(e => { const d = parseRecordDate(e.date); return d >= periodStart && d <= periodEnd; }),
    [allExpenses, periodStart, periodEnd],
  );

  // Period-filtered transactions (for totalReceived/totalPaid metrics)
  const transactionData = useMemo(() =>
    allTransactions.filter(t => { const d = parseRecordDate(t.date); return d >= periodStart && d <= periodEnd; }),
    [allTransactions, periodStart, periodEnd],
  );

  const metrics = useMemo(() => {
    let totalReceived = 0, totalPaid = 0;
    for (const t of transactionData) {
      const amt = Number(t.amount) || 0;
      if (t.type === 'received') totalReceived += amt;
      else                       totalPaid     += amt;
    }

    let sales = 0, purchase = 0;
    for (const l of ledgerData) {
      const rent      = Number(l.vehicle_rent) || 0;
      const fullTotal = Number(l.total_amount)  || 0;
      const itemTotal = fullTotal - rent;
      if (l.type === 'sell')     sales    += itemTotal;
      if (l.type === 'purchase') purchase += itemTotal;
    }

    const expense = expenseData.reduce((s, e) => s + (Number(e.amount) || 0), 0);

    // Pending receivable/payable: party-level net balance approach.
    // For each party sum all sale invoices within the period, then subtract ALL
    // payments ever received from that party (across all time).  This avoids
    // false positives caused by reference-number mismatches between invoices and
    // payment transactions (e.g. payment recorded without a bill_no reference).
    const salesByParty    = new Map<string, number>();
    const purchByParty    = new Map<string, number>();
    const rxByParty       = new Map<string, number>();
    const payByParty      = new Map<string, number>();

    for (const l of ledgerData) {
      const p     = String(l.party_name || '').trim().toLowerCase();
      const total = Number(l.total_amount) || 0;
      if (total <= 0) continue;
      if (l.type === 'sell')     salesByParty.set(p, (salesByParty.get(p) || 0) + total);
      else if (l.type === 'purchase') purchByParty.set(p, (purchByParty.get(p) || 0) + total);
    }

    for (const t of allTransactions) {
      const p   = String(t.party_name || '').trim().toLowerCase();
      const amt = Number(t.amount) || 0;
      if (t.type === 'received') rxByParty.set(p,  (rxByParty.get(p)  || 0) + amt);
      else if (t.type === 'paid') payByParty.set(p, (payByParty.get(p) || 0) + amt);
    }

    let pendingReceivable = 0, pendingPayable = 0;
    for (const [p, sales] of salesByParty) {
      const balance = sales - (rxByParty.get(p) || 0);
      if (balance > 0) pendingReceivable += balance;
    }
    for (const [p, purch] of purchByParty) {
      const balance = purch - (payByParty.get(p) || 0);
      if (balance > 0) pendingPayable += balance;
    }

    return { sales, purchase, expense, received: totalReceived, paid: totalPaid, pendingReceivable, pendingPayable };
  }, [ledgerData, expenseData, transactionData, allTransactions]);

  const allActivity = useMemo(() => {
    const combined = [...allLedger, ...allTransactions, ...allExpenses];
    combined.sort((a, b) => parseRecordDate(b.date).getTime() - parseRecordDate(a.date).getTime());
    return combined;
  }, [allLedger, allTransactions, allExpenses]);

  const filteredRecents = useMemo(() => {
    const toLocal = (d: Date) => {
      if (isNaN(d.getTime())) return '1970-01-01';
      const off = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - off).toISOString().split('T')[0];
    };
    const now       = new Date();
    const todayStr  = toLocal(now);
    const yester    = new Date(now); yester.setDate(now.getDate() - 1);
    const yesterStr = toLocal(yester);
    const weekAgo   = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    const weekStr   = toLocal(weekAgo);

    return allActivity.filter((r: any) => {
      const recordDate = toLocal(parseRecordDate(r.date));
      if (recentFilter === 'today')     return recordDate === todayStr;
      if (recentFilter === 'yesterday') return recordDate === yesterStr;
      if (recentFilter === 'week')      return recordDate >= weekStr;
      return true;
    });
  }, [allActivity, recentFilter]);

  const handleQuickAction = useCallback((action: string) => {
    if (onQuickAction) onQuickAction(action);
  }, [onQuickAction]);

  // Top 3 getting-started steps available for this user's plan
  const gettingStartedSteps = useMemo(() =>
    GETTING_STARTED_ALL
      .filter(s => hasAccess(subscription, s.feature, globalConfig?.appMode, liveFeatures))
      .slice(0, 3),
    [subscription, globalConfig, liveFeatures],
  );

  const handleLockApp = () => {
    sessionStorage.removeItem('app_unlocked');
    window.dispatchEvent(new Event('lockapp'));
  };

  const toggleExpand = (id: string) => setExpandedId(expandedId === id ? null : id);

  const filterBadgeLabel = periodFilter.mode === 'business-year'
    ? getCurrentBusinessYear().label
    : periodLabel;

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto scroll-smooth" style={{ background: 'var(--app-bg)', paddingBottom: 'calc(96px + env(safe-area-inset-bottom, 0px))' }}>

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
              <button onClick={() => { setShowLogoutConfirm(false); logout(); }}
                className="flex-1 py-3 rounded-[16px] font-black text-sm text-white active:scale-95 transition-all"
                style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)', boxShadow: '0 8px 24px rgba(239,68,68,0.35)' }}>
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── HERO HEADER ── */}
      <div className="dashboard-hero relative overflow-hidden" style={{ minHeight: '240px' }}>
        {isDark ? (
          <>
            <div className="absolute inset-0 bg-gradient-to-br from-[#1a0533] via-[#0f1f5c] to-[#0a2e4a]" />
            <div className="absolute top-[-40%] left-[-20%] w-[80%] h-[160%] rounded-full opacity-30" style={{ background: 'rgba(139,92,246,0.12)' }} />
            <div className="absolute top-[-20%] right-[-20%] w-[70%] h-[140%] rounded-full opacity-20" style={{ background: 'rgba(59,130,246,0.1)' }} />
          </>
        ) : (
          <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, #eef2ff 0%, #f0f4ff 50%, #e8f0fe 100%)', borderBottom: '1px solid rgba(0,0,0,0.06)' }} />
        )}

        <div className="relative px-5 pb-8" style={{ paddingTop: '24px' }}>
          <div className="flex justify-between items-center mb-4">
            <div className="min-w-0 flex-1">
              <p className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-0.5 ${isDark ? 'text-white/40' : 'text-slate-400'}`}>
                {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
              <h1 className={`text-[28px] font-black tracking-tight leading-none ${isDark ? 'text-white' : 'text-slate-800'}`} style={{ letterSpacing: '-0.03em' }}>Overview</h1>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 ml-3">
              <span className={`text-[9px] font-black uppercase px-3 py-1.5 rounded-full ${
                isDark
                  ? isAdmin ? 'bg-white/15 text-white/80 border border-white/20' : 'bg-amber-400/25 text-amber-200 border border-amber-400/30'
                  : isAdmin ? 'bg-indigo-100 text-indigo-700 border border-indigo-200' : 'bg-amber-50 text-amber-600 border border-amber-200'
              }`} style={{ backdropFilter: 'blur(8px)' }}>
                {role}
              </span>
              {isStaff && (
                <button onClick={() => setShowLogoutConfirm(true)}
                  className={`p-2 rounded-full transition-all active:scale-90 ${isDark ? 'text-white/70' : 'text-slate-600'}`}
                  style={isDark
                    ? { background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)' }
                    : { background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.09)', backdropFilter: 'blur(8px)' }}>
                  <LogOut size={15} />
                </button>
              )}
              {appSettings?.security?.enabled && (appSettings?.security?.pin?.length === 4) && (
                <button onClick={handleLockApp}
                  className={`p-2 rounded-full transition-all active:scale-90 ${isDark ? 'text-white/70' : 'text-slate-600'}`}
                  style={isDark
                    ? { background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)' }
                    : { background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.09)', backdropFilter: 'blur(8px)' }}>
                  <Lock size={15} />
                </button>
              )}
              {/* THEME_TOGGLE_HIDDEN: set FORCE_DARK_MODE=false in App.tsx to re-enable */}
              {false && onToggleTheme && (
                <button onClick={onToggleTheme}
                  className="p-2 rounded-full transition-all active:scale-90"
                  title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                  style={isDark
                    ? { background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)' }
                    : { background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.09)', backdropFilter: 'blur(8px)' }}>
                  {isDark
                    ? <Sun size={15} style={{ color: '#fbbf24' }} />
                    : <Moon size={15} style={{ color: '#6366f1' }} />}
                </button>
              )}
              {hideAmountsPref && (
                <button onClick={() => setAmountsVisible(v => !v)}
                  className="p-2 rounded-full transition-all active:scale-90"
                  title={amountsVisible ? 'Hide amounts' : 'Show amounts'}
                  style={isDark
                    ? { background: amountsVisible ? 'rgba(139,92,246,0.25)' : 'rgba(255,255,255,0.1)', border: amountsVisible ? '1px solid rgba(139,92,246,0.4)' : '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)' }
                    : { background: amountsVisible ? 'rgba(99,102,241,0.12)' : 'rgba(0,0,0,0.06)', border: amountsVisible ? '1px solid rgba(99,102,241,0.3)' : '1px solid rgba(0,0,0,0.09)', backdropFilter: 'blur(8px)' }}>
                  {amountsVisible ? <EyeOff size={15} style={{ color: '#a78bfa' }} /> : <Eye size={15} style={{ color: isDark ? 'rgba(255,255,255,0.7)' : '#64748b' }} />}
                </button>
              )}
              <div className="h-9 w-9 rounded-full flex items-center justify-center font-black text-sm flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.8), rgba(59,130,246,0.8))', border: `2px solid ${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.9)'}`, color: '#ffffff' }}>
                {(user.email?.[0] ?? '?').toUpperCase()}
              </div>
            </div>
          </div>

          {/* Period filter toggle */}
          <button onClick={() => setShowFilterPanel(v => !v)}
            className="flex items-center gap-2 mb-4 px-3 py-2 rounded-2xl transition-all active:scale-95"
            style={showFilterPanel
              ? { background: 'rgba(139,92,246,0.25)', border: '1px solid rgba(139,92,246,0.4)', backdropFilter: 'blur(8px)' }
              : isDark
                ? { background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)' }
                : { background: 'rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.1)', backdropFilter: 'blur(8px)' }}>
            <Calendar size={13} style={{ color: showFilterPanel ? '#a78bfa' : isDark ? 'rgba(255,255,255,0.6)' : 'rgba(71,85,105,0.7)' }} />
            <span className="text-[11px] font-black" style={{ color: showFilterPanel ? '#a78bfa' : isDark ? 'rgba(255,255,255,0.75)' : '#475569' }}>{filterBadgeLabel}</span>
            <Filter size={11} style={{ color: showFilterPanel ? '#a78bfa' : isDark ? 'rgba(255,255,255,0.4)' : 'rgba(71,85,105,0.5)' }} />
          </button>

          {showFilterPanel && (
            <div className="mb-4">
              <PeriodFilterPanel filter={periodFilter} onChange={setPeriodFilter} onClose={() => setShowFilterPanel(false)} />
            </div>
          )}
          {/* Hero metric card */}
          <div className="rounded-3xl p-4 relative overflow-hidden"
            style={isDark
              ? { background: 'rgba(15,20,40,0.85)', border: '1px solid rgba(255,255,255,0.13)' }
              : { background: 'rgba(255,255,255,0.88)', border: '1px solid rgba(0,0,0,0.07)', boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}>
            <div className={`grid grid-cols-3 ${isDark ? 'divide-x divide-white/10' : 'divide-x divide-slate-200'}`}>
              <div className="pr-3">
                <p className="text-[9px] font-bold text-white/45 uppercase tracking-[0.15em] mb-1.5 flex items-center gap-1"><TrendingUp size={9} className="text-emerald-400" /> Sales</p>
                <p className="fit-amount-lg font-black text-white tabular-nums leading-none">
                  {loading ? <span className="inline-block w-16 h-5 rounded-lg animate-pulse" style={{ background: 'rgba(255,255,255,0.15)' }} /> : <span style={shouldHide ? { letterSpacing: '0.15em', opacity: 0.7 } : {}}>{amt(metrics.sales)}</span>}
                </p>
              </div>
              <div className="px-3">
                <p className="text-[9px] font-bold text-white/45 uppercase tracking-[0.15em] mb-1.5 flex items-center gap-1"><TrendingDown size={9} className="text-rose-400" /> Purchase</p>
                <p className="fit-amount-lg font-black text-rose-300 tabular-nums leading-none">
                  {loading ? <span className="inline-block w-16 h-5 rounded-lg animate-pulse" style={{ background: 'rgba(255,255,255,0.15)' }} /> : <span style={shouldHide ? { letterSpacing: '0.15em', opacity: 0.7 } : {}}>{amt(metrics.purchase)}</span>}
                </p>
              </div>
              <div className="pl-3">
                <p className="text-[9px] font-bold text-white/45 uppercase tracking-[0.15em] mb-1.5 flex items-center gap-1"><Wallet size={9} className="text-amber-400" /> Expenses</p>
                <p className="fit-amount-lg font-black text-amber-300 tabular-nums leading-none">
                  {loading ? <span className="inline-block w-16 h-5 rounded-lg animate-pulse" style={{ background: 'rgba(255,255,255,0.15)' }} /> : <span style={shouldHide ? { letterSpacing: '0.15em', opacity: 0.7 } : {}}>{amt(metrics.expense)}</span>}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-8" style={{ background: 'var(--app-bg)', borderRadius: '32px 32px 0 0', marginBottom: '-2px' }} />
      </div>

      <div className="px-4 pt-2 pb-4 space-y-4">

        {/* ── GETTING STARTED card — hidden after 5 app opens or manual dismiss ── */}
        {!loading && !gsHidden && (() => {
          const pendingSteps = gettingStartedSteps.filter(s => !doneSteps.has(s.id));
          if (pendingSteps.length === 0) return null;
          return (
            <div className="rounded-[20px] p-4"
              style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.14), rgba(139,92,246,0.08))', border: '1px solid rgba(99,102,241,0.3)' }}>
              <div className="flex items-start justify-between mb-0.5">
                <p className="text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: 'rgba(167,139,250,0.7)' }}>Getting Started</p>
                <button
                  onClick={dismissGettingStarted}
                  className="w-5 h-5 -mt-0.5 -mr-0.5 flex items-center justify-center rounded-full transition-all active:scale-90"
                  style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(148,163,184,0.5)' }}
                  title="Dismiss">
                  <X size={10}/>
                </button>
              </div>
              <p className="text-sm font-black text-white mb-3">
                Complete these steps · {pendingSteps.length} remaining
              </p>
              <div className="space-y-2.5">
                {gettingStartedSteps.map((step, idx) => {
                  const Icon = step.icon;
                  const done = doneSteps.has(step.id);
                  const handleClick = () => {
                    if (step.quickAction) handleQuickAction(step.quickAction);
                    else if (step.nav) onNavigate(step.nav);
                  };
                  return (
                    <div key={step.id}
                      className="flex items-center gap-3 p-3 rounded-[14px] transition-all"
                      style={{
                        background: done ? 'rgba(16,185,129,0.06)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${done ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.07)'}`,
                        opacity: done ? 0.55 : 1,
                      }}>
                      <button onClick={handleClick} className="flex items-center gap-3 flex-1 text-left min-w-0 active:scale-[0.99] transition-all">
                        <div className="w-9 h-9 rounded-[12px] flex items-center justify-center flex-shrink-0 relative"
                          style={{ background: done ? 'rgba(16,185,129,0.15)' : 'rgba(99,102,241,0.15)' }}>
                          <Icon size={16} style={{ color: done ? '#34d399' : '#a5b4fc' }} />
                          {!done && (
                            <span className="absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black"
                              style={{ background: 'rgba(99,102,241,0.8)', color: '#fff' }}>
                              {idx + 1}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-[12px] font-black ${done ? 'line-through' : 'text-white'}`}
                            style={{ color: done ? 'rgba(52,211,153,0.7)' : undefined }}>{step.label}</p>
                          <p className="text-[10px]" style={{ color: 'rgba(148,163,184,0.5)' }}>{step.sub}</p>
                        </div>
                      </button>
                      {/* Mark done button */}
                      <button
                        onClick={() => markStepDone(step.id)}
                        disabled={done}
                        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 transition-all disabled:cursor-default"
                        style={{
                          background: done ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.07)',
                          border: `1px solid ${done ? 'rgba(16,185,129,0.35)' : 'rgba(255,255,255,0.12)'}`,
                        }}
                        title={done ? 'Done' : 'Mark as done'}
                      >
                        <CheckCircle2 size={14} style={{ color: done ? '#34d399' : 'rgba(148,163,184,0.4)' }} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {showReminders && (
          <SmartRemindersWidget lowStockItems={lowStockItems} todaySales={metrics.sales} todayExpenses={metrics.expense} pendingReceivable={metrics.pendingReceivable} onDismiss={() => setShowReminders(false)} />
        )}

        {/* Receivable / Payable cards */}
        <section className="grid grid-cols-2 gap-3">
          <div onClick={() => onNavigate('pending-dashboard', { filter: 'receivable' })} className="relative p-4 rounded-[24px] cursor-pointer overflow-hidden active:scale-[0.96] transition-all" style={{ background: 'rgba(16,185,129,0.09)', border: '1px solid rgba(16,185,129,0.25)' }}>
            <div className="p-2 rounded-2xl w-fit mb-3" style={{ background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.25)' }}><ArrowUpRight size={14} style={{ color: '#34d399' }} /></div>
            <p className="text-[9px] font-black uppercase tracking-wider mb-1" style={{ color: 'rgba(52,211,153,0.7)' }}>To Receive</p>
            <p className="font-black text-xl tabular-nums leading-tight" style={{ color: '#6ee7b7' }}>
              {loading ? <span className="inline-block w-20 h-6 rounded-lg animate-pulse" style={{ background: 'rgba(16,185,129,0.2)' }} /> : <span style={shouldHide ? { letterSpacing: '0.15em', opacity: 0.7 } : {}}>{amt(metrics.pendingReceivable)}</span>}
            </p>
          </div>
          <div onClick={() => onNavigate('pending-dashboard', { filter: 'payable' })} className="relative p-4 rounded-[24px] cursor-pointer overflow-hidden active:scale-[0.96] transition-all" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)' }}>
            <div className="p-2 rounded-2xl w-fit mb-3" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.22)' }}><ArrowDownLeft size={14} style={{ color: '#f87171' }} /></div>
            <p className="text-[9px] font-black uppercase tracking-wider mb-1" style={{ color: 'rgba(248,113,113,0.7)' }}>To Pay</p>
            <p className="font-black text-xl tabular-nums leading-tight" style={{ color: '#fca5a5' }}>
              {loading ? <span className="inline-block w-20 h-6 rounded-lg animate-pulse" style={{ background: 'rgba(239,68,68,0.15)' }} /> : <span style={shouldHide ? { letterSpacing: '0.15em', opacity: 0.7 } : {}}>{amt(metrics.pendingPayable)}</span>}
            </p>
          </div>
        </section>

        {/* Quick actions */}
        <section>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] mb-3 px-1" style={{ color: 'rgba(148,163,184,0.45)' }}>Quick Actions</p>
          <div className="grid grid-cols-4 gap-2.5">
            {[
              { label: 'Sale',     icon: TrendingUp,     glowColor: 'rgba(16,185,129,0.3)',  bg: 'rgba(16,185,129,0.1)',  iconBg: 'rgba(16,185,129,0.18)', iconColor: '#34d399', border: 'rgba(16,185,129,0.25)',  action: 'sale' },
              { label: 'Purchase', icon: TrendingDown,   glowColor: 'rgba(239,68,68,0.25)',  bg: 'rgba(239,68,68,0.09)',  iconBg: 'rgba(239,68,68,0.15)',  iconColor: '#f87171', border: 'rgba(239,68,68,0.2)',    action: 'purchase' },
              { label: 'Payment',  icon: ArrowRightLeft, glowColor: 'rgba(59,130,246,0.25)', bg: 'rgba(59,130,246,0.09)', iconBg: 'rgba(59,130,246,0.15)', iconColor: '#60a5fa', border: 'rgba(59,130,246,0.2)',   action: 'transaction' },
              { label: 'Expense',  icon: Wallet,         glowColor: 'rgba(245,158,11,0.25)', bg: 'rgba(245,158,11,0.09)', iconBg: 'rgba(245,158,11,0.15)', iconColor: '#fbbf24', border: 'rgba(245,158,11,0.2)',   action: 'expense' },
            ].map(({ label, icon: Icon, glowColor, bg, iconBg, iconColor, border, action }) => (
              <button key={action} onClick={() => handleQuickAction(action)}
                className="flex flex-col items-center gap-2.5 py-4 px-2 rounded-[20px] active:scale-90 transition-all relative overflow-hidden"
                style={{ background: bg, boxShadow: `0 4px 16px ${glowColor}`, border: `1px solid ${border}` }}>
                <div className="p-2.5 rounded-2xl" style={{ background: iconBg, border: `1px solid ${border}` }}>
                  <Icon size={17} style={{ color: iconColor }} />
                </div>
                <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: iconColor }}>{label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Cashflow */}
        <section className="grid grid-cols-2 gap-3">
          <MetricCard title="Received" value={metrics.received} icon={ArrowRightLeft} color="text-blue-400" onClick={() => onNavigate('transactions', { typeFilter: 'received' })} loading={loading} hide={shouldHide} />
          <MetricCard title="Paid Out"  value={metrics.paid}     icon={Wallet}         color="text-orange-400" onClick={() => onNavigate('transactions', { typeFilter: 'paid' })} loading={loading} hide={shouldHide} />
        </section>

        {/* Insight + Charts */}
        <section className="flex gap-2">
          <button onClick={() => setShowInsight(true)} className="flex-1 text-white p-4 rounded-[24px] active:scale-95 transition-all flex items-center gap-3 overflow-hidden relative" style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', boxShadow: '0 8px 32px rgba(79,70,229,0.5)', border: '1px solid rgba(167,139,250,0.35)' }}>
            <div className="p-2.5 rounded-2xl relative" style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)' }}><Lightbulb size={18} className="text-yellow-300 fill-yellow-300" /></div>
            <div className="relative"><div className="font-black text-sm">AI Insights</div><div className="text-[10px]" style={{ color: 'rgba(196,181,253,0.8)' }}>Profit & Analysis</div></div>
          </button>
          <button onClick={() => setShowAnalytics(!showAnalytics)} className="w-[56px] h-[56px] rounded-[20px] flex items-center justify-center active:scale-95 transition-all flex-shrink-0" style={showAnalytics ? { background: 'linear-gradient(135deg,#059669,#10b981)', boxShadow: '0 4px 16px rgba(16,185,129,0.5)' } : { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <BarChart3 size={20} strokeWidth={1.5} style={{ color: showAnalytics ? '#fff' : 'rgba(148,163,184,0.6)' }} />
          </button>
          <button onClick={() => setShowCharts(!showCharts)} className="w-[56px] h-[56px] rounded-[20px] flex items-center justify-center active:scale-95 transition-all flex-shrink-0" style={showCharts ? { background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', boxShadow: '0 4px 16px rgba(79,70,229,0.5)' } : { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <FileText size={20} strokeWidth={1.5} style={{ color: showCharts ? '#fff' : 'rgba(148,163,184,0.6)' }} />
          </button>
        </section>

        {showAnalytics && !loading && <section><DashboardAnalyticsWidget metrics={metrics} ledgerData={ledgerData} loading={loading} onNavigate={onNavigate} /></section>}
        {showCharts && <section className="space-y-4"><SalesChart ledger={ledgerData} expenses={expenseData} days={14} /><CategoryPieChart expenses={expenseData} /></section>}

        {/* Nav shortcuts */}
        <section>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] mb-3 px-1" style={{ color: 'rgba(148,163,184,0.45)' }}>Quick Navigate</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'pos-billing',     Icon: ShoppingCart,   label: 'Quick Bill',  glassColor: 'rgba(16,185,129,0.14)',  iconColor: '#34d399', border: 'rgba(16,185,129,0.3)',   adminOnly: false },
              { id: 'ledger',          Icon: BookOpen,       label: 'Ledger',      glassColor: 'rgba(59,130,246,0.12)',  iconColor: '#60a5fa', border: 'rgba(59,130,246,0.22)',  adminOnly: false },
              { id: 'transactions',    Icon: ArrowRightLeft, label: 'Payments',    glassColor: 'rgba(139,92,246,0.12)',  iconColor: '#a78bfa', border: 'rgba(139,92,246,0.22)',  adminOnly: false },
              { id: 'expenses',        Icon: Wallet,         label: 'Expenses',    glassColor: 'rgba(245,158,11,0.1)',   iconColor: '#fbbf24', border: 'rgba(245,158,11,0.2)',   adminOnly: true  },
              { id: 'vehicles',        Icon: Truck,          label: 'Vehicles',    glassColor: 'rgba(16,185,129,0.1)',   iconColor: '#34d399', border: 'rgba(16,185,129,0.2)',   adminOnly: false },
              { id: 'waste',           Icon: Trash2,         label: 'Waste',       glassColor: 'rgba(239,68,68,0.09)',   iconColor: '#f87171', border: 'rgba(239,68,68,0.18)',   adminOnly: false },
              { id: 'reports',         Icon: FileText,       label: 'Reports',     glassColor: 'rgba(100,116,139,0.1)',  iconColor: '#94a3b8', border: 'rgba(100,116,139,0.2)',  adminOnly: true  },
              { id: 'game-timeline',   Icon: Footprints,     label: 'Timeline',    glassColor: 'rgba(79,70,229,0.12)',   iconColor: '#818cf8', border: 'rgba(79,70,229,0.22)',   adminOnly: false },
              { id: 'analytics',       Icon: BarChart3,      label: 'Analytics',   glassColor: 'rgba(16,185,129,0.1)',   iconColor: '#34d399', border: 'rgba(16,185,129,0.2)',   adminOnly: true  },
              { id: 'bulk-import',     Icon: Upload,         label: 'Bulk Import', glassColor: 'rgba(99,102,241,0.1)',   iconColor: '#818cf8', border: 'rgba(99,102,241,0.22)',  adminOnly: true  },
              { id: 'stock-valuation', Icon: TrendingUp,     label: 'Stock Val.',  glassColor: 'rgba(16,185,129,0.08)', iconColor: '#6ee7b7', border: 'rgba(16,185,129,0.18)',  adminOnly: true  },
            ]
              .filter(item => !item.adminOnly || isAdmin)
              .map(({ id, Icon, label, glassColor, iconColor, border }) => (
                <button key={id} onClick={() => onNavigate(id)}
                  className="p-3 rounded-[20px] flex items-center gap-2.5 active:scale-95 transition-all relative overflow-hidden"
                  style={{ background: glassColor, border: `1px solid ${border}`, backdropFilter: 'blur(8px)' }}>
                  <div className="p-2 rounded-xl flex-shrink-0" style={{ background: 'rgba(255,255,255,0.08)', border: `1px solid ${border}` }}>
                    <Icon size={13} style={{ color: iconColor }} />
                  </div>
                  <span className="font-black text-[9px] uppercase tracking-wider leading-tight" style={{ color: iconColor }}>{label}</span>
                </button>
              ))}
          </div>
        </section>

        {lowStockItems.length > 0 && (
          <LowStockWidget items={lowStockItems} salesData={allLedger} onViewAll={() => onNavigate('inventory')} onItemClick={() => onNavigate('inventory')} />
        )}

        {!loading && inventoryData.length > 0 && (
          <ReorderWidget inventory={inventoryData} ledgerData={ledgerData} onNavigate={onNavigate} />
        )}

        {/* Recent activity */}
        <section>
          <div className="flex justify-between items-center mb-3 gap-2">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] px-1" style={{ color: 'rgba(148,163,184,0.45)' }}>Activity</h3>
            <div className="flex p-1 rounded-2xl gap-1" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
              {(['today', 'yesterday', 'week'] as const).map((t) => (
                <button key={t} onClick={() => setRecentFilter(t)}
                  className="px-3 py-1.5 text-[9px] font-black uppercase rounded-xl transition-all whitespace-nowrap"
                  style={recentFilter === t
                    ? { background: 'rgba(139,92,246,0.25)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.3)' }
                    : { color: 'rgba(148,163,184,0.45)' }}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            {filteredRecents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 rounded-[24px]" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="p-4 rounded-full mb-3" style={{ background: 'rgba(255,255,255,0.06)' }}><FileText size={24} style={{ color: 'rgba(148,163,184,0.3)' }} /></div>
                <p className="text-xs font-bold" style={{ color: 'rgba(148,163,184,0.4)' }}>No activity for {recentFilter}</p>
              </div>
            ) : (
              filteredRecents.slice(0, 15).map((item: any) => {
                const isLedger   = item.docType === 'ledger';
                const isExpense  = item.docType === 'expense';
                const isReceived = item.type === 'received';
                const isExpanded = expandedId === item.id;

                let iconBg = 'rgba(100,116,139,0.15)', iconColor = '#94a3b8', amountColor = '#94a3b8';
                let Icon: React.FC<any> = FileText;
                let badge = 'REC', glassColor = 'rgba(255,255,255,0.06)', leftAccent = 'rgba(100,116,139,0.4)';

                if (isLedger) {
                  if (item.type === 'sell')  { iconBg='rgba(16,185,129,0.15)'; iconColor='#34d399'; amountColor='#6ee7b7'; Icon=TrendingUp;   badge='SAL'; leftAccent='#10b981'; glassColor='rgba(16,185,129,0.07)'; }
                  else                       { iconBg='rgba(239,68,68,0.12)';  iconColor='#f87171'; amountColor='#fca5a5'; Icon=TrendingDown; badge='PUR'; leftAccent='#ef4444'; glassColor='rgba(239,68,68,0.06)';  }
                } else if (isExpense) {        iconBg='rgba(245,158,11,0.15)'; iconColor='#fbbf24'; amountColor='#fcd34d'; Icon=Wallet;       badge='EXP'; leftAccent='#f59e0b'; glassColor='rgba(245,158,11,0.06)';
                } else {
                  if (isReceived)            { iconBg='rgba(59,130,246,0.13)'; iconColor='#60a5fa'; amountColor='#93c5fd'; Icon=ArrowRightLeft;badge='RCV'; leftAccent='#3b82f6'; glassColor='rgba(59,130,246,0.06)'; }
                  else                       { iconBg='rgba(245,158,11,0.13)'; iconColor='#fbbf24'; amountColor='#fcd34d'; Icon=Wallet;        badge='PAY'; leftAccent='#f59e0b'; glassColor='rgba(245,158,11,0.06)'; }
                }

                const rawVal     = isLedger ? item.total_amount : item.amount;
                const displayVal = Math.round(Number(rawVal) || 0).toLocaleString('en-IN');
                const title      = item.party_name || item.category || 'Unknown';
                const refNo      = (item.invoice_no || item.bill_no) ? `${isLedger ? (item.type === 'sell' ? 'S' : 'P') : 'T'}-${String(item.invoice_no || item.bill_no).slice(-3)}` : '';
                const subText    = isLedger ? `${(item.items || []).length} items` : (item.payment_mode || item.notes || '');

                return (
                  <div key={item.id} className="rounded-[20px] overflow-hidden transition-all active:scale-[0.99] relative" style={{ background: glassColor, backdropFilter: 'blur(8px)', border: `1px solid ${leftAccent}30`, borderLeft: `3px solid ${leftAccent}` }}>
                    <div className="flex items-center gap-3 p-3.5 cursor-pointer" onClick={() => toggleExpand(item.id)}>
                      <div className="p-2.5 rounded-2xl flex-shrink-0" style={{ background: iconBg, border: `1px solid ${leftAccent}25` }}>
                        <Icon size={16} style={{ color: iconColor }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center gap-2 mb-0.5">
                          <span className="font-bold text-sm truncate" style={{ color: 'rgba(240,244,255,0.88)' }}>{title}</span>
                          <span className="font-black text-sm tabular-nums flex-shrink-0" style={{ color: amountColor }}>
                            {shouldHide
                              ? <span style={{ letterSpacing: '0.15em', opacity: 0.7 }}>••••</span>
                              : <>{(isLedger && item.type === 'purchase') || (!isLedger && !isReceived) ? '-' : '+'}₹{displayVal}</>
                            }
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[8px] font-black px-1.5 py-0.5 rounded-lg" style={{ background: iconBg, color: iconColor }}>{refNo || badge}</span>
                          <span className="text-[10px] font-medium" style={{ color: 'rgba(148,163,184,0.5)' }}>
                            {parseRecordDate(item.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                          </span>
                          {subText && <span className="text-[10px] truncate" style={{ color: 'rgba(148,163,184,0.45)' }}>{subText}</span>}
                        </div>
                      </div>
                      {isLedger && <div className="flex-shrink-0" style={{ color: 'rgba(148,163,184,0.35)' }}>{isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</div>}
                    </div>

                    {isExpanded && isLedger && item.items && (
                      <div className="px-3.5 pb-3.5 pt-0 mx-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                        <div className="mt-3 space-y-1.5">
                          {item.items.map((it: any, idx: number) => (
                            <div key={idx} className="flex justify-between items-center text-xs py-1">
                              <span className="truncate flex-1" style={{ color: 'rgba(203,213,225,0.7)' }}>{it.item_name}</span>
                              <span className="mx-2" style={{ color: 'rgba(148,163,184,0.45)' }}>{it.quantity} {it.unit}</span>
                              <span className="font-bold tabular-nums" style={{ color: 'rgba(226,232,240,0.8)' }}>₹{it.rate}</span>
                            </div>
                          ))}
                        </div>
                        {Number(item.vehicle_rent || 0) > 0 && (
                          <div className="mt-2 text-[10px] flex items-center gap-1 rounded-xl p-2" style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(148,163,184,0.5)' }}>
                            <Truck size={11} className="flex-shrink-0" /> {item.vehicle} (₹{item.vehicle_rent})
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {filteredRecents.length > 15 && (
              // FIX: "View all" now passes the active date context so the ledger
              // opens pre-filtered to the same period the user was browsing on the
              // dashboard, instead of defaulting to the current month.
              <button
                onClick={() => {
                  const startStr = periodStart.toISOString().split('T')[0];
                  const endStr   = periodEnd.toISOString().split('T')[0];
                  onNavigate('ledger', { dateStart: startStr, dateEnd: endStr });
                }}
                className="w-full py-3 rounded-[18px] text-[10px] font-black uppercase tracking-wider transition-all active:scale-95"
                style={{ background: 'rgba(139,92,246,0.1)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.2)' }}>
                View all {filteredRecents.length} records →
              </button>
            )}
          </div>
        </section>
      </div>

      <InsightModal isOpen={showInsight} onClose={() => setShowInsight(false)} user={user} appSettings={appSettings} />
    </div>
  );
};

export default DashboardView;


