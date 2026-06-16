/**
 * TransactionDetailView — Beautiful receipt card for payment transactions
 * Receipt-style with money receipt / payment voucher design
 */

import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import {
  ArrowLeft, Edit2, Download, MessageCircle, Loader2,
  Calendar, Hash, Banknote, User, FileText, ArrowUpRight, ArrowDownLeft,
  CreditCard, CheckCircle2, Copy, Link2, Package, IndianRupee,
} from 'lucide-react';
import { exportService } from '../../services/export';
import { nativePdfService } from '../../services/nativePdfService';
import { amountInWords, fmtINR } from '../../utils/gstUtils';
import { useUI } from '../../context/UIContext';
import ExportFormatModal from '../common/ExportFormatModal';

interface TransactionDetailViewProps {
  transaction   : any;
  settings      : any;
  ledgerEntries?: any[];
  onBack        : () => void;
  onEdit        : (txn: any) => void;
}

const TransactionDetailView: React.FC<TransactionDetailViewProps> = ({
  transaction: txn, settings, ledgerEntries = [], onBack, onEdit,
}) => {
  const { showToast }   = useUI();
  const [loading, setLoading]           = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [copied, setCopied]             = useState(false);

  const isReceived   = txn.type === 'received';
  const amount       = Number(txn.amount) || 0;
  const accentColor  = isReceived ? '#34d399' : '#f87171';
  const accentBg     = isReceived ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.08)';
  const accentBorder = isReceived ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.22)';
  const typeLabel    = isReceived ? 'Money Receipt' : 'Payment Voucher';

  // Linked order — look up by bill_no across ledger entries
  const linkedOrder = txn.bill_no
    ? ledgerEntries.find((e: any) =>
        String(e.invoice_no || e.bill_no || '').trim() === String(txn.bill_no).trim()
      ) || null
    : null;

  const fmtDate = (d: any) => {
    try {
      const dt = d?.toDate ? d.toDate() : new Date(d || 0);
      return dt.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    } catch { return String(d || ''); }
  };

  const modeIcon = (mode: string) => {
    const m = (mode || '').toLowerCase();
    if (m.includes('upi') || m.includes('online')) return '📱';
    if (m.includes('bank') || m.includes('neft') || m.includes('rtgs')) return '🏦';
    if (m.includes('cheque') || m.includes('check')) return '📄';
    if (m.includes('card')) return '💳';
    return '💵'; // cash
  };

  // ── PDF ─────────────────────────────────────────────────────────────────
  const generatePDF = async () => {
    // Build sections for native PDF service
    const nativeData = nativePdfService.transactionToSections(txn, settings, {
      isReceived, amount, typeLabel,
    });

    // Generate jsPDF blob as fallback
    const { jsPDF } = await import('jspdf' as any);
    const doc   = new jsPDF();
    const PW    = doc.internal.pageSize.width;
    const margin= 16;
    const themeRgb: [number,number,number] = isReceived ? [5,150,105] : [220,38,38];
    const firmName = settings?.profile?.firm_name || 'Business';

    // Top colored bar
    doc.setFillColor(...themeRgb); doc.rect(0,0,PW,24,'F');
    doc.setFontSize(14); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
    doc.text(typeLabel.toUpperCase(), PW/2, 16, {align:'center'});

    // Receipt container
    doc.setFillColor(255,255,255); doc.setDrawColor(220);
    doc.roundedRect(margin, 30, PW-margin*2, 190, 3, 3, 'FD');

    // Firm header
    doc.setTextColor(30,40,60); doc.setFontSize(14); doc.setFont('helvetica','bold');
    doc.text(firmName, PW/2, 44, {align:'center'});
    doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(100);
    if (settings?.profile?.address) doc.text(settings.profile.address, PW/2, 50, {align:'center'});
    if (settings?.profile?.phone)   doc.text(`Ph: ${settings.profile.phone}`, PW/2, 56, {align:'center'});

    doc.setDrawColor(220); doc.line(margin+5, 61, PW-margin-5, 61);

    // Receipt # and Date
    doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(30,40,60);
    doc.text(`Receipt No: ${txn.prefixed_id || txn.id?.slice(-8) || 'N/A'}`, margin+5, 69);
    doc.text(`Date: ${txn.date}`, PW-margin-5, 69, {align:'right'});

    // Big amount box
    doc.setFillColor(themeRgb[0],themeRgb[1],themeRgb[2]);
    doc.roundedRect(margin+5, 74, PW-margin*2-10, 24, 2, 2, 'F');
    doc.setFontSize(18); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
    doc.text(`${fmtINR(amount, 'Rs.')}`, PW/2, 89, {align:'center'});

    // Party
    let y = 106;
    const label = (k:string, v:string) => {
      doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(100);
      doc.text(`${k}:`, margin+5, y);
      doc.setFont('helvetica','normal'); doc.setTextColor(30,40,60);
      doc.text(v, margin+40, y);
      y += 7;
    };
    label(isReceived ? 'Received From' : 'Paid To', txn.party_name || 'N/A');
    label('Payment Mode', txn.payment_mode || 'Cash');
    if (txn.payment_purpose) label('Purpose', txn.payment_purpose);
    if (txn.bill_no)          label('Bill Ref', txn.bill_no);
    if (txn.transaction_id)   label('Txn ID', txn.transaction_id);
    if (txn.notes)            label('Notes', txn.notes);

    // Amount in words
    y += 3;
    doc.setFillColor(248,250,252); doc.rect(margin+5, y, PW-margin*2-10, 12, 'F');
    doc.setFontSize(7); doc.setFont('helvetica','bold'); doc.setTextColor(100);
    doc.text('Amount in Words:', margin+8, y+5);
    doc.setFont('helvetica','italic'); doc.setTextColor(60);
    doc.text(amountInWords(amount), margin+38, y+5, {maxWidth: PW-margin*2-42});

    // Footer
    y += 20;
    doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(160);
    doc.text('Authorised Signatory', PW-margin-5, y, {align:'right'});
    doc.line(PW-margin-45, y-6, PW-margin-5, y-6);

    const fallbackBlob = doc.output('blob');
    const success = await nativePdfService.generateAndShare(nativeData, fallbackBlob);
    if (success) {
      showToast('PDF shared successfully!', 'success');
    } else {
      showToast('Failed to share PDF', 'error');
    }
  };

  // ── Excel/CSV ─────────────────────────────────────────────────────────────
  const generateExcel = async () => {
    const rows = [
      [settings?.profile?.firm_name || 'Business'],
      [typeLabel],
      [],
      ['Date', txn.date],
      ['Receipt No', txn.prefixed_id || txn.id?.slice(-8) || '-'],
      [isReceived?'Received From':'Paid To', txn.party_name||'-'],
      ['Amount', amount.toFixed(2)],
      ['Payment Mode', txn.payment_mode||'Cash'],
      ['Purpose', txn.payment_purpose||'-'],
      ['Bill Ref', txn.bill_no||'-'],
      ['Txn ID', txn.transaction_id||'-'],
      ['Notes', txn.notes||'-'],
      [],
      ['Amount in Words', amountInWords(amount)],
    ];
    const csv = rows.map(r => r.map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const csvBlob = new Blob([csv], { type: 'text/csv' });
    await exportService.sharePdfBlob(csvBlob, `Transaction_${txn.date}.csv`);
    showToast('Excel/CSV exported!', 'success');
  };

  const handleExport = async (format: 'pdf' | 'excel') => {
    setLoading(true); setShowExportModal(false);
    try { format === 'pdf' ? await generatePDF() : await generateExcel(); }
    catch (e: any) { console.error('Export error:', e); showToast('Export failed: ' + (e?.message || 'Unknown error'), 'error'); }
    finally { setLoading(false); }
  };

  const handleWhatsApp = async () => {
    const msg =
`*${typeLabel}*
*${settings?.profile?.firm_name || 'Business'}*
Date: ${txn.date}
${isReceived ? 'From' : 'To'}: ${txn.party_name}
Amount: *₹${Math.round(amount).toLocaleString('en-IN')}*
Mode: ${txn.payment_mode || 'Cash'}
${txn.payment_purpose ? `Purpose: ${txn.payment_purpose}` : ''}
${txn.notes ? `Note: ${txn.notes}` : ''}`;
    if (Capacitor.isNativePlatform()) {
      try { await Share.share({ text: msg }); } catch (_) {}
    } else {
      window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
    }
  };

  const copyTxnId = () => {
    if (txn.transaction_id) {
      navigator.clipboard.writeText(txn.transaction_id);
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="h-full overflow-y-auto" style={{ background: 'var(--app-bg)' }}>
      {showExportModal && (
        <ExportFormatModal onSelect={handleExport} onClose={() => setShowExportModal(false)} />
      )}

      {/* Header */}
      <div className="sticky top-0 z-30 px-4 pb-3"
        style={{paddingTop: '16px',  background: 'rgba(var(--app-bg-rgb),0.93)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center justify-between">
          <button onClick={onBack}
            className="p-2 rounded-2xl active:scale-95 transition-all"
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(148,163,184,0.7)' }}>
            <ArrowLeft size={18} />
          </button>
          <div className="text-center">
            <p className="text-[10px] font-black uppercase tracking-[0.15em]"
              style={{ color: accentColor }}>{typeLabel}</p>
            <p className="text-sm font-black text-white">
              {txn.prefixed_id || `#${txn.id?.slice(-6)}`}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowExportModal(true)} disabled={loading}
              className="p-2 rounded-2xl active:scale-95 transition-all"
              style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.25)', color: '#60a5fa' }}>
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
            </button>
            <button onClick={() => onEdit(txn)}
              className="p-2 rounded-2xl active:scale-95 transition-all"
              style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.25)', color: '#a78bfa' }}>
              <Edit2 size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 pt-3 pb-32 space-y-3">

        {/* Hero card */}
        <div className="rounded-[24px] overflow-hidden relative"
          style={{ background: accentBg, border: `1px solid ${accentBorder}` }}>
          <div className="h-1.5" style={{ background: `linear-gradient(90deg,${accentColor},transparent)` }} />
          <div className="p-5 space-y-4">

            {/* Type badge */}
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-[14px]" style={{ background: accentBg, border: `1px solid ${accentBorder}` }}>
                {isReceived ? <ArrowUpRight size={16} style={{ color: accentColor }} />
                            : <ArrowDownLeft size={16} style={{ color: accentColor }} />}
              </div>
              <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: accentColor }}>
                {typeLabel}
              </span>
              <span className="ml-auto text-[9px] font-bold px-2.5 py-1 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(148,163,184,0.5)' }}>
                {txn.date}
              </span>
            </div>

            {/* Big amount */}
            <div className="text-center py-3">
              <p className="text-[42px] font-black tabular-nums leading-none" style={{ color: accentColor, letterSpacing: '-0.03em' }}>
                <span style={{ fontSize: '50%', opacity: 0.5 }}>₹</span>
                {Math.round(amount).toLocaleString('en-IN')}
              </p>
              <p className="text-[10px] mt-1.5 italic" style={{ color: 'rgba(148,163,184,0.45)' }}>
                {amountInWords(amount)}
              </p>
            </div>

            {/* Party */}
            <div className="rounded-[16px] p-3.5"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-[12px]" style={{ background: 'rgba(255,255,255,0.07)' }}>
                  <User size={14} style={{ color: 'rgba(148,163,184,0.6)' }} />
                </div>
                <div>
                  <p className="text-[8px] font-black uppercase tracking-wider mb-0.5"
                    style={{ color: 'rgba(148,163,184,0.35)' }}>
                    {isReceived ? 'Received From' : 'Paid To'}
                  </p>
                  <p className="font-black text-white text-sm">{txn.party_name || 'Unknown'}</p>
                </div>
              </div>
            </div>

            {/* Payment mode chip */}
            <div className="flex items-center gap-2">
              <span className="text-lg">{modeIcon(txn.payment_mode)}</span>
              <span className="text-sm font-black" style={{ color: '#fbbf24' }}>
                {txn.payment_mode || 'Cash'}
              </span>
              {txn.payment_purpose && (
                <span className="text-[10px] px-2.5 py-1 rounded-xl ml-auto"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(148,163,184,0.6)' }}>
                  {txn.payment_purpose}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Connected Order */}
        {linkedOrder && (
          <div className="rounded-[20px] overflow-hidden"
            style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.22)' }}>
            <div className="px-4 pt-3.5 pb-1 flex items-center gap-2">
              <Link2 size={11} style={{ color: '#818cf8' }} />
              <p className="text-[9px] font-black uppercase tracking-wider" style={{ color: '#818cf8' }}>
                Connected {linkedOrder.type === 'sell' ? 'Sale' : 'Purchase'} Order
              </p>
            </div>
            <div className="px-4 pb-4 space-y-2 mt-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-black text-white">
                  {linkedOrder.party_name || '—'}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg"
                  style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' }}>
                  #{linkedOrder.invoice_no || linkedOrder.bill_no || '—'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-1">
                <div className="rounded-[10px] p-2 text-center"
                  style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <p className="text-[8px] font-bold uppercase mb-0.5" style={{ color: 'rgba(148,163,184,0.4)' }}>Total</p>
                  <p className="text-[11px] font-black tabular-nums" style={{ color: '#e2e8f0' }}>
                    {fmtINR(Number(linkedOrder.total_amount) || 0)}
                  </p>
                </div>
                <div className="rounded-[10px] p-2 text-center"
                  style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <p className="text-[8px] font-bold uppercase mb-0.5" style={{ color: 'rgba(148,163,184,0.4)' }}>Date</p>
                  <p className="text-[10px] font-bold" style={{ color: '#94a3b8' }}>
                    {String(linkedOrder.date || '—').substring(0, 10)}
                  </p>
                </div>
                <div className="rounded-[10px] p-2 text-center"
                  style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <p className="text-[8px] font-bold uppercase mb-0.5" style={{ color: 'rgba(148,163,184,0.4)' }}>Items</p>
                  <p className="text-[11px] font-black" style={{ color: '#e2e8f0' }}>
                    {(linkedOrder.items || []).length}
                  </p>
                </div>
              </div>
              {(linkedOrder.items || []).length > 0 && (
                <div className="space-y-1 mt-0.5">
                  {(linkedOrder.items || []).slice(0, 3).map((item: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between text-[10px]">
                      <span style={{ color: 'rgba(148,163,184,0.7)' }}>
                        {item.item_name} <span style={{ color: 'rgba(148,163,184,0.4)' }}>×{item.quantity} {item.unit || ''}</span>
                      </span>
                      <span className="font-bold tabular-nums" style={{ color: 'rgba(203,213,225,0.8)' }}>
                        {fmtINR(Number(item.quantity) * Number(item.rate))}
                      </span>
                    </div>
                  ))}
                  {(linkedOrder.items || []).length > 3 && (
                    <p className="text-[9px]" style={{ color: 'rgba(148,163,184,0.35)' }}>
                      +{(linkedOrder.items || []).length - 3} more items
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Details */}
        <div className="rounded-[20px] p-4 space-y-3"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}>
          {[
            { icon: Hash,     label: 'Bill Reference',  value: txn.bill_no,         show: !!txn.bill_no },
            { icon: CreditCard,label:'Transaction ID',  value: txn.transaction_id,  show: !!txn.transaction_id, copyable: true },
            { icon: FileText, label: 'Notes',           value: txn.notes,           show: !!txn.notes },
          ].filter(r => r.show).map(({ icon: Icon, label, value, copyable }, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="p-1.5 rounded-xl flex-shrink-0" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <Icon size={11} style={{ color: 'rgba(148,163,184,0.5)' }} />
              </div>
              <p className="text-[9px] font-bold uppercase tracking-wider w-24 flex-shrink-0"
                style={{ color: 'rgba(148,163,184,0.35)' }}>{label}</p>
              <div className="flex items-center gap-1.5 flex-1 justify-end">
                <p className="text-[11px] font-bold" style={{ color: 'rgba(203,213,225,0.8)' }}>{value}</p>
                {copyable && (
                  <button onClick={copyTxnId} className="active:scale-90 transition-all">
                    {copied ? <CheckCircle2 size={12} style={{ color: '#34d399' }} />
                            : <Copy size={12} style={{ color: 'rgba(148,163,184,0.4)' }} />}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => setShowExportModal(true)} disabled={loading}
            className="flex items-center justify-center gap-2 py-3.5 rounded-[18px] font-black text-sm active:scale-95 transition-all"
            style={{ background: 'rgba(59,130,246,0.14)', border: '1px solid rgba(59,130,246,0.25)', color: '#60a5fa' }}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            Export
          </button>
          <button onClick={handleWhatsApp}
            className="flex items-center justify-center gap-2 py-3.5 rounded-[18px] font-black text-sm active:scale-95 transition-all"
            style={{ background: 'rgba(37,211,102,0.12)', border: '1px solid rgba(37,211,102,0.25)', color: '#25d366' }}>
            <MessageCircle size={15} /> WhatsApp
          </button>
          <button onClick={() => onEdit(txn)}
            className="col-span-2 flex items-center justify-center gap-2 py-3.5 rounded-[18px] font-black text-sm active:scale-95 transition-all"
            style={{ background: 'rgba(139,92,246,0.14)', border: '1px solid rgba(139,92,246,0.25)', color: '#a78bfa' }}>
            <Edit2 size={15} /> Edit Transaction
          </button>
        </div>
      </div>
    </div>
  );
};

export default TransactionDetailView;






