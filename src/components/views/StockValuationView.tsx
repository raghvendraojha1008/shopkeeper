/**
 * StockValuationView — Stock valuation, purchase history, FIFO cost, margin trends
 * Shows per-item cost breakdown, last 5 purchase prices, gross margin sparkline
 */
import React, { useState, useMemo } from 'react';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import {
  ArrowLeft, TrendingUp, TrendingDown, Package, DollarSign,
  BarChart2, AlertTriangle, ChevronDown, Download, RefreshCw,
  Loader2, ShoppingCart, Percent, Activity, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import { fmtINR, fmtCompact } from '../../utils/gstUtils';
import { useUI } from '../../context/UIContext';
import { exportService } from '../../services/export';

interface StockValuationViewProps {
  items: any[];      // inventory items
  ledger: any[];     // ledger entries (for purchase history)
  settings: any;
  onBack: () => void;
  onViewItem?: (item: any) => void;
}

type SortKey = 'value' | 'margin' | 'name' | 'stock' | 'turnover';
type ViewMode = 'table' | 'cards';

function calcMargin(sale: number, purchase: number): number {
  if (!purchase || !sale) return 0;
  return ((sale - purchase) / sale) * 100;
}

function getMarginColor(m: number): string {
  if (m >= 30) return '#34d399';
  if (m >= 15) return '#fbbf24';
  if (m >= 0)  return '#f97316';
  return '#f87171';
}

// Extract purchase history from ledger for an item
function getPurchaseHistory(itemName: string, ledger: any[]): { date: string; rate: number; qty: number; total: number }[] {
  const history: { date: string; rate: number; qty: number; total: number }[] = [];
  for (const entry of ledger) {
    if (entry.type !== 'purchase') continue;
    const found = (entry.items || []).find((i: any) =>
      i.item_name?.toLowerCase() === itemName?.toLowerCase()
    );
    if (found) {
      history.push({
        date:  entry.date?.toDate ? entry.date.toDate().toISOString().split('T')[0] : String(entry.date || ''),
        rate:  Number(found.rate || 0),
        qty:   Number(found.quantity || 0),
        total: Number(found.rate || 0) * Number(found.quantity || 0),
      });
    }
  }
  return history.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
}

// Tiny sparkline SVG for margin trend
const Sparkline: React.FC<{ data: number[]; color: string; w?: number; h?: number }> = ({ data, color, w = 60, h = 24 }) => {
  if (data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  });
  return (
    <svg width={w} height={h} style={{ flexShrink: 0 }}>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length-1].split(',')[0]} cy={pts[pts.length-1].split(',')[1]} r={2} fill={color} />
    </svg>
  );
};

const Card: React.FC<{ children: React.ReactNode; className?: string; style?: React.CSSProperties }> = ({ children, className = '', style = {} }) => (
  <div className={`rounded-2xl p-4 ${className}`}
    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', ...style }}>
    {children}
  </div>
);

const StockValuationView: React.FC<StockValuationViewProps> = ({ items, ledger, settings, onBack, onViewItem }) => {
  const scrollRef = useScrollMemory('stock-valuation');
  const { showToast } = useUI();
  const [sortKey, setSortKey]     = useState<SortKey>('value');
  const [sortAsc, setSortAsc]     = useState(false);
  const [search, setSearch]       = useState('');
  const [viewMode, setViewMode]   = useState<ViewMode>('table');
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showLowMarginOnly, setShowLowMarginOnly] = useState(false);

  const firmName = settings?.profile?.firm_name || 'My Firm';

  // ── Enrich items ──────────────────────────────────────────────────────────
  const enrichedItems = useMemo(() => {
    return items.map(item => {
      const qty        = Number(item.current_stock || 0);
      const saleRate   = Number(item.sale_rate || item.default_rate || 0);
      const purchRate  = Number(item.purchase_rate || 0);
      const stockVal   = qty * saleRate;
      const costVal    = qty * purchRate;
      const margin     = calcMargin(saleRate, purchRate);
      const profitPerUnit = saleRate - purchRate;

      // Purchase history from ledger
      const history    = getPurchaseHistory(item.name, ledger);
      const lastRates  = history.slice(0, 5).map(h => h.rate);
      const avgPurchase = lastRates.length ? lastRates.reduce((s, r) => s + r, 0) / lastRates.length : purchRate;

      // Sales from ledger (last 30 days)
      const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      let soldQty30 = 0;
      for (const entry of ledger) {
        if (entry.type !== 'sell') continue;
        const d = entry.date?.toDate ? entry.date.toDate() : new Date(entry.date || 0);
        if (d < thirtyDaysAgo) continue;
        const found = (entry.items || []).find((i: any) => i.item_name?.toLowerCase() === item.name?.toLowerCase());
        if (found) soldQty30 += Number(found.quantity || 0);
      }
      const turnoverDays = soldQty30 > 0 ? Math.round(qty / (soldQty30 / 30)) : null;

      // FIFO cost — use historical purchase rates weighted by qty
      let fifoValue = 0;
      let remaining = qty;
      for (const h of [...history].reverse()) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, h.qty);
        fifoValue += take * h.rate;
        remaining -= take;
      }
      if (remaining > 0) fifoValue += remaining * purchRate;

      // Rate trend (last 5 purchases: newest last for sparkline)
      const rateTrend = [...lastRates].reverse();

      return {
        ...item, qty, saleRate, purchRate, stockVal, costVal, margin, profitPerUnit,
        history, lastRates, avgPurchase, soldQty30, turnoverDays, fifoValue, rateTrend,
      };
    });
  }, [items, ledger]);

  // ── Summary stats ─────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const totalStockVal = enrichedItems.reduce((s, i) => s + i.stockVal, 0);
    const totalCostVal  = enrichedItems.reduce((s, i) => s + i.costVal, 0);
    const totalProfit   = totalStockVal - totalCostVal;
    const avgMargin     = enrichedItems.length
      ? enrichedItems.reduce((s, i) => s + i.margin, 0) / enrichedItems.length : 0;
    const lowMarginItems = enrichedItems.filter(i => i.margin < 15).length;
    const outOfStock     = enrichedItems.filter(i => i.qty <= 0).length;
    return { totalStockVal, totalCostVal, totalProfit, avgMargin, lowMarginItems, outOfStock };
  }, [enrichedItems]);

  // ── Filter + sort ─────────────────────────────────────────────────────────
  const displayed = useMemo(() => {
    let list = enrichedItems.filter(i =>
      (!search || i.name?.toLowerCase().includes(search.toLowerCase())) &&
      (!showLowMarginOnly || i.margin < 15)
    );
    list = [...list].sort((a, b) => {
      let av = 0, bv = 0;
      if (sortKey === 'value')    { av = a.stockVal;  bv = b.stockVal;  }
      if (sortKey === 'margin')   { av = a.margin;    bv = b.margin;    }
      if (sortKey === 'stock')    { av = a.qty;       bv = b.qty;       }
      if (sortKey === 'turnover') { av = a.turnoverDays ?? 9999; bv = b.turnoverDays ?? 9999; }
      if (sortKey === 'name')     return sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      return sortAsc ? av - bv : bv - av;
    });
    return list;
  }, [enrichedItems, search, sortKey, sortAsc, showLowMarginOnly]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(v => !v);
    else { setSortKey(key); setSortAsc(false); }
  };

  // ── Export PDF ────────────────────────────────────────────────────────────
  const exportPDF = async () => {
    setExporting(true);
    try {
      const { jsPDF } = await import('jspdf');
      const atMod = await import('jspdf-autotable');
      const autoTable = (atMod as any).default || atMod;
      const doc: any = new (jsPDF as any)({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const PW = 297, m = 12;
      doc.setFillColor(14, 20, 50);
      doc.rect(0, 0, PW, 22, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12); doc.setFont('helvetica', 'bold');
      doc.text(firmName, m, 9);
      doc.setFontSize(8); doc.setFont('helvetica', 'normal');
      doc.text('Stock Valuation Report', m, 16);
      doc.text(`Date: ${new Date().toLocaleDateString('en-IN')}`, PW - m, 16, { align: 'right' });
      doc.setTextColor(0, 0, 0);

      // Summary row
      doc.setFontSize(8);
      const sumY = 26;
      const boxes = [
        { l: 'Stock Value',  v: fmtINR(summary.totalStockVal) },
        { l: 'Cost Value',   v: fmtINR(summary.totalCostVal)  },
        { l: 'Gross Profit', v: fmtINR(summary.totalProfit)   },
        { l: 'Avg Margin',   v: `${summary.avgMargin.toFixed(1)}%` },
        { l: 'Total Items',  v: String(enrichedItems.length)  },
      ];
      const bw = (PW - m * 2 - 16) / 5;
      boxes.forEach((b, i) => {
        const x = m + i * (bw + 4);
        doc.setFillColor(245, 247, 255);
        doc.roundedRect(x, sumY, bw, 12, 1, 1, 'F');
        doc.setFontSize(6); doc.setFont('helvetica', 'bold');
        doc.text(b.l, x + 2, sumY + 4);
        doc.setFontSize(8); doc.setFont('helvetica', 'bold');
        doc.text(b.v, x + 2, sumY + 9);
      });

      const rows = displayed.map(i => [
        i.name,
        `${i.qty} ${i.unit || ''}`,
        `₹${i.purchRate.toFixed(2)}`,
        `₹${i.saleRate.toFixed(2)}`,
        `${i.margin.toFixed(1)}%`,
        fmtINR(i.stockVal),
        fmtINR(i.costVal),
        `₹${i.profitPerUnit.toFixed(2)}`,
        i.soldQty30 > 0 ? `${i.soldQty30} / 30d` : '—',
        i.turnoverDays != null ? `${i.turnoverDays}d` : '—',
      ]);

      autoTable(doc, {
        startY: sumY + 16,
        head: [['Item','Stock','Pur. Rate','Sale Rate','Margin','Stock Value','Cost Value','Profit/Unit','Sold (30d)','Turnover']],
        body: rows,
        margin: { left: m, right: m },
        headStyles: { fillColor: [14, 20, 50], textColor: 255, fontSize: 6 },
        bodyStyles: { fontSize: 6, cellPadding: 1.5 },
        alternateRowStyles: { fillColor: [248, 249, 255] },
        columnStyles: {
          0: { cellWidth: 40 },
          4: { halign: 'right' },
          5: { halign: 'right' },
          6: { halign: 'right' },
          7: { halign: 'right' },
        },
        didDrawCell: (data: any) => {
          if (data.section === 'body' && data.column.index === 4) {
            const m = parseFloat(data.cell.raw as string);
            doc.setTextColor(m >= 30 ? 5 : m >= 15 ? 150 : 220, m >= 30 ? 150 : m >= 15 ? 120 : 38, m >= 30 ? 105 : m >= 15 ? 11 : 38);
          }
        },
      });

      const blob = doc.output('blob');
      await exportService.sharePdfBlob(blob, 'Stock_Valuation.pdf');
      showToast('PDF ready to share!', 'success');
    } catch (e: any) {
      showToast('Export failed: ' + e.message, 'error');
    } finally {
      setExporting(false);
    }
  };

  const SortBtn: React.FC<{ k: SortKey; label: string }> = ({ k, label }) => (
    <button onClick={() => toggleSort(k)}
      className="flex items-center gap-0.5 text-[8px] font-black uppercase tracking-wide transition-all"
      style={{ color: sortKey === k ? '#a78bfa' : 'rgba(148,163,184,0.4)' }}>
      {label}
      {sortKey === k && (sortAsc ? <ArrowUpRight size={8} /> : <ArrowDownRight size={8} />)}
    </button>
  );

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto pb-24" style={{ background: 'var(--app-bg)' }}>
      {/* Header */}
      <div className="sticky top-0 z-30 px-4 pb-3"
        style={{paddingTop: '16px',  background: 'rgba(var(--app-bg-rgb),0.95)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-2xl active:scale-95"
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(148,163,184,0.7)' }}>
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-black text-white">Stock Valuation</h1>
            <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'rgba(148,163,184,0.4)' }}>
              FIFO · Purchase history · Margin analysis
            </p>
          </div>
          <button onClick={exportPDF} disabled={exporting}
            className="p-2 rounded-2xl active:scale-95"
            style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', color: '#60a5fa' }}>
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          </button>
        </div>

        {/* Search + filter */}
        <div className="flex gap-2 mt-3">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search items…"
            className="flex-1 text-xs font-bold px-3 py-2 rounded-xl outline-none"
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(226,232,240,0.9)' }} />
          <button onClick={() => setShowLowMarginOnly(v => !v)}
            className="px-3 py-2 rounded-xl text-[10px] font-black transition-all"
            style={showLowMarginOnly
              ? { background: 'rgba(249,115,22,0.2)', color: '#f97316', border: '1px solid rgba(249,115,22,0.4)' }
              : { background: 'rgba(255,255,255,0.07)', color: 'rgba(148,163,184,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}>
            Low Margin
          </button>
          <button onClick={() => setViewMode(v => v === 'table' ? 'cards' : 'table')}
            className="px-3 py-2 rounded-xl text-[10px] font-black"
            style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(148,163,184,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}>
            {viewMode === 'table' ? '⊞' : '≡'}
          </button>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-4">
        {/* Summary row */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Total Stock Value',  value: summary.totalStockVal,  color: '#60a5fa', icon: Package },
            { label: 'Total Cost Value',   value: summary.totalCostVal,   color: '#a78bfa', icon: DollarSign },
            { label: 'Gross Profit Pool',  value: summary.totalProfit,    color: '#34d399', icon: TrendingUp },
            { label: 'Avg Gross Margin',   value: null,                   color: getMarginColor(summary.avgMargin), icon: Percent,
              custom: `${summary.avgMargin.toFixed(1)}%` },
          ].map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={i} className="p-3 rounded-2xl"
                style={{ background: `${s.color}11`, border: `1px solid ${s.color}33` }}>
                <Icon size={14} style={{ color: s.color }} />
                <div className="text-lg font-black mt-1 leading-tight" style={{ color: s.color }}>
                  {s.custom || fmtCompact(s.value!)}
                </div>
                <div className="text-[8px] font-bold uppercase mt-0.5" style={{ color: `${s.color}88` }}>{s.label}</div>
              </div>
            );
          })}
        </div>

        {/* Alert badges */}
        <div className="flex gap-2 flex-wrap">
          {summary.lowMarginItems > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black"
              style={{ background: 'rgba(249,115,22,0.1)', color: '#f97316', border: '1px solid rgba(249,115,22,0.25)' }}>
              <AlertTriangle size={10} /> {summary.lowMarginItems} items with margin &lt; 15%
            </div>
          )}
          {summary.outOfStock > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black"
              style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}>
              <Package size={10} /> {summary.outOfStock} out of stock
            </div>
          )}
        </div>

        {/* Item list */}
        {viewMode === 'table' ? (
          <div>
            {/* Sort headers */}
            <div className="grid grid-cols-12 gap-1 px-3 pb-2">
              <div className="col-span-4"><SortBtn k="name"     label="Item"    /></div>
              <div className="col-span-2 text-right"><SortBtn k="stock"    label="Stock"  /></div>
              <div className="col-span-2 text-right"><SortBtn k="margin"   label="Margin" /></div>
              <div className="col-span-2 text-right"><SortBtn k="value"    label="Value"  /></div>
              <div className="col-span-2 text-right"><SortBtn k="turnover" label="T/O"    /></div>
            </div>

            <div className="space-y-2">
              {displayed.map(item => {
                const mColor = getMarginColor(item.margin);
                const expanded = expandedItem === item.id;
                return (
                  <div key={item.id || item.name}>
                    <button onClick={() => setExpandedItem(expanded ? null : (item.id || item.name))}
                      className="w-full grid grid-cols-12 gap-1 px-3 py-3 rounded-2xl text-left transition-all active:scale-[0.99]"
                      style={{ background: expanded ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                      <div className="col-span-4 min-w-0">
                        <p className="text-xs font-black truncate" style={{ color: 'rgba(226,232,240,0.9)' }}>{item.name}</p>
                        <p className="text-[8px] font-semibold" style={{ color: 'rgba(148,163,184,0.4)' }}>
                          {item.unit || 'Pcs'} · ₹{item.purchRate}→₹{item.saleRate}
                        </p>
                      </div>
                      <div className="col-span-2 text-right">
                        <p className="text-xs font-black" style={{ color: item.qty <= 0 ? '#f87171' : 'rgba(226,232,240,0.8)' }}>{item.qty}</p>
                        <p className="text-[8px]" style={{ color: 'rgba(148,163,184,0.35)' }}>{item.unit || 'Pcs'}</p>
                      </div>
                      <div className="col-span-2 text-right">
                        <p className="text-xs font-black" style={{ color: mColor }}>{item.margin.toFixed(1)}%</p>
                        {item.rateTrend.length >= 2 && (
                          <Sparkline data={item.rateTrend} color={mColor} w={40} h={12} />
                        )}
                      </div>
                      <div className="col-span-2 text-right">
                        <p className="text-xs font-black" style={{ color: 'rgba(203,213,225,0.8)' }}>{fmtCompact(item.stockVal)}</p>
                        <p className="text-[8px]" style={{ color: 'rgba(148,163,184,0.35)' }}>val</p>
                      </div>
                      <div className="col-span-2 text-right">
                        <p className="text-xs font-black" style={{ color: item.turnoverDays != null ? (item.turnoverDays <= 30 ? '#34d399' : item.turnoverDays <= 90 ? '#fbbf24' : '#f87171') : 'rgba(148,163,184,0.3)' }}>
                          {item.turnoverDays != null ? `${item.turnoverDays}d` : '—'}
                        </p>
                        <p className="text-[8px]" style={{ color: 'rgba(148,163,184,0.35)' }}>T/O</p>
                      </div>
                    </button>

                    {/* Expanded detail */}
                    {expanded && (
                      <div className="mx-2 rounded-b-2xl overflow-hidden"
                        style={{ background: 'rgba(255,255,255,0.04)', borderTop: '1px solid rgba(255,255,255,0.05)', marginTop: -4 }}>

                        {/* Key metrics row */}
                        <div className="grid grid-cols-3 gap-2 p-3">
                          {[
                            { label: 'Stock Value',  val: fmtINR(item.stockVal),  color: '#60a5fa' },
                            { label: 'Cost Value',   val: fmtINR(item.costVal),   color: '#a78bfa' },
                            { label: 'Profit Pool',  val: fmtINR(item.stockVal - item.costVal), color: '#34d399' },
                            { label: 'FIFO Cost',    val: fmtINR(item.fifoValue), color: '#fbbf24' },
                            { label: 'Sold 30d',     val: `${item.soldQty30} ${item.unit||''}`, color: '#f97316' },
                            { label: 'Profit/Unit',  val: fmtINR(item.profitPerUnit), color: getMarginColor(item.margin) },
                          ].map((m, i) => (
                            <div key={i} className="rounded-xl px-2 py-2"
                              style={{ background: `${m.color}11` }}>
                              <div className="text-[8px] font-bold uppercase" style={{ color: `${m.color}88` }}>{m.label}</div>
                              <div className="text-xs font-black" style={{ color: m.color }}>{m.val}</div>
                            </div>
                          ))}
                        </div>

                        {/* Purchase history */}
                        {item.history.length > 0 && (
                          <div className="px-3 pb-3">
                            <p className="text-[9px] font-black uppercase tracking-wide mb-2" style={{ color: 'rgba(148,163,184,0.4)' }}>
                              Last {item.history.length} Purchase{item.history.length > 1 ? 's' : ''}
                            </p>
                            <div className="space-y-1">
                                  {item.history.slice(0, 5).map((h: { date: string; rate: number; qty: number; total: number }, j: number) => {
                                  const isHigher = j > 0 && h.rate > item.history[j-1].rate;
                                  const isLower  = j > 0 && h.rate < item.history[j-1].rate;
                                  return (
                                    <div key={j} className="flex items-center justify-between py-1 px-2 rounded-lg"
                                    style={{ background: 'rgba(255,255,255,0.03)' }}>
                                    <span className="text-[9px] font-semibold" style={{ color: 'rgba(148,163,184,0.5)' }}>{h.date}</span>
                                    <span className="text-[9px] font-semibold" style={{ color: 'rgba(148,163,184,0.5)' }}>
                                    {h.qty} {item.unit || 'Pcs'}
                                    </span>
                                    <div className="flex items-center gap-1">
                                    {j > 0 && isHigher && <TrendingUp size={9} style={{ color: '#f87171' }} />}
                                    {j > 0 && isLower && <TrendingDown size={9} style={{ color: '#34d399' }} />}
                                    <span className="text-[10px] font-black" style={{ color: isHigher ? '#f87171' : isLower ? '#34d399' : 'rgba(203,213,225,0.7)' }}>
                                    ₹{h.rate.toLocaleString('en-IN')}
                                    </span>
                                    </div>
                                    </div>
                                  );
                                  })}
                            </div>
                            {item.avgPurchase > 0 && (
                              <div className="mt-2 flex items-center justify-between px-2 py-1.5 rounded-lg"
                                style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.15)' }}>
                                <span className="text-[9px] font-bold text-yellow-400">Avg Purchase Rate</span>
                                <span className="text-[10px] font-black text-yellow-400">₹{item.avgPurchase.toLocaleString('en-IN', {minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                              </div>
                            )}
                          </div>
                        )}
                        {item.history.length === 0 && (
                          <div className="px-3 pb-3">
                            <p className="text-[10px] font-semibold text-center py-2" style={{ color: 'rgba(148,163,184,0.3)' }}>
                              No purchase records found in ledger
                            </p>
                          </div>
                        )}

                        {onViewItem && (
                          <button onClick={() => onViewItem(item)}
                            className="w-full mx-0 px-4 py-2.5 text-[10px] font-black text-center"
                            style={{ background: 'rgba(79,70,229,0.1)', color: '#818cf8', borderTop: '1px solid rgba(79,70,229,0.15)' }}>
                            View Full Item Detail →
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* Card view */
          <div className="grid grid-cols-2 gap-3">
            {displayed.map(item => {
              const mColor = getMarginColor(item.margin);
              return (
                <button key={item.id || item.name}
                  onClick={() => setExpandedItem(expandedItem === (item.id||item.name) ? null : (item.id||item.name))}
                  className="text-left p-3 rounded-2xl transition-all active:scale-[0.97]"
                  style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${mColor}33` }}>
                  <p className="text-xs font-black truncate" style={{ color: 'rgba(226,232,240,0.9)' }}>{item.name}</p>
                  <div className="flex items-center justify-between mt-2">
                    <div>
                      <div className="text-[8px] font-bold" style={{ color: 'rgba(148,163,184,0.4)' }}>Stock Val</div>
                      <div className="text-sm font-black" style={{ color: '#60a5fa' }}>{fmtCompact(item.stockVal)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[8px] font-bold" style={{ color: 'rgba(148,163,184,0.4)' }}>Margin</div>
                      <div className="text-sm font-black" style={{ color: mColor }}>{item.margin.toFixed(0)}%</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[9px]" style={{ color: 'rgba(148,163,184,0.4)' }}>{item.qty} {item.unit||'Pcs'} in stock</span>
                    {item.rateTrend.length >= 2 && <Sparkline data={item.rateTrend} color={mColor} w={40} h={16} />}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {displayed.length === 0 && (
          <Card className="text-center py-8">
            <Package size={32} style={{ color: 'rgba(148,163,184,0.2)', margin: '0 auto 8px' }} />
            <p className="text-sm font-bold" style={{ color: 'rgba(148,163,184,0.4)' }}>No items found</p>
          </Card>
        )}
      </div>
    </div>
  );
};

export default StockValuationView;





