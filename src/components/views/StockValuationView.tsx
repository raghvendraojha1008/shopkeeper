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
  if (m >= 30) return "var(--col-success)";
  if (m >= 15) return "var(--col-warning)";
  if (m >= 0)  return "var(--col-orange)";
  return "var(--col-danger)";
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
    style={{ background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)', ...style }}>
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
      const { buildPdf, drawPdfHeader, drawSummaryBoxes, addPageFooters, tableStyles, pdfRupee } = await import('../../utils/professionalPdf');
      const { doc, PW, m, autoTable } = await buildPdf('landscape');

      let y = drawPdfHeader(doc, PW, { firm: firmName, title: 'Stock Valuation Report' });
      y = drawSummaryBoxes(doc, y, PW, m, [
        { label: 'Stock Value',  value: pdfRupee(summary.totalStockVal) },
        { label: 'Cost Value',   value: pdfRupee(summary.totalCostVal) },
        { label: 'Gross Profit', value: pdfRupee(summary.totalProfit) },
        { label: 'Avg Margin',   value: `${summary.avgMargin.toFixed(1)}%` },
        { label: 'Total Items',  value: String(enrichedItems.length) },
      ]);

      const head = [['Item', 'Stock', 'Pur. Rate', 'Sale Rate', 'Margin %', 'Stock Value', 'Cost Value', 'Profit/Unit', 'Sold (30d)', 'Turnover']];
      const rows = displayed.map(i => [
        i.name,
        `${i.qty} ${i.unit || ''}`,
        pdfRupee(i.purchRate),
        pdfRupee(i.saleRate),
        `${i.margin.toFixed(1)}%`,
        pdfRupee(i.stockVal),
        pdfRupee(i.costVal),
        pdfRupee(i.profitPerUnit),
        i.soldQty30 > 0 ? `${i.soldQty30} / 30d` : '—',
        i.turnoverDays != null ? `${i.turnoverDays}d` : '—',
      ]);

      // CHUNKED RENDER — same fix applied to the Inventory export. A single
      // autoTable() call over a very large stock list can exhaust memory on
      // Android WebView; rendering in fixed-size batches (own page each) keeps
      // peak memory low and prevents the export from silently failing.
      const CHUNK_SIZE = 250;
      let startY = y;
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        autoTable(doc, {
          startY,
          margin: { left: m, right: m },
          head,
          body: chunk,
          ...tableStyles([5, 6, 7]),
          columnStyles: { 0: { cellWidth: 38 }, 4: { halign: 'right' as any } },
          didParseCell: (data: any) => {
            if (data.section === 'body' && data.column.index === 4) {
              const val = parseFloat(String(data.cell.raw));
              data.cell.styles.textColor = val >= 30 ? [5, 120, 60] : val >= 15 ? [150, 120, 11] : [180, 30, 30];
              data.cell.styles.fontStyle = 'bold';
            }
          },
        });
        if (i + CHUNK_SIZE < rows.length) {
          doc.addPage();
          startY = 12;
          await new Promise(r => setTimeout(r, 0));
        }
      }

      addPageFooters(doc, firmName);
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
      className="flex items-center gap-0.5 text-app-2xs font-black uppercase tracking-wide transition-all"
      style={{ color: sortKey === k ? "var(--col-violet)" : 'var(--text-muted)' }}>
      {label}
      {sortKey === k && (sortAsc ? <ArrowUpRight size={8} /> : <ArrowDownRight size={8} />)}
    </button>
  );

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto pb-24" style={{ background: 'var(--app-bg)' }}>
      {/* Header */}
      <div className="sticky top-0 z-30 px-4 pb-3"
        style={{paddingTop: '16px',  background: 'rgba(var(--app-bg-rgb),0.95)', backdropFilter: 'blur(20px)', borderBottom: '1px solid var(--glass-border)' }}>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-2xl active:scale-95"
            style={{ background: 'var(--rgba-white-08)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-black text-white">Stock Valuation</h1>
            <p className="text-app-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              FIFO · Purchase history · Margin analysis
            </p>
          </div>
          <button onClick={exportPDF} disabled={exporting}
            className="p-2 rounded-2xl active:scale-95"
            style={{ background: 'var(--col-info-15)', border: '1px solid var(--col-info-35)', color: "var(--col-info)" }}>
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          </button>
        </div>

        {/* Search + filter */}
        <div className="flex gap-2 mt-3">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search items…"
            className="flex-1 text-xs font-bold px-3 py-2 rounded-xl outline-none"
            style={{ background: 'var(--rgba-white-08)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }} />
          <button onClick={() => setShowLowMarginOnly(v => !v)}
            className="px-3 py-2 rounded-xl text-app-sm font-black transition-all"
            style={showLowMarginOnly
              ? { background: 'rgba(249,115,22,0.2)', color: "var(--col-orange)", border: '1px solid rgba(249,115,22,0.4)' }
              : { background: 'var(--rgba-white-07)', color: 'var(--text-muted)', border: '1px solid var(--glass-border)' }}>
            Low Margin
          </button>
          <button onClick={() => setViewMode(v => v === 'table' ? 'cards' : 'table')}
            className="px-3 py-2 rounded-xl text-app-sm font-black"
            style={{ background: 'var(--rgba-white-07)', color: 'var(--text-muted)', border: '1px solid var(--glass-border)' }}>
            {viewMode === 'table' ? '⊞' : '≡'}
          </button>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-4">
        {/* Summary row */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Total Stock Value',  value: summary.totalStockVal,  color: "var(--col-info)", icon: Package },
            { label: 'Total Cost Value',   value: summary.totalCostVal,   color: "var(--col-violet)", icon: DollarSign },
            { label: 'Gross Profit Pool',  value: summary.totalProfit,    color: "var(--col-success)", icon: TrendingUp },
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
                <div className="text-app-2xs font-bold uppercase mt-0.5" style={{ color: `${s.color}88` }}>{s.label}</div>
              </div>
            );
          })}
        </div>

        {/* Alert badges */}
        <div className="flex gap-2 flex-wrap">
          {summary.lowMarginItems > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-app-sm font-black"
              style={{ background: 'rgba(249,115,22,0.1)', color: "var(--col-orange)", border: '1px solid rgba(249,115,22,0.25)' }}>
              <AlertTriangle size={10} /> {summary.lowMarginItems} items with margin &lt; 15%
            </div>
          )}
          {summary.outOfStock > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-app-sm font-black"
              style={{ background: 'var(--col-danger-15)', color: "var(--col-danger)", border: '1px solid var(--col-danger-25)' }}>
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
                      style={{ background: expanded ? 'var(--rgba-white-07)' : 'var(--rgba-white-03)', border: '1px solid var(--glass-border)' }}>
                      <div className="col-span-4 min-w-0">
                        <p className="text-xs font-black truncate" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
                        <p className="text-app-2xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                          {item.unit || 'Pcs'} · ₹{item.purchRate}→₹{item.saleRate}
                        </p>
                      </div>
                      <div className="col-span-2 text-right">
                        <p className="text-xs font-black" style={{ color: item.qty <= 0 ? "var(--col-danger)" : 'var(--text-secondary)' }}>{item.qty}</p>
                        <p className="text-app-2xs" style={{ color: 'var(--text-muted)' }}>{item.unit || 'Pcs'}</p>
                      </div>
                      <div className="col-span-2 text-right">
                        <p className="text-xs font-black" style={{ color: mColor }}>{item.margin.toFixed(1)}%</p>
                        {item.rateTrend.length >= 2 && (
                          <Sparkline data={item.rateTrend} color={mColor} w={40} h={12} />
                        )}
                      </div>
                      <div className="col-span-2 text-right">
                        <p className="text-xs font-black" style={{ color: 'var(--text-secondary)' }}>{fmtCompact(item.stockVal)}</p>
                        <p className="text-app-2xs" style={{ color: 'var(--text-muted)' }}>val</p>
                      </div>
                      <div className="col-span-2 text-right">
                        <p className="text-xs font-black" style={{ color: item.turnoverDays != null ? (item.turnoverDays <= 30 ? "var(--col-success)" : item.turnoverDays <= 90 ? "var(--col-warning)" : "var(--col-danger)") : 'var(--text-muted)' }}>
                          {item.turnoverDays != null ? `${item.turnoverDays}d` : '—'}
                        </p>
                        <p className="text-app-2xs" style={{ color: 'var(--text-muted)' }}>T/O</p>
                      </div>
                    </button>

                    {/* Expanded detail */}
                    {expanded && (
                      <div className="mx-2 rounded-b-2xl overflow-hidden"
                        style={{ background: 'var(--rgba-white-04)', borderTop: '1px solid var(--glass-border)', marginTop: -4 }}>

                        {/* Key metrics row */}
                        <div className="grid grid-cols-3 gap-2 p-3">
                          {[
                            { label: 'Stock Value',  val: fmtINR(item.stockVal),  color: "var(--col-info)" },
                            { label: 'Cost Value',   val: fmtINR(item.costVal),   color: "var(--col-violet)" },
                            { label: 'Profit Pool',  val: fmtINR(item.stockVal - item.costVal), color: "var(--col-success)" },
                            { label: 'FIFO Cost',    val: fmtINR(item.fifoValue), color: "var(--col-warning)" },
                            { label: 'Sold 30d',     val: `${item.soldQty30} ${item.unit||''}`, color: "var(--col-orange)" },
                            { label: 'Profit/Unit',  val: fmtINR(item.profitPerUnit), color: getMarginColor(item.margin) },
                          ].map((m, i) => (
                            <div key={i} className="rounded-xl px-2 py-2"
                              style={{ background: `${m.color}11` }}>
                              <div className="text-app-2xs font-bold uppercase" style={{ color: `${m.color}88` }}>{m.label}</div>
                              <div className="text-xs font-black" style={{ color: m.color }}>{m.val}</div>
                            </div>
                          ))}
                        </div>

                        {/* Purchase history */}
                        {item.history.length > 0 && (
                          <div className="px-3 pb-3">
                            <p className="text-app-xs font-black uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
                              Last {item.history.length} Purchase{item.history.length > 1 ? 's' : ''}
                            </p>
                            <div className="space-y-1">
                                  {item.history.slice(0, 5).map((h: { date: string; rate: number; qty: number; total: number }, j: number) => {
                                  const isHigher = j > 0 && h.rate > item.history[j-1].rate;
                                  const isLower  = j > 0 && h.rate < item.history[j-1].rate;
                                  return (
                                    <div key={j} className="flex items-center justify-between py-1 px-2 rounded-lg"
                                    style={{ background: 'var(--rgba-white-03)' }}>
                                    <span className="text-app-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{h.date}</span>
                                    <span className="text-app-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                                    {h.qty} {item.unit || 'Pcs'}
                                    </span>
                                    <div className="flex items-center gap-1">
                                    {j > 0 && isHigher && <TrendingUp size={9} style={{ color: "var(--col-danger)" }} />}
                                    {j > 0 && isLower && <TrendingDown size={9} style={{ color: "var(--col-success)" }} />}
                                    <span className="text-app-sm font-black" style={{ color: isHigher ? "var(--col-danger)" : isLower ? "var(--col-success)" : 'var(--text-secondary)' }}>
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
                                <span className="text-app-xs font-bold text-yellow-400">Avg Purchase Rate</span>
                                <span className="text-app-sm font-black text-yellow-400">₹{item.avgPurchase.toLocaleString('en-IN', {minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                              </div>
                            )}
                          </div>
                        )}
                        {item.history.length === 0 && (
                          <div className="px-3 pb-3">
                            <p className="text-app-sm font-semibold text-center py-2" style={{ color: 'var(--text-muted)' }}>
                              No purchase records found in ledger
                            </p>
                          </div>
                        )}

                        {onViewItem && (
                          <button onClick={() => onViewItem(item)}
                            className="w-full mx-0 px-4 py-2.5 text-app-sm font-black text-center"
                            style={{ background: 'var(--col-indigo-15)', color: "var(--col-indigo)", borderTop: '1px solid var(--col-indigo-15)' }}>
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
                  style={{ background: 'var(--rgba-white-04)', border: `1px solid ${mColor}33` }}>
                  <p className="text-xs font-black truncate" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
                  <div className="flex items-center justify-between mt-2">
                    <div>
                      <div className="text-app-2xs font-bold" style={{ color: 'var(--text-muted)' }}>Stock Val</div>
                      <div className="text-sm font-black" style={{ color: "var(--col-info)" }}>{fmtCompact(item.stockVal)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-app-2xs font-bold" style={{ color: 'var(--text-muted)' }}>Margin</div>
                      <div className="text-sm font-black" style={{ color: mColor }}>{item.margin.toFixed(0)}%</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-app-xs" style={{ color: 'var(--text-muted)' }}>{item.qty} {item.unit||'Pcs'} in stock</span>
                    {item.rateTrend.length >= 2 && <Sparkline data={item.rateTrend} color={mColor} w={40} h={16} />}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {displayed.length === 0 && (
          <Card className="text-center py-8">
            <Package size={32} style={{ color: 'var(--text-muted)', margin: '0 auto 8px' }} />
            <p className="text-sm font-bold" style={{ color: 'var(--text-muted)' }}>No items found</p>
          </Card>
        )}
      </div>
    </div>
  );
};

export default StockValuationView;





