import React, { useState, useMemo, useCallback, useRef, memo, useEffect, useLayoutEffect } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useNavState } from '../../services/useNavState';
import { User } from 'firebase/auth';
import {
  FileText, Edit2, Trash2, Filter, Download, Plus,
  ArrowUpRight, ArrowDownLeft, Banknote, ArrowLeft,
  TrendingUp, BarChart3, Hash, Tag, SlidersHorizontal,
  ChevronDown, ChevronUp, X, UserCheck,
} from 'lucide-react';
import SearchBarWithSuggest from '../common/SearchBarWithSuggest';
import DateRangeFilter from '../common/DateRangeFilter';
import { getDefaultDateRange } from '../../utils/filterPeriod';
import { TrashService } from '../../services/trash';
import { exportService } from '../../services/export';
import { fmtINR } from '../../utils/gstUtils';
import { useUI } from '../../context/UIContext';
import { useData, usePartyMap } from '../../context/DataContext';
import { resolvePartyName } from '../../utils/partyUtils';
import { useRole } from '../../context/RoleContext';
import { useSoftDelete } from '../common/UndoSnackbar';
import { formatCurrency } from '../../utils/helpers';
import ManualEntryModal from '../modals/ManualEntryModal';
import { TransactionsSkeleton } from '../common/Skeleton';
import ExportFormatModal from '../common/ExportFormatModal';
import TransactionDetailView from './TransactionDetailView';

import { parseDateSafe } from '../../utils/dateUtils';

function parseRecordDate(raw: any): Date {
  return parseDateSafe(raw);
}

function highlight(text: string, query: string): React.ReactNode {
  if (!query || !text) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q || !lower.includes(q)) return text;
  const idx = lower.indexOf(q);
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: 'rgba(251,191,36,0.3)', color: "var(--col-warning)", borderRadius: 2, padding: '0 1px' }}>
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function toDateString(raw: any): string {
  const d = parseRecordDate(raw);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Memoized row ─────────────────────────────────────────────────────────────
// Extracted so Virtuoso can skip re-rendering stable rows when the list
// scrolls or an unrelated item changes. Each row renders only when its own
// data or the active search term changes.

interface TransactionRowProps {
  item:               any;
  searchTerm:         string;
  isStaff:            boolean;
  resolvedPartyName?: string;
  onDelete:           (id: string, e: React.MouseEvent) => void;
  onView:             (item: any) => void;
}

const TransactionRow = memo(function TransactionRow({
  item, searchTerm, isStaff, resolvedPartyName, onDelete, onView,
}: TransactionRowProps) {
  const isReceived = item.type === 'received';
  return (
    <div
      onClick={() => onView(item)}
      className="p-2 rounded-xl active:scale-[0.98] transition-all relative overflow-hidden cursor-pointer"
      style={{ background: 'var(--rgba-white-05)', border: '1px solid var(--glass-border)', backdropFilter: 'blur(16px)' }}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-r-full ${isReceived ? 'bg-blue-500' : 'bg-orange-500'}`} />
      <div className="pl-2">
        <div className="flex justify-between items-center mb-1">
          <div className="flex items-center gap-2">
            <span className="text-app-sm font-bold text-[var(--text-muted)]">{toDateString(item.date)}</span>
            {item.bill_no && (
              <span className="text-app-xs font-bold px-1.5 py-0.5 rounded text-[var(--text-muted)]">Ref: {item.bill_no}</span>
            )}
          </div>
          <span style={isReceived ? { color: "var(--col-info)" } : { color: "var(--col-warning)" }} className="text-app-xs font-black uppercase">
            {isReceived ? '↓ RECEIVED' : '↑ PAID'}
          </span>
        </div>
        <div className="flex justify-between items-center mb-1">
          <div className="font-bold text-sm truncate max-w-[65%] text-[var(--text-primary)]">{highlight(resolvedPartyName ?? item.party_name ?? '', searchTerm)}</div>
          <div style={isReceived ? { color: "var(--col-info-light)" } : { color: "var(--col-warning-light)" }} className="font-black text-base">
            {isReceived ? '+' : '-'}₹{Number(item.amount).toLocaleString('en-IN')}
          </div>
        </div>
        <div className="text-app-sm flex items-center gap-1.5 text-[var(--text-muted)]">
          <Banknote size={12} className="shrink-0" />
          <span>{item.payment_mode}</span>
          {item.notes && <span className="truncate max-w-[150px]">• {item.notes}</span>}
        </div>
        {(item.payment_purpose || item.transaction_id) && (
          <div className="flex items-center gap-2 flex-wrap mt-1">
            {item.payment_purpose && (
              <span className="text-app-xs font-bold flex items-center gap-1 px-1.5 py-0.5 rounded-full"
                style={{ background: 'var(--col-accent-15)', color: 'var(--col-violet-85)', border: '1px solid var(--col-accent-18)' }}>
                <Tag size={8} />{item.payment_purpose}
              </span>
            )}
            {item.transaction_id && (
              <span className="text-app-xs font-mono flex items-center gap-1"
                style={{ color: 'var(--text-muted)' }}>
                <Hash size={8} className="shrink-0" />{item.transaction_id}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="mt-2 pt-2 border-t border-white/08 flex justify-end gap-2">
        {!isStaff && (
          <button onClick={(e) => onDelete(item.id, e)} className="p-1.5 rounded-lg bg-[var(--col-danger-12)] text-red-400">
            <Trash2 size={12} />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onView(item); }}
          className="px-3 py-1 rounded-lg flex items-center gap-1 text-app-sm font-bold bg-[var(--rgba-white-07)] text-[var(--text-secondary)]"
        >
          <FileText size={12} /> View
        </button>
      </div>
    </div>
  );
});

// ─── Main component ───────────────────────────────────────────────────────────

interface TransactionsViewProps {
  user: User;
  onBack: () => void;
  appSettings?: any;
  initialTypeFilter?: 'received' | 'paid';
}

const TransactionsView: React.FC<TransactionsViewProps> = ({ user, onBack, appSettings, initialTypeFilter }) => {
  const { confirm, showToast } = useUI();
  const { useTransactions, useParties, useLedger } = useData();
  const { isStaff } = useRole();
  // Scroll container — use a callback ref so Virtuoso only receives a real DOM
  // node (never null). On first render scrollContainerRef.current is null, which
  // caused Virtuoso to measure 0 height and render nothing until a re-render.
  const scrollParentNodeRef = useRef<HTMLElement | null>(null);
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null);
  const scrollContainerRef = useCallback((node: HTMLDivElement | null) => {
    if (node && scrollParentNodeRef.current !== node) {
      scrollParentNodeRef.current = node;
      setScrollParent(node);
    }
  }, []);

  // Save scroll position on unmount (tab switch away)
  useEffect(() => {
    return () => {
      try {
        if (scrollParentNodeRef.current) {
          sessionStorage.setItem('scroll_txn_v2', String(scrollParentNodeRef.current.scrollTop));
        }
      } catch {}
    };
  }, []);

  // Restore scroll position before first paint once the scroll container attaches
  useLayoutEffect(() => {
    if (!scrollParent) return;
    try {
      const saved = parseInt(sessionStorage.getItem('scroll_txn_v2') ?? '0', 10);
      if (saved > 0) {
        scrollParent.scrollTop = saved;
        requestAnimationFrame(() => {
          if (scrollParent.scrollTop !== saved) scrollParent.scrollTop = saved;
        });
      }
    } catch {}
  }, [scrollParent]);

  const { data: transactionsRaw, isLoading: loading, refetch, setData } = useTransactions(user.uid);
  const { data: partiesRaw } = useParties(user.uid);
  const { data: ledgerRaw }  = useLedger(user.uid);
  const partyMap = usePartyMap(user.uid);
  const transactions  = useMemo(() => transactionsRaw || [], [transactionsRaw]);
  const parties       = useMemo(() => partiesRaw      || [], [partiesRaw]);
  const ledgerEntries = useMemo(() => ledgerRaw       || [], [ledgerRaw]);

  const [searchTerm, setSearchTerm] = useNavState<string>('txn_search', '');
  const [currentFilter, setCurrentFilter] = useNavState<'all' | 'received' | 'paid'>('txn_filter', initialTypeFilter ?? 'all');
  const [dateRange, setDateRange] = useState(() => getDefaultDateRange(appSettings));

  const [selectedDetail, setSelectedDetail] = useState<any | null>(null);
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [editData, setEditData] = useState<any | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);

  const [filterMode,     setFilterMode]     = useState('');
  const [filterPurpose,  setFilterPurpose]  = useState('');
  const [filterPerson,   setFilterPerson]   = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const { scheduleDelete } = useSoftDelete();

  const handleDelete = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const item = transactions.find(t => t.id === id);
    if (!item) return;
    scheduleDelete({
      id,
      collection: 'transactions',
      itemName: item.party_name || 'Transaction',
      onOptimistic: () => setData(old => old.filter(i => i.id !== id)),
      onRestore: () => setData(old => [...old, item].sort((a, b) => {
        const dA = (a.date||'').slice(0,10), dB = (b.date||'').slice(0,10);
        if (dA !== dB) return dB < dA ? -1 : 1;
        const cA = a.created_at ? parseRecordDate(a.created_at).getTime() : 0;
        const cB = b.created_at ? parseRecordDate(b.created_at).getTime() : 0;
        return cB - cA;
      })),
      onCommit: async () => { await TrashService.moveToTrash(user.uid, 'transactions', id); },
    });
  }, [transactions, user.uid, scheduleDelete, setData]);

  const handleAdd  = useCallback(() => { setEditData(null);   setShowEntryModal(true); }, []);
  const handleEdit = useCallback((item: any) => { setEditData(item); setShowEntryModal(true); }, []);

  const cycleFilter = () => {
    if (currentFilter === 'all') setCurrentFilter('received');
    else if (currentFilter === 'received') setCurrentFilter('paid');
    else setCurrentFilter('all');
  };

  const uniqueModes = useMemo(() => {
    const modes = new Set<string>();
    transactions.forEach(t => { if (t.payment_mode) modes.add(t.payment_mode); });
    return Array.from(modes).sort();
  }, [transactions]);

  const uniquePurposes = useMemo(() => {
    const purposes = new Set<string>();
    transactions.forEach(t => { if (t.payment_purpose) purposes.add(t.payment_purpose); });
    return Array.from(purposes).sort();
  }, [transactions]);

  const uniquePersons = useMemo(() => {
    const persons = new Set<string>();
    transactions.forEach(t => {
      if (t.received_by) persons.add(t.received_by);
      if (t.paid_by)     persons.add(t.paid_by);
      if (t.paid_to)     persons.add(t.paid_to);
    });
    return Array.from(persons).sort();
  }, [transactions]);

  const advancedFilterCount = [filterMode, filterPurpose, filterPerson].filter(Boolean).length;

  const filtered = useMemo(() => {
    const s = searchTerm.toLowerCase().trim();
    const fp = filterPerson.toLowerCase().trim();
    return transactions.filter(t => {
      const matchesSearch = !s || (
        resolvePartyName(t, partyMap).toLowerCase().includes(s) ||
        t.party_name?.toLowerCase().includes(s) ||
        t.bill_no?.toLowerCase().includes(s) ||
        t.notes?.toLowerCase().includes(s) ||
        t.payment_mode?.toLowerCase().includes(s) ||
        t.transaction_id?.toLowerCase().includes(s) ||
        t.transaction_reference?.toLowerCase().includes(s) ||
        String(t.amount ?? '').includes(s)
      );
      const matchesType    = currentFilter === 'all' ? true : t.type === currentFilter;
      const recordDate     = toDateString(t.date);
      const matchesDate    = (!dateRange.start || recordDate >= dateRange.start) && (!dateRange.end || recordDate <= dateRange.end);
      const matchesMode    = !filterMode    || t.payment_mode === filterMode;
      const matchesPurpose = !filterPurpose || t.payment_purpose === filterPurpose;
      const matchesPerson  = !fp || (
        (t.received_by || '').toLowerCase().includes(fp) ||
        (t.paid_by     || '').toLowerCase().includes(fp) ||
        (t.paid_to     || '').toLowerCase().includes(fp)
      );
      return matchesSearch && matchesType && matchesDate && matchesMode && matchesPurpose && matchesPerson;
    });
  }, [transactions, searchTerm, currentFilter, dateRange, partyMap, filterMode, filterPurpose, filterPerson]);

  const stats = useMemo(() => {
    return filtered.reduce(
      (acc, t) => {
        if (t.type === 'received') acc.in  += Number(t.amount);
        else                        acc.out += Number(t.amount);
        return acc;
      },
      { in: 0, out: 0 },
    );
  }, [filtered]);

  const searchSuggestions = useMemo(() => {
    return parties
      .filter(p => {
        if (currentFilter === 'received') return p.role === 'customer';
        if (currentFilter === 'paid')     return p.role === 'supplier';
        return true;
      })
      .map(p => p.name);
  }, [parties, currentFilter]);

  const handleExportFormat = async (format: 'pdf' | 'excel') => {
    setShowExportModal(false);
    if (filtered.length === 0) return showToast('No data to export', 'error');

    if (format === 'excel') {
      const rows: any[][] = [
        [appSettings?.profile?.firm_name || 'Business'],
        ['TRANSACTIONS REPORT'],
        ['Period:', `${dateRange.start} to ${dateRange.end}`],
        [],
        ['Date', 'Type', 'Party', 'Amount', 'Mode', 'Purpose', 'Received/Paid By', 'Bill Ref', 'Txn ID', 'Notes'],
        ...filtered.map(t => [
          toDateString(t.date),
          t.type === 'received' ? 'Received' : 'Paid',
          t.party_name,
          t.amount,
          t.payment_mode || '-',
          t.payment_purpose || '-',
          t.type === 'received' ? (t.received_by || '-') : (t.paid_by || t.paid_to || '-'),
          t.bill_no || '-',
          t.transaction_id || '-',
          t.notes || '-',
        ]),
        [],
        ['Total In (Received)', stats.in.toFixed(2)],
        ['Total Out (Paid)',    stats.out.toFixed(2)],
        ['Net Flow',           (stats.in - stats.out).toFixed(2)],
      ];
      const csv = rows.map(r => r.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')).join('\n');
      await exportService.shareOrDownload(csv, `Transactions_${currentFilter}.csv`, 'text/csv');
      showToast('Excel Downloaded', 'success');
    } else {
      try {
        const { buildPdf, drawPdfHeader, drawSummaryBoxes, addPageFooters, tableStyles, pdfRupee } = await import('../../utils/professionalPdf');
        const { doc, PW, m, autoTable } = await buildPdf('landscape');
        const firm = appSettings?.profile?.firm_name || 'Business';
        const period = `${dateRange.start}  →  ${dateRange.end}`;

        let y = drawPdfHeader(doc, PW, { firm, title: 'Transactions Report', subtitle: period });
        y = drawSummaryBoxes(doc, y, PW, m, [
          { label: 'Total Received',  value: pdfRupee(stats.in) },
          { label: 'Total Paid',      value: pdfRupee(stats.out) },
          { label: 'Net Cash Flow',   value: pdfRupee(stats.in - stats.out) },
          { label: 'Records',         value: String(filtered.length) },
        ]);

        autoTable(doc, {
          startY: y, margin: { left: m, right: m },
          head: [['Date', 'Type', 'Party', 'Mode', 'Purpose', 'By', 'Bill Ref', 'Amount']],
          body: filtered.map(t => [
            toDateString(t.date),
            t.type === 'received' ? 'Received' : 'Paid',
            t.party_name || '-',
            t.payment_mode || 'Cash',
            t.payment_purpose || '-',
            t.type === 'received' ? (t.received_by || '-') : (t.paid_by || t.paid_to || '-'),
            t.bill_no || '-',
            pdfRupee(Number(t.amount)),
          ]),
          ...tableStyles([7]),
          didParseCell: (data: any) => {
            if (data.section === 'body' && data.column.index === 1) {
              data.cell.styles.textColor = data.cell.text[0] === 'Received' ? [5, 120, 60] : [180, 30, 30];
              data.cell.styles.fontStyle = 'bold';
            }
          },
        });

        addPageFooters(doc, firm);
        const blob = doc.output('blob');
        await exportService.sharePdfBlob(blob, `Transactions_${currentFilter}.pdf`);
        showToast('PDF Downloaded', 'success');
      } catch (e: any) { console.error(e); showToast('Export failed', 'error'); }
    }
  };

  const title = currentFilter === 'all' ? 'Transactions' : (currentFilter === 'received' ? 'Received' : 'Paid');

  // Hoisted BEFORE the early return below — Rules of Hooks requires the same
  // number of hooks on every render.  The old inline useCallback inside
  // itemContent JSX was called AFTER the `if (selectedDetail)` early return,
  // causing React error #300 in the production Android build.
  const renderTransactionRow = useCallback((_index: number, item: any) => (
    <div className="pb-2">
      <TransactionRow
        item={item}
        searchTerm={searchTerm}
        isStaff={isStaff}
        resolvedPartyName={resolvePartyName(item, partyMap)}
        onDelete={handleDelete}
        onView={setSelectedDetail}
      />
    </div>
  ), [searchTerm, isStaff, partyMap, handleDelete, setSelectedDetail]);

  if (selectedDetail) {
    return (
      <TransactionDetailView
        transaction={selectedDetail}
        settings={appSettings || {}}
        ledgerEntries={ledgerEntries}
        onBack={() => setSelectedDetail(null)}
        onEdit={(item) => { setSelectedDetail(null); handleEdit(item); }}
      />
    );
  }

  return (
    <>
      <div ref={scrollContainerRef} className="h-full overflow-y-auto" style={{ background: 'var(--app-bg)' }}>
        {showExportModal && (
          <ExportFormatModal onSelect={handleExportFormat} onClose={() => setShowExportModal(false)} />
        )}

        {/* STICKY HEADER */}
        <div className="sticky top-0 z-30 px-3 pb-2 md:px-6" style={{ background: 'rgba(var(--app-bg-rgb),0.92)', backdropFilter: 'blur(20px)', paddingTop: '12px' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <button onClick={onBack} className="flex-shrink-0 p-2 rounded-full active:scale-95 transition-all" style={{ background: 'var(--rgba-white-08)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                <ArrowLeft size={16} />
              </button>
              <div className="min-w-0">
                <h1 className="text-xl font-black leading-none truncate">{title}</h1>
                <p className="text-app-sm font-bold uppercase text-[var(--text-muted)]">{filtered.length} Entries</p>
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={cycleFilter} className={`p-2 rounded-xl shadow-sm active:scale-95 transition-all border ${currentFilter !== 'all' ? 'bg-[var(--col-violet-25)] text-violet-300 border-[var(--col-violet-35)]' : 'bg-[var(--rgba-white-06)] text-[var(--text-muted)] border-[var(--rgba-white-08)]'}`}>
                <Filter size={16} />
              </button>
              <button onClick={() => setShowExportModal(true)} className="p-2 rounded-xl active:scale-95 transition-all" style={{ background: 'var(--col-emerald-12)', color: "var(--col-success)", border: '1px solid var(--col-emerald-25)' }}>
                <Download size={16} />
              </button>
              <button onClick={handleAdd} className="text-white p-2 rounded-xl shadow-lg active:scale-95 bg-gradient-to-r from-col-indigo-600 to-col-violet-600 transition-all">
                <Plus size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* SCROLLABLE CONTENT */}
        <div className="px-3 md:px-6">
          {/* TOTAL SUMMARY CARD */}
          <div className="p-3 rounded-2xl shadow-lg mb-3 flex justify-between items-center relative overflow-hidden border border-[var(--col-indigo-35)]" style={{ background: 'var(--col-indigo-15)', backdropFilter: 'blur(20px)' }}>
            <div className="relative z-10">
              <div className="text-app-sm font-bold opacity-70 uppercase mb-0.5">Net Cash Flow</div>
              <div className="text-xl font-black leading-none mb-2">{formatCurrency(stats.in - stats.out)}</div>
              <div className="flex gap-2 text-app-sm font-bold">
                <span className="text-green-300 flex items-center gap-1"><ArrowDownLeft size={10} /> In: {formatCurrency(stats.in)}</span>
                <span className="text-orange-300 flex items-center gap-1"><ArrowUpRight size={10} /> Out: {formatCurrency(stats.out)}</span>
              </div>
            </div>
            <div className="bg-[var(--rgba-white-06)]/10 p-2 rounded-full relative z-10">
              <BarChart3 size={24} className="text-white" />
            </div>
            <TrendingUp size={80} className="absolute -bottom-4 -right-4 text-white opacity-5 pointer-events-none" />
          </div>

          {/* SEARCH & DATE */}
          <div className="p-2.5 rounded-xl mb-3 space-y-2 border border-white/08" style={{ background: 'var(--rgba-white-04)' }}>
            <SearchBarWithSuggest
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder={currentFilter === 'received' ? 'Search customer, amount, mode…' : currentFilter === 'paid' ? 'Search supplier, amount, ref…' : 'Search party, amount, mode…'}
              suggestions={searchSuggestions}
              className="rounded-lg border border-white/12"
              inputClassName="p-2 text-xs font-bold bg-transparent outline-none text-[var(--text-primary)]"
            />
            <DateRangeFilter
              start={dateRange.start}
              end={dateRange.end}
              onStartChange={v => setDateRange(r => ({ ...r, start: v }))}
              onEndChange={v => setDateRange(r => ({ ...r, end: v }))}
            />

            {/* Advanced filters toggle */}
            <button
              onClick={() => setShowAdvancedFilters(v => !v)}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-app-sm font-bold transition-all"
              style={{
                background: advancedFilterCount > 0 ? 'var(--col-violet-15)' : 'transparent',
                color: advancedFilterCount > 0 ? "var(--col-violet)" : 'var(--text-muted)',
              }}>
              <span className="flex items-center gap-1.5">
                <SlidersHorizontal size={11} />
                Advanced Filters {advancedFilterCount > 0 && `(${advancedFilterCount} active)`}
              </span>
              {showAdvancedFilters ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>

            {showAdvancedFilters && (
              <div className="space-y-3 pt-1 border-t border-white/06">
                {/* Payment Mode */}
                <div>
                  <p className="text-app-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>
                    Payment Mode
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {['', ...uniqueModes].map(m => (
                      <button key={m || '__all__'} onClick={() => setFilterMode(m)}
                        className="px-2.5 py-1 rounded-lg text-app-sm font-bold transition-all active:scale-95"
                        style={filterMode === m
                          ? { background: 'var(--col-violet-25)', border: '1px solid var(--col-violet-40)', color: "var(--col-violet)" }
                          : { background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                        {m || 'All'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Payment Purpose */}
                {uniquePurposes.length > 0 && (
                  <div>
                    <p className="text-app-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>
                      Purpose
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {['', ...uniquePurposes].map(p => (
                        <button key={p || '__all__'} onClick={() => setFilterPurpose(p)}
                          className="px-2.5 py-1 rounded-lg text-app-sm font-bold transition-all active:scale-95"
                          style={filterPurpose === p
                            ? { background: 'var(--col-accent-25)', border: '1px solid var(--col-accent-40)', color: "var(--col-indigo)" }
                            : { background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                          {p || 'All'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Received / Paid By */}
                {uniquePersons.length > 0 && (
                  <div>
                    <p className="text-app-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>
                      <UserCheck size={9} className="inline mr-1" />Received / Paid By
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {['', ...uniquePersons].map(p => (
                        <button key={p || '__all__'} onClick={() => setFilterPerson(p)}
                          className="px-2.5 py-1 rounded-lg text-app-sm font-bold transition-all active:scale-95"
                          style={filterPerson === p
                            ? { background: 'var(--col-emerald-15)', border: '1px solid var(--col-emerald-35)', color: "var(--col-success)" }
                            : { background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                          {p || 'All'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {advancedFilterCount > 0 && (
                  <button
                    onClick={() => { setFilterMode(''); setFilterPurpose(''); setFilterPerson(''); }}
                    className="flex items-center gap-1 text-app-sm font-bold transition-all"
                    style={{ color: 'var(--col-danger-60)' }}>
                    <X size={10} /> Clear advanced filters
                  </button>
                )}
              </div>
            )}
          </div>

          {loading ? (
            <div className="space-y-2 pb-20">
              <TransactionsSkeleton count={6} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="w-16 h-16 rounded-[20px] flex items-center justify-center mb-4"
                style={{ background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.2)' }}>
                <Banknote size={28} style={{ color: 'rgba(96,165,250,0.6)' }} />
              </div>
              <p className="text-sm font-black text-white mb-1">No payments yet</p>
              <p className="text-app-md mb-5" style={{ color: 'var(--text-muted)' }}>
                Record money received from customers or paid to suppliers
              </p>
              <button
                onClick={handleAdd}
                className="flex items-center gap-2 px-5 py-2.5 rounded-[14px] text-app-lg font-black text-white active:scale-95 transition-all"
                style={{ background: 'linear-gradient(135deg,#3b82f6,#2563eb)', boxShadow: '0 6px 20px var(--col-info-35)' }}>
                <Plus size={14} /> Add Payment
              </button>
            </div>
          ) : (
            // Virtualized list — only renders the rows visible in the scroll
            // container. customScrollParent keeps the sticky header working
            // because the outer div owns the scroll position.
            <Virtuoso
              customScrollParent={scrollParent ?? undefined}
              data={filtered}
              itemContent={renderTransactionRow}
              components={{
                Footer: () => <div style={{ height: 80 }} />,
              }}
            />
          )}
        </div>
      </div>

      {showEntryModal && <ManualEntryModal
        isOpen={showEntryModal}
        onClose={() => setShowEntryModal(false)}
        type="transactions"
        user={user}
        initialData={editData}
        appSettings={appSettings || {}}
        onSuccess={(data: any) => {
          if (data?.id) {
            if (editData) {
              setData(old => old.map(t => t.id === data.id ? { ...t, ...data } : t));
            } else {
              setData(old => [data, ...old].sort((a, b) => parseRecordDate(b.date).getTime() - parseRecordDate(a.date).getTime()));
            }
          }
          refetch();
        }}
      />}
    </>
  );
};

export default TransactionsView;

