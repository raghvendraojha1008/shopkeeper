/**
 * ExpenseDetailView — Receipt-style card for expense entries
 */

import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import {
  ArrowLeft, Edit2, Download, MessageCircle, Loader2,
  Calendar, Tag, User, FileText, Wallet, Hash,
} from 'lucide-react';
import { exportService } from '../../services/export';
import { nativePdfService } from '../../services/nativePdfService';
import { amountInWords, fmtINR } from '../../utils/gstUtils';
import { useUI } from '../../context/UIContext';
import ExportFormatModal from '../common/ExportFormatModal';

interface ExpenseDetailViewProps {
  expense  : any;
  settings : any;
  onBack   : () => void;
  onEdit   : (expense: any) => void;
}

const CAT_ICONS: Record<string,string> = {
  fuel: '⛽', salary: '👔', utilities: '💡', rent: '🏠',
  repair: '🔧', food: '🍽️', transport: '🚗', marketing: '📢',
  office: '🏢', other: '📦',
};

const CAT_COLORS: Record<string, [string, string, string]> = {
  fuel      : ['rgba(245,158,11,0.12)', '#fbbf24', 'rgba(245,158,11,0.25)'],
  salary    : ['rgba(99,102,241,0.12)', '#818cf8', 'rgba(99,102,241,0.25)'],
  utilities : ['rgba(59,130,246,0.12)', '#60a5fa', 'rgba(59,130,246,0.25)'],
  rent      : ['rgba(16,185,129,0.12)', '#34d399', 'rgba(16,185,129,0.25)'],
  repair    : ['rgba(239,68,68,0.1)',   '#f87171', 'rgba(239,68,68,0.22)'],
  food      : ['rgba(245,158,11,0.1)',  '#fbbf24', 'rgba(245,158,11,0.2)'],
  transport : ['rgba(139,92,246,0.1)',  '#a78bfa', 'rgba(139,92,246,0.2)'],
  default   : ['rgba(100,116,139,0.1)','#94a3b8', 'rgba(100,116,139,0.2)'],
};

const ExpenseDetailView: React.FC<ExpenseDetailViewProps> = ({
  expense, settings, onBack, onEdit,
}) => {
  const { showToast }   = useUI();
  const [loading, setLoading]           = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

  const cat    = (expense.category || 'other').toLowerCase();
  const icon   = CAT_ICONS[cat] || '📦';
  const amount = Number(expense.amount) || 0;
  const [accentBg, accentColor, accentBorder] = CAT_COLORS[cat] || CAT_COLORS.default;

  const fmtDate = (d: any) => {
    try {
      const dt = d?.toDate ? d.toDate() : new Date(d || 0);
      return dt.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    } catch { return String(d || ''); }
  };

  // ── PDF ─────────────────────────────────────────────────────────────────
  const generatePDF = async () => {
    // Build sections for native PDF service
    const nativeData = nativePdfService.expenseToSections(expense, settings, { amount });

    // Generate jsPDF blob as fallback
    const { jsPDF } = await import('jspdf' as any);
    const doc = new jsPDF();
    const PW  = doc.internal.pageSize.width;
    const m   = 16;

    doc.setFillColor(30,40,80); doc.rect(0,0,PW,22,'F');
    doc.setFontSize(14); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
    doc.text('EXPENSE VOUCHER', PW/2, 15, {align:'center'});

    doc.setFillColor(255,255,255); doc.setDrawColor(220);
    doc.roundedRect(m, 28, PW-m*2, 160, 3, 3, 'FD');

    const firmName = settings?.profile?.firm_name || 'Business';
    doc.setTextColor(30,40,60); doc.setFontSize(13); doc.setFont('helvetica','bold');
    doc.text(firmName, PW/2, 42, {align:'center'});
    doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(100);
    if (settings?.profile?.address) doc.text(settings.profile.address, PW/2, 49, {align:'center'});

    doc.setDrawColor(220); doc.line(m+5, 55, PW-m-5, 55);

    doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(30,40,60);
    doc.text(`Date: ${expense.date}`, m+5, 63);
    doc.text(`Voucher: ${expense.prefixed_id||expense.id?.slice(-6)||'N/A'}`, PW-m-5, 63, {align:'right'});

    // Amount box
    doc.setFillColor(239,68,68); doc.roundedRect(m+5, 68, PW-m*2-10, 22, 2,2,'F');
    doc.setFontSize(18); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
    doc.text(fmtINR(amount, 'Rs.'), PW/2, 82, {align:'center'});

    let y = 100;
    const row = (k:string, v:string) => {
      doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(100);
      doc.text(`${k}:`, m+5, y);
      doc.setFont('helvetica','normal'); doc.setTextColor(30,40,60);
      doc.text(v, m+45, y);
      y += 7;
    };
    row('Category', expense.category||'-');
    row('Description', expense.description||'-');
    if (expense.paid_by) row('Paid By', expense.paid_by);
    if (expense.payment_mode) row('Payment Mode', expense.payment_mode);
    if (expense.notes) row('Notes', expense.notes);

    y += 3;
    doc.setFillColor(248,250,252); doc.rect(m+5, y, PW-m*2-10, 12, 'F');
    doc.setFontSize(7); doc.setFont('helvetica','italic'); doc.setTextColor(80);
    doc.text(amountInWords(amount), m+8, y+7, {maxWidth: PW-m*2-14});

    const fallbackBlob = doc.output('blob');
    const success = await nativePdfService.generateAndShare(nativeData, fallbackBlob);
    if (success) {
      showToast('PDF shared successfully!', 'success');
    } else {
      console.error('PDF share failed'); showToast('Failed to share PDF', 'error');
    }
  };

  // ── Excel ─────────────────────────────────────────────────────────────────
  const generateExcel = async () => {
    const rows = [
      [settings?.profile?.firm_name||'Business'],
      ['EXPENSE VOUCHER'],
      [],
      ['Date', expense.date],
      ['Voucher No', expense.prefixed_id||expense.id?.slice(-6)||'-'],
      ['Category', expense.category||'-'],
      ['Description', expense.description||'-'],
      ['Amount', amount.toFixed(2)],
      ['Paid By', expense.paid_by||'-'],
      ['Payment Mode', expense.payment_mode||'Cash'],
      ['Notes', expense.notes||'-'],
      [],
      ['Amount in Words', amountInWords(amount)],
    ];
    const csv = rows.map(r=>r.map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const csvBlob = new Blob([csv], { type: 'text/csv' });
    await exportService.sharePdfBlob(csvBlob, `Expense_${expense.category}_${expense.date}.csv`);
    showToast('Excel/CSV exported!', 'success');
  };

  const handleExport = async (format: 'pdf' | 'excel') => {
    setLoading(true); setShowExportModal(false);
    try { format === 'pdf' ? await generatePDF() : await generateExcel(); }
    catch { showToast('Export failed', 'error'); }
    finally { setLoading(false); }
  };

  const handleWhatsApp = async () => {
    const msg =
`*Expense Voucher*
*${settings?.profile?.firm_name||'Business'}*
Date: ${expense.date}
Category: ${expense.category}
Description: ${expense.description||'-'}
*Amount: ₹${Math.round(amount).toLocaleString('en-IN')}*
${expense.paid_by ? `Paid by: ${expense.paid_by}` : ''}
${expense.notes ? `Note: ${expense.notes}` : ''}`;
    if (Capacitor.isNativePlatform()) {
      // Android WebView blocks window.open for external URLs
      // Use Share plugin which routes through the OS share sheet
      try { await Share.share({ text: msg }); } catch (_) {}
    } else {
      window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
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
              style={{ color: accentColor }}>Expense Voucher</p>
            <p className="text-sm font-black text-white">{expense.category || 'Expense'}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowExportModal(true)} disabled={loading}
              className="p-2 rounded-2xl active:scale-95 transition-all"
              style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.25)', color: '#60a5fa' }}>
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
            </button>
            <button onClick={() => onEdit(expense)}
              className="p-2 rounded-2xl active:scale-95 transition-all"
              style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.25)', color: '#a78bfa' }}>
              <Edit2 size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 pt-3 pb-32 space-y-3">

        {/* Hero */}
        <div className="rounded-[24px] overflow-hidden relative"
          style={{ background: accentBg, border: `1px solid ${accentBorder}` }}>
          <div className="h-1.5" style={{ background: `linear-gradient(90deg,${accentColor},transparent)` }} />
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-[18px] flex items-center justify-center text-3xl flex-shrink-0"
                style={{ background: accentBg, border: `1px solid ${accentBorder}` }}>
                {icon}
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-wider mb-1"
                  style={{ color: 'rgba(148,163,184,0.4)' }}>Expense Category</p>
                <p className="text-lg font-black" style={{ color: accentColor }}>{expense.category || 'Other'}</p>
                <p className="text-[11px]" style={{ color: 'rgba(148,163,184,0.55)' }}>
                  {expense.description || 'No description'}
                </p>
              </div>
            </div>

            <div className="text-center py-2">
              <p className="text-[9px] font-black uppercase tracking-[0.2em] mb-1" style={{ color: 'rgba(148,163,184,0.4)' }}>Amount</p>
              <p className="text-[38px] font-black tabular-nums leading-none"
                style={{ color: accentColor, letterSpacing: '-0.03em' }}>
                <span style={{ fontSize: '50%', opacity: 0.5 }}>₹</span>
                {Math.round(amount).toLocaleString('en-IN')}
              </p>
              <p className="text-[9px] mt-1.5 italic" style={{ color: 'rgba(148,163,184,0.4)' }}>
                {amountInWords(amount)}
              </p>
            </div>

            <div className="flex items-center justify-between text-[10px] px-2">
              <div className="flex items-center gap-1.5" style={{ color: 'rgba(148,163,184,0.55)' }}>
                <Calendar size={11} />
                <span className="font-bold">{fmtDate(expense.date)}</span>
              </div>
              {expense.paid_by && (
                <div className="flex items-center gap-1.5" style={{ color: 'rgba(148,163,184,0.55)' }}>
                  <User size={11} />
                  <span>{expense.paid_by}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="rounded-[20px] p-4 space-y-3"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}>
          {[
            { icon: Hash,     label: 'Voucher No',    value: expense.prefixed_id || expense.id?.slice(-8) || '-' },
            { icon: Wallet,   label: 'Payment Mode',  value: expense.payment_mode || 'Cash' },
            { icon: User,     label: 'Paid By',       value: expense.paid_by, show: !!expense.paid_by },
            { icon: FileText, label: 'Notes',         value: expense.notes, show: !!expense.notes },
          ].filter(r => r.show !== false).map(({ icon: Icon, label, value }, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="p-1.5 rounded-xl flex-shrink-0" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <Icon size={11} style={{ color: 'rgba(148,163,184,0.5)' }} />
              </div>
              <p className="text-[9px] font-bold uppercase tracking-wider w-24 flex-shrink-0"
                style={{ color: 'rgba(148,163,184,0.35)' }}>{label}</p>
              <p className="text-[11px] font-bold text-right flex-1" style={{ color: 'rgba(203,213,225,0.8)' }}>{value}</p>
            </div>
          ))}
        </div>

        {/* Actions */}
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
          <button onClick={() => onEdit(expense)}
            className="col-span-2 flex items-center justify-center gap-2 py-3.5 rounded-[18px] font-black text-sm active:scale-95 transition-all"
            style={{ background: 'rgba(139,92,246,0.14)', border: '1px solid rgba(139,92,246,0.25)', color: '#a78bfa' }}>
            <Edit2 size={15} /> Edit Expense
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExpenseDetailView;






