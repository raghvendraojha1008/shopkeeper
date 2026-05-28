/**
 * PartyStatementView — Full Account Book / Ledger Statement per Party
 * Shows: running balance, all invoices + payments, aging, PDF/WhatsApp share
 */
import React, { useState, useMemo, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import {
  ArrowLeft, Download, MessageCircle, Loader2, ChevronDown, ChevronUp,
  TrendingUp, TrendingDown, Wallet, FileText, Clock, CheckCircle2,
  AlertTriangle, Filter, Share2, Printer,
} from 'lucide-react';
import { useUI } from '../../context/UIContext';
import { fmtINR } from '../../utils/gstUtils';
import { formatDate } from '../../utils/helpers';
import { exportService } from '../../services/export';
import DateRangeFilter from '../common/DateRangeFilter';

interface PartyStatementViewProps {
  party: any;
  ledger: any[];
  transactions: any[];
  settings: any;
  onBack: () => void;
}

type FilterPeriod = 'all' | 'thisMonth' | 'last3' | 'thisYear' | 'custom';

// Aging buckets
const AGING = [
  { label: '0–30 days',  min: 0,   max: 30,  color: '#34d399', bg: 'rgba(16,185,129,0.1)'  },
  { label: '31–60 days', min: 31,  max: 60,  color: '#fbbf24', bg: 'rgba(245,158,11,0.1)'  },
  { label: '61–90 days', min: 61,  max: 90,  color: '#f97316', bg: 'rgba(249,115,22,0.1)'  },
  { label: '90+ days',   min: 91,  max: 9999, color: '#f87171', bg: 'rgba(239,68,68,0.1)'  },
];

function getAgeBucket(dateStr: string) {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  return AGING.find(a => days >= a.min && days <= a.max) || AGING[AGING.length - 1];
}

function addDays(dateStr: string, n: number) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

const Card: React.FC<{ children: React.ReactNode; className?: string; style?: React.CSSProperties }> = ({ children, className = '', style = {} }) => (
  <div className={`rounded-2xl p-4 ${className}`}
    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', ...style }}>
    {children}
  </div>
);

// FIX (Issue #9): Normalise phone number before building WhatsApp URL.
// party.contact?.replace(/\D/g,'') strips non-digits but applies no country code,
// so a 10-digit number like "9876543210" produces a broken WhatsApp link.
function normalisePhone(raw: string): string {
  let digits = (raw || '').replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  if (digits.length === 10) return '91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return digits;
}

const PartyStatementView: React.FC<PartyStatementViewProps> = ({
  party, ledger, transactions, settings, onBack,
}) => {
  const { showToast } = useUI();
  const [filterPeriod, setFilterPeriod] = useState<FilterPeriod>('all');
  const [customRange, setCustomRange] = useState({
    start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0],
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [generating, setGenerating] = useState(false);

  const firmName = settings?.profile?.firm_name || 'My Firm';
  const currency  = settings?.profile?.currency_symbol || '₹';

  // ── Date filtering ──────────────────────────────────────────────────────
  const dateRange = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    if (filterPeriod === 'thisMonth')
      return { start: new Date(y, m, 1).toISOString().split('T')[0], end: now.toISOString().split('T')[0] };
    if (filterPeriod === 'last3')
      return { start: new Date(y, m - 3, 1).toISOString().split('T')[0], end: now.toISOString().split('T')[0] };
    if (filterPeriod === 'thisYear')
      return { start: `${y}-04-01`, end: now.toISOString().split('T')[0] };
    if (filterPeriod === 'custom')
      return customRange;
    return null;
  }, [filterPeriod, customRange]);

  // ── Build timeline ───────────────────────────────────────────────────────
  const { timeline, summary, agingMap } = useMemo(() => {
    const partyLedger = ledger.filter(l => l.party_name === party.name);
    const partyTrans  = transactions.filter(t => t.party_name === party.name);
    const role        = party.role || 'customer';

    let combined = [
      ...partyLedger.map(l => ({ ...l, _type: 'invoice' as const })),
      ...partyTrans.map(t  => ({ ...t, _type: 'payment' as const })),
    ].sort((a, b) => {
      const da = a.date?.toDate ? a.date.toDate().getTime() : new Date(a.date || 0).getTime();
      const db_ = b.date?.toDate ? b.date.toDate().getTime() : new Date(b.date || 0).getTime();
      return da - db_;
    });

    // Apply date filter
    if (dateRange) {
      combined = combined.filter(item => {
        let d: string;
        if (item.date?.toDate) {
          const dt = item.date.toDate();
          d = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
        } else {
          d = String(item.date || '').substring(0, 10);
        }
        return d >= dateRange.start && d <= dateRange.end;
      });
    }

    // Running balance
    let runBal = 0;
    const withBalance = combined.map(item => {
      const amt = Number(item.total_amount || item.amount || 0);
      if (item._type === 'invoice') {
        const isBilled = (role === 'customer' && item.type === 'sell') || (role === 'supplier' && item.type === 'purchase');
        runBal += isBilled ? amt : -amt;
      } else {
        const isIncoming = (role === 'customer' && item.type === 'received') || (role === 'supplier' && item.type === 'paid');
        runBal -= isIncoming ? amt : -amt;
      }
      return { ...item, runningBalance: runBal };
    });

    // Summary
    let totalBilled = 0, totalPaid = 0;
    partyLedger.forEach(l => {
      if ((role === 'customer' && l.type === 'sell') || (role === 'supplier' && l.type === 'purchase'))
        totalBilled += Number(l.total_amount || 0);
    });
    partyTrans.forEach(t => {
      if ((role === 'customer' && t.type === 'received') || (role === 'supplier' && t.type === 'paid'))
        totalPaid += Number(t.amount || 0);
    });

    // Aging — unpaid invoices only
    const agingBuckets: Record<string, number> = { '0–30 days': 0, '31–60 days': 0, '61–90 days': 0, '90+ days': 0 };
    partyLedger.filter(l => l.type === 'sell').forEach(l => {
      let dateStr: string;
      if (l.date?.toDate) {
        const dt = l.date.toDate();
        dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      } else {
        dateStr = String(l.date || '').substring(0, 10);
      }
      const bucket = getAgeBucket(dateStr);
      agingBuckets[bucket.label] = (agingBuckets[bucket.label] || 0) + Number(l.total_amount || 0);
    });

    return {
      timeline: withBalance,
      summary: { totalBilled, totalPaid, balance: totalBilled - totalPaid },
      agingMap: agingBuckets,
    };
  }, [ledger, transactions, party, dateRange]);

  // ── Generate PDF statement ──────────────────────────────────────────────
  const generatePDF = async (share = false) => {
    setGenerating(true);
    try {
      const { jsPDF } = await import('jspdf');
      const atMod = await import('jspdf-autotable');
      const autoTable = (atMod as any).default || atMod;
      const doc: any = new (jsPDF as any)({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const PW = 210, m = 14;

      // Header
      doc.setFillColor(14, 20, 50);
      doc.rect(0, 0, PW, 30, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14); doc.setFont('helvetica', 'bold');
      doc.text(firmName, m, 10);
      doc.setFontSize(9); doc.setFont('helvetica', 'normal');
      doc.text('Account Statement', m, 17);
      doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, PW - m, 17, { align: 'right' });
      doc.setFontSize(8);
      doc.text(`Period: ${filterPeriod === 'all' ? 'All Time' : `${dateRange?.start} to ${dateRange?.end}`}`, PW - m, 22, { align: 'right' });

      // Party info
      doc.setTextColor(0, 0, 0);
      doc.setFillColor(245, 247, 255);
      doc.rect(m, 35, PW - m * 2, 18, 'F');
      doc.setFontSize(11); doc.setFont('helvetica', 'bold');
      doc.text(party.name, m + 3, 42);
      doc.setFontSize(8); doc.setFont('helvetica', 'normal');
      if (party.contact) doc.text(`Phone: ${party.contact}`, m + 3, 48);
      if (party.gstin) doc.text(`GSTIN: ${party.gstin}`, PW / 2, 48);

      // Summary boxes
      const boxes = [
        { label: 'Total Billed', val: summary.totalBilled, color: [14, 100, 200] as [number,number,number] },
        { label: 'Total Paid',   val: summary.totalPaid,   color: [5, 150, 105]  as [number,number,number] },
        { label: 'Balance Due',  val: summary.balance,     color: summary.balance > 0 ? [220, 38, 38] as [number,number,number] : [5, 150, 105] as [number,number,number] },
      ];
      const bw = (PW - m * 2 - 8) / 3;
      boxes.forEach((b, i) => {
        const x = m + i * (bw + 4);
        doc.setFillColor(...b.color);
        doc.roundedRect(x, 58, bw, 14, 2, 2, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(7); doc.setFont('helvetica', 'bold');
        doc.text(b.label, x + bw / 2, 63, { align: 'center' });
        doc.setFontSize(9);
        doc.text(fmtINR(Number(b.val), 'Rs.'), x + bw / 2, 69, { align: 'center' });
      });
      doc.setTextColor(0, 0, 0);

      // Transaction table
      const rows = timeline.map(item => {
        const dateStr = item.date?.toDate
          ? item.date.toDate().toLocaleDateString('en-IN')
          : new Date(item.date || '').toLocaleDateString('en-IN');
        const isInvoice = item._type === 'invoice';
        const amt = Number(item.total_amount || item.amount || 0);
        return [
          dateStr,
          isInvoice ? (item.invoice_no || item.bill_no || 'Invoice') : (item.type === 'received' ? 'Payment Recv.' : 'Payment Made'),
          isInvoice ? fmtINR(amt, 'Rs.') : '',
          !isInvoice ? fmtINR(amt, 'Rs.') : '',
          fmtINR(Number(item.runningBalance), 'Rs.'),
          item.notes || '',
        ];
      });

      autoTable(doc, {
        startY: 78,
        head: [['Date', 'Particulars', 'Debit (Rs.)', 'Credit (Rs.)', 'Balance (Rs.)', 'Notes']],
        body: rows,
        margin: { left: m, right: m },
        headStyles: { fillColor: [14, 20, 50], textColor: 255, fontSize: 7, fontStyle: 'bold' },
        bodyStyles: { fontSize: 7, cellPadding: 2 },
        alternateRowStyles: { fillColor: [248, 249, 255] },
        columnStyles: {
          0: { cellWidth: 22 },
          1: { cellWidth: 40 },
          2: { cellWidth: 30, halign: 'right' },
          3: { cellWidth: 30, halign: 'right' },
          4: { cellWidth: 30, halign: 'right', fontStyle: 'bold' },
          5: { cellWidth: 30 },
        },
        didDrawPage: (data: any) => {
          doc.setFontSize(7);
          doc.setTextColor(150);
          doc.text(`Page ${data.pageNumber}`, PW / 2, 290, { align: 'center' });
          doc.text(firmName, m, 290);
        },
      });

      // Footer note
      const finalY = (doc as any).lastAutoTable?.finalY + 8 || 200;
      doc.setFontSize(7);
      doc.setTextColor(100);
      doc.text('This is a computer-generated statement and does not require a signature.', m, finalY);

      const blob = doc.output('blob');
      if (share) {
        // WhatsApp share — first download the PDF, then share the text
        await exportService.sharePdfBlob(blob, `${party.name}_Statement.pdf`);
        const msg = `Account Statement for *${party.name}*\nFirm: *${firmName}*\nBalance Due: *₹${summary.balance.toLocaleString('en-IN')}*\nPlease find attached statement.`;
        if (Capacitor.isNativePlatform()) {
          try { await Share.share({ text: msg }); } catch (_) {}
        } else {
          window.open(`https://wa.me/${normalisePhone(party.contact || '')}?text=${encodeURIComponent(msg)}`, '_blank');
        }
      } else {
        await exportService.sharePdfBlob(blob, `${party.name}_Statement.pdf`);
      }
      showToast('Statement downloaded!', 'success');
    } catch (e: any) {
      showToast('PDF generation failed: ' + e.message, 'error');
    } finally {
      setGenerating(false);
    }
  };

  const balanceColor = summary.balance > 0 ? '#f87171' : summary.balance < 0 ? '#34d399' : 'rgba(148,163,184,0.5)';

  return (
    <div className="h-full overflow-y-auto pb-24" style={{ background: 'var(--app-bg)' }}>
      {/* Header */}
      <div className="sticky top-0 z-30 px-4 pb-3"
        style={{paddingTop: '16px',  background: 'rgba(var(--app-bg-rgb),0.95)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-2xl active:scale-95"
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(148,163,184,0.7)' }}>
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-black text-white truncate">Account Statement</h1>
            <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'rgba(148,163,184,0.4)' }}>
              {party.name} · {party.role}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowFilter(v => !v)}
              className="p-2 rounded-2xl active:scale-95"
              style={{ background: showFilter ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.08)', border: `1px solid ${showFilter ? 'rgba(139,92,246,0.4)' : 'rgba(255,255,255,0.1)'}`, color: showFilter ? '#a78bfa' : 'rgba(148,163,184,0.7)' }}>
              <Filter size={16} />
            </button>
            <button onClick={() => generatePDF(false)} disabled={generating}
              className="p-2 rounded-2xl active:scale-95"
              style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', color: '#60a5fa' }}>
              {generating ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            </button>
            <button onClick={() => generatePDF(true)} disabled={generating}
              className="p-2 rounded-2xl active:scale-95"
              style={{ background: 'rgba(37,211,102,0.1)', border: '1px solid rgba(37,211,102,0.25)', color: '#25d366' }}>
              <MessageCircle size={16} />
            </button>
          </div>
        </div>

        {/* Filter bar */}
        {showFilter && (
          <div className="mt-3 space-y-2">
            <div className="flex gap-1.5 flex-wrap">
              {(['all','thisMonth','last3','thisYear','custom'] as FilterPeriod[]).map(p => (
                <button key={p} onClick={() => setFilterPeriod(p)}
                  className="px-2.5 py-1 rounded-xl text-[10px] font-black transition-all"
                  style={filterPeriod === p
                    ? { background: 'rgba(139,92,246,0.2)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.4)' }
                    : { background: 'rgba(255,255,255,0.06)', color: 'rgba(148,163,184,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  {p === 'all' ? 'All Time' : p === 'thisMonth' ? 'This Month' : p === 'last3' ? 'Last 3M' : p === 'thisYear' ? 'This Year' : 'Custom'}
                </button>
              ))}
            </div>
            {filterPeriod === 'custom' && (
              <DateRangeFilter
                start={customRange.start}
                end={customRange.end}
                onStartChange={v => setCustomRange(r => ({ ...r, start: v }))}
                onEndChange={v => setCustomRange(r => ({ ...r, end: v }))}
              />
            )}
          </div>
        )}
      </div>

      <div className="px-4 pt-4 space-y-4">
        {/* Party summary card */}
        <Card>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-base font-black text-white">{party.name}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[9px] font-black px-2 py-0.5 rounded-full capitalize"
                  style={party.role === 'customer'
                    ? { background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)' }
                    : { background: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.25)' }}>
                  {party.role}
                </span>
                {party.contact && <span className="text-[10px] font-semibold" style={{ color: 'rgba(148,163,184,0.5)' }}>{party.contact}</span>}
              </div>
              {party.gstin && <p className="text-[9px] font-mono mt-0.5" style={{ color: 'rgba(148,163,184,0.35)' }}>GSTIN: {party.gstin}</p>}
            </div>
            <div className="text-right">
              <div className="text-xs font-bold" style={{ color: 'rgba(148,163,184,0.5)' }}>Balance Due</div>
              <div className="text-xl font-black" style={{ color: balanceColor }}>
                {fmtINR(Math.abs(summary.balance))}
              </div>
              <div className="text-[9px] font-bold" style={{ color: 'rgba(148,163,184,0.4)' }}>
                {summary.balance > 0 ? 'Amount Receivable' : summary.balance < 0 ? 'Amount Payable' : 'Settled'}
              </div>
            </div>
          </div>
        </Card>

        {/* 3 stat cards */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Billed', value: summary.totalBilled, icon: FileText, color: '#60a5fa', bg: 'rgba(59,130,246,0.1)' },
            { label: 'Paid',   value: summary.totalPaid,   icon: CheckCircle2, color: '#34d399', bg: 'rgba(16,185,129,0.1)' },
            { label: 'Due',    value: summary.balance,     icon: Wallet, color: balanceColor, bg: 'rgba(248,113,113,0.08)' },
          ].map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={i} className="p-3 rounded-2xl"
                style={{ background: s.bg, border: `1px solid ${s.color}33` }}>
                <Icon size={14} style={{ color: s.color }} />
                <div className="text-sm font-black mt-1 leading-tight" style={{ color: s.color }}>
                  {fmtINR(Math.abs(s.value))}
                </div>
                <div className="text-[8px] font-bold uppercase mt-0.5" style={{ color: `${s.color}88` }}>{s.label}</div>
              </div>
            );
          })}
        </div>

        {/* Aging analysis */}
        {Object.values(agingMap).some(v => v > 0) && (
          <Card>
            <p className="text-[10px] font-black uppercase tracking-wide mb-3" style={{ color: 'rgba(148,163,184,0.4)' }}>
              Aging Analysis (Unpaid Invoices)
            </p>
            <div className="space-y-2">
              {AGING.map((bucket, i) => {
                const amt = agingMap[bucket.label] || 0;
                if (!amt) return null;
                const pct = summary.totalBilled > 0 ? (amt / summary.totalBilled) * 100 : 0;
                return (
                  <div key={i}>
                    <div className="flex justify-between mb-1">
                      <span className="text-[10px] font-bold" style={{ color: bucket.color }}>{bucket.label}</span>
                      <span className="text-[10px] font-black" style={{ color: bucket.color }}>{fmtINR(amt)}</span>
                    </div>
                    <div className="h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: bucket.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Transaction timeline */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-black uppercase tracking-wide" style={{ color: 'rgba(148,163,184,0.4)' }}>
              Statement ({timeline.length} entries)
            </p>
          </div>

          {timeline.length === 0 ? (
            <Card className="text-center py-8">
              <FileText size={28} style={{ color: 'rgba(148,163,184,0.2)', margin: '0 auto 8px' }} />
              <p className="text-sm font-bold" style={{ color: 'rgba(148,163,184,0.4)' }}>No transactions in this period</p>
            </Card>
          ) : (
            <div className="overflow-x-auto -mx-1 px-1">
              <div className="min-w-[500px] space-y-2">
                {/* Table header */}
                <div className="grid gap-1 px-3 pb-1"
                  style={{ gridTemplateColumns: '60px 1fr 92px 92px 92px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {['Date', 'Particulars', 'Debit', 'Credit', 'Balance'].map((h, i) => (
                    <span key={h} className={`text-[8px] font-black uppercase tracking-wide ${i >= 2 ? 'text-right' : ''}`}
                      style={{ color: 'rgba(148,163,184,0.35)' }}>{h}</span>
                  ))}
                </div>

                {timeline.map((item, idx) => {
                  const isInvoice = item._type === 'invoice';
                  const amt = Number(item.total_amount || item.amount || 0);
                  const dateStr = item.date?.toDate
                    ? item.date.toDate().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                    : new Date(item.date || '').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
                  const label = isInvoice
                    ? (item.invoice_no || item.bill_no || `${item.type === 'sell' ? 'Sale' : 'Purchase'}`)
                    : (item.type === 'received' ? 'Payment Received' : 'Payment Made');
                  const isDebit  = isInvoice && ((party.role === 'customer' && item.type === 'sell') || (party.role === 'supplier' && item.type === 'purchase'));
                  const isCredit = !isInvoice && ((party.role === 'customer' && item.type === 'received') || (party.role === 'supplier' && item.type === 'paid'));
                  const balColor = Number(item.runningBalance) > 0 ? '#f87171' : Number(item.runningBalance) < 0 ? '#34d399' : 'rgba(148,163,184,0.5)';
                  const expanded = expandedId === (item.id || String(idx));

                  return (
                    <div key={item.id || idx}>
                      <button
                        onClick={() => setExpandedId(expanded ? null : (item.id || String(idx)))}
                        className="w-full grid gap-1 px-3 py-2.5 rounded-2xl text-left transition-all active:scale-[0.99]"
                        style={{ gridTemplateColumns: '60px 1fr 92px 92px 92px', background: expanded ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                        <span className="text-[9px] font-bold" style={{ color: 'rgba(148,163,184,0.55)' }}>{dateStr}</span>
                        <span className="text-[10px] font-bold truncate" style={{ color: 'rgba(203,213,225,0.8)' }}>
                          {isInvoice
                            ? <span className="flex items-center gap-1"><FileText size={9} />{label}</span>
                            : <span className="flex items-center gap-1"><Wallet size={9} />{label}</span>}
                        </span>
                        <span className="text-[10px] font-black text-right tabular-nums" style={{ color: isDebit ? '#f87171' : 'transparent' }}>
                          {isDebit ? fmtINR(amt) : '—'}
                        </span>
                        <span className="text-[10px] font-black text-right tabular-nums" style={{ color: isCredit ? '#34d399' : 'transparent' }}>
                          {isCredit ? fmtINR(amt) : '—'}
                        </span>
                        <span className="text-[10px] font-black text-right tabular-nums" style={{ color: balColor }}>
                          {fmtINR(Math.abs(Number(item.runningBalance)))}
                        </span>
                      </button>
                      {expanded && (
                        <div className="mx-2 px-3 py-2 rounded-b-2xl space-y-1"
                          style={{ background: 'rgba(255,255,255,0.04)', borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: -4 }}>
                          {item.notes && (
                            <p className="text-[10px]" style={{ color: 'rgba(148,163,184,0.6)' }}>📝 {item.notes}</p>
                          )}
                          {item.payment_mode && (
                            <p className="text-[10px]" style={{ color: 'rgba(148,163,184,0.5)' }}>💳 {item.payment_mode}</p>
                          )}
                          {isInvoice && item.items?.length > 0 && (
                            <div className="mt-1">
                              {item.items.slice(0, 3).map((it: any, j: number) => (
                                <p key={j} className="text-[9px] font-semibold" style={{ color: 'rgba(148,163,184,0.45)' }}>
                                  {it.item_name} × {it.quantity} {it.unit} @ ₹{it.rate}
                                </p>
                              ))}
                              {item.items.length > 3 && (
                                <p className="text-[9px]" style={{ color: 'rgba(148,163,184,0.3)' }}>+{item.items.length - 3} more items</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Closing balance */}
                <div className="flex items-center justify-between px-3 py-3 rounded-2xl mt-2"
                  style={{ background: summary.balance > 0 ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)', border: `1px solid ${summary.balance > 0 ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)'}` }}>
                  <span className="text-sm font-black" style={{ color: balanceColor }}>Closing Balance</span>
                  <div className="text-right">
                    <span className="text-lg font-black" style={{ color: balanceColor }}>
                      {fmtINR(Math.abs(summary.balance))}
                    </span>
                    <p className="text-[9px] font-bold" style={{ color: `${balanceColor}99` }}>
                      {summary.balance > 0 ? '(Receivable)' : summary.balance < 0 ? '(Payable)' : '(Settled)'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PartyStatementView;







