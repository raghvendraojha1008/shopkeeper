/**
 * InventoryItemDetailView — Full detail card for inventory items
 * Shows: stock info, pricing, GST, sales/purchase history, reorder status
 */

import React, { useState, useMemo } from 'react';
import {
  ArrowLeft, Edit2, Download, Loader2,
  Package, TrendingUp, AlertTriangle,
  Hash, Percent, ShoppingCart, Truck, Calendar,
} from 'lucide-react';
import { exportService } from '../../services/export';
import { calcSalesVelocity } from '../../services/geminiEnhanced';
import { fmtINR } from '../../utils/gstUtils';
import { useUI } from '../../context/UIContext';
import ExportFormatModal from '../common/ExportFormatModal';
import DateRangeFilter from '../common/DateRangeFilter';
import { parseDateSafe, toDateStrSafe } from '../../utils/dateUtils';

function parseRecordDate(raw: any): Date {
  return parseDateSafe(raw);
}
function toDateString(raw: any): string {
  return toDateStrSafe(raw);
}

interface InventoryItemDetailViewProps {
  item       : any;
  ledgerData?: any[];
  settings   : any;
  onBack     : () => void;
  onEdit     : (item: any) => void;
}

const InventoryItemDetailView: React.FC<InventoryItemDetailViewProps> = ({
  item, ledgerData = [], settings, onBack, onEdit,
}) => {
  const { showToast }   = useUI();
  const [loading, setLoading]           = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

  const stock    = Number(item.current_stock || 0);
  const minStock = Number(item.min_stock || 0);
  const isLow    = stock <= minStock;
  const isOut    = stock <= 0;

  const saleRate     = Number(item.sale_rate || item.default_rate || 0);
  const purchaseRate = Number(item.purchase_rate || 0);
  const gstPercent   = Number(item.gst_percent || 0);
  const velocity     = useMemo(() => calcSalesVelocity(item.name, ledgerData, 30), [item.name, ledgerData]);
  const daysLeft     = velocity > 0 ? Math.floor(stock / velocity) : 999;
  const stockValue   = stock * saleRate;

  // ── Sold / Purchase section state ─────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'sales' | 'purchases'>('sales');

  // Quick date filter:
  //   'fy'     → current Indian Financial Year (Apr 1 → today, capped)
  //   'mN'     → that month within the current FY (m0 = Apr ... m11 = Mar)
  //   'custom' → user-picked start/end via the inline DateRangeFilter
  type QuickKey = 'fy' | `m${number}` | 'custom';
  const [quickKey, setQuickKey] = useState<QuickKey>('fy');

  const fmtIso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const fyInfo = useMemo(() => {
    const now = new Date();
    const fyStartYear = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
    const start = new Date(fyStartYear, 3, 1);          // Apr 1
    const end   = new Date(fyStartYear + 1, 2, 31);     // Mar 31 next year
    return { fyStartYear, start, end, label: `FY ${String(fyStartYear).slice(-2)}-${String(fyStartYear + 1).slice(-2)}` };
  }, []);

  const todayIso = useMemo(() => fmtIso(new Date()), []);

  const [dateRange, setDateRange] = useState({
    start: fmtIso(fyInfo.start),
    end:   todayIso,
  });

  // Month index 0..11 = Apr..Mar (FY order). Months 0..8 → fyStartYear,
  // months 9..11 (Jan, Feb, Mar) → fyStartYear + 1.
  const monthRange = (fyMonthIdx: number) => {
    const calMonth   = (3 + fyMonthIdx) % 12;
    const yearOffset = fyMonthIdx <= 8 ? 0 : 1;
    const year       = fyInfo.fyStartYear + yearOffset;
    const start = new Date(year, calMonth, 1);
    const end   = new Date(year, calMonth + 1, 0);    // last day of month
    return { start: fmtIso(start), end: fmtIso(end) };
  };

  const applyQuick = (key: QuickKey) => {
    setQuickKey(key);
    if (key === 'fy') {
      const fyEndIso = fmtIso(fyInfo.end);
      setDateRange({ start: fmtIso(fyInfo.start), end: todayIso < fyEndIso ? todayIso : fyEndIso });
    } else if (key !== 'custom') {
      setDateRange(monthRange(parseInt(key.slice(1), 10)));
    }
  };

  const MONTH_LABELS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

  // All ledger entries that involve this item, with the matching item line
  // pre-extracted so totals/activity rendering stay cheap.
  const itemEntries = useMemo(() => {
    const target = (item.name || '').toLowerCase();
    return ledgerData
      .filter((l: any) => l.items?.some((i: any) => i.item_name?.toLowerCase() === target))
      .map((l: any) => {
        const line = (l.items || []).find((i: any) => i.item_name?.toLowerCase() === target) || {};
        const qty   = Number(line.quantity) || 0;
        const rate  = Number(line.rate)     || 0;
        const total = Number(line.total)    || qty * rate;
        return { ...l, itemQty: qty, itemRate: rate, itemTotal: total, itemUnit: line.unit || item.unit };
      });
  }, [ledgerData, item.name, item.unit]);

  // Apply tab + date filter, then sort newest-first for display.
  const filteredEntries = useMemo(() => {
    const wantType = activeTab === 'sales' ? 'sell' : 'purchase';
    return itemEntries
      .filter((l: any) => {
        if (l.type !== wantType) return false;
        const ds = toDateString(l.date);
        return ds >= dateRange.start && ds <= dateRange.end;
      })
      .sort((a: any, b: any) => parseRecordDate(b.date).getTime() - parseRecordDate(a.date).getTime());
  }, [itemEntries, activeTab, dateRange]);

  // Totals — computed once for the active section so the "Total" box stays
  // in sync with the filter chips above.
  const totals = useMemo(() => {
    let amount = 0, qty = 0;
    filteredEntries.forEach((l: any) => { amount += l.itemTotal; qty += l.itemQty; });
    return { amount: Math.round(amount), qty: Math.round(qty), count: filteredEntries.length };
  }, [filteredEntries]);

  // Show the 5 most-recent entries from the filtered list under the totals.
  const recentActivity = useMemo(() => filteredEntries.slice(0, 5), [filteredEntries]);

  const accentColor = isOut ? '#f87171' : isLow ? '#fbbf24' : '#34d399';
  const accentBg    = isOut ? 'rgba(239,68,68,0.1)' : isLow ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.08)';
  const accentBorder= isOut ? 'rgba(239,68,68,0.25)' : isLow ? 'rgba(245,158,11,0.25)' : 'rgba(16,185,129,0.2)';

  // ── PDF ───────────────────────────────────────────────────────────────────
  const generatePDF = async () => {
    const { jsPDF } = await import('jspdf');
    const atMod = await import('jspdf-autotable');
    const autoTable = (atMod as any).default || atMod;
    const doc = new jsPDF();
    const PW  = doc.internal.pageSize.width;
    const m   = 14;
    const themeRgb: [number,number,number] = isLow || isOut ? [220,38,38] : [5,150,105];

    doc.setFillColor(...themeRgb); doc.rect(0,0,PW,22,'F');
    doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
    doc.text('INVENTORY ITEM REPORT', PW/2, 14, {align:'center'});

    doc.setTextColor(30,40,60); doc.setFontSize(16); doc.setFont('helvetica','bold');
    doc.text(item.name, m, 34);
    doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(100);
    if (item.category) doc.text(`Category: ${item.category}`, m, 41);
    if (item.unit)     doc.text(`Unit: ${item.unit}`, PW-m, 41, {align:'right'});

    // Stock status
    const statusColor: [number,number,number] = isOut?[220,38,38]:isLow?[245,158,11]:[5,150,105];
    doc.setFillColor(...statusColor); doc.roundedRect(m, 46, 60, 10, 2,2,'F');
    doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
    doc.text(isOut?'OUT OF STOCK':isLow?'LOW STOCK':'IN STOCK', m+30, 52.5, {align:'center'});

    doc.setDrawColor(220); doc.line(m, 62, PW-m, 62);

    // Metrics table
    autoTable(doc, {
      startY:65, margin:{left:m,right:m},
      head:[['Metric','Value','Metric','Value']],
      body:[
        ['Current Stock', `${stock} ${item.unit||'Pcs'}`, 'Min Stock', `${minStock} ${item.unit||'Pcs'}`],
        ['Sale Rate', fmtINR(saleRate), 'Purchase Rate', fmtINR(purchaseRate)],
        ['GST %', `${gstPercent}%`, 'Stock Value', fmtINR(stockValue)],
        ['Sales Velocity', `${velocity.toFixed(1)}/day`, 'Days Remaining', daysLeft<999?`${daysLeft}d`:'N/A'],
        ['HSN Code', item.hsn_code||'-', 'Category', item.category||'-'],
      ],
      headStyles:{fillColor:[30,40,80],fontSize:7,fontStyle:'bold'},
      bodyStyles:{fontSize:8},
      columnStyles:{1:{fontStyle:'bold'},3:{fontStyle:'bold'}},
    });

    // Recent activity
    if (recentActivity.length > 0) {
      let y2 = (doc as any).lastAutoTable.finalY + 8;
      doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(30,40,60);
      doc.text('Recent Activity', m, y2);

      autoTable(doc, {
        startY: y2+3, margin:{left:m,right:m},
        head:[['Date','Type','Party','Qty']],
        body: recentActivity.map((l:any) => [
          l.date, l.type==='sell'?'Sale':'Purchase', l.party_name||'-', `${l.itemQty} ${item.unit||''}`
        ]),
        headStyles:{fillColor:themeRgb,fontSize:7},
        bodyStyles:{fontSize:7},
        alternateRowStyles:{fillColor:[248,250,252]},
      });
    }

    const pdfBlob = doc.output('blob');
    await exportService.sharePdfBlob(pdfBlob, `Item_${item.name.replace(/\s/g,'_')}.pdf`);
    showToast('PDF exported!', 'success');
  };

  // ── CSV ───────────────────────────────────────────────────────────────────
  const generateExcel = async () => {
    const rows = [
      ['INVENTORY ITEM REPORT'],
      ['Item Name', item.name],
      ['Category', item.category||'-'],
      ['Unit', item.unit||'-'],
      ['HSN Code', item.hsn_code||'-'],
      ['GST %', `${gstPercent}%`],
      [],
      ['Current Stock', stock],
      ['Min Stock', minStock],
      ['Stock Status', isOut?'Out of Stock':isLow?'Low Stock':'In Stock'],
      ['Sale Rate', saleRate.toFixed(2)],
      ['Purchase Rate', purchaseRate.toFixed(2)],
      ['Stock Value (at sale rate)', stockValue.toFixed(2)],
      ['Sales Velocity (30-day avg)', `${velocity.toFixed(2)} ${item.unit||'pcs'}/day`],
      ['Days Remaining at Velocity', daysLeft<999?daysLeft:'N/A'],
      [],
      ['--- Recent Activity ---'],
      ['Date','Type','Party','Qty'],
      ...recentActivity.map((l:any) => [l.date, l.type==='sell'?'Sale':'Purchase', l.party_name||'-', `${l.itemQty} ${item.unit||''}`]),
    ];
    const csv = rows.map(r=>r.map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const csvBlob = new Blob([csv], { type: 'text/csv' });
    await exportService.sharePdfBlob(csvBlob, `Item_${item.name}.csv`);
    showToast('Excel/CSV exported!', 'success');
  };

  const handleExport = async (format: 'pdf'|'excel') => {
    setLoading(true); setShowExportModal(false);
    try { format==='pdf' ? await generatePDF() : await generateExcel(); }
    catch (e: any) { console.error('Export error:', e); showToast('Export failed: ' + (e?.message || 'Unknown'), 'error'); }
    finally { setLoading(false); }
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
          <div className="text-center flex-1 px-3">
            <p className="text-[10px] font-black uppercase tracking-[0.15em]"
              style={{ color: accentColor }}>Inventory Item</p>
            <p className="text-sm font-black text-white truncate">{item.name}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowExportModal(true)} disabled={loading}
              className="p-2 rounded-2xl active:scale-95 transition-all"
              style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.25)', color: '#60a5fa' }}>
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
            </button>
            <button onClick={() => onEdit(item)}
              className="p-2 rounded-2xl active:scale-95 transition-all"
              style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.25)', color: '#a78bfa' }}>
              <Edit2 size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 pt-3 pb-32 space-y-3">

        {/* Hero stock card */}
        <div className="rounded-[24px] overflow-hidden"
          style={{ background: accentBg, border: `1px solid ${accentBorder}` }}>
          <div className="h-1.5" style={{ background: `linear-gradient(90deg,${accentColor},transparent)` }} />
          <div className="p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-xl font-black text-white truncate">{item.name}</p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {item.unit && (
                    <span className="text-[9px] font-black px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(139,92,246,0.2)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.3)' }}>
                      {item.unit}
                    </span>
                  )}
                  {item.category && (
                    <span className="text-[9px] font-bold" style={{ color: 'rgba(148,163,184,0.5)' }}>
                      {item.category}
                    </span>
                  )}
                  {item.prefixed_id && (
                    <span className="text-[8px] font-mono" style={{ color: 'rgba(148,163,184,0.4)' }}>
                      #{item.prefixed_id}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl flex-shrink-0"
                style={{ background: accentBg, border: `1px solid ${accentBorder}` }}>
                {isOut ? <AlertTriangle size={12} style={{ color: accentColor }} />
                : isLow ? <AlertTriangle size={12} style={{ color: accentColor }} />
                        : <Package size={12} style={{ color: accentColor }} />}
                <span className="text-[9px] font-black" style={{ color: accentColor }}>
                  {isOut ? 'OUT' : isLow ? 'LOW' : 'OK'}
                </span>
              </div>
            </div>

            {/* Stock metrics grid */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-[16px] p-3.5"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <p className="text-[8px] font-black uppercase tracking-wider mb-1.5"
                  style={{ color: 'rgba(148,163,184,0.4)' }}>Current Stock</p>
                <p className="text-2xl font-black tabular-nums" style={{ color: accentColor }}>
                  {stock}
                  <span className="text-[11px] ml-1 opacity-60">{item.unit||'pcs'}</span>
                </p>
                {minStock > 0 && (
                  <p className="text-[9px] mt-1" style={{ color: 'rgba(148,163,184,0.4)' }}>
                    Min: {minStock} {item.unit||'pcs'}
                  </p>
                )}
              </div>
              <div className="rounded-[16px] p-3.5"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <p className="text-[8px] font-black uppercase tracking-wider mb-1.5"
                  style={{ color: 'rgba(148,163,184,0.4)' }}>Stock Value</p>
                <p className="text-xl font-black tabular-nums" style={{ color: '#fbbf24' }}>
                  ₹{Math.round(stockValue).toLocaleString('en-IN')}
                </p>
                <p className="text-[9px] mt-1" style={{ color: 'rgba(148,163,184,0.4)' }}>
                  at ₹{saleRate}/unit
                </p>
              </div>
            </div>

            {/* Velocity */}
            {velocity > 0 && (
              <div className="rounded-[14px] p-3 flex items-center justify-between"
                style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.18)' }}>
                <div className="flex items-center gap-2">
                  <TrendingUp size={13} style={{ color: '#60a5fa' }} />
                  <p className="text-[11px] font-bold" style={{ color: 'rgba(147,197,253,0.8)' }}>
                    Avg {velocity.toFixed(1)} {item.unit||'pcs'}/day sold
                  </p>
                </div>
                <span className="text-[9px] font-black px-2.5 py-1 rounded-xl"
                  style={{ background: daysLeft <= 7 ? 'rgba(239,68,68,0.18)' : 'rgba(16,185,129,0.15)',
                    color: daysLeft <= 7 ? '#f87171' : '#34d399' }}>
                  {daysLeft < 999 ? `${daysLeft}d left` : 'Well stocked'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Pricing */}
        <div className="rounded-[20px] p-4 space-y-3"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}>
          <p className="text-[9px] font-black uppercase tracking-[0.15em]" style={{ color: 'rgba(148,163,184,0.4)' }}>Pricing</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Sale Rate',     value: fmtINR(saleRate),     color: '#34d399' },
              { label: 'Purchase Rate', value: fmtINR(purchaseRate), color: '#60a5fa' },
            ].map((p, i) => (
              <div key={i} className="rounded-[14px] p-3"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <p className="text-[8px] font-black uppercase tracking-wider mb-1.5"
                  style={{ color: 'rgba(148,163,184,0.35)' }}>{p.label}</p>
                <p className="text-lg font-black tabular-nums" style={{ color: p.color }}>{p.value}</p>
              </div>
            ))}
          </div>
          {gstPercent > 0 && (
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5">
                <Percent size={11} style={{ color: '#fbbf24' }} />
                <span className="text-[11px] font-bold" style={{ color: 'rgba(148,163,184,0.6)' }}>GST Rate</span>
              </div>
              <span className="text-sm font-black" style={{ color: '#fbbf24' }}>{gstPercent}%</span>
            </div>
          )}
          {item.hsn_code && (
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5">
                <Hash size={11} style={{ color: '#a78bfa' }} />
                <span className="text-[11px] font-bold" style={{ color: 'rgba(148,163,184,0.6)' }}>HSN Code</span>
              </div>
              <span className="text-[11px] font-mono font-black" style={{ color: '#a78bfa' }}>{item.hsn_code}</span>
            </div>
          )}
          {purchaseRate > 0 && saleRate > 0 && (
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5">
                <TrendingUp size={11} style={{ color: '#34d399' }} />
                <span className="text-[11px] font-bold" style={{ color: 'rgba(148,163,184,0.6)' }}>Margin</span>
              </div>
              <span className="text-[11px] font-black" style={{ color: '#34d399' }}>
                {(((saleRate-purchaseRate)/saleRate)*100).toFixed(1)}%
              </span>
            </div>
          )}
        </div>

        {/* ── Sold / Purchase toggle ──────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('sales')}
            className={`flex items-center justify-center gap-2 py-3 rounded-[16px] text-[12px] font-black transition-all active:scale-95 ${
              activeTab === 'sales' ? 'text-white shadow-md' : 'text-slate-400'
            }`}
            style={{
              background: activeTab === 'sales' ? '#10b981' : 'rgba(255,255,255,0.04)',
              border: activeTab === 'sales' ? '1px solid rgba(16,185,129,0.5)' : '1px solid rgba(255,255,255,0.09)',
              boxShadow: activeTab === 'sales' ? '0 4px 14px rgba(16,185,129,0.25)' : 'none',
            }}
          >
            <ShoppingCart size={14} />
            Sold
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('purchases')}
            className={`flex items-center justify-center gap-2 py-3 rounded-[16px] text-[12px] font-black transition-all active:scale-95 ${
              activeTab === 'purchases' ? 'text-white shadow-md' : 'text-slate-400'
            }`}
            style={{
              background: activeTab === 'purchases' ? '#f97316' : 'rgba(255,255,255,0.04)',
              border: activeTab === 'purchases' ? '1px solid rgba(249,115,22,0.5)' : '1px solid rgba(255,255,255,0.09)',
              boxShadow: activeTab === 'purchases' ? '0 4px 14px rgba(249,115,22,0.25)' : 'none',
            }}
          >
            <Truck size={14} />
            Purchase
          </button>
        </div>

        {/* ── Total box for the active section ────────────────────────────── */}
        <div
          className="rounded-[20px] p-4"
          style={{
            background: activeTab === 'sales'
              ? 'linear-gradient(135deg, rgba(16,185,129,0.18), rgba(16,185,129,0.06))'
              : 'linear-gradient(135deg, rgba(249,115,22,0.18), rgba(249,115,22,0.06))',
            border: `1px solid ${activeTab === 'sales' ? 'rgba(16,185,129,0.3)' : 'rgba(249,115,22,0.3)'}`,
          }}
        >
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-black uppercase tracking-[0.15em]"
                style={{ color: activeTab === 'sales' ? 'rgba(110,231,183,0.8)' : 'rgba(253,186,116,0.8)' }}>
                {activeTab === 'sales' ? 'Total Sold' : 'Total Purchased'}
              </p>
              <p className="text-2xl font-black tabular-nums mt-1"
                style={{ color: activeTab === 'sales' ? '#34d399' : '#fb923c' }}>
                ₹{totals.amount.toLocaleString('en-IN')}
              </p>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <span className="text-[10px] font-bold flex items-center gap-1"
                  style={{ color: 'rgba(226,232,240,0.7)' }}>
                  <Package size={10} /> {totals.qty} {item.unit || 'pcs'}
                </span>
                <span className="text-[10px] font-bold flex items-center gap-1"
                  style={{ color: 'rgba(226,232,240,0.7)' }}>
                  <Hash size={10} /> {totals.count} {totals.count === 1 ? 'record' : 'records'}
                </span>
              </div>
            </div>
            <div
              className="p-2.5 rounded-xl flex-shrink-0"
              style={{ background: activeTab === 'sales' ? 'rgba(16,185,129,0.18)' : 'rgba(249,115,22,0.18)' }}
            >
              {activeTab === 'sales'
                ? <ShoppingCart size={18} style={{ color: '#34d399' }} />
                : <Truck        size={18} style={{ color: '#fb923c' }} />}
            </div>
          </div>
        </div>

        {/* ── Date filter chips (FY default, Apr–Mar months, Custom) ──────── */}
        <div className="rounded-[16px] p-2.5 space-y-2"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5"
            style={{ scrollbarWidth: 'none' }}>
            {([
              { key: 'fy' as QuickKey, label: fyInfo.label },
              ...MONTH_LABELS.map((m, i) => ({ key: `m${i}` as QuickKey, label: m })),
              { key: 'custom' as QuickKey, label: 'Custom' },
            ]).map(opt => {
              const active = quickKey === opt.key;
              const isCustom = opt.key === 'custom';
              const accent = activeTab === 'sales' ? '#10b981' : '#f97316';
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => applyQuick(opt.key)}
                  className="flex-shrink-0 px-3 py-1.5 rounded-full text-[10px] font-black transition-all flex items-center gap-1 active:scale-95"
                  style={{
                    background: active ? accent : 'rgba(255,255,255,0.04)',
                    color:      active ? '#fff'  : 'rgba(148,163,184,0.7)',
                    border: `1px solid ${active ? accent : 'rgba(255,255,255,0.1)'}`,
                  }}
                >
                  {isCustom && <Calendar size={9} />}
                  {opt.label}
                </button>
              );
            })}
          </div>
          {quickKey === 'custom' && (
            <DateRangeFilter
              start={dateRange.start}
              end={dateRange.end}
              onStartChange={v => setDateRange(r => ({ ...r, start: v }))}
              onEndChange  ={v => setDateRange(r => ({ ...r, end:   v }))}
            />
          )}
        </div>

        {/* ── Recent activity for the active section ──────────────────────── */}
        <div className="rounded-[20px] overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}>
          <div className="px-4 py-3 flex items-center justify-between"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-[9px] font-black uppercase tracking-[0.15em]"
              style={{ color: 'rgba(148,163,184,0.4)' }}>
              Recent {activeTab === 'sales' ? 'Sales' : 'Purchases'}
            </p>
            {filteredEntries.length > recentActivity.length && (
              <span className="text-[9px] font-bold" style={{ color: 'rgba(148,163,184,0.5)' }}>
                Showing 5 of {filteredEntries.length}
              </span>
            )}
          </div>
          {recentActivity.length === 0 ? (
            <div className="px-4 py-6 text-center text-[11px] font-bold"
              style={{ color: 'rgba(148,163,184,0.4)' }}>
              No {activeTab === 'sales' ? 'sales' : 'purchases'} in this period
            </div>
          ) : (
            recentActivity.map((l: any, i: number) => (
              <div key={i} className="flex items-center px-4 py-3 gap-3"
                style={{ borderBottom: i < recentActivity.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                <div className="p-2 rounded-xl flex-shrink-0"
                  style={{ background: l.type === 'sell' ? 'rgba(16,185,129,0.12)' : 'rgba(249,115,22,0.12)' }}>
                  {l.type === 'sell'
                    ? <ShoppingCart size={12} style={{ color: '#34d399' }} />
                    : <Truck        size={12} style={{ color: '#fb923c' }} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold text-white truncate">{l.party_name || '-'}</p>
                  <p className="text-[9px]" style={{ color: 'rgba(148,163,184,0.45)' }}>{l.date}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[11px] font-black"
                    style={{ color: l.type === 'sell' ? '#34d399' : '#fb923c' }}>
                    ₹{Math.round(l.itemTotal).toLocaleString('en-IN')}
                  </p>
                  <p className="text-[9px] font-bold" style={{ color: 'rgba(148,163,184,0.5)' }}>
                    {l.itemQty} {l.itemUnit || item.unit || 'pcs'}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => setShowExportModal(true)} disabled={loading}
            className="flex items-center justify-center gap-2 py-3.5 rounded-[18px] font-black text-sm active:scale-95 transition-all"
            style={{ background: 'rgba(59,130,246,0.14)', border: '1px solid rgba(59,130,246,0.25)', color: '#60a5fa' }}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            Export
          </button>
          <button onClick={() => onEdit(item)}
            className="flex items-center justify-center gap-2 py-3.5 rounded-[18px] font-black text-sm active:scale-95 transition-all"
            style={{ background: 'rgba(139,92,246,0.14)', border: '1px solid rgba(139,92,246,0.25)', color: '#a78bfa' }}>
            <Edit2 size={15} /> Edit Item
          </button>
        </div>
      </div>
    </div>
  );
};

export default InventoryItemDetailView;






