import React, { useState, useMemo } from 'react';
import { ArrowLeft, Plus, Users, Wallet, TrendingUp, UserCheck, UserX, ChevronRight } from 'lucide-react';
import SearchBarWithSuggest from '../common/SearchBarWithSuggest';
import { StaffMember } from '../../types/models';
import { useStaffList, useAllStaffTransactions, calculateBalance } from '../../hooks/useStaff';
import { useUI } from '../../context/UIContext';
import StaffFormModal from '../modals/StaffFormModal';
import StaffDetailView from './StaffDetailView';

interface Props {
  user: { uid: string; email?: string | null; displayName?: string | null };
  onBack: () => void;
}

function fmt(n: number) {
  const abs = Math.abs(n);
  if (abs >= 100000)  return `₹${(n/100000).toFixed(1)}L`;
  if (abs >= 1000)    return `₹${(n/1000).toFixed(1)}k`;
  return `₹${n.toFixed(0)}`;
}

function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="flex-1 min-w-0 p-3 rounded-2xl" style={{ background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)' }}>
      <p className="text-app-sm font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-base font-black truncate" style={{ color }}>{value}</p>
      {sub && <p className="text-app-xs mt-0.5 font-semibold" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  );
}

export default function StaffView({ user, onBack }: Props) {
  const { showToast } = useUI();
  const uid = user.uid;

  const { data: staffList = [], isLoading: loadingStaff } = useStaffList(uid);
  const { data: allTx = [] } = useAllStaffTransactions(uid);

  const [search,      setSearch]      = useState('');
  const [showForm,    setShowForm]    = useState(false);
  const [editStaff,   setEditStaff]   = useState<StaffMember | null>(null);
  const [detailStaff, setDetailStaff] = useState<StaffMember | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const activeStaff = useMemo(() => staffList.filter(s => s.status === 'active'),   [staffList]);
  const inactiveStaff = useMemo(() => staffList.filter(s => s.status === 'inactive'), [staffList]);

  // Aggregate dashboard stats
  const stats = useMemo(() => {
    let totalMoneyWithStaff = 0;
    let totalSalaryDue = 0;
    activeStaff.forEach(s => {
      const txs = allTx.filter(t => t.staff_id === s.id);
      const bal = calculateBalance(txs, s);
      totalMoneyWithStaff += bal.moneyWithStaff;
      if (bal.pendingSalaryThisMonth > 0) totalSalaryDue += bal.pendingSalaryThisMonth;
    });
    return { totalMoneyWithStaff, totalSalaryDue };
  }, [activeStaff, allTx]);

  const staffSuggestions = useMemo(() => staffList.map(s => s.name).filter(Boolean) as string[], [staffList]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const list = showInactive ? staffList : activeStaff;
    if (!q) return list;
    return list.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.phone       || '').includes(q) ||
      (s.staff_code  || '').toLowerCase().includes(q) ||
      (s.address     || '').toLowerCase().includes(q) ||
      (s.notes       || '').toLowerCase().includes(q)
    );
  }, [staffList, activeStaff, search, showInactive]);

  // Show detail view
  if (detailStaff) {
    return (
      <StaffDetailView
        user={user}
        staff={detailStaff}
        onBack={() => setDetailStaff(null)}
        onEdit={(s) => { setEditStaff(s); setShowForm(true); }}
      />
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--app-bg)' }}>
      {/* Header */}
      <div className="shrink-0 px-4 pt-5 pb-4 border-b"
        style={{ background: 'rgba(var(--app-bg-rgb),0.95)', backdropFilter: 'blur(20px)', borderColor: 'var(--rgba-white-06)' }}>
        <div className="flex items-center gap-3 mb-4">
          <button onClick={onBack} className="p-2 rounded-xl active:scale-95 transition-all"
            style={{ background: 'var(--rgba-white-07)', border: '1px solid var(--glass-border)' }}>
            <ArrowLeft size={18} className="text-[var(--text-primary)]" />
          </button>
          <div className="flex-1">
            <h1 className="font-black text-base text-[var(--text-primary)] tracking-tight">Staff</h1>
            <p className="text-app-sm text-[var(--text-muted)]">
              {activeStaff.length} active{inactiveStaff.length > 0 ? ` · ${inactiveStaff.length} inactive` : ''}
            </p>
          </div>
          <button onClick={() => { setEditStaff(null); setShowForm(true); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-black text-xs active:scale-95 transition-all"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', color: 'white' }}>
            <Plus size={14} /> Add
          </button>
        </div>

        {/* Summary cards */}
        <div className="flex gap-2 mb-3">
          <SummaryCard label="Active Staff" value={String(activeStaff.length)} color="var(--col-violet)" />
          <SummaryCard label="Cash With Staff" value={fmt(stats.totalMoneyWithStaff)}
            color={stats.totalMoneyWithStaff >= 0 ? "var(--col-success)" : "var(--col-danger)"}
            sub={stats.totalMoneyWithStaff < 0 ? 'You owe staff' : 'Held by staff'} />
          <SummaryCard label="Salary Pending" value={fmt(stats.totalSalaryDue)} color="var(--col-warning)" sub="This month" />
        </div>

        {/* Search + inactive toggle */}
        <div className="flex gap-2">
          <SearchBarWithSuggest
            value={search}
            onChange={setSearch}
            placeholder="Name, phone, code, address…"
            suggestions={staffSuggestions}
            className="flex-1 rounded-xl py-1"
            inputClassName="py-1 text-sm bg-transparent outline-none text-[var(--text-secondary)] placeholder-[rgba(148,163,184,0.4)]"
            containerStyle={{ background: 'var(--rgba-white-05)', border: '1px solid var(--glass-border)' }}
          />
          <button onClick={() => setShowInactive(p => !p)}
            className="px-3 py-2 rounded-xl text-app-md font-black transition-all active:scale-95"
            style={showInactive
              ? { background: 'var(--surface-3)', border: '1px solid var(--glass-border)', color: "var(--col-slate)" }
              : { background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
            {showInactive ? <UserCheck size={13} /> : <UserX size={13} />}
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 80px)' }}>
        {loadingStaff ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <div className="w-8 h-8 border-2 border-white/10 border-t-violet-400 rounded-full animate-spin" />
            <p className="text-xs text-[var(--text-muted)] font-semibold">Loading staff…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 px-6 text-center">
            <Users size={32} className="text-[var(--text-muted)]" />
            <p className="text-sm font-bold text-[var(--text-muted)]">
              {search ? 'No staff match your search' : 'No staff members yet'}
            </p>
            {!search && (
              <button onClick={() => setShowForm(true)}
                className="mt-2 px-4 py-2 rounded-xl text-xs font-black active:scale-95 transition-all"
                style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', color: "var(--col-violet)" }}>
                + Add first staff member
              </button>
            )}
          </div>
        ) : (
          <div className="px-4 pt-3 space-y-2">
            {filtered.map(s => <StaffCard key={s.id} staff={s} allTx={allTx} onOpen={() => setDetailStaff(s)} />)}
          </div>
        )}
      </div>

      <StaffFormModal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditStaff(null); }}
        uid={uid}
        createdBy={user.displayName || user.email || uid}
        initialData={editStaff}
      />
    </div>
  );
}

function StaffCard({ staff, allTx, onOpen }: { staff: StaffMember; allTx: any[]; onOpen: () => void }) {
  const txs = allTx.filter(t => t.staff_id === staff.id);
  const bal = calculateBalance(txs, staff);
  const moneyWithStaff = bal.moneyWithStaff;
  const isActive = staff.status === 'active';

  return (
    <button onClick={onOpen} className="w-full text-left p-4 rounded-2xl transition-all active:scale-[0.98] group"
      style={{ background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)' }}>
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 font-black text-base"
          style={{ background: isActive ? 'rgba(124,58,237,0.2)' : 'var(--text-muted)', color: isActive ? "var(--col-violet)" : 'var(--text-muted)' }}>
          {staff.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-black text-sm text-[var(--text-primary)] truncate">{staff.name}</p>
            {!isActive && <span className="text-app-xs font-black px-1.5 py-0.5 rounded-md" style={{ background: 'var(--text-muted)', color: 'var(--text-muted)' }}>Inactive</span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {staff.staff_code && <span className="text-app-sm font-mono text-[var(--text-muted)]">{staff.staff_code}</span>}
            {staff.phone && <span className="text-app-sm text-[var(--text-muted)]">· {staff.phone}</span>}
          </div>
          {staff.monthly_salary && (
            <p className="text-app-sm mt-0.5 font-semibold text-[var(--text-muted)]">
              ₹{staff.monthly_salary.toLocaleString('en-IN')}/month
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          {txs.length > 0 && (
            <p className="text-sm font-black" style={{ color: moneyWithStaff > 0 ? "var(--col-success)" : moneyWithStaff < 0 ? "var(--col-danger)" : 'var(--text-muted)' }}>
              {moneyWithStaff >= 0 ? '' : '−'}₹{Math.abs(moneyWithStaff).toLocaleString('en-IN')}
            </p>
          )}
          {txs.length > 0 && (
            <p className="text-app-xs font-semibold mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {moneyWithStaff >= 0 ? 'with them' : 'you owe'}
            </p>
          )}
          <ChevronRight size={14} className="text-[var(--text-muted)] mt-1 ml-auto" />
        </div>
      </div>
    </button>
  );
}
