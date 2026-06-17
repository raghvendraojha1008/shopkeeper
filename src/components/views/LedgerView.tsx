import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavState } from '../../services/useNavState';
import { useDebounce } from '../../hooks/usePaginatedData';
import { useBackHandler } from '../../services/useBackHandler';
import { User } from 'firebase/auth';
import {
  Search, FileText, Edit2, Trash2, Filter, Download, Plus,
  Package, Truck, Calendar, BarChart3,
  ArrowLeft, BadgePercent, CheckCircle2, Clock, AlertCircle,
  IndianRupee, Zap, Banknote, MessageSquare, MapPin, Building2
} from 'lucide-react';
import DateRangeFilter from '../common/DateRangeFilter';
import { ApiService } from '../../services/api';
import { TrashService } from '../../services/trash';
import { useSoftDelete } from '../common/UndoSnackbar';
import { exportServiceV2 } from '../../services/exportServiceV2';
import { exportService } from '../../services/export';
import { useUI } from '../../context/UIContext';
import { useData } from '../../context/DataContext';
import ManualEntryModal from '../modals/ManualEntryModal';
import { formatCurrency, formatINR } from '../../utils/helpers';
import { LedgerSkeleton } from '../common/Skeleton';
import ExportFormatModal from '../common/ExportFormatModal';
import LedgerEntryDetailView from './LedgerEntryDetailView';
import { Virtuoso } from 'react-virtuoso';
import { computePaymentDistribution } from '../../utils/paymentDistribution';
import { getDefaultDateRange } from '../../utils/filterPeriod';

import { parseDateSafe, toDateStrSafe } from '../../utils/dateUtils';

function parseRecordDate(raw: any): Date {
  return parseDateSafe(raw);
}

function toDateString(raw: any): string {
  return toDateStrSafe(raw);
}

interface LedgerViewProps {
  user: User;
  onBack: () => void;
  appSettings?: any;
  typeFilter?: 'sell' | 'purchase';
}

const StatusTag: React.FC<{ status: 'paid' | 'partial' | 'pending' }> = ({ status }) => {
  if (status === 'paid') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black"
        style={{ background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.25)' }}>
        <CheckCircle2 size={9} /> Paid
      </span>
    );
  }
  if (status === 'partial') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black"
        style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.25)' }}>
        <Clock size={9} /> Partially Paid
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black"
      style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
      <AlertCircle size={9} /> Pending
    </span>
  );
};

const LedgerView: React.FC<LedgerViewProps> = ({ user, onBack, appSettings, typeFilter }) => {
  const { confirm, showToast } = useUI();
  const { useLedger, useParties, useTransactions, useInventory } = useData();

  const { data: entriesRaw, isLoading: loading, refetch, setData } = useLedger(user.uid);
  const entries = useMemo(() => entriesRaw || [], [entriesRaw]);
  const { data: partiesRaw } = useParties(user.uid);
  const { data: transactionsRaw } = useTransactions(user.uid);
  const transactions = useMemo(() => (transactionsRaw || []) as any[], [transactionsRaw]);
  const { refetch: refetchInventory } = useInventory(user.uid);
  const parties = useMemo(() => (partiesRaw || []) as any[], [partiesRaw]);

  const [fetchedSettings, setFetchedSettings] = useState<any>({});
  const settings = appSettings && Object.keys(appSettings).length > 0 ? appSettings : fetchedSettings;

  const [searchTerm, setSearchTerm] = useNavState<string>('ledger_search', '');
  const debouncedSearch = useDebounce(searchTerm, 300);
  const [currentFilter, setCurrentFilter] = useNavState<'all' | 'sell' | 'purchase'>('ledger_filter', typeFilter || 'all');
  const [dateRange, setDateRange] = useState(() => getDefaultDateRange(appSettings));

  const [selectedDetail, setSelectedDetail] = useState<any | null>(null);
  useBackHandler(() => setSelectedDetail(null), !!selectedDetail, 5);

  const virtuosoRef = useRef<any>(null);
  const virtuosoStateRef = useRef<any>(null);
  const [initialVirtuosoState] = useState<any>(() => {
    try {
      const s = sessionStorage.getItem('scroll_ledger_v2');
      if (!s) return undefined;
      const p = JSON.parse(s);
      return Array.isArray(p?.ranges) ? p : undefined;
    } catch { return undefined; }
  });
  useEffect(() => {
    return () => { virtuosoRef.current?.getState((state: any) => { try { sessionStorage.setItem('scroll_ledger_v2', JSON.stringify(state)); } catch {} }); };
  }, []);
  const handleSelectDetail = useCallback((item: any) => {
    virtuosoRef.current?.getState((state: any) => { virtuosoStateRef.current = state; });
    setSelectedDetail(item);
  }, []);
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [editData, setEditData] = useState<any | null>(null);
  const [entryType, setEntryType] = useState<'sales' | 'purchases'>('sales');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [paymentDetailsFor, setPaymentDetailsFor] = useState<{
    autoPayments: any[];
    totalPaid: number;
    orderTotal: number;
    allTransactions: any[];
  } | null>(null);

  useEffect(() => { if (typeFilter) setCurrentFilter(typeFilter); }, [typeFilter]);

  useEffect(() => {
    if (!appSettings || Object.keys(appSettings).length === 0) {
      ApiService.settings.get(user.uid).then(s => {
        const fetched = s || {};
        setFetchedSettings(fetched);
        setDateRange(prev => (prev.start === '' && prev.end === '') ? getDefaultDateRange(fetched) : prev);
      }).catch(err => console.error('LedgerView: failed to load settings', err));
    }
  }, [user.uid, appSettings]);

  const handleAdd = useCallback(() => {
    setEntryType(currentFilter === 'purchase' ? 'purchases' : 'sales');
    setEditData(null);
    setShowEntryModal(true);
  }, [currentFilter]);

  const handleEdit = useCallback((item: any) => {
    setEntryType(item.type === 'sell' ? 'sales' : 'purchases');
    setEditData(item);
    setShowEntryModal(true);
  }, []);

  const { scheduleDelete } = useSoftDelete();

  const handleDelete = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const item = entries.find(i => i.id === id);
    if (!item) return;
    scheduleDelete({
      id,
      collection: 'ledger_entries',
      itemName: item.party_name || 'Ledger Entry',
      onOptimistic: () => setData(old => old.filter(i => i.id !== id)),
      onRestore: () => setData(old => [...old, item].sort((a, b) => parseRecordDate(b.date).getTime() - parseRecordDate(a.date).getTime())),
      onCommit: async () => { await TrashService.moveToTrash(user.uid, 'ledger_entries', id); },
    });
  }, [entries, user.uid, scheduleDelete, setData]);

  const cycleFilter = () => {
    if (currentFilter === 'all') setCurrentFilter('sell');
    else if (currentFilter === 'sell') setCurrentFilter('purchase');
    else setCurrentFilter('all');
  };

  const filtered = useMemo(() => {
    const s = debouncedSearch.toLowerCase();
    return entries.filter(e => {
      const matchesSearch = !s ||
        e.party_name?.toLowerCase().includes(s) ||
        e.invoice_no?.toLowerCase().includes(s);
      const matchesType = currentFilter === 'all' ? true : e.type === currentFilter;
      const recordDate = toDateString(e.date);
      const matchesDate = (!dateRange.start || recordDate >= dateRange.start) && (!dateRange.end || recordDate <= dateRange.end);
      return matchesSearch && matchesType && matchesDate;
    });
  }, [entries, debouncedSearch, currentFilter, dateRange]);

  const allPartyNames = useMemo(() => {
    return parties
      .filter(p => {
        if (currentFilter === 'sell') return p.role === 'customer';
        if (currentFilter === 'purchase') return p.role === 'supplier';
        return true;
      })
      .map(p => p.name as string);
  }, [parties, currentFilter]);

  const filteredSuggestions = useMemo(() => {
    if (!debouncedSearch.trim()) return allPartyNames.slice(0, 8);
    const lower = debouncedSearch.toLowerCase();
    return allPartyNames.filter(n => n.toLowerCase().includes(lower)).slice(0, 8);
  }, [allPartyNames, debouncedSearch]);

  // Compute payment distribution for all ledger entries (not just filtered)
  // so FIFO distribution is correct across all orders of a party
  const paymentStatusMap = useMemo(() => {
    const autoDistribute = settings?.automation?.auto_distribute_payments !== false;
    return computePaymentDistribution(entries, transactions, autoDistribute);
  }, [entries, transactions, settings]);

  const { itemVolume, rentVolume, totalPaid, totalPending } = useMemo(() => {
    return filtered.reduce(
      (acc, item) => {
        const rent = Number(item.vehicle_rent) || 0;
        const fullTotal = Number(item.total_amount) || 0;
        const ps = paymentStatusMap.get(item.id);
        const paid = ps?.totalPaid || 0;
        const pending = ps ? Math.max(0, ps.orderTotal - ps.totalPaid) : fullTotal;
        return {
          itemVolume: acc.itemVolume + (fullTotal - rent),
          rentVolume: acc.rentVolume + rent,
          totalPaid: acc.totalPaid + paid,
          totalPending: acc.totalPending + pending,
        };
      },
      { itemVolume: 0, rentVolume: 0, totalPaid: 0, totalPending: 0 },
    );
  }, [filtered, paymentStatusMap]);

  const enrichedFiltered = useMemo(() => {
    const gstEnabled = !!settings?.automation?.auto_calculate_gst;
    return filtered.map(item => {
      const rent = Number(item.vehicle_rent) || 0;
      const discount = Number(item.discount_amount) || 0;
      const fullTotal = Number(item.total_amount) || 0;
      const itemTotal = fullTotal - rent;
      const partyMatch = parties?.find((p: any) => p.name === item.party_name);
      const totalGstPercent = Array.isArray(item.items) && item.items.length > 0
        ? item.items.reduce((sum: number, i: any) => sum + (Number(i?.gst_percent) || 0), 0) / item.items.length
        : 0;
      const ps = paymentStatusMap.get(item.id);
      return {
        ...item,
        _rent: rent,
        _discount: discount,
        _itemTotal: itemTotal,
        _gstEnabled: gstEnabled,
        _partyMatch: partyMatch,
        _totalGstPercent: totalGstPercent,
        _paidAmount: ps?.totalPaid || 0,
        _pendingAmount: ps ? Math.max(0, ps.orderTotal - ps.totalPaid) : fullTotal,
        _paymentStatus: ps?.status || 'pending',
        _autoPayments: ps?.autoPayments || [],
      };
    });
  }, [filtered, parties, settings, paymentStatusMap]);

  const getItemSummary = (items: any[]) => {
    if (!Array.isArray(items) || items.length === 0) return 'No Items';
    const first = items[0];
    if (!first) return 'No Items';
    const count = items.length;
    return `${first.quantity ?? ''} ${first.unit || ''} x ₹${first.rate ?? 0} ${first.item_name ?? ''}${count > 1 ? ` + ${count - 1} more` : ''}`.trim();
  };

  const handleExportFormat = async (format: 'pdf' | 'excel') => {
    setShowExportModal(false);
    if (filtered.length === 0) return showToast('No data to export', 'error');

    if (format === 'excel') {
      const headerRow = ['Date', 'Invoice', 'Type', 'Party', 'Site', 'Item Name', 'Qty', 'Unit', 'Rate', 'Item Amount', 'GST%', 'Item Total', 'Rent', 'Discount', 'Grand Total', 'Payment Mode', 'Vehicle', 'Notes'];
      const dataRows: string[][] = [];

      for (const e of filtered) {
        const rent  = Number(e.vehicle_rent) || 0;
        const disc  = Number(e.discount_amount) || 0;
        const total = Number(e.total_amount) || 0;
        const items: any[] = Array.isArray(e.items) && e.items.length > 0 ? e.items : [null];

        items.forEach((item, idx) => {
          dataRows.push([
            toDateString(e.date),
            idx === 0 ? (e.invoice_no || e.prefixed_id || '-') : '',
            idx === 0 ? (e.type === 'sell' ? 'Sale' : 'Purchase') : '',
            idx === 0 ? (e.party_name || '-') : '',
            idx === 0 ? (e.site || '') : '',
            item ? item.item_name : '-',
            item ? String(item.quantity ?? '') : '',
            item ? (item.unit || '') : '',
            item ? String(item.rate ?? '') : '',
            item ? String(Number(item.quantity || 0) * Number(item.rate || 0)) : '',
            item ? String(item.gst_percent ?? '') : '',
            item ? String(item.total ?? '') : '',
            idx === 0 ? rent.toFixed(2) : '',
            idx === 0 ? disc.toFixed(2) : '',
            idx === 0 ? total.toFixed(2) : '',
            idx === 0 ? (e.payment_mode || '') : '',
            idx === 0 ? (e.vehicle_no || '') : '',
            idx === 0 ? (e.notes || '') : '',
          ]);
        });
      }

      const summaryRows = [[], ['Net Item Volume', itemVolume.toFixed(2)], ['Total Rent', rentVolume.toFixed(2)], ['Total Paid', totalPaid.toFixed(2)], ['Total Pending', totalPending.toFixed(2)]];

      const allRows = [
        [settings?.profile?.firm_name || 'Business'],
        [currentFilter === 'all' ? 'LEDGER REPORT' : currentFilter === 'sell' ? 'SALES REPORT' : 'PURCHASE REPORT'],
        ['Period:', `${dateRange.start} to ${dateRange.end}`],
        [],
        headerRow,
        ...dataRows,
        ...summaryRows,
      ];
      const csv = allRows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
      await exportService.shareOrDownload(csv, `Ledger_${currentFilter}.csv`, 'text/csv');
      showToast('CSV Downloaded', 'success');
    } else {
      try {
        const profile = await ApiService.settings.get(user.uid);
        await exportServiceV2.ledgerToPdf(filtered, profile);
        showToast('PDF Downloaded', 'success');
      } catch (e: any) {
        console.error('Export error:', e);
        showToast('Export failed: ' + (e?.message || 'Unknown'), 'error');
      }
    }
  };

  const title = currentFilter === 'all' ? 'Ledger' : (currentFilter === 'sell' ? 'Sales' : 'Purchases');

  const renderLedgerCard = useCallback((item: any) => {
    const {
      _rent: rent, _discount: discount, _itemTotal: itemTotal,
      _gstEnabled: gstEnabled, _partyMatch: partyMatch, _totalGstPercent: totalGstPercent,
      _paidAmount: paidAmount, _pendingAmount: pendingAmount, _paymentStatus: paymentStatus,
      _autoPayments: autoPayments,
    } = item;
    const hasAutoPayment = autoPayments && autoPayments.length > 0;
    const autoTotal = hasAutoPayment ? autoPayments.reduce((s: number, p: any) => s + p.amount, 0) : 0;
    const firstAuto = hasAutoPayment ? autoPayments[0] : null;

    return (
      <div
        data-list-item
        onClick={() => handleSelectDetail(item)}
        className="p-3.5 rounded-2xl active:scale-[0.98] transition-all relative overflow-hidden cursor-pointer"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', minHeight: 80 }}
      >
        <div className={`absolute left-0 top-0 bottom-0 w-1.5 rounded-r-full ${item.type === 'sell' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
        <div className="pl-3">
          <div className="flex items-center justify-between mb-1.5 overflow-hidden gap-2">
            <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden flex-wrap">
              <span className="text-[9px] font-bold text-slate-400 flex-shrink-0">{toDateString(item.date)}</span>
              {(item.prefixed_id || item.invoice_no) && (
                <span className="text-[9px] font-mono font-bold text-slate-400 px-1.5 py-0.5 rounded-full flex-shrink-0 flex items-center gap-1">
                  #{item.prefixed_id || item.invoice_no}
                  {discount > 0 && <BadgePercent size={9} className="text-orange-500" />}
                </span>
              )}
              {gstEnabled && (
                totalGstPercent > 0 ? (
                  <span className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 bg-[rgba(59,130,246,0.15)] text-blue-400">GST {Math.round(totalGstPercent)}%</span>
                ) : (
                  <span className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 bg-[rgba(255,255,255,0.05)] text-[rgba(148,163,184,0.35)]">Non-GST</span>
                )
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <StatusTag status={paymentStatus} />
              <span style={item.type === 'sell' ? { background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.25)' } : { background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }} className="text-[9px] font-black uppercase flex-shrink-0 px-2 py-0.5 rounded-full">
                {item.type === 'sell' ? 'Sale' : 'Purchase'}
              </span>
            </div>
          </div>

          <div className="flex justify-between items-center mb-1 overflow-hidden gap-2">
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="font-bold text-sm truncate text-[rgba(240,244,255,0.9)]">{item.party_name}</div>
              {gstEnabled && partyMatch?.gstin && (
                <div className="text-[9px] font-mono text-blue-400 truncate min-w-0">GSTIN: {partyMatch.gstin}</div>
              )}
            </div>
            <div className="text-right flex-shrink-0">
              <div className="font-black text-base tabular-nums whitespace-nowrap" style={{ color: item.type === 'sell' ? 'rgba(52,211,153,0.9)' : 'rgba(248,113,113,0.9)' }}>
                ₹{formatINR(itemTotal)}
              </div>
            </div>
          </div>

          <div className="text-[11px] text-[rgba(148,163,184,0.55)] flex items-center gap-1.5 mb-1 overflow-hidden">
            <Package size={12} className="shrink-0 opacity-50" />
            <span className="truncate min-w-0">{getItemSummary(item.items)}</span>
          </div>

          {/* Extra meta: payment mode · vehicle · supplier · site · notes */}
          {(item.payment_mode || item.vehicle || item.vehicle_no || item.notes || item.source_supplier || item.site || item.seller_invoice_no) && (
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              {item.payment_mode && (
                <span className="text-[9px] font-bold flex items-center gap-1 px-1.5 py-0.5 rounded-full"
                  style={{ background: 'rgba(16,185,129,0.08)', color: 'rgba(52,211,153,0.7)', border: '1px solid rgba(16,185,129,0.15)' }}>
                  <Banknote size={8} />{item.payment_mode}
                </span>
              )}
              {(item.vehicle || item.vehicle_no) && (
                <span className="text-[9px] font-bold flex items-center gap-1 px-1.5 py-0.5 rounded-full"
                  style={{ background: 'rgba(251,191,36,0.08)', color: 'rgba(251,191,36,0.65)', border: '1px solid rgba(251,191,36,0.15)' }}>
                  <Truck size={8} />{item.vehicle || item.vehicle_no}
                </span>
              )}
              {item.source_supplier && (
                <span className="text-[9px] font-bold flex items-center gap-1 px-1.5 py-0.5 rounded-full"
                  style={{ background: 'rgba(139,92,246,0.1)', color: 'rgba(196,181,253,0.8)', border: '1px solid rgba(139,92,246,0.18)' }}>
                  <Building2 size={8} />Supplier: {item.source_supplier}
                </span>
              )}
              {item.site && (
                <span className="text-[9px] font-bold flex items-center gap-1 px-1.5 py-0.5 rounded-full"
                  style={{ background: 'rgba(6,182,212,0.08)', color: 'rgba(103,232,249,0.75)', border: '1px solid rgba(6,182,212,0.15)' }}>
                  <MapPin size={8} />{item.site}
                </span>
              )}
              {item.seller_invoice_no && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full flex items-center gap-1"
                  style={{ background: 'rgba(245,158,11,0.08)', color: 'rgba(251,191,36,0.65)', border: '1px solid rgba(245,158,11,0.12)' }}>
                  Seller #{item.seller_invoice_no}
                </span>
              )}
              {item.notes && (
                <span className="text-[9px] flex items-center gap-1 min-w-0 max-w-[200px]"
                  style={{ color: 'rgba(148,163,184,0.45)' }}>
                  <MessageSquare size={8} className="shrink-0" />
                  <span className="truncate">{item.notes}</span>
                </span>
              )}
            </div>
          )}

          {/* Payment status row */}
          <div className="flex items-start justify-between mt-1.5 gap-2">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              {paidAmount > 0 && (
                <span className="text-[10px] font-bold flex items-center gap-1" style={{ color: '#34d399' }}>
                  <IndianRupee size={9} />Paid: ₹{formatINR(paidAmount)}
                </span>
              )}
              {pendingAmount > 0 && (
                <span className="text-[10px] font-bold flex items-center gap-1" style={{ color: '#fbbf24' }}>
                  <IndianRupee size={9} />Pending: ₹{formatINR(pendingAmount)}
                </span>
              )}
            </div>
          </div>

          {/* Auto-adjustment tag — shown when payment was auto-distributed */}
          {hasAutoPayment && (
            <div className="mt-1.5 flex items-center justify-between gap-2" style={{ borderTop: '1px dashed rgba(99,102,241,0.2)', paddingTop: 6 }}>
              <div className="flex items-start gap-1.5 min-w-0">
                <div className="flex-shrink-0 mt-0.5">
                  <Zap size={9} style={{ color: '#818cf8' }} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: '#818cf8' }}>
                      Payment Auto Adjusted
                    </span>
                    {autoPayments.length > 1 && (
                      <span className="text-[7px] font-black px-1 py-0.5 rounded-full" style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' }}>
                        {autoPayments.length} payments
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mt-0.5">
                    {firstAuto && (
                      <span className="text-[8px] font-mono" style={{ color: 'rgba(165,180,252,0.7)' }}>
                        #{String(firstAuto.txId).slice(-6).toUpperCase()}
                      </span>
                    )}
                    {firstAuto && (
                      <span className="text-[8px]" style={{ color: 'rgba(165,180,252,0.6)' }}>
                        {firstAuto.date}
                      </span>
                    )}
                    <span className="text-[8px] font-bold" style={{ color: '#a5b4fc' }}>
                      ₹{formatINR(autoTotal)}
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setPaymentDetailsFor({
                    autoPayments,
                    totalPaid: paidAmount,
                    orderTotal: itemTotal,
                    allTransactions: (transactions as any[]) || [],
                  });
                }}
                className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[8px] font-black active:scale-95 transition-all"
                style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.25)' }}>
                <IndianRupee size={8} /> Details
              </button>
            </div>
          )}

          {rent > 0 && (
            <div className="flex items-center justify-end gap-1.5 text-[10px] font-bold text-orange-500 mt-1 border-t border-dashed border-[rgba(255,255,255,0.07)] pt-1">
              <Truck size={10} />
              <span className="whitespace-nowrap">Rent: ₹{formatINR(rent)}</span>
            </div>
          )}
          {discount > 0 && (
            <div className="flex items-center justify-end gap-1.5 text-[10px] font-bold text-orange-500 mt-1">
              <BadgePercent size={10} />
              <span className="whitespace-nowrap">Discount: -₹{formatINR(discount)}</span>
            </div>
          )}
        </div>

        <div className="mt-2 pt-2 border-t border-white/08 flex justify-end gap-2">
          <button onClick={(e) => { e.stopPropagation(); handleEdit(item); }}
            className="px-3 py-1.5 rounded-lg flex items-center gap-1 text-[10px] font-bold active:scale-95 transition-all"
            style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.2)' }}>
            <Edit2 size={11} /> Edit
          </button>
          <button onClick={(e) => { e.stopPropagation(); handleDelete(item.id, e); }}
            className="p-1.5 rounded-lg active:scale-95 transition-all"
            style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.15)' }}>
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    );
  }, [handleEdit, handleDelete, handleSelectDetail, parties, settings, paymentStatusMap, transactions, setPaymentDetailsFor]);

  // Hoisted BEFORE the early return below so this hook is always called in
  // the same order on every render (Rules of Hooks).
  // The old inline useCallback inside itemContent JSX was called AFTER the
  // `if (selectedDetail)` early return, causing React error #300 in production.
  const renderLedgerRow = useCallback((_index: number, item: any) => (
    <div className="px-3 md:px-6 pb-1.5">
      {renderLedgerCard(item)}
    </div>
  ), [renderLedgerCard]);

  if (selectedDetail) {
    return (
      <LedgerEntryDetailView
        entry={selectedDetail}
        settings={settings}
        parties={parties}
        transactions={transactions}
        onBack={() => setSelectedDetail(null)}
        onEdit={(item) => { setSelectedDetail(null); handleEdit(item); }}
      />
    );
  }

  return (
    <>
      {/* Payment Auto-Adjust Details Modal */}
      {paymentDetailsFor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center px-4 pb-6"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
          onClick={() => setPaymentDetailsFor(null)}>
          <div className="w-full max-w-sm rounded-[28px] overflow-hidden"
            style={{ background: 'rgba(14,18,40,0.99)', border: '1px solid rgba(99,102,241,0.25)', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="px-5 pt-5 pb-4 flex items-center gap-3" style={{ borderBottom: '1px solid rgba(99,102,241,0.15)' }}>
              <div className="w-9 h-9 rounded-[12px] flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(99,102,241,0.15)' }}>
                <Zap size={16} style={{ color: '#818cf8' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-black text-sm text-white">Payment Auto-Adjust Track</div>
                <div className="text-[10px] mt-0.5" style={{ color: 'rgba(148,163,184,0.5)' }}>
                  ₹{formatINR(paymentDetailsFor.totalPaid)} paid of ₹{formatINR(paymentDetailsFor.orderTotal)}
                </div>
              </div>
              <button onClick={() => setPaymentDetailsFor(null)}
                className="p-1.5 rounded-lg active:scale-95 transition-all"
                style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(148,163,184,0.6)' }}>
                ✕
              </button>
            </div>
            {/* Payment rows */}
            <div className="px-4 py-3 space-y-2 max-h-72 overflow-y-auto">
              {paymentDetailsFor.autoPayments.map((ap: any, idx: number) => {
                const tx = paymentDetailsFor.allTransactions.find((t: any) => t.id === ap.txId);
                const txTotal = tx ? Number(tx.amount) || 0 : 0;
                return (
                  <div key={idx} className="p-3 rounded-[14px]"
                    style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)' }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-mono font-black px-1.5 py-0.5 rounded-md"
                          style={{ background: 'rgba(99,102,241,0.2)', color: '#a5b4fc' }}>
                          #{String(ap.txId).slice(-8).toUpperCase()}
                        </span>
                        <span className="text-[9px]" style={{ color: 'rgba(148,163,184,0.55)' }}>{ap.date}</span>
                      </div>
                      <div className="text-[11px] font-black" style={{ color: '#34d399' }}>
                        ₹{formatINR(ap.amount)}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[9px]" style={{ color: 'rgba(148,163,184,0.45)' }}>Adjusted from payment</span>
                      {txTotal > 0 && (
                        <span className="text-[9px]" style={{ color: 'rgba(148,163,184,0.45)' }}>
                          Tx Total: ₹{formatINR(txTotal)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Footer note */}
            <div className="px-5 pb-5 pt-2">
              <p className="text-[9px] text-center" style={{ color: 'rgba(148,163,184,0.35)' }}>
                Calculated dynamically · Deleting a payment recalculates all adjustments
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="h-full flex flex-col" style={{ background: 'var(--app-bg)' }}>
        {showExportModal && (
          <ExportFormatModal onSelect={handleExportFormat} onClose={() => setShowExportModal(false)} />
        )}

        {/* STICKY HEADER */}
        <div className="sticky top-0 z-30 px-4 pb-3" style={{ background: 'rgba(var(--app-bg-rgb),0.93)', backdropFilter: 'blur(20px)', boxShadow: '0 1px 0 rgba(255,255,255,0.05)', paddingTop: '16px' }}>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2.5">
              <button onClick={onBack} className="p-2 rounded-2xl active:scale-95 transition-all" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(148,163,184,0.7)' }}>
                <ArrowLeft size={18} />
              </button>
              <div>
                <h1 className="text-xl font-black leading-none tracking-tight">{title}</h1>
                <p className="text-[9px] font-bold uppercase tracking-wider text-[rgba(148,163,184,0.45)]">{filtered.length} entries</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={cycleFilter} className="p-2.5 rounded-2xl active:scale-95 transition-all" style={currentFilter !== 'all' ? { background: 'rgba(139,92,246,0.25)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.3)' } : { background: 'rgba(255,255,255,0.07)', color: 'rgba(148,163,184,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <Filter size={16} />
              </button>
              <button onClick={() => setShowExportModal(true)} className="p-2.5 rounded-2xl active:scale-95 transition-all glass-icon-btn text-emerald-400">
                <Download size={16} />
              </button>
              <button onClick={handleAdd} className="bg-primary text-primary-foreground p-2.5 rounded-2xl shadow-lg shadow-primary/20 active:scale-95 transition-all">
                <Plus size={20} />
              </button>
            </div>
          </div>
        </div>

        {/* VIRTUALIZED LIST */}
        <div className="flex-1 min-h-0">
          {loading ? (
            <div className="px-3 md:px-6 pt-3">
              <LedgerSkeleton count={5} />
            </div>
          ) : (
            <Virtuoso
              ref={virtuosoRef}
              restoreStateFrom={virtuosoStateRef.current ?? initialVirtuosoState}
              style={{ height: '100%' }}
              data={enrichedFiltered}
              overscan={300}
              components={{
                Header: () => (
                  <div className="px-3 md:px-6 pt-3">
                    {/* TOTAL SUMMARY CARD */}
                    <div className="text-white p-4 rounded-3xl mb-3 relative overflow-hidden"
                      style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', boxShadow: '0 8px 32px rgba(79,70,229,0.4)', border: '1px solid rgba(167,139,250,0.3)' }}>
                      <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 70% 30%, white 0%, transparent 60%)' }} />
                      <div className="relative z-10 flex justify-between items-start">
                        <div>
                          <div className="text-[9px] font-bold opacity-70 uppercase tracking-widest mb-1">Net Volume (Excl. Rent)</div>
                          <div className="text-2xl font-black leading-none mb-2 tabular-nums">₹{formatINR(itemVolume)}</div>
                          {rentVolume > 0 && (
                            <div className="flex items-center gap-1.5 text-orange-300 px-2.5 py-1 rounded-full w-fit bg-white/10 mb-2">
                              <Truck size={11} /><span className="text-[10px] font-bold">Rent: ₹{formatINR(rentVolume)}</span>
                            </div>
                          )}
                          <div className="flex gap-2 mt-1">
                            <div className="px-2.5 py-1 rounded-full bg-white/10 flex items-center gap-1.5">
                              <CheckCircle2 size={10} className="text-emerald-300" />
                              <span className="text-[10px] font-bold text-emerald-200">Paid: ₹{formatINR(totalPaid)}</span>
                            </div>
                            <div className="px-2.5 py-1 rounded-full bg-white/10 flex items-center gap-1.5">
                              <AlertCircle size={10} className="text-amber-300" />
                              <span className="text-[10px] font-bold text-amber-200">Pending: ₹{formatINR(totalPending)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="bg-white/15 p-3 rounded-2xl relative z-10 flex-shrink-0"><BarChart3 size={22} className="text-white" /></div>
                      </div>
                    </div>
                    {/* SEARCH */}
                    <div className="p-3 rounded-3xl border border-white/10 mb-3 space-y-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <div className="flex gap-2">
                        <div className="flex-1 relative">
                          <Search className="absolute left-3 top-2.5 text-slate-400" size={13} />
                          <input
                            ref={searchInputRef}
                            className="w-full pl-8 pr-3 p-2 border border-white/12 rounded-2xl text-xs font-semibold outline-none focus:ring-2 focus:ring-primary/30"
                            style={{ background: 'rgba(255,255,255,0.06)', color: '#fff' }}
                            placeholder={currentFilter === 'sell' ? 'Search Customer...' : currentFilter === 'purchase' ? 'Search Supplier...' : 'Search Party...'}
                            value={searchTerm}
                            onChange={e => { setSearchTerm(e.target.value); setShowSuggestions(true); }}
                            onFocus={() => setShowSuggestions(true)}
                            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck={false}
                          />
                          {/* Custom party suggestion dropdown — replaces <datalist> which
                              blocks the keyboard and misbehaves on Android WebView/Capacitor */}
                          {showSuggestions && filteredSuggestions.length > 0 && (
                            <div
                              ref={suggestionsRef}
                              className="absolute left-0 right-0 top-full mt-1 z-50 rounded-2xl overflow-hidden"
                              style={{ background: 'rgba(15,20,50,0.98)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
                            >
                              {filteredSuggestions.map((name, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  className="w-full text-left px-3 py-2.5 text-xs font-semibold active:bg-white/10 transition-colors flex items-center gap-2"
                                  style={{ color: 'rgba(240,244,255,0.85)', borderBottom: i < filteredSuggestions.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}
                                  onMouseDown={e => {
                                    e.preventDefault();
                                    setSearchTerm(name);
                                    setShowSuggestions(false);
                                    searchInputRef.current?.blur();
                                  }}
                                >
                                  <Search size={10} className="text-slate-500 flex-shrink-0" />
                                  {name}
                                </button>
                              ))}
                            </div>
                          )}
                          {searchTerm.length > 0 && (
                            <button
                              type="button"
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full"
                              style={{ color: 'rgba(148,163,184,0.5)' }}
                              onMouseDown={e => { e.preventDefault(); setSearchTerm(''); setShowSuggestions(false); }}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                      <DateRangeFilter
                        start={dateRange.start}
                        end={dateRange.end}
                        onStartChange={v => setDateRange({ ...dateRange, start: v })}
                        onEndChange={v => setDateRange({ ...dateRange, end: v })}
                      />
                    </div>
                    {enrichedFiltered.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                        <div className="w-16 h-16 rounded-[20px] flex items-center justify-center mb-4"
                          style={{ background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)' }}>
                          <FileText size={28} style={{ color: 'rgba(167,139,250,0.6)' }} />
                        </div>
                        <p className="text-sm font-black text-white mb-1">No transactions yet</p>
                        <p className="text-[11px] mb-5" style={{ color: 'rgba(148,163,184,0.5)' }}>
                          Bills you create from Quick Bill will appear here
                        </p>
                        <button onClick={handleAdd}
                          className="flex items-center gap-2 px-5 py-2.5 rounded-[14px] text-[12px] font-black text-white active:scale-95 transition-all"
                          style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', boxShadow: '0 6px 20px rgba(124,58,237,0.3)' }}>
                          <Plus size={14} /> Create First Bill
                        </button>
                      </div>
                    )}
                  </div>
                ),
                Footer: () => <div className="h-24" />,
              }}
              itemContent={renderLedgerRow}
            />
          )}
        </div>
      </div>

      {showEntryModal && <ManualEntryModal
        isOpen={showEntryModal}
        onClose={() => setShowEntryModal(false)}
        type={entryType}
        user={user}
        initialData={editData}
        appSettings={settings}
        onSuccess={(data: any) => {
          if (data?.id) {
            if (editData) {
              setData(old => old.map(e => e.id === data.id ? { ...e, ...data } : e));
            } else {
              setData(old => [data, ...old].sort((a, b) => parseRecordDate(b.date).getTime() - parseRecordDate(a.date).getTime()));
            }
          }
          refetch();
          // Inventory may have been auto-decremented/incremented by the save;
          // trigger a background refetch so InventoryView reflects the change.
          if (settings?.automation?.auto_update_inventory !== false) {
            refetchInventory();
          }
        }}
      />}
    </>
  );
};

export default LedgerView;
