import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useNavState } from '../../services/useNavState';
import { useBackHandler } from '../../services/useBackHandler';
import { User } from 'firebase/auth';
import {
  Search, Plus, Phone, MapPin,
  Edit2, Trash2, ArrowLeft, RefreshCw, Download
} from 'lucide-react';
import { useUI } from '../../context/UIContext';
import { useData } from '../../context/DataContext';
import ManualEntryModal from '../modals/ManualEntryModal';
import { calculateAccounting, formatINR } from '../../utils/helpers';
import { PartiesSkeleton } from '../common/Skeleton';
import { TrashService } from '../../services/trash';
import { useSoftDelete } from '../common/UndoSnackbar';
import PartyDetailView from './PartyDetailView';
import { Virtuoso } from 'react-virtuoso';
import { exportService } from '../../services/export';

interface PartiesViewProps {
  user: User;
  onAdd?: () => void;
  onEdit?: (item: any) => void;
  onBack?: () => void;
  appSettings?: any;
  onViewStatement?: (party: any) => void;
  onSubPageChange?: (isOnSubPage: boolean) => void;
}

const PartiesView: React.FC<PartiesViewProps> = ({ user, onAdd, onEdit, onBack, appSettings = {}, onViewStatement, onSubPageChange }) => {
  const { showToast, confirm } = useUI();
  const { scheduleDelete } = useSoftDelete();
  const { useParties, useLedger, useTransactions } = useData();

  // MODULE 4 — Read all three lists from the shared React Query cache so the
  // screen renders instantly on cold start (and stays usable offline). No
  // more per-mount triple Firestore round-trip — the cache is shared with
  // the dashboard, statements, and reports.
  const { data: partiesRaw, isLoading: partiesLoading, isFetching: partiesFetching, setData: setPartiesCache } = useParties(user.uid);
  const { data: ledgerRaw, isLoading: ledgerLoading } = useLedger(user.uid);
  const { data: transactionsRaw, isLoading: transactionsLoading } = useTransactions(user.uid);
  const parties      = useMemo(() => partiesRaw      || [], [partiesRaw]);
  const ledger       = useMemo(() => ledgerRaw       || [], [ledgerRaw]);
  const transactions = useMemo(() => transactionsRaw || [], [transactionsRaw]);
  // Show the skeleton only while the FIRST load is in flight for any of the
  // three sources. Subsequent navigations reuse cached data instantly.
  const loading = partiesLoading || ledgerLoading || transactionsLoading;

  const [search, setSearch] = useNavState<string>('parties_search', '');
  const [filterRole, setFilterRole] = useNavState<'all' | 'customer' | 'supplier'>('parties_filter', 'all');

  const [selectedParty, setSelectedParty] = useState<any>(null);
  useBackHandler(() => setSelectedParty(null), !!selectedParty, 5);
  useEffect(() => { onSubPageChange?.(!!selectedParty); }, [selectedParty, onSubPageChange]);

  const virtuosoRef = useRef<any>(null);
  const virtuosoStateRef = useRef<any>(null);
  const [initialVirtuosoState] = useState<any>(() => {
    try {
      const s = sessionStorage.getItem('scroll_parties_v2');
      if (!s) return undefined;
      const p = JSON.parse(s);
      return Array.isArray(p?.ranges) ? p : undefined;
    } catch { return undefined; }
  });
  useEffect(() => {
    return () => { virtuosoRef.current?.getState((state: any) => { try { sessionStorage.setItem('scroll_parties_v2', JSON.stringify(state)); } catch {} }); };
  }, []);
  const handleSelectParty = useCallback((party: any) => {
    virtuosoRef.current?.getState((state: any) => { virtuosoStateRef.current = state; });
    setSelectedParty(party);
  }, []);
  const [showModal, setShowModal] = useState(false);
  const [editingParty, setEditingParty] = useState<any>(null);

  const handleLocalUpdate = (updatedItem: any) => {
    // Optimistic local mutation against the React Query cache so the new /
    // edited party appears instantly without waiting for a refetch.
    if (editingParty) {
      setPartiesCache(prev => prev.map(p => p.id === updatedItem.id ? { ...p, ...updatedItem } : p));
      // Also update selectedParty when it is the party currently open in the
      // detail view — otherwise PartyDetailView keeps the stale name and
      // filters ledger / transactions by the old name after rename.
      if (selectedParty?.id === updatedItem.id) {
        setSelectedParty((prev: any) => ({ ...prev, ...updatedItem }));
      }
    } else {
      setPartiesCache(prev => [updatedItem, ...prev]);
    }
    setShowModal(false);
    setEditingParty(null);
  };

  const handleDelete = useCallback(async (id: string, party: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (await confirm("Delete Party?", "This will NOT delete their transactions.")) {
      scheduleDelete({
        id,
        collection: 'parties',
        itemName: party.name,
        onOptimistic: () => setPartiesCache(prev => prev.filter(p => p.id !== id)),
        onRestore: () => setPartiesCache(prev => [...prev, party]),
        onCommit: async () => { await TrashService.moveToTrash(user.uid, 'parties', id); },
      });
    }
  }, [confirm, scheduleDelete, setPartiesCache, user.uid]);

  const handleEditClick = useCallback((party: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingParty(party);
    setShowModal(true);
  }, []);

  const handleAddClick = () => {
    setEditingParty(null);
    setShowModal(true);
  };

  const ledgerByParty = useMemo(() => {
    const map: Record<string, any[]> = {};
    ledger.forEach(l => {
      const name = l.party_name;
      if (!map[name]) map[name] = [];
      map[name].push(l);
    });
    return map;
  }, [ledger]);

  const transactionsByParty = useMemo(() => {
    const map: Record<string, any[]> = {};
    transactions.forEach(t => {
      const name = t.party_name;
      if (!map[name]) map[name] = [];
      map[name].push(t);
    });
    return map;
  }, [transactions]);

  const filteredParties = useMemo(() => {
    return parties.filter(p => {
      const name = (p.name || '').toLowerCase();
      const matchesSearch = name.includes(search.toLowerCase()) ||
        (p.contact || '').includes(search);
      const matchesRole = filterRole === 'all' || p.role === filterRole;
      return matchesSearch && matchesRole;
    });
  }, [parties, search, filterRole]);

  // PERF FIX: calculateAccounting was called inside the render loop for EVERY party
  // on EVERY render (search keystrokes, filter toggles, etc). With 100+ parties this
  // was running 100+ times per keystroke. Memoized here so it only recomputes when
  // the underlying ledger/transaction data actually changes.
  const partyAccounting = useMemo(() => {
    const map: Record<string, { totalBilled: number; totalPaid: number; balance: number }> = {};
    for (const party of parties) {
      map[party.id] = calculateAccounting(
        ledgerByParty[party.name] || [],
        transactionsByParty[party.name] || [],
        party.role,
        {
          openingBalance: Number(party.opening_balance) || 0,
          openingBalanceType: party.opening_balance_type || 'they_owe',
        }
      );
    }
    return map;
  }, [parties, ledgerByParty, transactionsByParty]);

  const handleExportParties = useCallback(async () => {
    if (filteredParties.length === 0) {
      showToast('No parties to export', 'error');
      return;
    }
    const headers = ['Party Code', 'Name', 'Role', 'Phone', 'GSTIN', 'Legal Name', 'Address', 'State', 'Site', 'Credit Limit', 'Total Billed', 'Total Paid', 'Balance'];
    const rows = filteredParties.map(party => {
      const { totalBilled, totalPaid, balance } = partyAccounting[party.id] || { totalBilled: 0, totalPaid: 0, balance: 0 };
      return {
        'Party Code': party.party_code || '',
        Name: party.name || '',
        Role: party.role || '',
        Phone: party.contact || '',
        GSTIN: party.gstin || '',
        'Legal Name': party.legal_name || '',
        Address: party.address || '',
        State: party.state || '',
        Site: party.site || '',
        'Credit Limit': party.credit_limit || '',
        'Total Billed': totalBilled,
        'Total Paid': totalPaid,
        Balance: balance,
      };
    });
    const suffix = filterRole !== 'all' ? `_${filterRole}s` : '';
    await exportService.exportToCSV(rows, headers, `parties${suffix}.csv`);
    showToast('Exported successfully', 'success');
  }, [filteredParties, partyAccounting, filterRole, showToast]);

  // PERF: Stable card renderer — memoized so Virtuoso skips re-rendering
  // individual rows when only unrelated parent state changes (e.g. search input).
  const renderPartyCard = useCallback((party: any) => {
    const { totalBilled, totalPaid, balance } = partyAccounting[party.id] || { totalBilled: 0, totalPaid: 0, balance: 0 };

    return (
      // PERF FIX: No backdropFilter on cards — inline styles bypass the global CSS
      // override in SeoHead.tsx. PartiesView cards were already clean; keeping note
      // here so this is not accidentally added in future.
      <div
        data-list-item
        onClick={() => handleSelectParty(party)}
        className="p-3.5 rounded-2xl active:scale-[0.98] transition-all relative group overflow-hidden"
        style={{
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderLeft: `3px solid ${party.role === 'customer' ? '#34d399' : '#fbbf24'}`,
        }}
      >
        <div className="flex justify-between items-start mb-2 overflow-hidden">
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex items-center gap-2 overflow-hidden">
              <h3 className="font-bold text-sm truncate text-[rgba(240,244,255,0.9)]">{party.name}</h3>
            </div>
            {party.address && (
              <div className="flex items-center gap-1 text-[10px] mt-0.5 truncate text-[rgba(148,163,184,0.45)]">
                <MapPin size={9} className="flex-shrink-0" /> <span className="truncate">{party.address}</span>
              </div>
            )}
            {party.site && (
              <div className="flex items-center gap-1 text-[10px] mt-0.5 truncate" style={{ color: 'rgba(139,92,246,0.65)' }}>
                <MapPin size={9} className="flex-shrink-0" /> <span className="truncate">Site: {party.site}</span>
              </div>
            )}
          </div>

          <div className="flex gap-1.5 flex-shrink-0">
            <button
              onClick={(e) => handleEditClick(party, e)}
              className="w-9 h-9 rounded-xl active:scale-90 transition-all flex items-center justify-center"
              style={{ background: "rgba(59,130,246,0.12)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.18)" }}
            >
              <Edit2 size={14} />
            </button>
            <button
              onClick={(e) => handleDelete(party.id, party, e)}
              className="w-9 h-9 rounded-xl active:scale-90 transition-all flex items-center justify-center"
              style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.15)" }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 py-2 mb-2" style={{ borderTop: "1px solid rgba(255,255,255,0.07)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="min-w-0 overflow-hidden">
            <div className="text-[8px] uppercase font-bold mb-0.5 text-[rgba(148,163,184,0.45)]">{party.role === 'customer' ? 'Total Sales' : 'Total Purchase'}</div>
            <div className="font-bold text-[10px] tabular-nums whitespace-nowrap overflow-hidden text-ellipsis text-[rgba(203,213,225,0.75)]">₹{formatINR(totalBilled)}</div>
          </div>
          <div className="min-w-0 overflow-hidden">
            <div className="text-[8px] uppercase font-bold mb-0.5 text-[rgba(148,163,184,0.45)]">{party.role === 'customer' ? 'Total Rec.' : 'Total Paid'}</div>
            <div className="font-bold text-[10px] tabular-nums whitespace-nowrap overflow-hidden text-ellipsis text-[rgba(203,213,225,0.75)]">₹{formatINR(totalPaid)}</div>
          </div>
          <div className="text-right min-w-0 overflow-hidden">
            <div className="text-[8px] uppercase font-bold mb-0.5 text-[rgba(148,163,184,0.45)]">Balance</div>
            <div
              style={balance > 0 ? { color: '#34d399' } : balance < 0 ? { color: '#f87171' } : { color: 'rgba(148,163,184,0.4)' }}
              className="font-black text-xs tabular-nums whitespace-nowrap"
            >
              ₹{formatINR(Math.abs(balance))} {balance > 0 ? 'Cr' : balance < 0 ? 'Dr' : '—'}
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center text-[10px] overflow-hidden">
          <a href={`tel:${party.contact}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1 font-bold text-[rgba(148,163,184,0.55)] px-2 py-1 rounded-lg truncate">
            <Phone size={10} className="flex-shrink-0" /> <span className="truncate">{party.contact}</span>
          </a>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {onViewStatement && (
              <button
                onClick={(e) => { e.stopPropagation(); onViewStatement(party); }}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black active:scale-95 transition-all"
                style={{ background: 'rgba(16,185,129,0.12)', color: '#34d399', border: '1px solid rgba(16,185,129,0.2)' }}
              >
                Account Book
              </button>
            )}
            <div className="text-[9px] font-bold text-violet-400 flex items-center gap-1">
              View Ledger <ArrowLeft className="rotate-180" size={10} />
            </div>
          </div>
        </div>
      </div>
    );
  }, [partyAccounting, handleEditClick, handleDelete, onViewStatement, handleSelectParty]);

  // Hoisted BEFORE the early returns (loading skeleton, selectedParty detail)
  // so this hook is always called in the same order on every render.
  // The previous inline useCallback inside itemContent JSX was a Rules of Hooks
  // violation that caused React error #300 in the production build.
  const renderPartyRow = useCallback((_index: number, party: any) => (
    <div className="px-4 pt-2">
      {renderPartyCard(party)}
    </div>
  ), [renderPartyCard]);

  if (loading) return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-white/08">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-3">
            {onBack && <button onClick={onBack} className="p-2 -ml-2"><ArrowLeft size={20} style={{ color: "rgba(148,163,184,0.45)" }} /></button>}
            <h1 className="text-xl font-black">Parties</h1>
          </div>
        </div>
      </div>
      <PartiesSkeleton count={5} />
    </div>
  );

  if (selectedParty) {
    return (
      <PartyDetailView
        party={selectedParty}
        user={user}
        onBack={() => setSelectedParty(null)}
        appSettings={appSettings}
      />
    );
  }

  return (
    // PERF: flex-col with fixed height so Virtuoso can measure and activate.
    // Previously overflow-y-auto on the outer div fought with Virtuoso's own scroller.
    <div className="h-full flex flex-col" style={{ background: 'var(--app-bg)' }}>

      {/* HEADER */}
      <div className="sticky top-0 z-30 px-4 pb-3 flex-shrink-0" style={{ background: "rgba(var(--app-bg-rgb),0.93)", paddingTop: '16px' }}>
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2">
            {onBack && (
              <button onClick={onBack} className="p-2 -ml-1 rounded-2xl active:scale-95 transition-all">
                <ArrowLeft size={16} className="text-[rgba(203,213,225,0.7)]" />
              </button>
            )}
            <div>
              <h1 className="text-xl font-black tracking-tight flex items-center gap-2">
                Parties
                {/* MODULE 4 — subtle background-refresh pill */}
                {partiesFetching && !partiesLoading && parties.length > 0 && (
                  <RefreshCw size={11} className="animate-spin text-[rgba(148,163,184,0.55)]" />
                )}
              </h1>
              <p className="text-[10px] font-semibold text-[rgba(148,163,184,0.45)]">{filteredParties.length} contacts</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleExportParties}
              className="p-2.5 rounded-2xl active:scale-95 transition-all"
              style={{ background: 'rgba(59,130,246,0.1)', color: '#60a5fa', border: '1.5px solid rgba(59,130,246,0.15)' }}
              title="Export parties to CSV"
            >
              <Download size={17} />
            </button>
            <button
              onClick={handleAddClick}
              className="text-white p-2.5 rounded-2xl active:scale-95 transition-all"
              style={{ background: "linear-gradient(135deg,#4f46e5,#7c3aed)", boxShadow: "0 4px 14px rgba(79,70,229,0.4)" }}
            >
              <Plus size={18} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <div className="flex-1 rounded-2xl flex items-center px-3 border border-white/10" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <Search size={14} className="text-slate-400 flex-shrink-0" />
            <input
              className="bg-transparent w-full p-2.5 text-sm font-semibold outline-none text-[rgba(240,244,255,0.88)] placeholder-[rgba(148,163,184,0.4)]"
              placeholder="Search parties..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="flex rounded-2xl p-1 gap-0.5 border border-white/10" style={{ background: "rgba(255,255,255,0.05)" }}>
            {(['all', 'customer', 'supplier'] as const).map(r => (
              <button
                key={r}
                onClick={() => setFilterRole(r)}
                className="px-2.5 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wide transition-all"
                style={filterRole === r
                  ? r === 'customer'
                    ? { background: 'rgba(52,211,153,0.15)', color: '#34d399' }
                    : r === 'supplier'
                      ? { background: 'rgba(251,191,36,0.12)', color: '#fbbf24' }
                      : { background: 'rgba(139,92,246,0.25)', color: '#a78bfa' }
                  : { color: 'rgba(148,163,184,0.4)' }}
              >
                {r === 'all' ? 'All' : r === 'customer' ? 'Cust' : 'Supp'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* VIRTUALIZED LIST */}
      <div className="flex-1 min-h-0">
        {filteredParties.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-8 text-center gap-4 pb-24">
            {parties.length === 0 ? (
              <>
                <div className="w-16 h-16 rounded-[22px] flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.2)' }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                </div>
                <div>
                  <p className="font-black text-base text-[rgba(203,213,225,0.75)]">No Parties Yet</p>
                  <p className="text-xs text-[rgba(148,163,184,0.45)] mt-1">Add your customers and suppliers to track their bills and payments.</p>
                </div>
                <button onClick={onAdd}
                  className="px-6 py-3 rounded-2xl text-white font-black text-sm active:scale-95 transition-all"
                  style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', boxShadow: '0 4px 16px rgba(124,58,237,0.35)' }}>
                  + Add First Party
                </button>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-[18px] flex items-center justify-center" style={{ background: 'rgba(148,163,184,0.08)', border: '1px solid rgba(148,163,184,0.12)' }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(148,163,184,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                </div>
                <div>
                  <p className="font-black text-sm text-[rgba(203,213,225,0.6)]">No results</p>
                  <p className="text-xs text-[rgba(148,163,184,0.4)] mt-1">Try a different name or clear the filter.</p>
                </div>
              </>
            )}
          </div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            restoreStateFrom={virtuosoStateRef.current ?? initialVirtuosoState}
            style={{ height: '100%' }}
            data={filteredParties}
            overscan={300}
            computeItemKey={(_index, party) => party.id || `party-${_index}`}
            itemContent={renderPartyRow}
            components={{
              Footer: () => <div className="h-24" />,
            }}
          />
        )}
      </div>

      {showModal && (
        <ManualEntryModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          type="parties"
          user={user}
          initialData={editingParty}
          appSettings={appSettings}
          onSuccess={handleLocalUpdate}
        />
      )}
    </div>
  );
};

export default PartiesView;
