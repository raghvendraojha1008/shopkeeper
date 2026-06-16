import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { User } from 'firebase/auth';
import { 
  ArrowLeft, Phone, MapPin, Share2, 
  MessageCircle, FileText, Wallet, 
  ChevronDown, ChevronUp, AlertCircle, Download, Edit2,
  ShoppingCart, Truck, CreditCard, Tag, Trash2, Plus, X, Scale
} from 'lucide-react';
import DateRangeFilter from '../common/DateRangeFilter';
import { ApiService } from '../../services/api';
import { getFirestore, doc, updateDoc } from 'firebase/firestore';
import { exportService } from '../../services/export';
import { nativePdfService } from '../../services/nativePdfService';
import { useUI } from '../../context/UIContext';
import { useEditPassword } from '../../context/EditPasswordContext';
import { useData } from '../../context/DataContext';
import { calculateAccounting } from '../../utils/helpers'; 
import ManualEntryModal from '../modals/ManualEntryModal';
import { parseDateSafe, toDateStrSafe } from '../../utils/dateUtils';

interface PartyDetailViewProps { 
    party: any; 
    user: User; 
    onBack: () => void;
    appSettings?: any;
}

function parseRecordDate(raw: any): Date {
  return parseDateSafe(raw);
}
function toDateString(raw: any): string {
  return toDateStrSafe(raw);
}

function normalisePhone(raw: string): string {
  let digits = (raw || '').replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  if (digits.length === 10) return '91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return digits;
}

function fmt(n: number): string {
  return 'Rs.' + Math.round(n).toLocaleString('en-IN');
}

function fmtPdfDate(raw: any): string {
  if (!raw) return '-';
  const d = parseDateSafe(raw);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtRsPdf(n: any): string {
  const num = Math.abs(Number(n || 0));
  const [intPart, decPart] = num.toFixed(2).split('.');
  let formatted = '';
  if (intPart.length <= 3) {
    formatted = intPart;
  } else {
    formatted = intPart.slice(-3);
    let rest = intPart.slice(0, -3);
    while (rest.length > 2) { formatted = rest.slice(-2) + ',' + formatted; rest = rest.slice(0, -2); }
    if (rest.length > 0) formatted = rest + ',' + formatted;
  }
  return `Rs.${formatted}.${decPart}`;
}

const PartyDetailView: React.FC<PartyDetailViewProps> = ({ party, user, onBack, appSettings = {} }) => {
  const { showToast } = useUI();
  const { requireEditPassword } = useEditPassword();
  const { useLedger, useTransactions } = useData();

  const { data: allLedger, refetch: refetchLedger } = useLedger(user.uid);
  const { data: allTransactions, refetch: refetchTransactions } = useTransactions(user.uid);

  const [activeTab, setActiveTab] = useState<'all' | 'orders' | 'payments' | 'summary'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [editType, setEditType] = useState<'sales' | 'purchases' | 'transactions'>('sales');

  const [showNewModal, setShowNewModal] = useState(false);
  const [newModalType, setNewModalType] = useState<'sales' | 'purchases' | 'transactions'>('sales');
  const [newModalData, setNewModalData] = useState<any>(null);

  const [dateRange, setDateRange] = useState({ start: '', end: '' });

  // ── Misc charges ─────────────────────────────────────────────────────────
  const MISC_CATEGORIES = ['Loading', 'Unloading', 'Transport', 'Labour', 'Commission', 'Adjustment', 'Other'];
  const [miscCharges, setMiscCharges] = useState<any[]>([]);
  const [showMiscModal, setShowMiscModal] = useState(false);
  const [editingMisc, setEditingMisc] = useState<any>(null);
  const [miscSaving, setMiscSaving] = useState(false);
  const [miscForm, setMiscForm] = useState({
    date: new Date().toISOString().split('T')[0],
    amount: '',
    category: 'Loading',
    direction: 'charge_to_party' as 'charge_to_party' | 'charge_from_party',
    notes: '',
  });

  const loadMiscCharges = useCallback(async () => {
    try {
      const snap = await ApiService.getAll(user.uid, 'misc_charges');
      const all = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      setMiscCharges(all.filter((c: any) => c.party_id === party.id || c.party_name === party.name));
    } catch (_) {}
  }, [user.uid, party.id, party.name]);

  useEffect(() => { loadMiscCharges(); }, [loadMiscCharges]);

  const openAddMisc = () => {
    setEditingMisc(null);
    setMiscForm({ date: new Date().toISOString().split('T')[0], amount: '', category: 'Loading', direction: 'charge_to_party', notes: '' });
    setShowMiscModal(true);
  };
  const openEditMisc = (c: any) => {
    setEditingMisc(c);
    setMiscForm({ date: c.date || '', amount: String(c.amount || ''), category: c.category || 'Loading', direction: c.direction || 'charge_to_party', notes: c.notes || '' });
    setShowMiscModal(true);
  };

  const handleSaveMisc = async () => {
    if (!miscForm.amount || Number(miscForm.amount) <= 0) { showToast('Enter a valid amount', 'error'); return; }
    setMiscSaving(true);
    try {
      const payload = { ...miscForm, amount: Number(miscForm.amount), party_id: party.id, party_name: party.name };
      if (editingMisc?.id) await ApiService.update(user.uid, 'misc_charges', editingMisc.id, payload);
      else await ApiService.add(user.uid, 'misc_charges', payload);
      setShowMiscModal(false);
      await loadMiscCharges();
      showToast(editingMisc ? 'Charge updated' : 'Charge added', 'success');
    } catch (e: any) {
      if (e?.code === 'WRITE_TIMEOUT') {
        const { SyncQueueService } = await import('../../services/syncQueue');
        const payload = { ...miscForm, amount: Number(miscForm.amount), party_id: party.id, party_name: party.name };
        if (editingMisc?.id) {
          SyncQueueService.addToQueue(user.uid, 'update', 'misc_charges', payload, editingMisc.id);
        } else {
          SyncQueueService.addToQueue(user.uid, 'create', 'misc_charges', payload);
        }
        setShowMiscModal(false);
        showToast('Saved — syncing in background', 'info');
        loadMiscCharges();
      } else {
        showToast(e.message || 'Failed to save', 'error');
      }
    }
    finally { setMiscSaving(false); }
  };

  const handleDeleteMisc = async (id: string) => {
    const ok = await requireEditPassword('delete');
    if (!ok) return;
    try {
      await ApiService.delete(user.uid, 'misc_charges', id);
      await loadMiscCharges();
      showToast('Charge deleted', 'success');
    } catch (e: any) { showToast('Failed to delete', 'error'); }
  };
  // ─────────────────────────────────────────────────────────────────────────

  const { timeline, stats } = useMemo(() => {
      // Match by party_id (stable, survives renames) OR party_name (legacy fallback).
      // party_id is preferred: after a rename, party.name changes immediately in state
      // but cached records still carry the old party_name until the cascade + refetch
      // completes. Without the id-based path the view would show zero records
      // during that window.
      const partyLedger = (allLedger || []).filter((l: any) =>
        (party.id && l.party_id === party.id) || l.party_name === party.name
      );
      const partyTrans = (allTransactions || []).filter((t: any) =>
        (party.id && t.party_id === party.id) || t.party_name === party.name
      );
      
      const combined = [
          ...partyLedger.map((i: any) => ({...i, docType: 'invoice'})),
          ...partyTrans.map((t: any) => ({...t, docType: 'payment'})),
          ...miscCharges.map((c: any) => ({...c, docType: 'misc'})),
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return {
          timeline: combined,
          stats: calculateAccounting(partyLedger, partyTrans, party.role, {
              openingBalance: Number(party.opening_balance) || 0,
              openingBalanceType: (party.opening_balance_type as 'they_owe' | 'we_owe') || 'they_owe',
              miscCharges,
          }),
      };
  }, [allLedger, allTransactions, party.name, party.role, party.opening_balance, party.opening_balance_type, miscCharges]);

  const filteredList = useMemo(() => {
      let data = timeline;
      if (activeTab === 'orders')   data = data.filter(t => t.docType === 'invoice');
      if (activeTab === 'payments') data = data.filter(t => t.docType === 'payment');
      if (activeTab === 'all')      { /* keep invoices + payments + misc */ }
      if (dateRange.start) data = data.filter(t => toDateString(t.date) >= dateRange.start);
      if (dateRange.end)   data = data.filter(t => toDateString(t.date) <= dateRange.end);
      return data;
  }, [timeline, activeTab, dateRange]);

  const itemSummary = useMemo(() => {
      const invoices = filteredList.filter((t: any) => t.docType === 'invoice');
      const map: Record<string, { name: string; unit: string; qty: number; amount: number }> = {};
      invoices.forEach((entry: any) => {
          (entry.items || []).forEach((it: any) => {
              const key = (it.item_name || '').toLowerCase();
              if (!map[key]) map[key] = { name: it.item_name, unit: it.unit || 'Pcs', qty: 0, amount: 0 };
              map[key].qty += Number(it.quantity) || 0;
              map[key].amount += Number(it.total) || (Number(it.quantity) * Number(it.rate)) || 0;
          });
      });
      return Object.values(map).sort((a, b) => b.amount - a.amount);
  }, [filteredList]);

  const handleExport = async () => {
      const hasData = filteredList.length > 0 || miscCharges.length > 0 || Number(party.opening_balance) > 0;
      if (!hasData) return showToast("No records to export", "error");

      const headers = [
          'Date', 'Type', 'Ref No',
          'Item Name', 'Quantity', 'Rate', 'Item Total',
          'Order Total', 'Payment Mode', 'Notes', 'Transport'
      ];

      const rows: any[] = [];

      // ── Opening balance header row ────────────────────────────────────────
      const ob = Number(party.opening_balance) || 0;
      if (ob > 0) {
          rows.push({
              Date: '-',
              Type: `Opening Balance (${party.opening_balance_type === 'we_owe' ? 'We Owe' : 'They Owe'})`,
              'Ref No': '-',
              'Item Name': '-', 'Quantity': '-', 'Rate': '-', 'Item Total': '-',
              'Order Total': ob,
              'Payment Mode': '-', 'Notes': 'Pre-existing balance', 'Transport': '-',
          });
      }

      // ── Invoices & payments ───────────────────────────────────────────────
      filteredList.forEach(t => {
          const isInv = t.docType === 'invoice';
          let typeLabel = '';
          if (isInv) typeLabel = t.type === 'sell' ? 'Sale Invoice' : 'Purchase Bill';
          else if (t.docType === 'misc') typeLabel = `Misc Charge (${t.direction === 'charge_to_party' ? 'To Party' : 'From Party'})`;
          else typeLabel = t.type === 'received' ? 'Payment Received' : 'Payment Paid';

          const baseRow = {
              Date: t.date,
              Type: typeLabel,
              'Ref No': t.invoice_no || t.bill_no || t.transaction_id || '-',
              'Order Total': t.total_amount || t.amount || 0,
              'Notes': t.notes || '',
              'Transport': t.vehicle ? `${t.vehicle} (₹${t.vehicle_rent || 0})` : '-'
          };

          if (isInv && t.items && t.items.length > 0) {
              t.items.forEach((item: any) => {
                  rows.push({
                      ...baseRow,
                      'Item Name': item.item_name,
                      'Quantity': item.quantity,
                      'Rate': item.rate,
                      'Item Total': item.total,
                      'Payment Mode': '-'
                  });
              });
          } else if (t.docType === 'misc') {
              rows.push({
                  ...baseRow,
                  'Item Name': t.category || '-',
                  'Quantity': '-', 'Rate': '-', 'Item Total': t.amount || 0,
                  'Payment Mode': '-',
              });
          } else {
              rows.push({
                  ...baseRow,
                  'Item Name': isInv ? '(No Items)' : '-',
                  'Quantity': '-', 'Rate': '-', 'Item Total': '-',
                  'Payment Mode': isInv ? '-' : `${t.payment_mode} - ${t.payment_purpose || ''}`
              });
          }
      });

      // ── Summary footer ────────────────────────────────────────────────────
      rows.push({ Date: '', Type: '', 'Ref No': '', 'Item Name': '', 'Quantity': '', 'Rate': '', 'Item Total': '', 'Order Total': '', 'Payment Mode': '', 'Notes': '', 'Transport': '' });
      rows.push({ Date: 'SUMMARY', Type: `Total Billed: ${stats.totalBilled}`, 'Ref No': `Total Paid: ${stats.totalPaid}`, 'Item Name': `Misc Net: ${stats.miscNet}`, 'Quantity': '', 'Rate': '', 'Item Total': '', 'Order Total': `Balance: ${stats.balance}`, 'Payment Mode': stats.balance > 0 ? 'Cr' : 'Dr', 'Notes': '', 'Transport': '' });

      const fileName = `${party.name}_Detailed_Report_${dateRange.start || 'all'}_to_${dateRange.end || 'all'}.csv`;
      await exportService.exportToCSV(rows, headers, fileName);
      showToast("Detailed Report Downloaded", "success");
  };

  const handlePdfExport = async () => {
      const allFiltered = (() => {
          let data = timeline;
          if (dateRange.start) data = data.filter(t => toDateString(t.date) >= dateRange.start);
          if (dateRange.end) data = data.filter(t => toDateString(t.date) <= dateRange.end);
          return data;
      })();

      const hasData = allFiltered.length > 0 || Number(party.opening_balance) > 0;
      if (!hasData) return showToast("No records to export", "error");

      try {
          const periodText = dateRange.start || dateRange.end
              ? `Period: ${dateRange.start || 'All'} to ${dateRange.end || 'All'}`
              : 'All Time';

          const sections: { type: 'text' | 'table'; content?: string; rows?: string[][] }[] = [];

          // ── Header ────────────────────────────────────────────────────────
          sections.push({ type: 'text', content: 'PARTY STATEMENT' });
          sections.push({ type: 'text', content: `${party.name}  |  ${(party.role || '').toUpperCase()}` });
          if (party.contact) sections.push({ type: 'text', content: `Contact: ${party.contact}` });
          if (party.address) sections.push({ type: 'text', content: `Address: ${party.address}` });
          sections.push({ type: 'text', content: periodText });
          sections.push({ type: 'text', content: '' });

          // ── Summary ───────────────────────────────────────────────────────
          sections.push({ type: 'text', content: 'SUMMARY' });
          const obAmt = Number(party.opening_balance) || 0;
          const summaryRows: string[][] = [['Field', 'Amount']];
          if (obAmt > 0) {
              summaryRows.push(['Opening Balance', `${fmt(obAmt)} (${party.opening_balance_type === 'we_owe' ? 'We Owe' : 'They Owe'})`]);
          }
          summaryRows.push(['Total Billed', fmt(stats.totalBilled)]);
          summaryRows.push(['Total Paid',   fmt(stats.totalPaid)]);
          if (stats.miscNet !== 0) {
              summaryRows.push(['Misc Net', fmt(Math.abs(stats.miscNet)) + (stats.miscNet >= 0 ? ' (Dr)' : ' (Cr)')]);
          }
          summaryRows.push(['Balance', `${fmt(Math.abs(stats.balance))} ${stats.balance > 0 ? 'Cr' : 'Dr'}`]);
          sections.push({ type: 'table', rows: summaryRows });
          sections.push({ type: 'text', content: '' });

          // ── Sales ─────────────────────────────────────────────────────────
          const sales = allFiltered.filter(t => t.docType === 'invoice' && t.type === 'sell');
          if (sales.length > 0) {
              sections.push({ type: 'text', content: 'SALES' });
              const rows: string[][] = [['Date', 'Ref No', 'Items', 'Total']];
              sales.forEach(e => {
                  const itemDesc = (e.items && e.items.length > 0)
                      ? e.items.map((it: any) => `${it.item_name} x${it.quantity}`).join(', ')
                      : '(no items)';
                  rows.push([
                      fmtPdfDate(e.date),
                      e.invoice_no || '-',
                      itemDesc,
                      fmtRsPdf(Number(e.total_amount) || 0),
                  ]);
              });
              const salesTotal = sales.reduce((s, e) => s + (Number(e.total_amount) || 0), 0);
              rows.push(['', '', 'Grand Total', fmtRsPdf(salesTotal)]);
              sections.push({ type: 'table', rows });
              sections.push({ type: 'text', content: '' });
          }

          // ── Purchases ─────────────────────────────────────────────────────
          const purchases = allFiltered.filter(t => t.docType === 'invoice' && t.type === 'purchase');
          if (purchases.length > 0) {
              sections.push({ type: 'text', content: 'PURCHASES' });
              const rows: string[][] = [['Date', 'Ref No', 'Items', 'Total']];
              purchases.forEach(e => {
                  const itemDesc = (e.items && e.items.length > 0)
                      ? e.items.map((it: any) => `${it.item_name} x${it.quantity}`).join(', ')
                      : '(no items)';
                  rows.push([
                      fmtPdfDate(e.date),
                      e.bill_no || '-',
                      itemDesc,
                      fmtRsPdf(Number(e.total_amount) || 0),
                  ]);
              });
              const purchTotal = purchases.reduce((s, e) => s + (Number(e.total_amount) || 0), 0);
              rows.push(['', '', 'Grand Total', fmtRsPdf(purchTotal)]);
              sections.push({ type: 'table', rows });
              sections.push({ type: 'text', content: '' });
          }

          // ── Payments ──────────────────────────────────────────────────────
          const payments = allFiltered.filter(t => t.docType === 'payment');
          if (payments.length > 0) {
              sections.push({ type: 'text', content: 'PAYMENTS' });
              const rows: string[][] = [['Date', 'Type', 'Mode', 'Ref', 'Amount']];
              payments.forEach(p => {
                  rows.push([
                      fmtPdfDate(p.date),
                      p.type === 'received' ? 'Received' : 'Paid',
                      p.payment_mode || '-',
                      p.bill_no || p.transaction_id || '-',
                      fmtRsPdf(Number(p.amount) || 0),
                  ]);
              });
              const payTotal = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
              rows.push(['', '', '', 'Total', fmtRsPdf(payTotal)]);
              sections.push({ type: 'table', rows });
              sections.push({ type: 'text', content: '' });
          }

          // ── Misc Charges ──────────────────────────────────────────────────
          const miscItems = allFiltered.filter(t => t.docType === 'misc');
          if (miscItems.length > 0) {
              sections.push({ type: 'text', content: 'MISCELLANEOUS CHARGES' });
              const rows: string[][] = [['Date', 'Category', 'Direction', 'Amount']];
              miscItems.forEach(m => {
                  rows.push([
                      fmtPdfDate(m.date),
                      m.category || '-',
                      m.direction === 'charge_to_party' ? 'To Party' : 'From Party',
                      fmtRsPdf(Number(m.amount) || 0),
                  ]);
              });
              sections.push({ type: 'table', rows });
              sections.push({ type: 'text', content: '' });
          }

          // ── Footer ────────────────────────────────────────────────────────
          sections.push({ type: 'text', content: `Generated: ${new Date().toLocaleDateString('en-IN')}` });

          const filename = `${party.name.replace(/\s+/g,'_')}_Statement_${new Date().toISOString().split('T')[0]}.pdf`;
          const ok = await nativePdfService.generateAndShare({ title: 'Party Statement', fileName: filename, sections }, undefined);
          if (ok) {
              showToast("PDF ready to share", "success");
          } else {
              showToast("Failed to generate PDF", "error");
          }
      } catch (err) {
          console.error(err);
          showToast("Failed to generate PDF", "error");
      }
  };

  const toggleExpand = (id: string) => {
      setExpandedId(expandedId === id ? null : id);
  };

  const handleEditClick = (item: any, e: React.MouseEvent) => {
      e.stopPropagation();
      setEditingItem(item);
      if (item.docType === 'invoice') {
          setEditType(item.type === 'sell' ? 'sales' : 'purchases');
      } else {
          setEditType('transactions');
      }
      setShowEditModal(true);
  };

  const refreshData = () => {
      refetchLedger();
      refetchTransactions();
  };

  return (
    <div className="h-full flex flex-col animate-in slide-in-from-right duration-300" style={{background: 'var(--app-bg)'}}>

        {/* HEADER */}
        <div className="shrink-0 z-20" style={{background:"rgba(var(--app-bg-rgb),0.97)", backdropFilter:"blur(20px)"}}>

            {/* Gradient accent strip */}
            <div className="h-0.5 w-full" style={{
              background: party.role === 'customer'
                ? 'linear-gradient(90deg,#34d399,rgba(52,211,153,0.1))'
                : 'linear-gradient(90deg,#fbbf24,rgba(251,191,36,0.1))'
            }}/>

            {/* Top Bar */}
            <div className="flex items-center gap-3 px-3 pt-3 pb-2">
                <button onClick={onBack} className="p-2 -ml-1 rounded-full active:scale-90 transition-all" style={{background:'rgba(255,255,255,0.06)'}}><ArrowLeft size={18} style={{color:'rgba(203,213,225,0.7)'}}/></button>

                {/* Avatar */}
                <div className="w-11 h-11 rounded-[14px] flex items-center justify-center flex-shrink-0 font-black text-base"
                  style={{
                    background: party.role === 'customer'
                      ? 'linear-gradient(135deg,rgba(52,211,153,0.25),rgba(16,185,129,0.1))'
                      : 'linear-gradient(135deg,rgba(251,191,36,0.22),rgba(245,158,11,0.1))',
                    border: `1.5px solid ${party.role === 'customer' ? 'rgba(52,211,153,0.3)' : 'rgba(251,191,36,0.3)'}`,
                    color: party.role === 'customer' ? '#34d399' : '#fbbf24',
                  }}>
                  {(party.name || '?').charAt(0).toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="font-black text-base truncate leading-tight text-[rgba(240,244,255,0.95)]">{party.name}</h2>
                      <span className="text-[8px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wide flex-shrink-0"
                        style={party.role === 'customer'
                          ? {background:'rgba(52,211,153,0.12)',color:'#34d399',border:'1px solid rgba(52,211,153,0.2)'}
                          : {background:'rgba(251,191,36,0.1)',color:'#fbbf24',border:'1px solid rgba(251,191,36,0.2)'}}>
                        {party.role}
                      </span>
                    </div>
                    {party.contact && (
                      <p className="text-[10px] font-semibold mt-0.5" style={{color:'rgba(148,163,184,0.55)'}}>{party.contact}</p>
                    )}
                </div>
                <div className="flex gap-1.5">
                    <button onClick={handlePdfExport} className="p-2 rounded-xl active:scale-90 transition-all" style={{background:'rgba(139,92,246,0.12)',color:'#a78bfa',border:'1px solid rgba(139,92,246,0.2)'}} title="Download PDF Statement">
                        <Download size={16}/>
                    </button>
                    {party.contact && (
                      <a href={`tel:${party.contact}`} className="p-2 rounded-xl active:scale-90 transition-all" style={{background:'rgba(16,185,129,0.1)',color:'#34d399',border:'1px solid rgba(16,185,129,0.18)'}}><Phone size={16}/></a>
                    )}
                    {party.contact && (
                      <a href={`https://wa.me/${normalisePhone(party.contact || '')}`} className="p-2 rounded-xl active:scale-90 transition-all" style={{background:'rgba(16,185,129,0.1)',color:'#34d399',border:'1px solid rgba(16,185,129,0.18)'}}><MessageCircle size={16}/></a>
                    )}
                </div>
            </div>

            {/* Address bar */}
            {(party.address || party.site) && (
              <div className="px-4 pb-2 flex items-center gap-1.5">
                <MapPin size={11} style={{color:'rgba(148,163,184,0.4)',flexShrink:0}}/>
                <span className="text-[10px] font-semibold truncate" style={{color:'rgba(148,163,184,0.45)'}}>
                  {party.address}{party.address && party.site ? ' · ' : ''}{party.site ? `Site: ${party.site}` : ''}
                </span>
              </div>
            )}

            {/* Opening balance + misc adjustments — sits above stats, 2-col only when both exist */}
            {(() => {
              const hasOpening = Number(party.opening_balance) > 0;
              const hasMisc = miscCharges.length > 0;
              if (!hasOpening && !hasMisc) return null;
              const both = hasOpening && hasMisc;
              return (
                <div className={`mx-3 mb-1.5 grid gap-1.5 ${both ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {hasOpening && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-[12px] min-w-0"
                      style={{background:'rgba(139,92,246,0.1)',border:'1px solid rgba(139,92,246,0.2)'}}>
                      <Scale size={12} style={{color:'#a78bfa',flexShrink:0}}/>
                      <div className="min-w-0 flex-1">
                        <div className="text-[8px] font-bold uppercase tracking-wide leading-none mb-0.5" style={{color:'rgba(167,139,250,0.55)'}}>
                          Opening · {party.opening_balance_type === 'we_owe' ? 'We Owe' : 'They Owe'}
                        </div>
                        <div className="text-xs font-black truncate leading-none" style={{color:'#a78bfa'}}>
                          ₹{Number(party.opening_balance).toLocaleString('en-IN')}
                        </div>
                      </div>
                    </div>
                  )}
                  {hasMisc && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-[12px] min-w-0"
                      style={{background:'rgba(251,146,60,0.1)',border:'1px solid rgba(251,146,60,0.2)'}}>
                      <Tag size={12} style={{color:'#fb923c',flexShrink:0}}/>
                      <div className="min-w-0 flex-1">
                        <div className="text-[8px] font-bold uppercase tracking-wide leading-none mb-0.5" style={{color:'rgba(251,146,60,0.55)'}}>
                          {miscCharges.length} Misc Charge{miscCharges.length !== 1 ? 's' : ''}
                        </div>
                        <div className="text-xs font-black truncate leading-none" style={{color:'#fb923c'}}>
                          {stats.miscNet !== 0 ? `${stats.miscNet > 0 ? '+' : ''}₹${Math.abs(stats.miscNet).toLocaleString('en-IN')}` : '₹0'} <span className="text-[8px] font-semibold opacity-60">net</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Stats Row */}
            <div className="grid grid-cols-3 mx-3 rounded-[16px] overflow-hidden" style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)'}}>
                <div className="p-2.5 text-center">
                    <div className="text-[8px] font-bold uppercase tracking-wide mb-0.5" style={{color:'rgba(148,163,184,0.45)'}}>Total Bill</div>
                    <div className="text-sm font-black text-[rgba(203,213,225,0.9)]">₹{stats.totalBilled.toLocaleString('en-IN')}</div>
                </div>
                <div className="p-2.5 text-center" style={{borderLeft:'1px solid rgba(255,255,255,0.07)',borderRight:'1px solid rgba(255,255,255,0.07)'}}>
                    <div className="text-[8px] font-bold uppercase tracking-wide mb-0.5" style={{color:'rgba(148,163,184,0.45)'}}>Received</div>
                    <div className="text-sm font-black" style={{color:'#34d399'}}>₹{stats.totalPaid.toLocaleString('en-IN')}</div>
                </div>
                <div className="p-2.5 text-center" style={{background: stats.balance > 0 ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)'}}>
                    <div className="text-[8px] font-bold uppercase tracking-wide mb-0.5" style={{color:'rgba(148,163,184,0.45)'}}>Balance</div>
                    <div className="text-sm font-black" style={{color: stats.balance > 0 ? '#34d399' : '#f87171'}}>
                        ₹{Math.abs(stats.balance).toLocaleString('en-IN')} <span className="text-[9px]">{stats.balance > 0 ? 'Cr' : 'Dr'}</span>
                    </div>
                </div>
            </div>

            <div className="mb-2" style={{borderBottom:'1px solid rgba(255,255,255,0.08)'}}/>

            {/* Quick Action Buttons: Sale/Purchase | Misc | Payment */}
            <div className="flex gap-2 px-3 py-2.5">
              {party.role === 'customer' ? (
                <>
                  <button
                    onClick={() => { setNewModalType('sales'); setNewModalData({ party_name: party.name, paid_by: party.name, address: party.address || '' }); setShowNewModal(true); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-xs transition-all active:scale-95"
                    style={{ background: 'rgba(52,211,153,0.12)', color: '#34d399', border: '1px solid rgba(52,211,153,0.22)' }}>
                    <ShoppingCart size={13}/> New Sale
                  </button>
                  <button
                    onClick={openAddMisc}
                    className="flex items-center justify-center gap-1 px-3 py-2.5 rounded-xl font-bold text-xs transition-all active:scale-95"
                    style={{ background: 'rgba(251,146,60,0.1)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.22)' }}
                    title="Add Miscellaneous Charge">
                    <Tag size={13}/> Misc
                  </button>
                  <button
                    onClick={() => { setNewModalType('transactions'); setNewModalData({ type: 'received', paid_by: party.name, party_name: party.name }); setShowNewModal(true); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-xs transition-all active:scale-95"
                    style={{ background: 'rgba(99,102,241,0.12)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.22)' }}>
                    <CreditCard size={13}/> Payment
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => { setNewModalType('purchases'); setNewModalData({ party_name: party.name, paid_to: party.name, address: party.address || '' }); setShowNewModal(true); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-xs transition-all active:scale-95"
                    style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }}>
                    <Truck size={13}/> New Purchase
                  </button>
                  <button
                    onClick={openAddMisc}
                    className="flex items-center justify-center gap-1 px-3 py-2.5 rounded-xl font-bold text-xs transition-all active:scale-95"
                    style={{ background: 'rgba(251,146,60,0.1)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.22)' }}
                    title="Add Miscellaneous Charge">
                    <Tag size={13}/> Misc
                  </button>
                  <button
                    onClick={() => { setNewModalType('transactions'); setNewModalData({ type: 'paid', paid_to: party.name, party_name: party.name }); setShowNewModal(true); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-xs transition-all active:scale-95"
                    style={{ background: 'rgba(99,102,241,0.12)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.22)' }}>
                    <CreditCard size={13}/> Payment
                  </button>
                </>
              )}
            </div>
        </div>

        {/* TABS & DATE FILTERS (Sticky) */}
        <div className="border-b border-white/10 sticky top-0 z-10 shrink-0">
            {/* Tabs */}
            <div className="flex">
                {['all', 'orders', 'payments', 'summary'].map(t => (
                    <button 
                        key={t}
                        onClick={() => setActiveTab(t as any)}
                        className={`flex-1 py-3 text-xs font-bold uppercase tracking-wide border-b-2 transition-colors ${activeTab === t ? 'border-violet-500 text-violet-300' : 'border-transparent text-[rgba(148,163,184,0.5)]'}`}
                    >
                        {t}
                    </button>
                ))}
            </div>
            
            {/* Date Filter Bar — wide, compact height */}
            <div className="flex items-center gap-2 px-2 py-1.5 border-t border-white/08">
                <DateRangeFilter
                    start={dateRange.start}
                    end={dateRange.end}
                    onStartChange={v => setDateRange(prev => ({...prev, start: v}))}
                    onEndChange={v => setDateRange(prev => ({...prev, end: v}))}
                    className="flex-1"
                    compact
                />
                {/* Square icon-only export button */}
                <button 
                    onClick={handleExport}
                    className="w-8 h-8 flex items-center justify-center rounded-lg active:scale-95 transition-all flex-shrink-0 bg-[rgba(139,92,246,0.2)] text-violet-300 border border-[rgba(139,92,246,0.3)]"
                    title="Export CSV"
                >
                    <Download size={14}/>
                </button>
            </div>
        </div>

        {/* SCROLLABLE LIST */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {activeTab === 'summary' ? (
                itemSummary.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12">
                        <div className="p-4 rounded-full mb-3"><AlertCircle size={24}/></div>
                        <p className="text-xs font-bold">No items found for this period</p>
                    </div>
                ) : (
                    <>
                        <div className="p-3 rounded-xl border border-violet-500/20 bg-[rgba(139,92,246,0.08)]">
                            <div className="flex justify-between items-center">
                                <span className="text-[10px] font-bold uppercase text-slate-400">Total Items: {itemSummary.length}</span>
                                <span className="font-black text-sm text-violet-300">
                                    ₹{itemSummary.reduce((s, i) => s + i.amount, 0).toLocaleString('en-IN')}
                                </span>
                            </div>
                        </div>

                        <div className="flex justify-between text-[9px] font-bold uppercase text-slate-400 px-3">
                            <span className="flex-1">Item</span>
                            <span className="w-20 text-center">Qty</span>
                            <span className="w-24 text-right">Amount</span>
                        </div>

                        {itemSummary.map((it, idx) => (
                            <div key={idx} className="p-3 rounded-xl bg-[rgba(255,255,255,0.05)] border border-white/08 flex justify-between items-center">
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-sm truncate">{it.name}</div>
                                </div>
                                <div className="w-20 text-center">
                                    <span className="text-xs font-bold text-slate-300">{Math.round(it.qty)}</span>
                                    <span className="text-[10px] text-slate-500 ml-1">{it.unit}</span>
                                </div>
                                <div className="w-24 text-right font-black text-sm">
                                    ₹{Math.round(it.amount).toLocaleString('en-IN')}
                                </div>
                            </div>
                        ))}
                    </>
                )
            ) : (
                <>
                {filteredList.map((item: any) => {
                // ── Misc charge row ──────────────────────────────────────────
                if (item.docType === 'misc') {
                  const isDebit = item.direction === 'charge_to_party';
                  return (
                    <div key={item.id} className="rounded-xl overflow-hidden border border-orange-500/15"
                      style={{background:'rgba(251,146,60,0.06)'}}>
                      <div className="p-3 flex justify-between items-start">
                        <div className="flex gap-3">
                          <div className="p-2.5 rounded-xl flex items-center justify-center h-10 w-10 shrink-0 text-orange-400 border border-orange-500/20"
                            style={{background:'rgba(251,146,60,0.08)'}}>
                            <Tag size={16}/>
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-sm text-[rgba(240,244,255,0.9)]">Misc: {item.category}</span>
                              <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md uppercase"
                                style={isDebit
                                  ? {background:'rgba(239,68,68,0.12)',color:'#f87171',border:'1px solid rgba(239,68,68,0.2)'}
                                  : {background:'rgba(52,211,153,0.1)',color:'#34d399',border:'1px solid rgba(52,211,153,0.2)'}}>
                                {isDebit ? 'We Charge Them' : 'They Charge Us'}
                              </span>
                            </div>
                            <div className="text-xs font-medium mt-0.5" style={{color:'rgba(148,163,184,0.45)'}}>
                              {item.date}{item.notes ? ` · ${item.notes}` : ''}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <div className="text-right">
                            <div className={`font-black text-sm ${isDebit ? 'text-[rgba(240,244,255,0.9)]' : 'text-[rgba(52,211,153,0.9)]'}`}>
                              {isDebit ? '' : '- '}₹{Number(item.amount).toLocaleString('en-IN')}
                            </div>
                          </div>
                          <button onClick={() => openEditMisc(item)} className="p-1.5 rounded-lg text-violet-400" title="Edit">
                            <Edit2 size={13}/>
                          </button>
                          <button onClick={() => handleDeleteMisc(item.id)} className="p-1.5 rounded-lg text-red-400" title="Delete">
                            <Trash2 size={13}/>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }
                // ─────────────────────────────────────────────────────────────

                const isInv = item.docType === 'invoice';
                const alwaysExpanded = activeTab === 'orders' || activeTab === 'payments';
                const isExpanded = alwaysExpanded || expandedId === item.id;
                
                return (
                    <div key={item.id} onClick={() => !alwaysExpanded && toggleExpand(item.id)} className={`rounded-xl overflow-hidden bg-[rgba(255,255,255,0.05)] border border-white/08 ${!alwaysExpanded ? 'active:scale-[0.99] transition-transform' : ''}`}>
                        <div className="p-3 flex justify-between items-start">
                            <div className="flex gap-3">
                                <div className={`p-2.5 rounded-xl flex items-center justify-center h-10 w-10 shrink-0 ${isInv ? "text-blue-400 border border-blue-500/20" : "text-green-400 border border-green-500/20"}`}>
                                    {isInv ? <FileText size={18}/> : <Wallet size={18}/>}
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-sm ">
                                            {isInv ? (item.type === 'sell' ? 'Sale Invoice' : 'Purchase Bill') : (item.type === 'received' ? 'Payment Rec.' : 'Payment Paid')}
                                        </span>
                                        <span className="text-[10px] font-bold text-slate-400 px-1.5 py-0.5 rounded">
                                            #{item.invoice_no || item.bill_no || item.transaction_id?.slice(-8) || 'N/A'}
                                        </span>
                                    </div>
                                    <div className="text-xs font-medium mt-0.5 text-[rgba(148,163,184,0.45)]">
                                        {item.date}
                                        {isInv
                                          ? <> &bull; {(item.items || []).length} item{(item.items || []).length !== 1 ? 's' : ''}{item.payment_mode ? ` · ${item.payment_mode}` : ''}</>
                                          : <>{item.payment_mode ? ` · ${item.payment_mode}` : ''}{item.payment_purpose ? ` · ${item.payment_purpose}` : ''}</>
                                        }
                                    </div>
                                </div>
                            </div>
                            <div className="text-right flex items-start gap-2">
                                <div>
                                    <div className={`font-black text-sm ${isInv ? 'text-[rgba(240,244,255,0.95)]' : 'text-green-600'}`}>
                                        {isInv ? '' : '- '}₹{(item.total_amount || item.amount || 0).toLocaleString('en-IN')}
                                    </div>
                                    {!alwaysExpanded && (
                                        <div className="mt-1 text-[rgba(148,163,184,0.3)]">
                                            {isExpanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                                        </div>
                                    )}
                                </div>
                                <button 
                                    onClick={(e) => handleEditClick(item, e)}
                                    className="p-2 rounded-lg transition-colors glass-icon-btn text-violet-400"
                                    title="Edit"
                                >
                                    <Edit2 size={14}/>
                                </button>
                            </div>
                        </div>

                        {isExpanded && (
                            <div className="p-3 border-t border-white/08 text-xs animate-in slide-in-from-top-2">
                                {isInv ? (
                                    <div className="space-y-1">
                                        <div className="flex justify-between text-slate-400 font-bold uppercase text-[9px] mb-1">
                                            <span>Item</span><span>Qty x Rate</span><span>Total</span>
                                        </div>
                                        {(item.items || []).map((it:any, idx:number) => (
                                            <div key={idx} className="flex justify-between border-b border-dashed border-slate-200 border-white/08 pb-1 mb-1 last:border-0">
                                                <span className="font-bold text-[rgba(203,213,225,0.75)]">{it.item_name}</span>
                                                <span className="" style={{color:"rgba(148,163,184,0.5)"}}>{it.quantity} x {it.rate}</span>
                                                <span className="font-bold">₹{it.total}</span>
                                            </div>
                                        ))}
                                        {item.vehicle && <div className="mt-2 pt-2 border-t border-white/08 text-[rgba(148,163,184,0.5)] flex gap-2"><span className="font-bold">Transport:</span> {item.vehicle}{Number(item.vehicle_rent) > 0 ? ` (₹${Number(item.vehicle_rent).toLocaleString('en-IN')})` : ''}</div>}
                                        {item.source_supplier && <div className="mt-1 flex gap-2 text-[rgba(196,181,253,0.7)]"><span className="font-bold">Supplier:</span> {item.source_supplier}</div>}
                                        {item.site && <div className="mt-1 flex gap-2 text-[rgba(103,232,249,0.65)]"><span className="font-bold">Site:</span> {item.site}</div>}
                                        {item.seller_invoice_no && <div className="mt-1 flex gap-2 text-[rgba(251,191,36,0.65)]"><span className="font-bold">Seller Invoice:</span> #{item.seller_invoice_no}</div>}
                                        {Number(item.discount_amount) > 0 && <div className="mt-1 flex gap-2 text-amber-400"><span className="font-bold">Discount:</span> -₹{Number(item.discount_amount).toLocaleString('en-IN')}</div>}
                                        {item.notes && <div className="mt-1 flex gap-2 text-[rgba(148,163,184,0.5)]"><span className="font-bold">Notes:</span> {item.notes}</div>}
                                    </div>
                                ) : (
                                    <div className="space-y-1">
                                        {item.payment_purpose && <div className="flex gap-2"><span className="font-bold text-[rgba(148,163,184,0.45)]">Purpose:</span> <span className="text-[rgba(196,181,253,0.8)]">{item.payment_purpose}</span></div>}
                                        {item.notes && <div className="flex gap-2"><span className="font-bold text-[rgba(148,163,184,0.45)]">Note:</span> <span>{item.notes}</span></div>}
                                        {item.bill_no && <div className="flex gap-2"><span className="font-bold text-[rgba(148,163,184,0.45)]">Ref Bill:</span> <span className="bg-[rgba(245,158,11,0.18)] text-amber-300 px-1 rounded">{item.bill_no}</span></div>}
                                        {item.transaction_id && <div className="flex gap-2 items-center"><span className="font-bold text-[rgba(148,163,184,0.45)]">Txn ID:</span> <span className="font-mono text-[rgba(148,163,184,0.5)] text-[9px]">{item.transaction_id}</span></div>}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
            
            {filteredList.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12">
                    <div className="p-4 rounded-full mb-3"><AlertCircle size={24}/></div>
                    <p className="text-xs font-bold">No records found for this period</p>
                </div>
            )}
                </>
            )}
        </div>

        {/* Edit Modal */}
        {showEditModal && <ManualEntryModal 
            isOpen={showEditModal}
            onClose={() => setShowEditModal(false)}
            type={editType}
            user={user}
            initialData={editingItem}
            appSettings={appSettings}
            onSuccess={() => { 
                refreshData(); 
                setShowEditModal(false);
            }}
        />}

        {/* New Order / Payment Modal (quick-action from party header) */}
        {showNewModal && <ManualEntryModal
            isOpen={showNewModal}
            onClose={() => setShowNewModal(false)}
            type={newModalType}
            user={user}
            initialData={newModalData}
            appSettings={appSettings}
            onSuccess={() => {
                refreshData();
                setShowNewModal(false);
            }}
        />}

        {/* Misc Charge Modal */}
        {showMiscModal && (
          <div className="fixed inset-0 z-50 flex items-end justify-center" style={{background:'rgba(0,0,0,0.65)',backdropFilter:'blur(6px)'}}>
            <div className="w-full max-w-md rounded-t-3xl p-5 pb-8 space-y-4 animate-in slide-in-from-bottom duration-300"
              style={{background:'rgba(18,18,35,0.98)',border:'1px solid rgba(255,255,255,0.1)',borderBottom:'none'}}>

              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl" style={{background:'rgba(251,146,60,0.12)',border:'1px solid rgba(251,146,60,0.2)'}}>
                    <Tag size={15} style={{color:'#fb923c'}}/>
                  </div>
                  <div>
                    <h3 className="font-black text-sm text-[rgba(240,244,255,0.95)]">
                      {editingMisc ? 'Edit Misc Charge' : 'Add Misc Charge'}
                    </h3>
                    <p className="text-[10px] font-semibold" style={{color:'rgba(148,163,184,0.5)'}}>
                      {party.name}
                    </p>
                  </div>
                </div>
                <button onClick={() => setShowMiscModal(false)} className="p-2 rounded-full" style={{background:'rgba(255,255,255,0.06)'}}>
                  <X size={16} style={{color:'rgba(148,163,184,0.6)'}}/>
                </button>
              </div>

              {/* Direction toggle */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{color:'rgba(148,163,184,0.45)'}}>Direction</label>
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl" style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)'}}>
                  {([
                    {val:'charge_to_party',   label:'We Charge Them', sub:'Adds to their balance'},
                    {val:'charge_from_party',  label:'They Charge Us',  sub:'Reduces their balance'},
                  ] as const).map(opt => (
                    <button key={opt.val} type="button"
                      onClick={() => setMiscForm(f => ({...f, direction: opt.val}))}
                      className="py-2 px-1 rounded-lg text-xs font-bold transition-all text-center"
                      style={miscForm.direction === opt.val
                        ? {background:'rgba(251,146,60,0.2)',color:'#fb923c',border:'1px solid rgba(251,146,60,0.3)'}
                        : {color:'rgba(148,163,184,0.45)'}}>
                      {opt.label}
                      <div className="text-[9px] font-normal opacity-60 mt-0.5">{opt.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{color:'rgba(148,163,184,0.45)'}}>Category</label>
                <div className="flex flex-wrap gap-1.5">
                  {MISC_CATEGORIES.map(cat => (
                    <button key={cat} type="button"
                      onClick={() => setMiscForm(f => ({...f, category: cat}))}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all"
                      style={miscForm.category === cat
                        ? {background:'rgba(139,92,246,0.2)',color:'#a78bfa',border:'1px solid rgba(139,92,246,0.3)'}
                        : {background:'rgba(255,255,255,0.04)',color:'rgba(148,163,184,0.5)',border:'1px solid rgba(255,255,255,0.07)'}}>
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount + Date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wide mb-1" style={{color:'rgba(148,163,184,0.45)'}}>Amount (₹)</label>
                  <input type="number" inputMode="numeric"
                    className="w-full rounded-xl p-2.5 text-sm font-black outline-none focus:ring-2 focus:ring-orange-500"
                    style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',color:'rgba(240,244,255,0.95)'}}
                    placeholder="0"
                    value={miscForm.amount}
                    onChange={e => setMiscForm(f => ({...f, amount: e.target.value}))}/>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wide mb-1" style={{color:'rgba(148,163,184,0.45)'}}>Date</label>
                  <input type="date"
                    className="w-full rounded-xl p-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-orange-500"
                    style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',color:'rgba(240,244,255,0.95)'}}
                    value={miscForm.date}
                    onChange={e => setMiscForm(f => ({...f, date: e.target.value}))}/>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wide mb-1" style={{color:'rgba(148,163,184,0.45)'}}>Notes (Optional)</label>
                <input type="text"
                  className="w-full rounded-xl p-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-orange-500"
                  style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',color:'rgba(240,244,255,0.95)'}}
                  placeholder="e.g. Loading at Site A"
                  value={miscForm.notes}
                  onChange={e => setMiscForm(f => ({...f, notes: e.target.value}))}/>
              </div>

              {/* Save button */}
              <button
                onClick={handleSaveMisc}
                disabled={miscSaving}
                className="w-full py-3 rounded-xl font-black text-sm transition-all active:scale-98 disabled:opacity-60"
                style={{background:'linear-gradient(135deg,rgba(251,146,60,0.8),rgba(245,158,11,0.7))',color:'#fff',border:'1px solid rgba(251,146,60,0.4)'}}>
                {miscSaving ? 'Saving…' : editingMisc ? 'Update Charge' : 'Add Charge'}
              </button>
            </div>
          </div>
        )}
    </div>
  );
};

export default PartyDetailView;
