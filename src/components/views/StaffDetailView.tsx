/**
 * StaffDetailView — 3-tab redesign:
 *   Overview    : Balance hero (includes party collections/payments), salary picker, balance sheet, quick actions
 *   Party Activity : All party transactions where received_by / paid_by = staff.name
 *   Staff Ledger   : Manual staff_transaction entries with running balance
 *
 * Balance formula:
 *   effectiveCash = partyTotalIn - partyTotalOut + manualLedgerBalance
 *   where manualLedgerBalance = COLLECTION + EXPENSE_ADVANCE + SALARY_ADVANCE - STAFF_EXPENSE - SETTLEMENT ± ADJUSTMENT
 */
import React, { useState, useMemo } from 'react';
import {
  ArrowLeft, Edit, Plus, IndianRupee, Trash2,
  ChevronDown, ChevronUp, ArrowDownLeft, ArrowUpRight,
  BarChart3, FileText, Users, ChevronLeft, ChevronRight, Banknote,
} from 'lucide-react';
import { StaffMember, StaffTxType } from '../../types/models';
import { useStaffTransactions, useDeleteStaffTransaction, calculateBalance, getSalarySummary } from '../../hooks/useStaff';
import { STAFF_TX_LABELS } from '../../services/staffService';
import { useUI } from '../../context/UIContext';
import StaffTransactionModal from '../modals/StaffTransactionModal';
import { useData } from '../../context/DataContext';
import { parseDateSafe } from '../../utils/dateUtils';

interface Props {
  user: { uid: string; email?: string | null; displayName?: string | null };
  staff: StaffMember;
  onBack: () => void;
  onEdit: (s: StaffMember) => void;
}

type Tab = 'overview' | 'activity' | 'ledger';

const TYPE_COLOR: Record<StaffTxType, string> = {
  SALARY_PAYMENT:  "var(--col-success)", SALARY_ADVANCE:  "var(--col-success)",
  EXPENSE_ADVANCE: "var(--col-info)", STAFF_EXPENSE:   "var(--col-danger)",
  COLLECTION:      "var(--col-violet)", SETTLEMENT:      "var(--col-warning)",
  REIMBURSEMENT:   "var(--col-warning)", ADJUSTMENT:      "var(--col-slate)",
};
const TYPE_BG: Record<StaffTxType, string> = {
  SALARY_PAYMENT:  'var(--col-emerald-15)',  SALARY_ADVANCE:  'var(--col-emerald-15)',
  EXPENSE_ADVANCE: 'var(--col-info-15)',  STAFF_EXPENSE:   'var(--col-danger-08)',
  COLLECTION:      'var(--col-violet-15)',  SETTLEMENT:      'rgba(251,191,36,0.08)',
  REIMBURSEMENT:   'rgba(251,191,36,0.08)', ADJUSTMENT:      'var(--text-muted)',
};

const CREDIT_TYPES = new Set<StaffTxType>(['COLLECTION', 'EXPENSE_ADVANCE', 'SALARY_ADVANCE']);
const DEBIT_TYPES  = new Set<StaffTxType>(['STAFF_EXPENSE', 'SETTLEMENT']);

function getDirection(t: StaffTxType, amount: number): 'credit' | 'debit' | 'neutral' {
  if (CREDIT_TYPES.has(t)) return 'credit';
  if (DEBIT_TYPES.has(t))  return 'debit';
  if (t === 'ADJUSTMENT')  return amount >= 0 ? 'credit' : 'debit';
  return 'neutral';
}

function fmt(n: number, compact = false): string {
  const abs = Math.abs(n);
  if (compact) {
    if (abs >= 100000) return `₹${(abs / 100000).toFixed(1)}L`;
    if (abs >= 1000)   return `₹${(abs / 1000).toFixed(1)}k`;
  }
  return `₹${abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
}

const QUICK_ACTIONS: [StaffTxType, string, string][] = [
  ['SALARY_PAYMENT', 'Pay Salary',   "var(--col-success)"],
  ['EXPENSE_ADVANCE','Give Advance', "var(--col-info)"],
  ['COLLECTION',     'Collection',   "var(--col-violet)"],
  ['SETTLEMENT',     'Settlement',   "var(--col-warning)"],
  ['STAFF_EXPENSE',  'Expense',      "var(--col-danger)"],
  ['ADJUSTMENT',     'Adjust',       "var(--col-slate)"],
];

export default function StaffDetailView({ user, staff, onBack, onEdit }: Props) {
  const uid = user.uid;
  const { showToast } = useUI();
  const { data: txs = [], isLoading } = useStaffTransactions(uid, staff.id!);
  const deleteTx = useDeleteStaffTransaction(uid);

  const [activeTab,      setActiveTab]      = useState<Tab>('overview');
  const [showTxModal,    setShowTxModal]    = useState(false);
  const [defaultTxType,  setDefaultTxType]  = useState<StaffTxType>('SALARY_PAYMENT');
  const [typeFilter,     setTypeFilter]     = useState<StaffTxType | ''>('');
  const [confirmDelete,  setConfirmDelete]  = useState<string | null>(null);
  const [showBalSheet,   setShowBalSheet]   = useState(false);

  const nowMonthKey = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, []);
  const [salaryMonthView, setSalaryMonthView] = useState(nowMonthKey);

  // ── Linked party transactions (zero extra Firestore reads — DataContext cache) ──
  const { useTransactions: useAllTx } = useData();
  const { data: allTransactions = [], isLoading: linkedLoading } = useAllTx(uid);

  const partyActivity = useMemo(() => {
    if (!staff.name) return { all: [], totalIn: 0, totalOut: 0 };
    const staffName = staff.name.toLowerCase().trim();
    const all = (allTransactions as any[])
      .filter(t =>
        (t.received_by || '').toLowerCase().trim() === staffName ||
        (t.paid_by     || '').toLowerCase().trim() === staffName
      )
      .sort((a: any, b: any) => {
        const dA = (a.date || '').slice(0, 10), dB = (b.date || '').slice(0, 10);
        if (dA !== dB) return dB < dA ? -1 : 1;
        return parseDateSafe(b.created_at).getTime() - parseDateSafe(a.created_at).getTime();
      });

    let totalIn = 0, totalOut = 0;
    all.forEach((t: any) => {
      const amt   = Number(t.amount || 0);
      const rby   = (t.received_by || '').toLowerCase().trim();
      const pby   = (t.paid_by     || '').toLowerCase().trim();
      if (rby === staffName) totalIn  += amt;
      if (pby === staffName) totalOut += amt;
    });
    return { all, totalIn, totalOut };
  }, [allTransactions, staff.name]);

  // ── Staff-transaction balance (manual entries in staff_transactions collection) ──
  const bal = useMemo(() => calculateBalance(txs, staff), [txs, staff]);

  // Effective cash = manual ledger + party collections - party payments
  const effectiveCash = bal.moneyWithStaff + partyActivity.totalIn - partyActivity.totalOut;

  // All-time salary total
  const totalSalaryAllTime = useMemo(() =>
    txs.filter(t => !t.deleted && t.type === 'SALARY_PAYMENT')
       .reduce((s, t) => s + Number(t.amount || 0), 0),
    [txs]
  );

  // Salary summary for selected month
  const salarySummary = useMemo(() =>
    getSalarySummary(txs, staff, salaryMonthView),
    [txs, staff, salaryMonthView]
  );

  const navigateSalaryMonth = (dir: -1 | 1) => {
    const [y, m] = salaryMonthView.split('-').map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    setSalaryMonthView(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  // ── Running balance for ledger tab ───────────────────────────────────────────
  const withRunning = useMemo(() => {
    const sorted = [...txs].sort((a, b) => {
      const dA = (a.date || '').slice(0, 10), dB = (b.date || '').slice(0, 10);
      if (dA !== dB) return dA < dB ? -1 : 1;
      const cA = a.created_at ? parseDateSafe(a.created_at).getTime() : 0;
      const cB = b.created_at ? parseDateSafe(b.created_at).getTime() : 0;
      return cA - cB;
    });
    let run = 0;
    return sorted.map(t => {
      const dir = getDirection(t.type, t.amount);
      if (dir === 'credit') run += t.amount;
      else if (dir === 'debit') run -= t.amount;
      return { ...t, runningBalance: run };
    }).reverse();
  }, [txs]);

  const filteredByType = useMemo(() =>
    typeFilter ? txs.filter(t => t.type === typeFilter) : txs,
    [txs, typeFilter]
  );

  const filteredWithRunning = useMemo(() =>
    typeFilter
      ? filteredByType.map(t => withRunning.find(w => w.id === t.id)!).filter(Boolean)
      : withRunning,
    [filteredByType, withRunning, typeFilter]
  );

  const openTx = (type: StaffTxType) => { setDefaultTxType(type); setShowTxModal(true); };

  const handleDelete = async (id: string) => {
    try {
      await deleteTx.mutateAsync(id);
      showToast('Deleted', 'info');
      setConfirmDelete(null);
    } catch { showToast('Delete failed', 'error'); }
  };

  // ── Tab labels with counts ────────────────────────────────────────────────────
  const tabs: { id: Tab; icon: React.ReactNode; label: string }[] = [
    { id: 'overview',  icon: <BarChart3 size={12} />,  label: 'Overview' },
    { id: 'activity',  icon: <Users size={12} />,      label: `Activity${partyActivity.all.length > 0 ? ` (${partyActivity.all.length})` : ''}` },
    { id: 'ledger',    icon: <FileText size={12} />,   label: `Ledger${txs.length > 0 ? ` (${txs.length})` : ''}` },
  ];

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--app-bg)' }}>

      {/* ── Fixed header: back + name + tabs ───────────────────────────────── */}
      <div className="shrink-0 border-b"
        style={{ background: 'rgba(var(--app-bg-rgb),0.97)', backdropFilter: 'blur(20px)', borderColor: 'var(--rgba-white-06)' }}>
        <div className="flex items-center gap-3 px-4 pt-5 pb-3">
          <button onClick={onBack} className="p-2 rounded-xl active:scale-95 transition-all"
            style={{ background: 'var(--rgba-white-07)', border: '1px solid var(--glass-border)' }}>
            <ArrowLeft size={18} className="text-[var(--text-primary)]" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-black text-base text-[var(--text-primary)] truncate">{staff.name}</h1>
            <div className="flex items-center gap-2 flex-wrap mt-0.5">
              {staff.staff_code && (
                <span className="text-app-sm font-mono text-[var(--text-muted)]">{staff.staff_code}</span>
              )}
              <span className="text-app-sm font-black px-1.5 py-0.5 rounded-md"
                style={staff.status === 'active'
                  ? { background: 'var(--col-emerald-15)', color: "var(--col-success)" }
                  : { background: 'var(--text-muted)', color: "var(--col-slate)" }}>
                {staff.status}
              </span>
              {staff.monthly_salary ? (
                <span className="text-app-sm font-bold px-1.5 py-0.5 rounded-md"
                  style={{ background: 'rgba(251,191,36,0.08)', color: 'rgba(251,191,36,0.7)' }}>
                  ₹{staff.monthly_salary.toLocaleString('en-IN')}/mo
                </span>
              ) : null}
            </div>
          </div>
          <button onClick={() => onEdit(staff)} className="p-2 rounded-xl active:scale-95 transition-all"
            style={{ background: 'var(--rgba-white-07)', border: '1px solid var(--glass-border)' }}>
            <Edit size={16} className="text-[var(--text-muted)]" />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex px-0">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-app-sm font-black uppercase tracking-wide transition-all border-b-2"
              style={activeTab === tab.id
                ? { color: "var(--col-violet)", borderColor: "var(--col-violet-600)" }
                : { color: 'var(--text-muted)', borderColor: 'transparent' }}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Scrollable content ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0"
        style={{ WebkitOverflowScrolling: 'touch', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 80px)' }}>

        {/* ════════════════════ OVERVIEW TAB ════════════════════════════════ */}
        {activeTab === 'overview' && (
          <div className="px-4 pt-4 space-y-4">

            {/* Balance hero */}
            <div className="p-4 rounded-2xl relative overflow-hidden text-center"
              style={{
                background: effectiveCash >= 0 ? 'var(--col-emerald-08)' : 'var(--col-danger-08)',
                border: `1px solid ${effectiveCash >= 0 ? 'var(--col-emerald-25)' : 'var(--col-danger-25)'}`,
              }}>
              <p className="text-app-sm font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                {effectiveCash >= 0 ? 'Cash held by staff' : 'Owner owes this staff'}
              </p>
              <p className="text-3xl font-black mb-3"
                style={{ color: effectiveCash >= 0 ? "var(--col-success)" : "var(--col-danger)" }}>
                {effectiveCash < 0 ? '−' : ''}₹{Math.abs(effectiveCash).toLocaleString('en-IN')}
              </p>
              {/* Component breakdown */}
              <div className="flex justify-center gap-4 text-app-sm font-bold flex-wrap">
                {partyActivity.totalIn > 0 && (
                  <span style={{ color: "var(--col-success)" }}>
                    <ArrowDownLeft size={9} className="inline" /> Party Collected {fmt(partyActivity.totalIn, true)}
                  </span>
                )}
                {partyActivity.totalOut > 0 && (
                  <span style={{ color: "var(--col-danger)" }}>
                    <ArrowUpRight size={9} className="inline" /> Party Paid {fmt(partyActivity.totalOut, true)}
                  </span>
                )}
                {bal.moneyWithStaff !== 0 && (
                  <span style={{ color: "var(--col-violet)" }}>
                    Ledger {bal.moneyWithStaff < 0 ? '−' : '+'}{fmt(Math.abs(bal.moneyWithStaff), true)}
                  </span>
                )}
              </div>
            </div>

            {/* 4-stat grid */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Party Collected',    value: fmt(partyActivity.totalIn, true),                                  color: "var(--col-success)", sub: 'via received_by' },
                { label: 'Party Paid',         value: fmt(partyActivity.totalOut, true),                                 color: "var(--col-danger)", sub: 'via paid_by' },
                { label: 'Salary Paid (Total)',value: fmt(totalSalaryAllTime, true),                                     color: "var(--col-warning)", sub: 'all time' },
                { label: 'Advances Given',     value: fmt(bal.totalExpenseAdvances + bal.totalSalaryAdvances, true),     color: "var(--col-info)", sub: 'expense + salary' },
              ].map(({ label, value, color, sub }) => (
                <div key={label} className="p-3 rounded-2xl"
                  style={{ background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)' }}>
                  <p className="text-app-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
                  <p className="font-black text-sm" style={{ color }}>{value}</p>
                  <p className="text-app-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>
                </div>
              ))}
            </div>

            {/* Quick actions */}
            <div>
              <p className="text-app-xs font-black uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Quick Actions</p>
              <div className="flex flex-wrap gap-2">
                {QUICK_ACTIONS.map(([type, label, color]) => (
                  <button key={type} onClick={() => openTx(type)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-app-md font-black transition-all active:scale-95"
                    style={{ background: `${color}18`, border: `1px solid ${color}33`, color }}>
                    <Plus size={11} />{label}
                  </button>
                ))}
              </div>
            </div>

            {/* Salary section: month navigator + breakdown + pay buttons */}
            <div className="rounded-2xl overflow-hidden"
              style={{ border: '1px solid rgba(251,191,36,0.2)', background: 'rgba(251,191,36,0.05)' }}>

              {/* Month navigator */}
              <div className="flex items-center justify-between px-4 py-3 border-b"
                style={{ borderColor: 'rgba(251,191,36,0.1)' }}>
                <button onClick={() => navigateSalaryMonth(-1)}
                  className="p-1.5 rounded-lg active:scale-90 transition-all"
                  style={{ background: 'rgba(251,191,36,0.12)', color: 'rgba(251,191,36,0.7)' }}>
                  <ChevronLeft size={14} />
                </button>
                <div className="text-center">
                  <p className="text-app-xs font-bold uppercase tracking-wide" style={{ color: 'rgba(251,191,36,0.5)' }}>Salary Month</p>
                  <p className="text-sm font-black" style={{ color: 'rgba(251,191,36,0.85)' }}>{monthLabel(salaryMonthView)}</p>
                </div>
                <button onClick={() => navigateSalaryMonth(1)}
                  className="p-1.5 rounded-lg active:scale-90 transition-all"
                  style={{ background: 'rgba(251,191,36,0.12)', color: 'rgba(251,191,36,0.7)' }}>
                  <ChevronRight size={14} />
                </button>
              </div>

              {/* Salary breakdown */}
              <div className="px-4 py-3 space-y-2">
                {[
                  { label: 'Monthly Salary',    value: `₹${salarySummary.monthlySalary.toLocaleString('en-IN')}`, color: 'var(--text-primary)' },
                  { label: 'Paid this month',   value: `₹${salarySummary.totalPaid.toLocaleString('en-IN')}`,    color: "var(--col-success)" },
                  { label: 'Advance adjusted',  value: `₹${salarySummary.totalAdvance.toLocaleString('en-IN')}`, color: "var(--col-info)" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex justify-between text-xs">
                    <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                    <span className="font-bold" style={{ color }}>{value}</span>
                  </div>
                ))}
                <div className="flex justify-between text-xs border-t border-white/5 pt-2">
                  <span className="font-black" style={{ color: 'var(--text-primary)' }}>Balance due</span>
                  <span className="font-black" style={{ color: salarySummary.pending > 0 ? "var(--col-warning)" : "var(--col-success)" }}>
                    ₹{Math.max(0, salarySummary.pending).toLocaleString('en-IN')}
                    {salarySummary.pending <= 0 ? ' ✓' : ''}
                  </span>
                </div>
              </div>

              {/* Pay salary / give advance */}
              <div className="px-4 pb-3 flex gap-2">
                <button onClick={() => openTx('SALARY_PAYMENT')}
                  className="flex-1 py-2.5 rounded-xl text-app-md font-black flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                  style={{ background: 'var(--col-emerald-15)', border: '1px solid var(--col-emerald-35)', color: "var(--col-success)" }}>
                  <IndianRupee size={12} />Pay Salary
                </button>
                <button onClick={() => openTx('SALARY_ADVANCE')}
                  className="flex-1 py-2.5 rounded-xl text-app-md font-black flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                  style={{ background: 'var(--col-info-12)', border: '1px solid var(--col-info-25)', color: "var(--col-info)" }}>
                  <IndianRupee size={12} />Give Advance
                </button>
              </div>
            </div>

            {/* Balance Sheet (collapsible) */}
            <div className="rounded-2xl overflow-hidden"
              style={{ border: '1px solid var(--col-accent-25)', background: 'rgba(99,102,241,0.04)' }}>
              <button onClick={() => setShowBalSheet(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3"
                style={{ color: 'var(--col-indigo)' }}>
                <div className="flex items-center gap-2">
                  <BarChart3 size={14} />
                  <span className="text-app-md font-black uppercase tracking-wide">Balance Sheet</span>
                </div>
                {showBalSheet ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {showBalSheet && (
                <div className="px-4 pb-4 border-t border-white/5">
                  <div className="pt-3 space-y-2">
                    {[
                      { label: 'Party Collections (received_by)',  value: partyActivity.totalIn,            color: "var(--col-success)", sign: '+' },
                      { label: 'Party Payments (paid_by)',         value: partyActivity.totalOut,           color: "var(--col-danger)", sign: '−' },
                      { label: 'Manual Collections (ledger)',      value: bal.totalCollections,             color: "var(--col-violet)", sign: '+' },
                      { label: 'Expense Advances',                 value: bal.totalExpenseAdvances,         color: "var(--col-info)", sign: '+' },
                      { label: 'Salary Advances',                  value: bal.totalSalaryAdvances,          color: "var(--col-success)", sign: '+' },
                      { label: 'Staff Expenses',                   value: bal.totalExpenses,                color: "var(--col-danger)", sign: '−' },
                      { label: 'Settlements (returned to owner)',  value: bal.totalSettlements,             color: "var(--col-warning)", sign: '−' },
                      ...(bal.totalAdjustments !== 0
                        ? [{ label: 'Manual Adjustments', value: Math.abs(bal.totalAdjustments), color: "var(--col-slate)", sign: bal.totalAdjustments >= 0 ? '+' : '−' }]
                        : []),
                    ].map(({ label, value, color, sign }) => (
                      <div key={label} className="flex justify-between text-app-sm">
                        <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                        <span className="font-bold" style={{ color }}>{sign}₹{value.toLocaleString('en-IN')}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-xs border-t border-white/8 pt-2 mt-1">
                      <span className="font-black" style={{ color: 'var(--text-primary)' }}>Net Cash with Staff</span>
                      <span className="font-black" style={{ color: effectiveCash >= 0 ? "var(--col-success)" : "var(--col-danger)" }}>
                        {effectiveCash < 0 ? '−' : ''}₹{Math.abs(effectiveCash).toLocaleString('en-IN')}
                      </span>
                    </div>
                    <div className="flex justify-between text-app-sm pt-1 border-t border-white/5">
                      <span style={{ color: 'var(--text-muted)' }}>Total Salary Paid (All Time)</span>
                      <span className="font-bold text-col-warning">₹{totalSalaryAllTime.toLocaleString('en-IN')}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════════════════════ PARTY ACTIVITY TAB ══════════════════════════ */}
        {activeTab === 'activity' && (
          <div className="px-4 pt-4">

            {/* Summary */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                { label: 'Collected',  value: fmt(partyActivity.totalIn),                                     color: "var(--col-success)" },
                { label: 'Paid Out',   value: fmt(partyActivity.totalOut),                                    color: "var(--col-danger)" },
                { label: 'Net',        value: fmt(Math.abs(partyActivity.totalIn - partyActivity.totalOut)),  color: partyActivity.totalIn >= partyActivity.totalOut ? "var(--col-success)" : "var(--col-danger)" },
              ].map(({ label, value, color }) => (
                <div key={label} className="p-3 rounded-2xl text-center"
                  style={{ background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)' }}>
                  <p className="text-app-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
                  <p className="font-black text-sm" style={{ color }}>{value}</p>
                </div>
              ))}
            </div>

            {linkedLoading ? (
              <div className="flex justify-center py-12">
                <div className="w-6 h-6 border-2 border-white/10 border-t-cyan-400 rounded-full animate-spin" />
              </div>
            ) : partyActivity.all.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Users size={32} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
                <p className="text-sm font-bold" style={{ color: 'var(--text-muted)' }}>No party transactions yet</p>
                <p className="text-app-md mt-2 px-4" style={{ color: 'var(--text-muted)' }}>
                  When a payment is recorded with "{staff.name}" in the <span style={{ color: 'var(--col-success-60)' }}>Received By</span> or <span style={{ color: 'rgba(248,113,113,0.6)' }}>Paid By</span> field, it will appear here and be counted in the balance.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {partyActivity.all.map((t: any) => {
                  const sn          = staff.name.toLowerCase().trim();
                  const isCollect   = (t.received_by || '').toLowerCase().trim() === sn;
                  const amt         = Number(t.amount || 0);
                  return (
                    <div key={t.id} className="p-3 rounded-2xl"
                      style={{
                        background: isCollect ? 'var(--col-emerald-06)' : 'var(--col-danger-06)',
                        border: `1px solid ${isCollect ? 'var(--col-emerald-18)' : 'var(--col-danger-18)'}`,
                        borderLeft: `3px solid ${isCollect ? "var(--col-emerald)" : "var(--col-red)"}`,
                      }}>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                          style={{ background: isCollect ? 'var(--col-emerald-15)' : 'var(--col-danger-15)' }}>
                          {isCollect
                            ? <ArrowDownLeft size={14} style={{ color: "var(--col-success)" }} />
                            : <ArrowUpRight  size={14} style={{ color: "var(--col-danger)" }} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs truncate">{t.party_name || 'Unknown Party'}</span>
                            <span className="font-black text-sm shrink-0 ml-2"
                              style={{ color: isCollect ? "var(--col-success-light)" : "var(--col-danger-light)" }}>
                              {isCollect ? '+' : '−'}₹{Math.round(amt).toLocaleString('en-IN')}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-app-xs font-black px-1.5 py-0.5 rounded uppercase"
                              style={isCollect
                                ? { background: 'var(--col-emerald-15)', color: "var(--col-success)" }
                                : { background: 'var(--col-danger-12)', color: "var(--col-danger)" }}>
                              {isCollect ? 'Collected' : 'Paid Out'}
                            </span>
                            <span className="text-app-xs" style={{ color: 'var(--text-muted)' }}>
                              {(t.date || '').slice(0, 10)}
                            </span>
                            {t.payment_mode && (
                              <span className="text-app-xs flex items-center gap-0.5" style={{ color: 'var(--text-muted)' }}>
                                <Banknote size={9} />{t.payment_mode}
                              </span>
                            )}
                            {t.payment_purpose && (
                              <span className="text-app-xs px-1.5 py-0.5 rounded"
                                style={{ background: 'var(--col-accent-15)', color: 'var(--col-violet-70)' }}>
                                {t.payment_purpose}
                              </span>
                            )}
                          </div>
                          {t.notes && (
                            <p className="text-app-xs mt-1 italic" style={{ color: 'var(--text-muted)' }}>{t.notes}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ════════════════════ LEDGER TAB ══════════════════════════════════ */}
        {activeTab === 'ledger' && (
          <div>
            {/* Type filter chips */}
            <div className="px-4 pt-3 pb-2 flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              <button onClick={() => setTypeFilter('')}
                className="shrink-0 px-3 py-1.5 rounded-lg text-app-sm font-black transition-all"
                style={!typeFilter
                  ? { background: 'var(--col-violet-25)', border: '1px solid var(--col-violet-40)', color: "var(--col-violet)" }
                  : { background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                All
              </button>
              {(Object.keys(STAFF_TX_LABELS) as StaffTxType[]).map(t => (
                <button key={t} onClick={() => setTypeFilter(t === typeFilter ? '' : t)}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-app-sm font-black transition-all"
                  style={typeFilter === t
                    ? { background: `${TYPE_COLOR[t]}22`, border: `1px solid ${TYPE_COLOR[t]}55`, color: TYPE_COLOR[t] }
                    : { background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                  {STAFF_TX_LABELS[t]}
                </button>
              ))}
            </div>

            {isLoading ? (
              <div className="flex justify-center pt-12">
                <div className="w-8 h-8 border-2 border-white/10 border-t-violet-400 rounded-full animate-spin" />
              </div>
            ) : filteredWithRunning.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-2">
                <IndianRupee size={28} style={{ color: 'var(--text-muted)' }} />
                <p className="text-sm font-bold" style={{ color: 'var(--text-muted)' }}>
                  {typeFilter ? `No ${STAFF_TX_LABELS[typeFilter]} records` : 'No records yet'}
                </p>
                {!typeFilter && (
                  <button onClick={() => openTx('SALARY_PAYMENT')}
                    className="mt-2 px-4 py-2 rounded-xl text-xs font-black active:scale-95 transition-all"
                    style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', color: "var(--col-violet)" }}>
                    + Record first transaction
                  </button>
                )}
              </div>
            ) : (
              <div className="px-4 pt-1 space-y-2">
                {/* Column headers */}
                <div className="flex items-center justify-between text-app-xs font-bold uppercase tracking-wider px-1 py-1"
                  style={{ color: 'var(--text-muted)' }}>
                  <span>Date / Description</span>
                  <div className="flex gap-5">
                    <span>Out</span>
                    <span>In</span>
                    <span className="w-14 text-right">Balance</span>
                  </div>
                </div>

                {filteredWithRunning.map(tx => {
                  if (!tx) return null;
                  const dir   = getDirection(tx.type, tx.amount);
                  const color = TYPE_COLOR[tx.type];
                  return (
                    <div key={tx.id} className="p-3 rounded-2xl group relative"
                      style={{ background: TYPE_BG[tx.type], border: '1px solid var(--glass-border)' }}>
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                          style={{ background: `${color}22` }}>
                          <IndianRupee size={13} style={{ color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-app-sm font-black px-1.5 py-0.5 rounded-md"
                              style={{ background: `${color}22`, color }}>
                              {STAFF_TX_LABELS[tx.type]}
                            </span>
                            {tx.payment_mode && (
                              <span className="text-app-xs" style={{ color: 'var(--text-muted)' }}>{tx.payment_mode}</span>
                            )}
                            {tx.salary_month && (
                              <span className="text-app-xs font-bold px-1.5 py-0.5 rounded"
                                style={{ background: 'rgba(251,191,36,0.1)', color: 'rgba(251,191,36,0.65)' }}>
                                {monthLabel(tx.salary_month)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-semibold mt-0.5 truncate" style={{ color: 'var(--text-primary)' }}>
                            {tx.description || tx.purpose || '—'}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-app-xs" style={{ color: 'var(--text-muted)' }}>{tx.date}</span>
                            {tx.reference_number && (
                              <span className="text-app-xs" style={{ color: 'var(--text-muted)' }}>#{tx.reference_number}</span>
                            )}
                          </div>
                          {tx.notes && (
                            <p className="text-app-xs mt-0.5 italic" style={{ color: 'var(--text-muted)' }}>{tx.notes}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0 min-w-[90px]">
                          <div className="flex gap-3 justify-end text-xs font-black">
                            <span style={{ color: dir === 'debit'  ? "var(--col-danger)" : 'var(--text-muted)' }}>
                              {dir === 'debit' ? fmt(tx.amount) : '—'}
                            </span>
                            <span style={{ color: dir === 'credit' ? "var(--col-success)" : dir === 'neutral' ? "var(--col-violet)" : 'var(--text-muted)' }}>
                              {dir !== 'debit' ? fmt(tx.amount) : '—'}
                            </span>
                          </div>
                          {!typeFilter && (
                            <p className="text-app-sm font-black mt-0.5"
                              style={{ color: (tx as any).runningBalance >= 0 ? "var(--col-violet)" : "var(--col-danger)" }}>
                              {fmt((tx as any).runningBalance)}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Delete confirmation */}
                      {confirmDelete === tx.id ? (
                        <div className="mt-2 flex gap-2">
                          <button onClick={() => handleDelete(tx.id!)}
                            className="flex-1 py-1.5 rounded-lg text-app-sm font-black text-red-400"
                            style={{ background: 'var(--col-danger-15)', border: '1px solid var(--col-danger-35)' }}>
                            Delete
                          </button>
                          <button onClick={() => setConfirmDelete(null)}
                            className="flex-1 py-1.5 rounded-lg text-app-sm font-black"
                            style={{ background: 'var(--rgba-white-05)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDelete(tx.id!)}
                          className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 group-active:opacity-100 p-1 rounded-lg transition-all"
                          style={{ background: 'var(--col-danger-15)', border: '1px solid var(--col-danger-25)' }}>
                          <Trash2 size={10} className="text-red-400" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom action bar for Ledger tab ───────────────────────────────── */}
      {activeTab === 'ledger' && (
        <div className="shrink-0 px-4 py-3 border-t"
          style={{
            borderColor: 'var(--rgba-white-06)',
            background: 'rgba(var(--app-bg-rgb),0.97)',
            paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))',
          }}>
          <button onClick={() => openTx('SALARY_PAYMENT')}
            className="w-full py-3 rounded-2xl text-sm font-black text-white flex items-center justify-center gap-2 active:scale-95 transition-all"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', boxShadow: '0 6px 20px rgba(124,58,237,0.3)' }}>
            <Plus size={16} />Add Record
          </button>
        </div>
      )}

      <StaffTransactionModal
        isOpen={showTxModal}
        onClose={() => setShowTxModal(false)}
        uid={uid}
        staff={staff}
        createdBy={user.displayName || user.email || uid}
        defaultType={defaultTxType}
      />
    </div>
  );
}
