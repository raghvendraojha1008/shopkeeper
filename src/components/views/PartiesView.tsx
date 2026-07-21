import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useNavState } from '../../services/useNavState';
import { useBackHandler } from '../../services/useBackHandler';
import { User } from 'firebase/auth';
import {
  Plus, Phone, MapPin,
  Edit2, Trash2, ArrowLeft, RefreshCw, Download, BookDown,
} from 'lucide-react';
import SearchBarWithSuggest from '../common/SearchBarWithSuggest';
import { useUI } from '../../context/UIContext';
import { useData, useMiscCharges } from '../../context/DataContext';
import ManualEntryModal from '../modals/ManualEntryModal';
import { calculateAccounting, formatINR } from '../../utils/helpers';
import { parseDateSafe } from '../../utils/dateUtils';
import { usePartyMap } from '../../context/DataContext';
import { PartiesSkeleton } from '../common/Skeleton';
import { TrashService } from '../../services/trash';
import { useSoftDelete } from '../common/UndoSnackbar';
import PartyDetailView from './PartyDetailView';
import { Virtuoso } from 'react-virtuoso';
import { exportService } from '../../services/export';
import ExportOptionsModal, { ExportFormat } from '../modals/ExportOptionsModal';
import { ExportOptions } from '../../types/exportOptions';

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
  const [bulkDownloading, setBulkDownloading] = useState(false);

  // Export options modal state
  const [exportModal, setExportModal] = useState<{ open: boolean; format: ExportFormat } | null>(null);

  // MODULE 4 — Read all three lists from the shared React Query cache so the
  // screen renders instantly on cold start (and stays usable offline). No
  // more per-mount triple Firestore round-trip — the cache is shared with
  // the dashboard, statements, and reports.
  const { data: partiesRaw, isLoading: partiesLoading, isFetching: partiesFetching, setData: setPartiesCache } = useParties(user.uid);
  const { data: ledgerRaw, isLoading: ledgerLoading } = useLedger(user.uid);
  const { data: transactionsRaw, isLoading: transactionsLoading } = useTransactions(user.uid);
  const { data: miscChargesAll = [] } = useMiscCharges(user.uid);
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

  // Group misc_charges by party (by party_id then party_name fallback)
  const miscChargesByParty = useMemo(() => {
    const byId: Record<string, any[]> = {};
    const byName: Record<string, any[]> = {};
    miscChargesAll.forEach((mc: any) => {
      if (mc.party_id) { if (!byId[mc.party_id]) byId[mc.party_id] = []; byId[mc.party_id].push(mc); }
      else if (mc.party_name) { if (!byName[mc.party_name]) byName[mc.party_name] = []; byName[mc.party_name].push(mc); }
    });
    return { byId, byName };
  }, [miscChargesAll]);

  const partySuggestions = useMemo(() => parties.map((p: any) => p.name).filter(Boolean) as string[], [parties]);

  const filteredParties = useMemo(() => {
    const q = search.toLowerCase().trim();
    return parties.filter(p => {
      const matchesSearch = !q || (
        (p.name          || '').toLowerCase().includes(q) ||
        (p.legal_name    || '').toLowerCase().includes(q) ||
        (p.contact       || '').toLowerCase().includes(q) ||
        (p.address       || '').toLowerCase().includes(q) ||
        (p.state         || '').toLowerCase().includes(q) ||
        (p.site          || '').toLowerCase().includes(q) ||
        (p.gstin         || '').toLowerCase().includes(q) ||
        (p.party_code    || '').toLowerCase().includes(q)
      );
      const matchesRole = filterRole === 'all' || p.role === filterRole;
      return matchesSearch && matchesRole;
    });
  }, [parties, search, filterRole]);

  // PERF FIX: calculateAccounting was called inside the render loop for EVERY party
  // on EVERY render (search keystrokes, filter toggles, etc). With 100+ parties this
  // was running 100+ times per keystroke. Memoized here so it only recomputes when
  // the underlying ledger/transaction data actually changes.
  const partyAccounting = useMemo(() => {
    // Index records by party_id for those that have it stamped (new records)
    const ledgerById: Record<string, any[]> = {};
    const txById: Record<string, any[]> = {};
    ledger.forEach((l: any) => {
      if (l.party_id) {
        if (!ledgerById[l.party_id]) ledgerById[l.party_id] = [];
        ledgerById[l.party_id].push(l);
      }
    });
    transactions.forEach((t: any) => {
      if (t.party_id) {
        if (!txById[t.party_id]) txById[t.party_id] = [];
        txById[t.party_id].push(t);
      }
    });

    const map: Record<string, { totalBilled: number; totalPaid: number; balance: number; miscNet: number }> = {};
    for (const party of parties) {
      // Merge ID-indexed records with name-indexed records, dedup by record.id
      const byIdL = party.id ? (ledgerById[party.id] || []) : [];
      const byNameL = ledgerByParty[party.name] || [];
      const seenL = new Set(byIdL.map((r: any) => r.id));
      const mergedL = [...byIdL, ...byNameL.filter((r: any) => !seenL.has(r.id))];

      const byIdT = party.id ? (txById[party.id] || []) : [];
      const byNameT = transactionsByParty[party.name] || [];
      const seenT = new Set(byIdT.map((r: any) => r.id));
      const mergedT = [...byIdT, ...byNameT.filter((r: any) => !seenT.has(r.id))];

      // Collect this party's misc charges (by ID + by name, dedup)
      const mcById = party.id ? (miscChargesByParty.byId[party.id] || []) : [];
      const mcByName = miscChargesByParty.byName[party.name] || [];
      const seenMc = new Set(mcById.map((r: any) => r.id));
      const partyMisc = [...mcById, ...mcByName.filter((r: any) => !seenMc.has(r.id))];

      map[party.id] = calculateAccounting(mergedL, mergedT, party.role, {
        openingBalance: Number(party.opening_balance) || 0,
        openingBalanceType: party.opening_balance_type || 'they_owe',
        miscCharges: partyMisc,
      }) as any;
    }
    return map;
  }, [parties, ledger, transactions, ledgerByParty, transactionsByParty, miscChargesByParty]);

  const handleExportParties = useCallback(async (_eo?: ExportOptions) => {
    if (filteredParties.length === 0) {
      showToast('No parties to export', 'error');
      return;
    }
    try {
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
    } catch (err: any) {
      // User dismissing the share sheet triggers an AbortError — not a real failure
      if (err?.name !== 'AbortError') {
        console.error('Export parties error:', err);
        showToast('Export failed: ' + (err?.message || String(err)), 'error');
      }
    }
  }, [filteredParties, partyAccounting, filterRole, showToast]);

  // Bulk combined ledger download: one PDF with all parties in filtered list
  const handleBulkDownload = useCallback(async (eo: ExportOptions) => {
    if (filteredParties.length === 0) { showToast('No parties to export', 'error'); return; }
    setBulkDownloading(true);
    try {
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      const { drawPartyLedgerSection, addPageNumbers } = await import('../../utils/pdfGenerator');

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

      // Build lookup structures the same way partyAccounting does
      const ledgerById: Record<string, any[]> = {};
      const txById: Record<string, any[]> = {};
      ledger.forEach((l: any) => { if (l.party_id) { if (!ledgerById[l.party_id]) ledgerById[l.party_id] = []; ledgerById[l.party_id].push(l); } });
      transactions.forEach((t: any) => { if (t.party_id) { if (!txById[t.party_id]) txById[t.party_id] = []; txById[t.party_id].push(t); } });

      for (let i = 0; i < filteredParties.length; i++) {
        const party = filteredParties[i];
        const byIdL = party.id ? (ledgerById[party.id] || []) : [];
        const byNameL = ledgerByParty[party.name] || [];
        const seenL = new Set(byIdL.map((r: any) => r.id));
        const mergedL = [...byIdL, ...byNameL.filter((r: any) => !seenL.has(r.id))];

        const byIdT = party.id ? (txById[party.id] || []) : [];
        const byNameT = transactionsByParty[party.name] || [];
        const seenT = new Set(byIdT.map((r: any) => r.id));
        const mergedT = [...byIdT, ...byNameT.filter((r: any) => !seenT.has(r.id))];

        const mcById = party.id ? (miscChargesByParty.byId[party.id] || []) : [];
        const mcByName = miscChargesByParty.byName[party.name] || [];
        const seenMc = new Set(mcById.map((r: any) => r.id));
        const partyMisc = [...mcById, ...mcByName.filter((r: any) => !seenMc.has(r.id))];

        // Ascending: oldest first for the per-party ledger PDF.
        const filteredList = [
          ...mergedL.map((l: any) => ({ ...l, docType: 'invoice' })),
          ...mergedT.map((t: any) => ({ ...t, docType: 'payment' })),
        ].sort((a, b) => {
          const dA = (a.date || '').slice(0, 10), dB = (b.date || '').slice(0, 10);
          if (dA !== dB) return dA < dB ? -1 : 1;
          const cA = a.created_at ? parseDateSafe(a.created_at).getTime() : 0;
          const cB = b.created_at ? parseDateSafe(b.created_at).getTime() : 0;
          return cA - cB;
        });

        const stats = partyAccounting[party.id] || { totalBilled: 0, totalPaid: 0, balance: 0, miscNet: 0 };

        await drawPartyLedgerSection(doc, autoTable, {
          party,
          filteredList,
          miscCharges: partyMisc,
          stats,
          dateRange: { start: '', end: '' },
          isFirstSection: i === 0,
          exportOptions: eo,
        });
        // Note: drawPartyLedgerSection adds its own page break at the start for non-first parties,
        // so we do NOT call doc.addPage() here to avoid blank pages.
      }

      addPageNumbers(doc);

      const suffix = filterRole !== 'all' ? `_${filterRole}s` : '';
      const filename = `All_Parties_Ledger${suffix}_${new Date().toISOString().split('T')[0]}.pdf`;
      const pdfBlob = doc.output('blob');
      await exportService.sharePdfBlob(pdfBlob, filename);

      // Also export CSV summary
      const headers = ['Name', 'Role', 'Phone', 'Total Billed', 'Total Paid', 'Balance'];
      const rows = filteredParties.map(p => {
        const acc = partyAccounting[p.id] || { totalBilled: 0, totalPaid: 0, balance: 0 };
        return { Name: p.name || '', Role: p.role || '', Phone: p.contact || '', 'Total Billed': acc.totalBilled, 'Total Paid': acc.totalPaid, Balance: acc.balance };
      });
      await exportService.exportToCSV(rows, headers, `parties_summary${suffix}.csv`);
      showToast('All ledgers ready', 'success');
    } catch (err: any) {
      console.error('Bulk download error:', err);
      showToast('Export failed: ' + (err?.message || String(err)), 'error');
    } finally {
      setBulkDownloading(false);
    }
  }, [filteredParties, ledger, transactions, ledgerByParty, transactionsByParty, miscChargesByParty, partyAccounting, filterRole, showToast]);

  // Combined confirm handler for the export modal
  const handleExportConfirm = useCallback(async (eo: ExportOptions) => {
    if (!exportModal) return;
    try {
      if (exportModal.format === 'bulk-pdf') {
        await handleBulkDownload(eo);
      } else {
        await handleExportParties(eo);
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('Export error:', err);
        showToast('Export failed: ' + (err?.message || String(err)), 'error');
      }
    } finally {
      setExportModal(null);
    }
  }, [exportModal, handleBulkDownload, handleExportParties, showToast]);

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
          background: "var(--rgba-white-05)",
          border: "1px solid var(--glass-border)",
          borderLeft: `3px solid ${party.role === 'customer' ? "var(--col-success)" : "var(--col-warning)"}`,
        }}
      >
        <div className="flex justify-between items-start mb-2 overflow-hidden">
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex items-center gap-2 overflow-hidden">
              <h3 className="font-bold text-sm truncate text-[var(--text-primary)]">{party.name}</h3>
            </div>
            {party.address && (
              <div className="flex items-center gap-1 text-app-sm mt-0.5 truncate text-[var(--text-muted)]">
                <MapPin size={9} className="flex-shrink-0" /> <span className="truncate">{party.address}</span>
              </div>
            )}
            {party.site && (
              <div className="flex items-center gap-1 text-app-sm mt-0.5 truncate" style={{ color: 'var(--col-violet-65)' }}>
                <MapPin size={9} className="flex-shrink-0" /> <span className="truncate">Site: {party.site}</span>
              </div>
            )}
          </div>

          <div className="flex gap-1.5 flex-shrink-0">
            <button
              onClick={(e) => handleEditClick(party, e)}
              className="w-9 h-9 rounded-xl active:scale-90 transition-all flex items-center justify-center"
              style={{ background: "var(--col-info-12)", color: "var(--col-info)", border: "1px solid var(--col-info-18)" }}
            >
              <Edit2 size={14} />
            </button>
            <button
              onClick={(e) => handleDelete(party.id, party, e)}
              className="w-9 h-9 rounded-xl active:scale-90 transition-all flex items-center justify-center"
              style={{ background: "var(--col-danger-15)", color: "var(--col-danger)", border: "1px solid var(--col-danger-15)" }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 py-2 mb-2" style={{ borderTop: "1px solid var(--glass-border)", borderBottom: "1px solid var(--glass-border)" }}>
          <div className="min-w-0 overflow-hidden">
            <div className="text-app-2xs uppercase font-bold mb-0.5 text-[var(--text-muted)]">{party.role === 'customer' ? 'Total Sales' : 'Total Purchase'}</div>
            <div className="font-bold text-app-sm tabular-nums whitespace-nowrap overflow-hidden text-ellipsis text-[var(--text-secondary)]">₹{formatINR(totalBilled)}</div>
          </div>
          <div className="min-w-0 overflow-hidden">
            <div className="text-app-2xs uppercase font-bold mb-0.5 text-[var(--text-muted)]">{party.role === 'customer' ? 'Total Rec.' : 'Total Paid'}</div>
            <div className="font-bold text-app-sm tabular-nums whitespace-nowrap overflow-hidden text-ellipsis text-[var(--text-secondary)]">₹{formatINR(totalPaid)}</div>
          </div>
          <div className="text-right min-w-0 overflow-hidden">
            <div className="text-app-2xs uppercase font-bold mb-0.5 text-[var(--text-muted)]">Balance</div>
            <div
              style={balance > 0 ? { color: "var(--col-success)" } : balance < 0 ? { color: "var(--col-danger)" } : { color: 'var(--text-muted)' }}
              className="font-black text-xs tabular-nums whitespace-nowrap"
            >
              ₹{formatINR(Math.abs(balance))} {balance > 0 ? 'Cr' : balance < 0 ? 'Dr' : '—'}
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center text-app-sm overflow-hidden">
          <a href={`tel:${party.contact}`} onClick={e => e.stopPropagation()} className="flex items-center gap-1 font-bold text-[var(--text-muted)] px-2 py-1 rounded-lg truncate">
            <Phone size={10} className="flex-shrink-0" /> <span className="truncate">{party.contact}</span>
          </a>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {onViewStatement && (
              <button
                onClick={(e) => { e.stopPropagation(); onViewStatement(party); }}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-app-xs font-black active:scale-95 transition-all"
                style={{ background: 'var(--col-emerald-12)', color: "var(--col-success)", border: '1px solid var(--col-emerald-25)' }}
              >
                Account Book
              </button>
            )}
            <div className="text-app-xs font-bold text-violet-400 flex items-center gap-1">
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
            {onBack && <button onClick={onBack} className="p-2 -ml-2"><ArrowLeft size={20} style={{ color: "var(--text-muted)" }} /></button>}
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
        <div className="flex items-center gap-2 mb-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {onBack && (
              <button onClick={onBack} className="flex-shrink-0 p-2 -ml-1 rounded-2xl active:scale-95 transition-all">
                <ArrowLeft size={16} className="text-[var(--text-secondary)]" />
              </button>
            )}
            <div className="min-w-0">
              <h1 className="text-xl font-black tracking-tight flex items-center gap-2 truncate">
                Parties
                {partiesFetching && !partiesLoading && parties.length > 0 && (
                  <RefreshCw size={11} className="animate-spin text-[var(--text-muted)]" />
                )}
              </h1>
              <p className="text-app-sm font-semibold text-[var(--text-muted)]">{filteredParties.length} contacts</p>
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {/* CSV party list export */}
            <button
              onClick={() => setExportModal({ open: true, format: 'bulk-csv' })}
              className="p-2.5 rounded-2xl active:scale-95 transition-all"
              style={{ background: 'var(--col-info-15)', color: "var(--col-info)", border: '1.5px solid var(--col-info-15)' }}
              title="Export parties to CSV"
            >
              <Download size={17} />
            </button>
            {/* Bulk PDF ledger download — all visible parties */}
            <button
              onClick={() => setExportModal({ open: true, format: 'bulk-pdf' })}
              disabled={bulkDownloading}
              className="p-2.5 rounded-2xl active:scale-95 transition-all disabled:opacity-50"
              style={{ background: 'var(--col-success-15)', color: "var(--col-success)", border: '1.5px solid var(--col-success-18)' }}
              title="Download combined ledger PDF for all parties"
            >
              {bulkDownloading
                ? <RefreshCw size={17} className="animate-spin" />
                : <BookDown size={17} />
              }
            </button>
            <button
              onClick={handleAddClick}
              className="text-white p-2.5 rounded-2xl active:scale-95 transition-all"
              style={{ background: "linear-gradient(135deg,#4f46e5,#7c3aed)", boxShadow: "0 4px 14px var(--col-indigo-40)" }}
            >
              <Plus size={18} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <SearchBarWithSuggest
            value={search}
            onChange={setSearch}
            placeholder="Name, address, GSTIN, phone, state…"
            suggestions={partySuggestions}
            className="flex-1 rounded-2xl border border-white/10 py-1"
            inputClassName="p-2 text-sm font-semibold text-[var(--text-primary)] bg-transparent outline-none"
            containerStyle={{ background: 'var(--rgba-white-06)' }}
          />
          <div className="flex rounded-2xl p-1 gap-0.5 border border-white/10" style={{ background: "var(--rgba-white-05)" }}>
            {(['all', 'customer', 'supplier'] as const).map(r => (
              <button
                key={r}
                onClick={() => setFilterRole(r)}
                className="px-2.5 py-1.5 rounded-xl text-app-xs font-black uppercase tracking-wide transition-all"
                style={filterRole === r
                  ? r === 'customer'
                    ? { background: 'var(--col-success-15)', color: "var(--col-success)" }
                    : r === 'supplier'
                      ? { background: 'rgba(251,191,36,0.12)', color: "var(--col-warning)" }
                      : { background: 'var(--col-violet-25)', color: "var(--col-violet)" }
                  : { color: 'var(--text-muted)' }}
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
                <div className="w-16 h-16 rounded-[22px] flex items-center justify-center" style={{ background: 'var(--col-violet-12)', border: '1px solid var(--col-violet-25)' }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--col-violet)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                </div>
                <div>
                  <p className="font-black text-base text-[var(--text-secondary)]">No Parties Yet</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">Add your customers and suppliers to track their bills and payments.</p>
                </div>
                <button onClick={onAdd}
                  className="px-6 py-3 rounded-2xl text-white font-black text-sm active:scale-95 transition-all"
                  style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', boxShadow: '0 4px 16px rgba(124,58,237,0.35)' }}>
                  + Add First Party
                </button>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-[18px] flex items-center justify-center" style={{ background: 'var(--surface-2)', border: '1px solid var(--glass-border)' }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                </div>
                <div>
                  <p className="font-black text-sm text-[var(--text-secondary)]">No results</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">Try a different name or clear the filter.</p>
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

      {/* Export Options Modal */}
      <ExportOptionsModal
        isOpen={!!exportModal?.open}
        onClose={() => setExportModal(null)}
        onConfirm={handleExportConfirm}
        exportFormat={exportModal?.format ?? 'bulk-pdf'}
        partyRole={filterRole === 'customer' ? 'customer' : filterRole === 'supplier' ? 'supplier' : 'mixed'}
        isLoading={bulkDownloading}
      />
    </div>
  );
};

export default PartiesView;
