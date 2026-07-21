import React, { useState, useMemo, useRef, useEffect } from 'react';
import { User } from 'firebase/auth';
import { 
  ArrowLeft, Phone, MapPin, Share2, 
  MessageCircle, FileText, Wallet, 
  ChevronDown, ChevronUp, AlertCircle, Download, Edit2,
  ShoppingCart, Truck, CreditCard, Tag, Trash2, Plus, X, Scale,
  Sparkles, RotateCcw, Info, Building2, Hash, Globe,
} from 'lucide-react';
import ReturnOrderModal from '../modals/ReturnOrderModal';
import DateRangeFilter from '../common/DateRangeFilter';
import { ApiService } from '../../services/api';
import { getFirestore, doc, updateDoc } from 'firebase/firestore';
import { exportService } from '../../services/export';
import { useUI } from '../../context/UIContext';
import { useEditPassword } from '../../context/EditPasswordContext';
import { useData } from '../../context/DataContext';
import { calculateAccounting } from '../../utils/helpers';
import { recordBelongsToParty } from '../../utils/partyUtils'; 
import ManualEntryModal from '../modals/ManualEntryModal';
import { parseDateSafe, toDateStrSafe } from '../../utils/dateUtils';
import AILedgerImportModal from '../modals/AILedgerImportModal';
import ExportOptionsModal, { ExportFormat } from '../modals/ExportOptionsModal';
import { ExportOptions } from '../../types/exportOptions';

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
  const { useLedger, useTransactions, useServices, useMiscCharges } = useData();

  const { data: allLedger, refetch: refetchLedger } = useLedger(user.uid);
  const { data: allTransactions, refetch: refetchTransactions } = useTransactions(user.uid);
  const { data: servicesMaster } = useServices(user.uid);

  const [activeTab, setActiveTab] = useState<'all' | 'orders' | 'payments' | 'summary'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [editType, setEditType] = useState<'sales' | 'purchases' | 'transactions'>('sales');

  const [showNewModal, setShowNewModal] = useState(false);
  const [newModalType, setNewModalType] = useState<'sales' | 'purchases' | 'transactions'>('sales');
  const [newModalData, setNewModalData] = useState<any>(null);

  const [showAIImport, setShowAIImport] = useState(false);
  const [showPartyCard, setShowPartyCard] = useState(false);
  const [showEditPartyModal, setShowEditPartyModal] = useState(false);
  const [returnModal, setReturnModal] = useState<{ order: any; existing?: any } | null>(null);

  const [dateRange, setDateRange] = useState({ start: '', end: '' });

  const [paymentPurposeFilter, setPaymentPurposeFilter] = useState('');
  const [paymentByFilter, setPaymentByFilter] = useState('');
  const [paymentModeFilter, setPaymentModeFilter] = useState('');

  // ── Services (misc charges) — pulled from DataContext cache, no extra Firestore read ─
  const { data: allMiscChargesRaw = [], refetch: refetchMiscCharges } = useMiscCharges(user.uid);
  const miscCharges = useMemo(
    () => allMiscChargesRaw.filter((c: any) => c.party_id === party.id || c.party_name === party.name),
    [allMiscChargesRaw, party.id, party.name]
  );
  const [showMiscModal, setShowMiscModal] = useState(false);
  const [editingMisc, setEditingMisc] = useState<any>(null);
  const [miscSaving, setMiscSaving] = useState(false);

  // Export options modal state
  const [exportModal, setExportModal] = useState<{ open: boolean; format: ExportFormat } | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [serviceSearch, setServiceSearch] = useState('');
  const [miscForm, setMiscForm] = useState({
    date: new Date().toISOString().split('T')[0],
    amount: '',
    category: '',
    direction: 'charge_to_party' as 'charge_to_party' | 'charge_from_party',
    notes: '',
    service_id: '',
    service_name: '',
    quantity: '',
    rate_per_unit: '',
    unit: '',
  });

  // loadMiscCharges removed — data is derived from DataContext useMiscCharges cache above.

  const openAddMisc = () => {
    setEditingMisc(null);
    setServiceSearch('');
    setMiscForm({ date: new Date().toISOString().split('T')[0], amount: '', category: '', direction: 'charge_to_party', notes: '', service_id: '', service_name: '', quantity: '', rate_per_unit: '', unit: '' });
    setShowMiscModal(true);
  };
  const openEditMisc = (c: any) => {
    setEditingMisc(c);
    setServiceSearch(c.service_name || '');
    setMiscForm({ date: c.date || '', amount: String(c.amount || ''), category: c.category || '', direction: c.direction || 'charge_to_party', notes: c.notes || '', service_id: c.service_id || '', service_name: c.service_name || '', quantity: String(c.quantity || ''), rate_per_unit: String(c.rate_per_unit || ''), unit: c.unit || '' });
    setShowMiscModal(true);
  };

  const handleSaveMisc = async () => {
    if (!miscForm.amount || Number(miscForm.amount) <= 0) { showToast('Enter a valid amount', 'error'); return; }
    setMiscSaving(true);
    try {
      const payload: any = {
        date: miscForm.date,
        amount: Number(miscForm.amount),
        category: miscForm.category,
        direction: miscForm.direction,
        notes: miscForm.notes,
        party_id: party.id,
        party_name: party.name,
      };
      if (miscForm.service_id) payload.service_id = miscForm.service_id;
      if (miscForm.service_name) payload.service_name = miscForm.service_name;
      if (miscForm.quantity) payload.quantity = Number(miscForm.quantity);
      if (miscForm.rate_per_unit) payload.rate_per_unit = Number(miscForm.rate_per_unit);
      if (miscForm.unit) payload.unit = miscForm.unit;

      if (editingMisc?.id) await ApiService.update(user.uid, 'misc_charges', editingMisc.id, payload);
      else await ApiService.add(user.uid, 'misc_charges', payload);
      setShowMiscModal(false);
      refetchMiscCharges();
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
        refetchMiscCharges();
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
      refetchMiscCharges();
      showToast('Charge deleted', 'success');
    } catch (e: any) { showToast('Failed to delete', 'error'); }
  };
  // ─────────────────────────────────────────────────────────────────────────

  // Map from original order ID → its return record (sell_return / purchase_return)
  const returnsByOrderId = useMemo(() => {
    const map: Record<string, any> = {};
    (allLedger || []).forEach((l: any) => {
      if (l.is_return && l.return_of_id) map[l.return_of_id] = l;
    });
    return map;
  }, [allLedger]);

  const { timeline, stats } = useMemo(() => {
      const partyLedger = (allLedger || []).filter((l: any) => recordBelongsToParty(l, party));
      const partyTrans = (allTransactions || []).filter((t: any) => recordBelongsToParty(t, party));
      
      const combined = [
          ...partyLedger.map((i: any) => ({...i, docType: 'invoice'})),
          ...partyTrans.map((t: any) => ({...t, docType: 'payment'})),
          ...miscCharges.map((c: any) => ({...c, docType: 'misc'})),
      ].sort((a, b) => {
          // Descending date; same-date records in reverse entry order (most recently added first).
          const dA = (a.date || '').slice(0, 10), dB = (b.date || '').slice(0, 10);
          if (dA !== dB) return dB < dA ? -1 : 1;
          const cA = a.created_at ? parseDateSafe(a.created_at).getTime() : 0;
          const cB = b.created_at ? parseDateSafe(b.created_at).getTime() : 0;
          return cB - cA;
      });

      return {
          timeline: combined,
          stats: calculateAccounting(partyLedger, partyTrans, party.role, {
              openingBalance: Number(party.opening_balance) || 0,
              openingBalanceType: (party.opening_balance_type as 'they_owe' | 'we_owe') || 'they_owe',
              miscCharges,
          }),
      };
  }, [allLedger, allTransactions, party.id, party.name, party.role, party.opening_balance, party.opening_balance_type, miscCharges]);

  const tabCounts = useMemo(() => ({
      all: timeline.length,
      orders: timeline.filter(t => t.docType === 'invoice').length,
      payments: timeline.filter(t => t.docType === 'payment').length,
  }), [timeline]);

  const paymentFilterOptions = useMemo(() => {
      const payments = timeline.filter(t => t.docType === 'payment');
      const purposes = [...new Set(payments.map(p => p.payment_purpose).filter(Boolean))] as string[];
      const bys = [...new Set(payments.map(p => (p.paid_by || p.paid_to || '')).filter(Boolean))] as string[];
      const modes = [...new Set(payments.map(p => p.payment_mode).filter(Boolean))] as string[];
      return { purposes, bys, modes };
  }, [timeline]);

  const filteredList = useMemo(() => {
      let data = timeline;
      if (activeTab === 'orders')   data = data.filter(t => t.docType === 'invoice');
      if (activeTab === 'payments') {
          data = data.filter(t => t.docType === 'payment');
          if (paymentPurposeFilter) data = data.filter(t => t.payment_purpose === paymentPurposeFilter);
          if (paymentByFilter)      data = data.filter(t => (t.paid_by || t.paid_to || '') === paymentByFilter);
          if (paymentModeFilter)    data = data.filter(t => t.payment_mode === paymentModeFilter);
      }
      if (activeTab === 'all')      { /* keep invoices + payments + misc */ }
      if (dateRange.start) data = data.filter(t => toDateString(t.date) >= dateRange.start);
      if (dateRange.end)   data = data.filter(t => toDateString(t.date) <= dateRange.end);
      return data;
  }, [timeline, activeTab, dateRange, paymentPurposeFilter, paymentByFilter, paymentModeFilter]);

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

  /**
   * Profit / Loss summary for the filtered period.
   *
   * Calculation strategy (order-level reference fields):
   *   • Sale invoice  → profit = total_amount − purchase_rate_ref   (our cost reference)
   *   • Purchase invoice → profit = sale_price_ref − total_amount   (our planned revenue)
   *   • Returns       → negate the same formula for the original type
   *   Orders without the reference field set are excluded from the tally but
   *   their count is tracked so the UI can show "X orders without cost data".
   */
  const profitLoss = useMemo(() => {
      let totalProfit = 0;
      let totalLoss   = 0;
      let ordersWithData    = 0;
      let ordersWithoutData = 0;

      filteredList.filter((t: any) => t.docType === 'invoice').forEach((inv: any) => {
          const total    = Number(inv.total_amount) || 0;
          const isReturn = inv.is_return || inv.type === 'sell_return' || inv.type === 'purchase_return';
          const isSell   = inv.type === 'sell' || inv.type === 'sell_return';
          const isBuy    = inv.type === 'purchase' || inv.type === 'purchase_return';

          let margin: number | null = null;

          if (isSell) {
              const costRef = Number(inv.purchase_rate_ref) || 0;
              if (costRef > 0) { margin = total - costRef; ordersWithData++; }
              else ordersWithoutData++;
          } else if (isBuy) {
              const revenueRef = Number(inv.sale_price_ref) || 0;
              if (revenueRef > 0) { margin = revenueRef - total; ordersWithData++; }
              else ordersWithoutData++;
          }

          if (margin !== null) {
              const signed = isReturn ? -margin : margin;
              if (signed >= 0) totalProfit += signed;
              else             totalLoss   += Math.abs(signed);
          }
      });

      return { totalProfit, totalLoss, ordersWithData, ordersWithoutData };
  }, [filteredList]);

  const handleExport = async (eo: ExportOptions) => {
      const hasData = filteredList.length > 0 || miscCharges.length > 0 || Number(party.opening_balance) > 0;
      if (!hasData) return showToast("No records to export", "error");

      const isCustomerParty = party.role === 'customer';

      // Build dynamic headers based on options
      const headers: string[] = ['Date', 'Type', 'Ref No', 'Item Name', 'Quantity', 'Rate', 'Item Total', 'Order Total'];
      if (eo.includeGst)              headers.push('GST %');
      if (eo.includeDiscount)         headers.push('Discount');
      if (eo.includePaymentMode)      headers.push('Payment Mode');
      if (eo.includeReceivedBy)       headers.push('Collected/Paid By');
      if (eo.includeTransport)        headers.push('Transport');
      if (eo.includeSellerInvoiceNo)  headers.push('Seller Invoice No');
      if (eo.includePurchaseRateRef && isCustomerParty) headers.push('Our Cost (Purchase Rate)');
      if (eo.includeSalePriceRef && !isCustomerParty)   headers.push('Sale Price (Market Rate)');
      if (eo.includeNotes)            headers.push('Notes');

      const rows: any[] = [];

      // ── Opening balance header row ────────────────────────────────────────
      const ob = Number(party.opening_balance) || 0;
      if (eo.includeOpeningBalance && ob > 0) {
          const obDateLabel = party.opening_balance_date
              ? new Date(party.opening_balance_date + 'T00:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })
              : '-';
          const obRow: any = {
              Date: obDateLabel,
              Type: `Opening Balance (${party.opening_balance_type === 'we_owe' ? 'We Owe' : 'They Owe'})`,
              'Ref No': '-', 'Item Name': '-', 'Quantity': '-', 'Rate': '-', 'Item Total': '-',
              'Order Total': ob,
          };
          if (eo.includeGst)             obRow['GST %'] = '-';
          if (eo.includeDiscount)        obRow['Discount'] = '-';
          if (eo.includePaymentMode)     obRow['Payment Mode'] = '-';
          if (eo.includeReceivedBy)      obRow['Collected/Paid By'] = '-';
          if (eo.includeTransport)       obRow['Transport'] = '-';
          if (eo.includeSellerInvoiceNo) obRow['Seller Invoice No'] = '-';
          if (eo.includePurchaseRateRef && isCustomerParty) obRow['Our Cost (Purchase Rate)'] = '-';
          if (eo.includeSalePriceRef && !isCustomerParty)   obRow['Sale Price (Market Rate)'] = '-';
          if (eo.includeNotes)           obRow['Notes'] = party.opening_balance_date ? `As of ${obDateLabel}` : 'Pre-existing balance';
          rows.push(obRow);
      }

      // ── Invoices, payments & misc charges ────────────────────────────────
      filteredList.forEach(t => {
          if (t.docType === 'misc' && !eo.includeMiscCharges) return;

          const isInv = t.docType === 'invoice';
          let typeLabel = '';
          if (isInv) typeLabel = t.type === 'sell' ? 'Sale Invoice' : 'Purchase Bill';
          else if (t.docType === 'misc') typeLabel = `Service (${t.direction === 'charge_to_party' ? 'To Party' : 'From Party'})`;
          else {
            const isRev = (party.role === 'customer' && t.type === 'paid') || (party.role === 'supplier' && t.type === 'received');
            if (isRev) {
              typeLabel = t.type === 'paid' ? 'Reverse Pmt (Paid to Customer)' : 'Reverse Pmt (Rec. from Supplier)';
            } else {
              typeLabel = t.type === 'received' ? 'Payment Received' : 'Payment Paid';
            }
          }

          const makeRow = (extra: any = {}): any => {
              const r: any = {
                  Date: t.date,
                  Type: typeLabel,
                  'Ref No': t.invoice_no || t.bill_no || t.transaction_id || '-',
                  'Order Total': t.total_amount || t.amount || 0,
                  ...extra,
              };
              if (eo.includeGst)             r['GST %'] = extra['GST %'] ?? '-';
              if (eo.includeDiscount)        r['Discount'] = Number(t.discount_amount) > 0 ? `₹${Number(t.discount_amount).toLocaleString('en-IN')}` : '-';
              if (eo.includePaymentMode)     r['Payment Mode'] = t.payment_mode || '-';
              if (eo.includeReceivedBy)      r['Collected/Paid By'] = t.received_by || '-';
              if (eo.includeTransport)       r['Transport'] = t.vehicle ? `${t.vehicle} (₹${t.vehicle_rent || 0})` : '-';
              if (eo.includeSellerInvoiceNo) r['Seller Invoice No'] = t.seller_invoice_no || '-';
              if (eo.includePurchaseRateRef && isCustomerParty) r['Our Cost (Purchase Rate)'] = Number(t.purchase_rate_ref) > 0 ? `₹${Number(t.purchase_rate_ref).toLocaleString('en-IN')}` : '-';
              if (eo.includeSalePriceRef && !isCustomerParty)   r['Sale Price (Market Rate)'] = Number(t.sale_price_ref) > 0 ? `₹${Number(t.sale_price_ref).toLocaleString('en-IN')}` : '-';
              if (eo.includeNotes)           r['Notes'] = t.notes || '';
              return r;
          };

          if (isInv && t.items && t.items.length > 0) {
              t.items.forEach((item: any) => {
                  rows.push(makeRow({
                      'Item Name': item.item_name,
                      'Quantity': item.quantity,
                      'Rate': item.rate,
                      'Item Total': item.total,
                      ...(eo.includeGst ? { 'GST %': item.gst_percent > 0 ? `${item.gst_percent}% (${item.price_type || 'excl'})` : '-' } : {}),
                  }));
              });
          } else if (t.docType === 'misc') {
              rows.push(makeRow({
                  'Item Name': t.category || t.service_name || '-',
                  'Quantity': t.quantity || '-',
                  'Rate': t.rate_per_unit || '-',
                  'Item Total': t.amount || 0,
              }));
          } else {
              rows.push(makeRow({
                  'Item Name': isInv ? '(No Items)' : '-',
                  'Quantity': '-', 'Rate': '-', 'Item Total': '-',
              }));
          }
      });

      // ── Summary footer ────────────────────────────────────────────────────
      rows.push(Object.fromEntries(headers.map(h => [h, ''])));
      const summaryRow: any = {
          Date: 'SUMMARY',
          Type: `Total Billed: ${stats.totalBilled}`,
          'Ref No': `Total Paid: ${stats.totalPaid}`,
          'Item Name': `Services Net: ${stats.miscNet}`,
          'Quantity': '', 'Rate': '', 'Item Total': '',
          'Order Total': `Balance: ${stats.balance}`,
      };
      headers.slice(8).forEach(h => { summaryRow[h] = ''; });
      rows.push(summaryRow);

      const fileName = `${party.name}_Detailed_Report_${dateRange.start || 'all'}_to_${dateRange.end || 'all'}.csv`;
      await exportService.exportToCSV(rows, headers, fileName);
      showToast("Detailed Report Downloaded", "success");
  };

  const handlePdfExport = async (eo: ExportOptions) => {
      const allFiltered = filteredList;
      const hasData = allFiltered.length > 0 || miscCharges.length > 0 || Number(party.opening_balance) > 0;
      if (!hasData) return showToast("No records to export", "error");

      try {
          const { jsPDF } = await import('jspdf');
          const autoTable = (await import('jspdf-autotable')).default;
          const { drawPartyLedgerSection, addPageNumbers } = await import('../../utils/pdfGenerator');

          const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

          await drawPartyLedgerSection(doc, autoTable, {
              party,
              filteredList: allFiltered,
              miscCharges,
              stats,
              dateRange,
              isFirstSection: true,
              exportOptions: eo,
          });

          addPageNumbers(doc);

          const filename = `${(party.name || 'Party').replace(/\s+/g, '_')}_Ledger_${new Date().toISOString().split('T')[0]}.pdf`;
          const pdfBlob = doc.output('blob');
          await exportService.sharePdfBlob(pdfBlob, filename);
          showToast("PDF ready to share", "success");
      } catch (err: any) {
          console.error('PDF generation error:', err);
          showToast('PDF failed: ' + (err?.message || String(err)), "error");
      }
  };

  const handleExportConfirm = async (eo: ExportOptions) => {
      if (!exportModal) return;
      setExportLoading(true);
      try {
          if (exportModal.format === 'pdf') {
              await handlePdfExport(eo);
          } else {
              await handleExport(eo);
          }
      } catch (err: any) {
          if (err?.name !== 'AbortError') {
              console.error('Export error:', err);
              showToast('Export failed: ' + (err?.message || String(err)), 'error');
          }
      } finally {
          setExportLoading(false);
          setExportModal(null);
      }
  };


  const toggleExpand = (id: string) => {
      setExpandedId(expandedId === id ? null : id);
  };

  const handleEditClick = (item: any, e: React.MouseEvent) => {
      e.stopPropagation();

      // Return records (sell_return / purchase_return) MUST be edited via
      // ReturnOrderModal — not the generic ManualEntryModal.
      // Opening a sell_return in ManualEntryModal sets editType='purchases',
      // which would save it as type:'purchase', flipping the balance direction
      // and causing a 2× balance error.
      if (item.is_return && item.return_of_id) {
          const originalOrder = (allLedger || []).find((l: any) => l.id === item.return_of_id);
          if (originalOrder) {
              setReturnModal({ order: originalOrder, existing: item });
              return;
          }
          // Original order not found — show a helpful message rather than
          // opening the wrong modal and corrupting the balance.
          showToast('Open the original order to edit this return record', 'info');
          return;
      }

      setEditingItem(item);
      if (item.docType === 'invoice') {
          setEditType(item.type === 'sell' ? 'sales' : 'purchases');
      } else {
          setEditType('transactions');
      }
      setShowEditModal(true);
  };

  const handleDeleteRecord = async (item: any, e: React.MouseEvent) => {
      e.stopPropagation();
      const ok = await requireEditPassword('delete');
      if (!ok) return;
      try {
          const col = item.docType === 'invoice' ? 'ledger_entries' : 'transactions';
          await ApiService.delete(user.uid, col, item.id);
          refreshData();
          showToast('Record deleted', 'success');
      } catch (_) {
          showToast('Failed to delete', 'error');
      }
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
                ? 'linear-gradient(90deg,#34d399,var(--col-success-15))'
                : 'linear-gradient(90deg,#fbbf24,rgba(251,191,36,0.1))'
            }}/>

            {/* Top Bar */}
            <div className="flex items-center gap-3 px-3 pt-3 pb-2">
                <button onClick={onBack} className="p-2 -ml-1 rounded-full active:scale-90 transition-all" style={{background:'var(--rgba-white-06)'}}><ArrowLeft size={18} style={{color: 'var(--text-secondary)'}}/></button>

                {/* Avatar — tap to see full party details */}
                <button
                  onClick={() => setShowPartyCard(true)}
                  className="w-11 h-11 rounded-[14px] flex items-center justify-center flex-shrink-0 font-black text-base active:scale-90 transition-all"
                  style={{
                    background: party.role === 'customer'
                      ? 'linear-gradient(135deg,var(--col-success-25),var(--col-emerald-15))'
                      : 'linear-gradient(135deg,rgba(251,191,36,0.22),var(--col-warning-15))',
                    border: `1.5px solid ${party.role === 'customer' ? 'var(--col-success-35)' : 'rgba(251,191,36,0.3)'}`,
                    color: party.role === 'customer' ? "var(--col-success)" : "var(--col-warning)",
                  }}>
                  {(party.name || '?').charAt(0).toUpperCase()}
                </button>

                {/* Name — also tappable */}
                <button onClick={() => setShowPartyCard(true)} className="flex-1 min-w-0 text-left active:opacity-70 transition-opacity">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="font-black text-base truncate leading-tight text-[var(--text-primary)]">{party.name}</h2>
                      <span className="text-app-2xs font-black px-1.5 py-0.5 rounded-md uppercase tracking-wide flex-shrink-0"
                        style={party.role === 'customer'
                          ? {background:'var(--col-success-12)',color:"var(--col-success)",border:'1px solid var(--col-success-25)'}
                          : {background:'rgba(251,191,36,0.1)',color:"var(--col-warning)",border:'1px solid rgba(251,191,36,0.2)'}}>
                        {party.role}
                      </span>
                      <Info size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    </div>
                    {party.contact && (
                      <p className="text-app-sm font-semibold mt-0.5" style={{color: 'var(--text-muted)'}}>{party.contact}</p>
                    )}
                </button>
                <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => setShowAIImport(true)}
                      className="p-2 rounded-xl active:scale-90 transition-all"
                      style={{background:'linear-gradient(135deg,var(--col-violet-25),var(--col-accent-15))',color:"var(--col-violet)",border:'1px solid var(--col-violet-35)'}}
                      title="AI Ledger Import"
                    >
                        <Sparkles size={16}/>
                    </button>
                    <button onClick={() => setExportModal({ open: true, format: 'pdf' })} className="p-2 rounded-xl active:scale-90 transition-all" style={{background:'var(--col-violet-12)',color:"var(--col-violet)",border:'1px solid var(--col-violet-25)'}} title="Download PDF Statement">
                        <Download size={16}/>
                    </button>
                    {party.contact && (
                      <a href={`tel:${party.contact}`} className="p-2 rounded-xl active:scale-90 transition-all" style={{background:'var(--col-emerald-15)',color:"var(--col-success)",border:'1px solid var(--col-emerald-18)'}}><Phone size={16}/></a>
                    )}
                    {party.contact && (
                      <a href={`https://wa.me/${normalisePhone(party.contact || '')}`} className="p-2 rounded-xl active:scale-90 transition-all" style={{background:'var(--col-emerald-15)',color:"var(--col-success)",border:'1px solid var(--col-emerald-18)'}}><MessageCircle size={16}/></a>
                    )}
                </div>
            </div>

            {/* Address bar */}
            {(party.address || party.site) && (
              <div className="px-4 pb-2 flex items-center gap-1.5">
                <MapPin size={11} style={{color: 'var(--text-muted)',flexShrink:0}}/>
                <span className="text-app-sm font-semibold truncate" style={{color: 'var(--text-muted)'}}>
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
                      style={{background:'var(--col-violet-15)',border:'1px solid var(--col-violet-25)'}}>
                      <Scale size={12} style={{color:"var(--col-violet)",flexShrink:0}}/>
                      <div className="min-w-0 flex-1">
                        <div className="text-app-2xs font-bold uppercase tracking-wide leading-none mb-0.5" style={{color:'rgba(167,139,250,0.55)'}}>
                          Opening · {party.opening_balance_type === 'we_owe' ? 'We Owe' : 'They Owe'}
                          {party.opening_balance_date ? ` · as of ${new Date(party.opening_balance_date + 'T00:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}` : ''}
                        </div>
                        <div className="text-xs font-black truncate leading-none" style={{color:"var(--col-violet)"}}>
                          ₹{Number(party.opening_balance).toLocaleString('en-IN')}
                        </div>
                      </div>
                    </div>
                  )}
                  {hasMisc && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-[12px] min-w-0"
                      style={{background:'rgba(251,146,60,0.1)',border:'1px solid rgba(251,146,60,0.2)'}}>
                      <Tag size={12} style={{color:"var(--col-orange-400)",flexShrink:0}}/>
                      <div className="min-w-0 flex-1">
                        <div className="text-app-2xs font-bold uppercase tracking-wide leading-none mb-0.5" style={{color:'rgba(251,146,60,0.55)'}}>
                          {miscCharges.length} Service{miscCharges.length !== 1 ? 's' : ''}
                        </div>
                        <div className="text-xs font-black truncate leading-none" style={{color:"var(--col-orange-400)"}}>
                          {stats.miscNet !== 0 ? `${stats.miscNet > 0 ? '+' : ''}₹${Math.abs(stats.miscNet).toLocaleString('en-IN')}` : '₹0'} <span className="text-app-2xs font-semibold opacity-60">net</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Stats Row */}
            <div className="grid grid-cols-3 mx-3 rounded-[16px] overflow-hidden" style={{background:'var(--rgba-white-04)',border:'1px solid var(--glass-border)'}}>
                <div className="p-2.5 text-center">
                    <div className="text-app-2xs font-bold uppercase tracking-wide mb-0.5" style={{color: 'var(--text-muted)'}}>Total Bill</div>
                    <div className="text-sm font-black text-[var(--text-secondary)]">₹{stats.totalBilled.toLocaleString('en-IN')}</div>
                </div>
                <div className="p-2.5 text-center" style={{borderLeft:'1px solid var(--glass-border)',borderRight:'1px solid var(--glass-border)'}}>
                    <div className="text-app-2xs font-bold uppercase tracking-wide mb-0.5" style={{color: 'var(--text-muted)'}}>Received</div>
                    <div className="text-sm font-black" style={{color:"var(--col-success)"}}>₹{stats.totalPaid.toLocaleString('en-IN')}</div>
                </div>
                <div className="p-2.5 text-center" style={{background: stats.balance > 0 ? 'var(--col-emerald-06)' : 'var(--col-danger-06)'}}>
                    <div className="text-app-2xs font-bold uppercase tracking-wide mb-0.5" style={{color: 'var(--text-muted)'}}>Balance</div>
                    <div className="text-sm font-black" style={{color: stats.balance > 0 ? "var(--col-success)" : "var(--col-danger)"}}>
                        ₹{Math.abs(stats.balance).toLocaleString('en-IN')} <span className="text-app-xs">{stats.balance > 0 ? 'Cr' : 'Dr'}</span>
                    </div>
                </div>
            </div>

            <div className="mb-2" style={{borderBottom:'1px solid var(--glass-border)'}}/>

            {/* Quick Action Buttons: Sale/Purchase | Misc | Payment */}
            <div className="flex gap-2 px-3 py-2.5">
              {party.role === 'customer' ? (
                <>
                  <button
                    onClick={() => { setNewModalType('sales'); setNewModalData({ party_name: party.name, paid_by: party.name, address: party.address || '' }); setShowNewModal(true); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-xs transition-all active:scale-95"
                    style={{ background: 'var(--col-success-12)', color: "var(--col-success)", border: '1px solid var(--col-success-22)' }}>
                    <ShoppingCart size={13}/> New Sale
                  </button>
                  <button
                    onClick={openAddMisc}
                    className="flex items-center justify-center gap-1 px-3 py-2.5 rounded-xl font-bold text-xs transition-all active:scale-95"
                    style={{ background: 'rgba(251,146,60,0.1)', color: "var(--col-orange-400)", border: '1px solid rgba(251,146,60,0.22)' }}
                    title="Add Service">
                    <Tag size={13}/> Service
                  </button>
                  <button
                    onClick={() => { setNewModalType('transactions'); setNewModalData({ type: 'received', paid_by: party.name, party_name: party.name }); setShowNewModal(true); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-xs transition-all active:scale-95"
                    style={{ background: 'var(--col-accent-12)', color: "var(--col-indigo-light)", border: '1px solid var(--col-accent-22)' }}>
                    <CreditCard size={13}/> Payment
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => { setNewModalType('purchases'); setNewModalData({ party_name: party.name, paid_to: party.name, address: party.address || '' }); setShowNewModal(true); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-xs transition-all active:scale-95"
                    style={{ background: 'rgba(251,191,36,0.1)', color: "var(--col-warning)", border: '1px solid rgba(251,191,36,0.2)' }}>
                    <Truck size={13}/> New Purchase
                  </button>
                  <button
                    onClick={openAddMisc}
                    className="flex items-center justify-center gap-1 px-3 py-2.5 rounded-xl font-bold text-xs transition-all active:scale-95"
                    style={{ background: 'rgba(251,146,60,0.1)', color: "var(--col-orange-400)", border: '1px solid rgba(251,146,60,0.22)' }}
                    title="Add Service">
                    <Tag size={13}/> Service
                  </button>
                  <button
                    onClick={() => { setNewModalType('transactions'); setNewModalData({ type: 'paid', paid_to: party.name, party_name: party.name }); setShowNewModal(true); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-xs transition-all active:scale-95"
                    style={{ background: 'var(--col-accent-12)', color: "var(--col-indigo-light)", border: '1px solid var(--col-accent-22)' }}>
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
                {([
                    { key: 'all',      label: 'All',      count: tabCounts.all },
                    { key: 'orders',   label: 'Orders',   count: tabCounts.orders },
                    { key: 'payments', label: 'Payments', count: tabCounts.payments },
                    { key: 'summary',  label: 'Summary',  count: null },
                ] as const).map(({ key, label, count }) => (
                    <button
                        key={key}
                        onClick={() => setActiveTab(key as any)}
                        className={`flex-1 py-2.5 text-app-sm font-bold uppercase tracking-wide border-b-2 transition-colors flex flex-col items-center gap-0.5 ${activeTab === key ? 'border-violet-500 text-violet-300' : 'border-transparent text-[var(--text-muted)]'}`}
                    >
                        <span>{label}</span>
                        {count !== null && (
                            <span className={`text-app-xs font-black px-1.5 py-0.5 rounded-full leading-none ${activeTab === key ? 'bg-violet-500/20 text-violet-300' : 'bg-white/06 text-[var(--text-muted)]'}`}>
                                {count}
                            </span>
                        )}
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
                    onClick={() => setExportModal({ open: true, format: 'csv' })}
                    className="w-8 h-8 flex items-center justify-center rounded-lg active:scale-95 transition-all flex-shrink-0 bg-[var(--col-violet-25)] text-violet-300 border border-[var(--col-violet-35)]"
                    title="Export CSV"
                >
                    <Download size={14}/>
                </button>
            </div>

            {/* Payment Filters — only visible in Payments tab */}
            {activeTab === 'payments' && (
                <div className="px-2 pb-2 space-y-1.5 border-t border-white/06 pt-1.5">
                    {/* Row: Purpose | Paid By | Mode */}
                    <div className="grid grid-cols-3 gap-1.5">
                        {/* Payment Purpose */}
                        <div className="relative">
                            <select
                                value={paymentPurposeFilter}
                                onChange={e => setPaymentPurposeFilter(e.target.value)}
                                className="w-full text-app-sm font-bold rounded-lg px-2 py-1.5 pr-5 appearance-none outline-none"
                                style={{
                                    background: paymentPurposeFilter ? 'var(--col-violet-15)' : 'var(--rgba-white-06)',
                                    border: '1px solid ' + (paymentPurposeFilter ? 'var(--col-violet-35)' :   'var(--rgba-white-10)'),
                                    color: paymentPurposeFilter ? "var(--col-violet)" : 'var(--text-muted)',
                                }}
                            >
                                <option value="">Purpose</option>
                                {paymentFilterOptions.purposes.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                            <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500" />
                        </div>
                        {/* Paid By / To */}
                        <div className="relative">
                            <select
                                value={paymentByFilter}
                                onChange={e => setPaymentByFilter(e.target.value)}
                                className="w-full text-app-sm font-bold rounded-lg px-2 py-1.5 pr-5 appearance-none outline-none"
                                style={{
                                    background: paymentByFilter ? 'var(--col-emerald-12)' : 'var(--rgba-white-06)',
                                    border: '1px solid ' + (paymentByFilter ? 'var(--col-emerald-35)' :   'var(--rgba-white-10)'),
                                    color: paymentByFilter ? "var(--col-success)" : 'var(--text-muted)',
                                }}
                            >
                                <option value="">Received/Paid By</option>
                                {paymentFilterOptions.bys.map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                            <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500" />
                        </div>
                        {/* Mode */}
                        <div className="relative">
                            <select
                                value={paymentModeFilter}
                                onChange={e => setPaymentModeFilter(e.target.value)}
                                className="w-full text-app-sm font-bold rounded-lg px-2 py-1.5 pr-5 appearance-none outline-none"
                                style={{
                                    background: paymentModeFilter ? 'var(--col-info-12)' : 'var(--rgba-white-06)',
                                    border: '1px solid ' + (paymentModeFilter ? 'var(--col-info-35)' :   'var(--rgba-white-10)'),
                                    color: paymentModeFilter ? "var(--col-info)" : 'var(--text-muted)',
                                }}
                            >
                                <option value="">Mode</option>
                                {paymentFilterOptions.modes.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                            <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500" />
                        </div>
                    </div>
                    {/* Clear filters */}
                    {(paymentPurposeFilter || paymentByFilter || paymentModeFilter) && (
                        <button
                            onClick={() => { setPaymentPurposeFilter(''); setPaymentByFilter(''); setPaymentModeFilter(''); }}
                            className="text-app-xs font-black text-red-400 flex items-center gap-1"
                        >
                            <X size={9}/> Clear filters
                        </button>
                    )}
                </div>
            )}
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
                        {/* ── Profit / Loss boxes (filter-aware) ── */}
                        <div className="grid grid-cols-2 gap-2">
                            <div className="p-3 rounded-xl border" style={{ background: 'var(--col-emerald-07)', borderColor: 'var(--col-emerald-25)' }}>
                                <div className="text-app-xs font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--col-success-60)' }}>Total Profit</div>
                                <div className="font-black text-base" style={{ color: "var(--col-success)" }}>
                                    ₹{Math.round(profitLoss.totalProfit).toLocaleString('en-IN')}
                                </div>
                                {profitLoss.ordersWithoutData > 0 && (
                                    <div className="text-app-2xs mt-0.5 font-semibold" style={{ color: 'var(--col-success-40)' }}>
                                        {profitLoss.ordersWithData} orders tracked
                                    </div>
                                )}
                            </div>
                            <div className="p-3 rounded-xl border" style={{ background: 'var(--col-danger-07)', borderColor: 'var(--col-danger-25)' }}>
                                <div className="text-app-xs font-bold uppercase tracking-wide mb-1" style={{ color: 'rgba(248,113,113,0.6)' }}>Total Loss</div>
                                <div className="font-black text-base" style={{ color: "var(--col-danger)" }}>
                                    ₹{Math.round(profitLoss.totalLoss).toLocaleString('en-IN')}
                                </div>
                                {profitLoss.ordersWithoutData > 0 && (
                                    <div className="text-app-2xs mt-0.5 font-semibold" style={{ color: 'rgba(248,113,113,0.4)' }}>
                                        {profitLoss.ordersWithoutData} orders missing ref.
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Net margin pill */}
                        {(profitLoss.ordersWithData > 0) && (() => {
                            const net = profitLoss.totalProfit - profitLoss.totalLoss;
                            const isPos = net >= 0;
                            return (
                                <div className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold"
                                    style={{ background: isPos ? 'var(--col-emerald-06)' : 'var(--col-danger-06)', border: `1px solid ${isPos ? 'var(--col-emerald-15)' : 'var(--col-danger-15)'}` }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Net Margin (tracked orders)</span>
                                    <span style={{ color: isPos ? "var(--col-success)" : "var(--col-danger)" }}>
                                        {isPos ? '+' : '-'}₹{Math.abs(Math.round(net)).toLocaleString('en-IN')}
                                    </span>
                                </div>
                            );
                        })()}

                        {/* Item totals header */}
                        <div className="p-3 rounded-xl border border-violet-500/20 bg-[var(--col-violet-08)]">
                            <div className="flex justify-between items-center">
                                <span className="text-app-sm font-bold uppercase text-slate-400">Total Items: {itemSummary.length}</span>
                                <span className="font-black text-sm text-violet-300">
                                    ₹{itemSummary.reduce((s, i) => s + i.amount, 0).toLocaleString('en-IN')}
                                </span>
                            </div>
                        </div>

                        <div className="flex justify-between text-app-xs font-bold uppercase text-slate-400 px-3">
                            <span className="flex-1">Item</span>
                            <span className="w-20 text-center">Qty</span>
                            <span className="w-24 text-right">Amount</span>
                        </div>

                        {itemSummary.map((it, idx) => (
                            <div key={idx} className="p-3 rounded-xl bg-[var(--rgba-white-05)] border border-white/08 flex justify-between items-center">
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-sm truncate">{it.name}</div>
                                </div>
                                <div className="w-20 text-center">
                                    <span className="text-xs font-bold text-slate-300">{Math.round(it.qty * 100) / 100}</span>
                                    <span className="text-app-sm text-slate-500 ml-1">{it.unit}</span>
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
                              <span className="font-bold text-sm text-[var(--text-primary)]">
                                {item.service_name || item.category || 'Service'}
                              </span>
                              {item.service_name && item.category && item.category !== item.service_name && (
                                <span className="text-app-xs font-semibold px-1.5 py-0.5 rounded-md" style={{background:'var(--rgba-white-06)',color: 'var(--text-muted)'}}>
                                  {item.category}
                                </span>
                              )}
                              <span className="text-app-xs font-black px-1.5 py-0.5 rounded-md uppercase"
                                style={isDebit
                                  ? {background:'var(--col-danger-12)',color:"var(--col-danger)",border:'1px solid var(--col-danger-25)'}
                                  : {background:'var(--col-success-15)',color:"var(--col-success)",border:'1px solid var(--col-success-25)'}}>
                                {isDebit ? 'We Charge' : 'They Charge'}
                              </span>
                            </div>
                            <div className="text-xs font-medium mt-0.5 flex items-center gap-2 flex-wrap" style={{color: 'var(--text-muted)'}}>
                              <span>{item.date}</span>
                              {item.quantity && item.rate_per_unit && (
                                <span className="font-semibold" style={{color:'rgba(168,85,247,0.7)'}}>
                                  {item.quantity} {item.unit || ''} × ₹{Number(item.rate_per_unit).toLocaleString('en-IN')}
                                </span>
                              )}
                              {item.notes && <span>· {item.notes}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <div className="text-right">
                            <div className={`font-black text-sm ${isDebit ? 'text-[var(--text-primary)]' : 'text-[var(--col-success-95)]'}`}>
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

                // Detect reverse/unusual payment direction
                const isReversePayment = !isInv && item.docType === 'payment' && (
                  (party.role === 'customer' && item.type === 'paid') ||
                  (party.role === 'supplier' && item.type === 'received')
                );
                
                return (
                    <div key={item.id} onClick={() => !alwaysExpanded && toggleExpand(item.id)}
                      className={`rounded-xl overflow-hidden border ${!alwaysExpanded ? 'active:scale-[0.99] transition-transform' : ''}`}
                      style={isReversePayment
                        ? { background: 'rgba(251,146,60,0.06)', borderColor: 'rgba(251,146,60,0.25)' }
                        : { background: 'var(--rgba-white-05)', borderColor: 'var(--rgba-white-08)' }
                      }>
                        <div className="p-3 flex justify-between items-start">
                            <div className="flex gap-3">
                                <div className={`p-2.5 rounded-xl flex items-center justify-center h-10 w-10 shrink-0 ${
                                  isInv
                                    ? 'text-blue-400 border border-blue-500/20'
                                    : isReversePayment
                                      ? 'border'
                                      : 'text-green-400 border border-green-500/20'
                                }`}
                                  style={isReversePayment ? { color: "var(--col-orange-400)", borderColor: 'rgba(251,146,60,0.3)', background: 'rgba(251,146,60,0.1)' } : {}}>
                                    {isInv ? <FileText size={18}/> : <Wallet size={18}/>}
                                </div>
                                <div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-bold text-sm"
                                          style={isReversePayment ? { color: "var(--col-orange-400)" } : {}}>
                                            {isInv
                                              ? item.type === 'sell' ? 'Sale Invoice'
                                              : item.type === 'purchase' ? 'Purchase Bill'
                                              : item.type === 'sell_return' ? '↩ Sale Return'
                                              : item.type === 'purchase_return' ? '↩ Purchase Return'
                                              : 'Invoice'
                                              : isReversePayment
                                                ? (item.type === 'paid' ? '↺ Paid to Party' : '↺ Rec. from Party')
                                                : (item.type === 'received' ? 'Payment Rec.' : 'Payment Paid')
                                            }
                                        </span>
                                        {isReversePayment && (
                                          <span className="text-app-xs font-black px-1.5 py-0.5 rounded-md uppercase tracking-wide"
                                            style={{ background: 'rgba(251,146,60,0.15)', color: "var(--col-orange-400)", border: '1px solid rgba(251,146,60,0.3)' }}>
                                            Reverse
                                          </span>
                                        )}
                                        {item.is_return && item.return_of_invoice && (
                                          <span className="text-app-xs font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--col-danger-12)', color: "var(--col-danger)" }}>
                                            Return of {item.return_of_invoice}
                                          </span>
                                        )}
                                        <span className="text-app-sm font-bold text-slate-400 px-1.5 py-0.5 rounded">
                                            #{item.invoice_no || item.bill_no || item.transaction_id?.slice(-8) || 'N/A'}
                                        </span>
                                    </div>
                                    <div className="text-xs font-medium mt-0.5 text-[var(--text-muted)]">
                                        {item.date}
                                        {isInv ? (
                                          <>
                                            &bull; {(item.items || []).length} item{(item.items || []).length !== 1 ? 's' : ''}
                                            {item.payment_mode ? ` · ${item.payment_mode}` : ''}
                                            {item.vehicle ? ` · 🚛 ${item.vehicle}` : ''}
                                          </>
                                        ) : (
                                          <>
                                            {item.payment_mode ? ` · ${item.payment_mode}` : ''}
                                            {item.payment_purpose ? ` · ${item.payment_purpose}` : ''}
                                            {item.received_by ? ` · ${item.received_by}` : ''}
                                          </>
                                        )}
                                    </div>
                                    {isInv && (item.items || []).length > 0 && (
                                        <div className="text-app-sm mt-0.5 truncate max-w-[180px]" style={{ color: 'var(--text-muted)' }}>
                                            {(item.items || []).slice(0, 2).map((it: any) => it.item_name).filter(Boolean).join(', ')}
                                            {(item.items || []).length > 2 ? ` +${(item.items || []).length - 2} more` : ''}
                                        </div>
                                    )}
                                    {!isInv && item.linked_invoice && (
                                        <div className="text-app-sm mt-0.5" style={{ color: 'var(--col-warning-50)' }}>
                                            Ref: {item.linked_invoice.split(' | ')[0] || item.linked_invoice}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="text-right flex items-start gap-2">
                                <div>
                                    <div className={`font-black text-sm`}
                                      style={isReversePayment
                                        ? { color: "var(--col-orange-400)" }
                                        : isInv
                                          ? { color: 'var(--text-primary)' }
                                          : { color: "var(--col-green-dark)" }
                                      }>
                                        {isInv ? '' : isReversePayment ? '+ ' : '- '}₹{(item.total_amount || item.amount || 0).toLocaleString('en-IN')}
                                    </div>
                                    {!alwaysExpanded && (
                                        <div className="mt-1 text-[var(--text-muted)]">
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
                                {(activeTab === 'orders' || activeTab === 'payments') && (
                                    <button
                                        onClick={(e) => handleDeleteRecord(item, e)}
                                        className="p-2 rounded-lg transition-colors text-red-400"
                                        style={{ background: 'var(--col-danger-08)', border: '1px solid var(--col-danger-18)' }}
                                        title="Delete"
                                    >
                                        <Trash2 size={14}/>
                                    </button>
                                )}
                            </div>
                        </div>

                        {isExpanded && (
                            <div className="p-3 border-t border-white/08 text-xs animate-in slide-in-from-top-2">
                                {isInv ? (
                                    <div className="space-y-1">
                                        {/* Items table */}
                                        <div className="flex justify-between text-slate-400 font-bold uppercase text-app-xs mb-1 px-0.5">
                                            <span className="flex-1">Item</span><span className="w-28 text-center">Qty × Rate</span><span className="w-16 text-right">Total</span>
                                        </div>
                                        {(item.items || []).map((it:any, idx:number) => (
                                            <div key={idx} className="rounded-lg px-2 py-1.5 mb-1 last:mb-0"
                                              style={{ background: 'var(--rgba-white-03)', border: '1px solid var(--glass-border)' }}>
                                                <div className="flex justify-between items-center">
                                                    <span className="font-bold flex-1 truncate text-[var(--text-secondary)]">{it.item_name}</span>
                                                    <span className="w-28 text-center text-app-sm" style={{color: "var(--text-muted)"}}>
                                                        {it.quantity} {it.unit ? `${it.unit}` : ''} × ₹{Number(it.rate).toLocaleString('en-IN')}
                                                    </span>
                                                    <span className="w-16 text-right font-bold">₹{Number(it.total || (Number(it.quantity)*Number(it.rate))).toLocaleString('en-IN')}</span>
                                                </div>
                                                {it.gst_percent > 0 && (
                                                    <div className="text-app-xs mt-0.5" style={{color:'var(--col-accent-60)'}}>
                                                        GST {it.gst_percent}% ({it.price_type || 'exclusive'})
                                                    </div>
                                                )}
                                            </div>
                                        ))}

                                        {/* Order-level details */}
                                        <div className="mt-2 pt-2 space-y-1" style={{ borderTop: '1px solid var(--glass-border)' }}>
                                            {item.payment_mode && <div className="flex gap-2 text-[var(--text-muted)]"><span className="font-bold">Payment:</span> {item.payment_mode}</div>}
                                            {item.address && <div className="flex gap-2 text-[var(--text-muted)]"><span className="font-bold">Address:</span> {item.address}</div>}
                                            {item.vehicle && <div className="flex gap-2 text-[var(--text-muted)]"><span className="font-bold">Transport:</span> {item.vehicle}{Number(item.vehicle_rent) > 0 ? ` · ₹${Number(item.vehicle_rent).toLocaleString('en-IN')}` : ''}</div>}
                                            {(item.handling_type || Number(item.handling_charges) > 0) && (
                                                <div className="flex gap-2 text-[var(--text-muted)]">
                                                    <span className="font-bold">Handling:</span>
                                                    {item.handling_type || ''}{Number(item.handling_charges) > 0 ? ` · ₹${Number(item.handling_charges).toLocaleString('en-IN')}` : ''}
                                                </div>
                                            )}
                                            {item.source_supplier && <div className="flex gap-2 text-[rgba(196,181,253,0.7)]"><span className="font-bold">Source Supplier:</span> {item.source_supplier}</div>}
                                            {item.delivery_customer && <div className="flex gap-2 text-[rgba(196,181,253,0.7)]"><span className="font-bold">Delivery Customer:</span> {item.delivery_customer}</div>}
                                            {item.site && <div className="flex gap-2 text-[rgba(103,232,249,0.65)]"><span className="font-bold">Site:</span> {item.site}</div>}
                                            {item.seller_invoice_no && <div className="flex gap-2 text-[rgba(251,191,36,0.65)]"><span className="font-bold">Seller Invoice:</span> #{item.seller_invoice_no}</div>}
                                            {Number(item.discount_amount) > 0 && <div className="flex gap-2 text-amber-400"><span className="font-bold">Discount:</span> -₹{Number(item.discount_amount).toLocaleString('en-IN')}</div>}
                                            {(Number(item.purchase_rate_ref) > 0 || Number(item.sale_price_ref) > 0) && (
                                                <div className="flex gap-2" style={{ color: 'var(--col-success-65)' }}>
                                                    <span className="font-bold">{item.type === 'sell' ? 'Cost Ref:' : 'Sale Price Ref:'}</span>
                                                    ₹{Number(item.purchase_rate_ref || item.sale_price_ref).toLocaleString('en-IN')}
                                                </div>
                                            )}
                                            {item.notes && <div className="flex gap-2 text-[var(--text-muted)]"><span className="font-bold">Notes:</span> <span className="italic">{item.notes}</span></div>}
                                        </div>

                                        {/* Return button */}
                                        {(item.type === 'sell' || item.type === 'purchase') && !item.is_return && (
                                          <div className="mt-2 pt-2" style={{ borderTop: '1px dashed var(--rgba-white-08)' }}>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setReturnModal({ order: item, existing: returnsByOrderId[item.id] });
                                              }}
                                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-app-sm font-black active:scale-95 transition-all"
                                              style={{ background: 'var(--col-danger-15)', color: "var(--col-danger)", border: '1px solid var(--col-danger-25)' }}
                                            >
                                              <RotateCcw size={11} />
                                              {returnsByOrderId[item.id] ? 'Edit Return Record' : 'Record Return'}
                                              {returnsByOrderId[item.id] && (
                                                <span className="ml-1 text-app-2xs opacity-60">
                                                  (₹{Math.round(Number(returnsByOrderId[item.id].total_amount || 0)).toLocaleString('en-IN')})
                                                </span>
                                              )}
                                            </button>
                                          </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-1">
                                        {item.payment_purpose && <div className="flex gap-2"><span className="font-bold text-[var(--text-muted)]">Purpose:</span> <span className="text-[rgba(196,181,253,0.8)]">{item.payment_purpose}</span></div>}
                                        {item.payment_mode && <div className="flex gap-2"><span className="font-bold text-[var(--text-muted)]">Mode:</span> <span className="text-[var(--text-muted)]">{item.payment_mode}</span></div>}
                                        {(item.paid_by || item.paid_to) && (
                                          <div className="flex gap-2">
                                            <span className="font-bold text-[var(--text-muted)]">
                                              {item.type === 'received' ? 'From (Their Side):' : 'To (Their Side):'}
                                            </span>
                                            <span className="text-[var(--col-success-85)]">{item.paid_by || item.paid_to}</span>
                                          </div>
                                        )}
                                        {item.received_by && (
                                          <div className="flex gap-2">
                                            <span className="font-bold text-[var(--text-muted)]">
                                              {item.type === 'received' ? 'Collected By (Our Side):' : 'Paid By (Our Side):'}
                                            </span>
                                            <span className="text-[var(--col-accent-85)]">{item.received_by}</span>
                                          </div>
                                        )}
                                        {item.notes && <div className="flex gap-2"><span className="font-bold text-[var(--text-muted)]">Note:</span> <span className="italic text-[var(--text-muted)]">{item.notes}</span></div>}
                                        {(item.linked_invoice || item.bill_no) && (
                                            <div className="flex gap-2">
                                                <span className="font-bold text-[var(--text-muted)]">Linked Invoice:</span>
                                                <span className="bg-[var(--col-warning-18)] text-amber-300 px-1 rounded text-app-sm">
                                                    {item.linked_invoice?.split(' | ')[0] || item.bill_no}
                                                </span>
                                            </div>
                                        )}
                                        {item.transaction_reference && <div className="flex gap-2"><span className="font-bold text-[var(--text-muted)]">Bank Ref:</span> <span className="font-mono text-[var(--col-accent-60)] text-app-sm">{item.transaction_reference}</span></div>}
                                        {item.transaction_id && <div className="flex gap-2 items-center"><span className="font-bold text-[var(--text-muted)]">Txn ID:</span> <span className="font-mono text-[var(--text-muted)] text-app-xs">{item.transaction_id}</span></div>}
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
          <div className="fixed inset-0 z-50 flex items-end justify-center" style={{background:'var(--rgba-black-65)',backdropFilter:'blur(6px)'}}>
            <div className="w-full max-w-md rounded-t-3xl p-5 pb-8 space-y-3.5 animate-in slide-in-from-bottom duration-300 overflow-y-auto max-h-[92vh]"
              style={{background:'var(--modal-sheet-bg)',border:'1px solid var(--glass-border)',borderBottom:'none'}}>

              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl" style={{background:'rgba(251,146,60,0.12)',border:'1px solid rgba(251,146,60,0.2)'}}>
                    <Tag size={15} style={{color:"var(--col-orange-400)"}}/>
                  </div>
                  <div>
                    <h3 className="font-black text-sm text-[var(--text-primary)]">
                      {editingMisc ? 'Edit Service' : 'Add Service'}
                    </h3>
                    <p className="text-app-sm font-semibold" style={{color: 'var(--text-muted)'}}>
                      {party.name}
                    </p>
                  </div>
                </div>
                <button onClick={() => setShowMiscModal(false)} className="p-2 rounded-full" style={{background:'var(--rgba-white-06)'}}>
                  <X size={16} style={{color: 'var(--text-muted)'}}/>
                </button>
              </div>

              {/* ── Service picker from master list ── */}
              {(servicesMaster || []).length > 0 && (
                <div>
                  <label className="block text-app-sm font-bold uppercase tracking-wide mb-1.5" style={{color: 'var(--text-muted)'}}>
                    Pick from Services List
                    {miscForm.service_name && <span className="ml-2 text-app-xs normal-case font-semibold" style={{color:"var(--col-purple)"}}>✓ {miscForm.service_name}</span>}
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      className="w-full rounded-xl p-2.5 pr-8 text-sm font-bold outline-none focus:ring-2 focus:ring-orange-500"
                      style={{background:'var(--rgba-white-06)',border:'1px solid var(--glass-border)',color: 'var(--text-primary)'}}
                      placeholder="Search services…"
                      value={serviceSearch}
                      onChange={e => setServiceSearch(e.target.value)}
                    />
                    {miscForm.service_name && (
                      <button className="absolute right-2 top-1/2 -translate-y-1/2"
                        onClick={() => { setServiceSearch(''); setMiscForm(f => ({...f, service_id:'', service_name:'', rate_per_unit:'', unit:'', quantity:'', amount:''})); }}>
                        <X size={13} style={{color: 'var(--text-muted)'}}/>
                      </button>
                    )}
                  </div>
                  {/* Dropdown matches */}
                  {serviceSearch && !miscForm.service_name && (() => {
                    const q = serviceSearch.toLowerCase();
                    const matches = (servicesMaster || []).filter(s =>
                      s.name.toLowerCase().includes(q) || (s.category||'').toLowerCase().includes(q)
                    ).slice(0, 5);
                    if (!matches.length) return null;
                    return (
                      <div className="mt-1.5 rounded-xl overflow-hidden" style={{border:'1px solid var(--glass-border)',background:'var(--dropdown-bg)'}}>
                        {matches.map(s => (
                          <button key={s.id} type="button"
                            className="w-full flex items-center justify-between px-3 py-2.5 text-left active:bg-white/5 transition-all"
                            style={{borderBottom:'1px solid var(--glass-border)'}}
                            onClick={() => {
                              setServiceSearch(s.name);
                              const autoAmount = miscForm.quantity ? String(Number(miscForm.quantity) * s.rate_per_unit) : '';
                              setMiscForm(f => ({
                                ...f,
                                service_id: s.id || '',
                                service_name: s.name,
                                category: f.category || s.name,
                                rate_per_unit: String(s.rate_per_unit),
                                unit: s.unit,
                                amount: autoAmount || f.amount,
                              }));
                            }}>
                            <div>
                              <div className="text-xs font-black text-[var(--text-primary)]">{s.name}</div>
                              {s.category && <div className="text-app-xs" style={{color: 'var(--text-muted)'}}>{s.category}</div>}
                            </div>
                            <div className="text-right flex-shrink-0 ml-3">
                              <div className="text-xs font-black" style={{color:"var(--col-purple)"}}>₹{Number(s.rate_per_unit).toLocaleString('en-IN')}</div>
                              <div className="text-app-xs" style={{color: 'var(--text-muted)'}}>per {s.unit}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Direction toggle */}
              <div>
                <label className="block text-app-sm font-bold uppercase tracking-wide mb-1.5" style={{color: 'var(--text-muted)'}}>Direction</label>
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl" style={{background:'var(--rgba-white-04)',border:'1px solid var(--glass-border)'}}>
                  {([
                    {val:'charge_to_party',   label:'We Charge Them', sub:'Adds to their balance'},
                    {val:'charge_from_party',  label:'They Charge Us',  sub:'Reduces their balance'},
                  ] as const).map(opt => (
                    <button key={opt.val} type="button"
                      onClick={() => setMiscForm(f => ({...f, direction: opt.val}))}
                      className="py-2 px-1 rounded-lg text-xs font-bold transition-all text-center"
                      style={miscForm.direction === opt.val
                        ? {background:'rgba(251,146,60,0.2)',color:"var(--col-orange-400)",border:'1px solid rgba(251,146,60,0.3)'}
                        : {color: 'var(--text-muted)'}}>
                      {opt.label}
                      <div className="text-app-xs font-normal opacity-60 mt-0.5">{opt.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Category / Purpose */}
              <div>
                <label className="block text-app-sm font-bold uppercase tracking-wide mb-1.5" style={{color: 'var(--text-muted)'}}>Category / Purpose</label>
                <input
                  type="text"
                  className="w-full rounded-xl p-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-orange-500"
                  style={{background:'var(--rgba-white-06)',border:'1px solid var(--glass-border)',color: 'var(--text-primary)'}}
                  placeholder="e.g. Transport, Labour, Commission…"
                  value={miscForm.category}
                  onChange={e => setMiscForm(f => ({...f, category: e.target.value}))}
                />
              </div>

              {/* Qty × Rate → auto-amount row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-app-sm font-bold uppercase tracking-wide mb-1" style={{color: 'var(--text-muted)'}}>
                    Qty {miscForm.unit ? `(${miscForm.unit})` : ''}
                  </label>
                  <input type="number" inputMode="decimal"
                    className="w-full rounded-xl p-2.5 text-sm font-black outline-none focus:ring-2 focus:ring-orange-500"
                    style={{background:'var(--rgba-white-06)',border:'1px solid var(--glass-border)',color: 'var(--text-primary)'}}
                    placeholder="0"
                    value={miscForm.quantity}
                    onChange={e => {
                      const qty = e.target.value;
                      const rate = Number(miscForm.rate_per_unit);
                      const autoAmt = qty && rate ? String(Number(qty) * rate) : miscForm.amount;
                      setMiscForm(f => ({...f, quantity: qty, amount: autoAmt}));
                    }}/>
                </div>
                <div>
                  <label className="block text-app-sm font-bold uppercase tracking-wide mb-1" style={{color: 'var(--text-muted)'}}>Rate / Unit (₹)</label>
                  <input type="number" inputMode="decimal"
                    className="w-full rounded-xl p-2.5 text-sm font-black outline-none focus:ring-2 focus:ring-orange-500"
                    style={{background:'var(--rgba-white-06)',border:'1px solid var(--glass-border)',color: 'var(--text-primary)'}}
                    placeholder="0"
                    value={miscForm.rate_per_unit}
                    onChange={e => {
                      const rate = e.target.value;
                      const qty = Number(miscForm.quantity);
                      const autoAmt = rate && qty ? String(Number(rate) * qty) : miscForm.amount;
                      setMiscForm(f => ({...f, rate_per_unit: rate, amount: autoAmt}));
                    }}/>
                </div>
              </div>

              {/* Amount + Date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-app-sm font-bold uppercase tracking-wide mb-1" style={{color: 'var(--text-muted)'}}>
                    Amount (₹)
                    {miscForm.quantity && miscForm.rate_per_unit && (
                      <span className="ml-1 text-app-xs normal-case font-semibold" style={{color:"var(--col-orange-400)"}}>auto-calc</span>
                    )}
                  </label>
                  <input type="number" inputMode="numeric"
                    className="w-full rounded-xl p-2.5 text-sm font-black outline-none focus:ring-2 focus:ring-orange-500"
                    style={{background:'var(--rgba-white-06)',border:'1px solid var(--glass-border)',color: 'var(--text-primary)'}}
                    placeholder="0"
                    value={miscForm.amount}
                    onChange={e => setMiscForm(f => ({...f, amount: e.target.value}))}/>
                </div>
                <div>
                  <label className="block text-app-sm font-bold uppercase tracking-wide mb-1" style={{color: 'var(--text-muted)'}}>Date</label>
                  <input type="date"
                    className="w-full rounded-xl p-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-orange-500"
                    style={{background:'var(--rgba-white-06)',border:'1px solid var(--glass-border)',color: 'var(--text-primary)'}}
                    value={miscForm.date}
                    onChange={e => setMiscForm(f => ({...f, date: e.target.value}))}/>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-app-sm font-bold uppercase tracking-wide mb-1" style={{color: 'var(--text-muted)'}}>Notes (Optional)</label>
                <input type="text"
                  className="w-full rounded-xl p-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-orange-500"
                  style={{background:'var(--rgba-white-06)',border:'1px solid var(--glass-border)',color: 'var(--text-primary)'}}
                  placeholder="e.g. Loading at Site A"
                  value={miscForm.notes}
                  onChange={e => setMiscForm(f => ({...f, notes: e.target.value}))}/>
              </div>

              {/* Save button */}
              <button
                onClick={handleSaveMisc}
                disabled={miscSaving}
                className="w-full py-3 rounded-xl font-black text-sm transition-all active:scale-98 disabled:opacity-60"
                style={{background:'linear-gradient(135deg,rgba(251,146,60,0.8),var(--col-warning-70))',color:'white',border:'1px solid rgba(251,146,60,0.4)'}}>
                {miscSaving ? 'Saving…' : editingMisc ? 'Update Charge' : 'Add Charge'}
              </button>
            </div>
          </div>
        )}

        {/* ── Party Detail Card ──────────────────────────────────────────── */}
        {showPartyCard && (
          <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setShowPartyCard(false)}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div
              className="relative w-full max-w-md rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300"
              style={{ background: 'var(--modal-bg)', border: '1px solid var(--glass-border)', borderBottom: 'none' }}
              onClick={e => e.stopPropagation()}
            >
              {/* Card header strip */}
              <div className="h-1 w-full" style={{
                background: party.role === 'customer'
                  ? 'linear-gradient(90deg,#34d399,var(--col-success-25))'
                  : 'linear-gradient(90deg,#fbbf24,rgba(251,191,36,0.2))'
              }} />

              <div className="flex items-center justify-between px-5 pt-4 pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-[16px] flex items-center justify-center font-black text-lg flex-shrink-0"
                    style={{
                      background: party.role === 'customer'
                        ? 'linear-gradient(135deg,var(--col-success-35),var(--col-emerald-15))'
                        : 'linear-gradient(135deg,rgba(251,191,36,0.28),var(--col-warning-12))',
                      border: `1.5px solid ${party.role === 'customer' ? 'var(--col-success-35)' : 'rgba(251,191,36,0.35)'}`,
                      color: party.role === 'customer' ? "var(--col-success)" : "var(--col-warning)",
                    }}>
                    {(party.name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-black text-base text-[var(--text-primary)]">{party.name}</h3>
                    <span className="text-app-xs font-black px-2 py-0.5 rounded-md uppercase tracking-wide"
                      style={party.role === 'customer'
                        ? {background:'var(--col-success-12)',color:"var(--col-success)"}
                        : {background:'rgba(251,191,36,0.1)',color:"var(--col-warning)"}}>
                      {party.role}
                    </span>
                  </div>
                </div>
                <button onClick={() => setShowPartyCard(false)} className="p-2 rounded-xl" style={{ background: 'var(--rgba-white-07)' }}>
                  <X size={16} style={{ color: 'var(--text-muted)' }} />
                </button>
              </div>

              <div className="px-5 pb-4 space-y-2.5 max-h-[60vh] overflow-y-auto">
                {[
                  { icon: <Phone size={12}/>, label: 'Contact', value: party.contact },
                  { icon: <MapPin size={12}/>, label: 'Address', value: party.address },
                  { icon: <Globe size={12}/>, label: 'Site', value: party.site ? `Site: ${party.site}` : null },
                  { icon: <Building2 size={12}/>, label: 'Legal Name', value: party.legal_name },
                  { icon: <Hash size={12}/>, label: 'GSTIN', value: party.gstin },
                  { icon: <Globe size={12}/>, label: 'State', value: party.state },
                  { icon: <Hash size={12}/>, label: 'Party Code', value: party.party_code },
                  { icon: <CreditCard size={12}/>, label: 'Credit Limit', value: party.credit_limit ? `₹${Number(party.credit_limit).toLocaleString('en-IN')}` : null },
                  { icon: <Scale size={12}/>, label: 'Opening Balance', value: Number(party.opening_balance) > 0
                    ? `₹${Number(party.opening_balance).toLocaleString('en-IN')} (${party.opening_balance_type === 'we_owe' ? 'We Owe' : 'They Owe'})`
                    : null },
                ].filter(r => r.value).map((row, i) => (
                  <div key={i} className="flex items-start gap-3 px-3 py-2 rounded-xl" style={{ background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)' }}>
                    <span className="mt-0.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{row.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-app-xs font-bold text-[var(--text-muted)] uppercase tracking-wide">{row.label}</p>
                      <p className="text-xs font-semibold text-[var(--text-primary)] mt-0.5">{row.value}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="px-5 py-4" style={{ borderTop: '1px solid var(--glass-border)' }}>
                <button
                  onClick={() => { setShowPartyCard(false); setShowEditPartyModal(true); }}
                  className="w-full py-3 rounded-2xl text-sm font-black flex items-center justify-center gap-2 active:scale-95 transition-all"
                  style={{ background: 'var(--col-violet-15)', color: "var(--col-violet)", border: '1px solid var(--col-violet-25)' }}
                >
                  <Edit2 size={15} /> Edit Party Details
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Party Modal (opened from party detail card) */}
        {showEditPartyModal && (
          <ManualEntryModal
            isOpen={showEditPartyModal}
            onClose={() => setShowEditPartyModal(false)}
            type="parties"
            user={user}
            initialData={party}
            appSettings={appSettings}
            onSuccess={() => {
              setShowEditPartyModal(false);
              showToast('Party updated', 'success');
            }}
          />
        )}

        {/* Return Order Modal */}
        {returnModal && (
          <ReturnOrderModal
            order={returnModal.order}
            existingReturn={returnModal.existing}
            user={user}
            party={party}
            onClose={() => setReturnModal(null)}
            onSuccess={() => { refetchLedger(); setReturnModal(null); }}
          />
        )}

        {/* AI Ledger Import Modal */}
        {showAIImport && (
          <AILedgerImportModal
            party={party}
            user={user}
            onClose={() => setShowAIImport(false)}
            onImportComplete={() => {
              setShowAIImport(false);
              refetchLedger();
              refetchTransactions();
              refetchMiscCharges();
            }}
          />
        )}

        {/* Export Options Modal */}
        <ExportOptionsModal
          isOpen={!!exportModal?.open}
          onClose={() => setExportModal(null)}
          onConfirm={handleExportConfirm}
          exportFormat={exportModal?.format ?? 'pdf'}
          partyRole={party.role === 'customer' ? 'customer' : party.role === 'supplier' ? 'supplier' : 'mixed'}
          isLoading={exportLoading}
        />
    </div>
  );
};

export default PartyDetailView;
