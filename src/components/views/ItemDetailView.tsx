import React, { useState, useEffect, useMemo } from 'react';
import { User } from 'firebase/auth';
import { 
  ArrowLeft, Search, Package, TrendingUp, TrendingDown,
  ShoppingCart, Truck, Hash, FileText, Download, Calendar
} from 'lucide-react';
import DateRangeFilter from '../common/DateRangeFilter';
import { ApiService } from '../../services/api';
import { exportService } from '../../services/export';
import { useUI } from '../../context/UIContext';
import { parseDateSafe, toDateStrSafe } from '../../utils/dateUtils';

interface ItemDetailViewProps {
  user: User;
  item: any;
  onBack: () => void;
}

function parseRecordDate(raw: any): Date {
  return parseDateSafe(raw);
}
function toDateString(raw: any): string {
  return toDateStrSafe(raw);
}

const ItemDetailView: React.FC<ItemDetailViewProps> = ({ user, item, onBack }) => {
  const { showToast } = useUI();
  const [loading, setLoading] = useState(true);
  const [ledgerEntries, setLedgerEntries] = useState<any[]>([]);
  const [parties, setParties] = useState<any[]>([]);
  
  // Filters
  const [activeTab, setActiveTab] = useState<'sales' | 'purchases'>('sales');
  const [searchTerm, setSearchTerm] = useState('');

  // Quick date filter — defaults to "fy" (current Indian Financial Year, Apr 1 → today).
  // 'fy'     → entire current financial year (Apr 1 → Mar 31; capped at today)
  // 'mN'     → that calendar month of the current FY (m0..m11, where 0 = Apr, 11 = Mar)
  // 'custom' → user-picked start/end dates (the inline DateRangeFilter is shown)
  type QuickKey = 'fy' | `m${number}` | 'custom';
  const [quickKey, setQuickKey] = useState<QuickKey>('fy');

  const fmtIso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Indian FY runs Apr 1 → Mar 31. If today is Jan/Feb/Mar, the FY started
  // last calendar year; otherwise it started this calendar year.
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

  // Month index 0..11 maps to Apr..Mar in FY order.
  // Months 0..8 (Apr..Dec) live in fyStartYear; 9..11 (Jan..Mar) live in fyStartYear+1.
  const monthRange = (fyMonthIdx: number) => {
    const calendarMonth = (3 + fyMonthIdx) % 12;                 // 3=Apr ... 2=Mar
    const yearOffset    = fyMonthIdx <= 8 ? 0 : 1;
    const year          = fyInfo.fyStartYear + yearOffset;
    const start = new Date(year, calendarMonth, 1);
    const end   = new Date(year, calendarMonth + 1, 0);          // last day of month
    return { start: fmtIso(start), end: fmtIso(end) };
  };

  // Apply a quick filter — keeps quickKey in sync with the actual range.
  const applyQuick = (key: QuickKey) => {
    setQuickKey(key);
    if (key === 'fy') {
      // Cap end at today so future-dated entries inside the FY aren't included
      // until they actually occur (matches the previous "year" behaviour).
      const fyEndIso = fmtIso(fyInfo.end);
      setDateRange({ start: fmtIso(fyInfo.start), end: todayIso < fyEndIso ? todayIso : fyEndIso });
    } else if (key !== 'custom') {
      const m = parseInt(key.slice(1), 10);
      setDateRange(monthRange(m));
    }
    // 'custom' leaves the existing range alone — the user will adjust it
    // via the inline date-range picker that becomes visible.
  };

  // Month chip labels in FY order (Apr → Mar).
  const MONTH_LABELS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

  useEffect(() => {
    loadData();
  }, [user, item]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [ledgerSnap, partySnap] = await Promise.all([
        ApiService.getAll(user.uid, 'ledger_entries'),
        ApiService.getAll(user.uid, 'parties')
      ]);
      
      // Filter entries that contain this item
      const allEntries = ledgerSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const itemEntries = allEntries.filter((entry: any) => 
        entry.items?.some((i: any) => 
          i.item_name?.toLowerCase() === item.name?.toLowerCase()
        )
      );
      itemEntries.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setLedgerEntries(itemEntries);
      
      setParties(partySnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error(e);
      showToast("Failed to load data", "error");
    } finally {
      setLoading(false);
    }
  };

  // Filtered entries based on tab, search, and date
  const filteredEntries = useMemo(() => {
    return ledgerEntries.filter(entry => {
      const matchesType = activeTab === 'sales' ? entry.type === 'sell' : entry.type === 'purchase';
      const matchesSearch = entry.party_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           entry.invoice_no?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesDate = toDateString(entry.date) >= dateRange.start && toDateString(entry.date) <= dateRange.end;
      return matchesType && matchesSearch && matchesDate;
    });
  }, [ledgerEntries, activeTab, searchTerm, dateRange]);

  // Party suggestions based on tab
  const searchSuggestions = useMemo(() => {
    return parties.filter(p => {
      if (activeTab === 'sales') return p.role === 'customer';
      return p.role === 'supplier';
    }).map(p => p.name);
  }, [parties, activeTab]);

  // Calculate stats for the current item
  const stats = useMemo(() => {
    let totalQuantity = 0;
    let totalAmount = 0;

    filteredEntries.forEach(entry => {
      entry.items?.forEach((i: any) => {
        if (i.item_name?.toLowerCase() === item.name?.toLowerCase()) {
          totalQuantity += Number(i.quantity) || 0;
          totalAmount += Number(i.total) || (Number(i.quantity) * Number(i.rate)) || 0;
        }
      });
    });

    return {
      totalRecords: filteredEntries.length,
      totalQuantity: Math.round(totalQuantity),
      totalAmount: Math.round(totalAmount)
    };
  }, [filteredEntries, item]);

  // Get item-specific data from an entry
  const getItemFromEntry = (entry: any) => {
    return entry.items?.find((i: any) => 
      i.item_name?.toLowerCase() === item.name?.toLowerCase()
    ) || { quantity: 0, rate: 0, total: 0, unit: item.unit };
  };

  const handleExport = async () => {
    if (filteredEntries.length === 0) return showToast("No data to export", "error");
    
    const data = filteredEntries.map(entry => {
      const itemData = getItemFromEntry(entry);
      return {
        Date: entry.date,
        Invoice: entry.invoice_no || '-',
        Type: entry.type === 'sell' ? 'Sale' : 'Purchase',
        Party: entry.party_name,
        Quantity: `${itemData.quantity} ${itemData.unit || item.unit}`,
        Rate: itemData.rate,
        Amount: itemData.total || (itemData.quantity * itemData.rate)
      };
    });

    await exportService.exportToCSV(
      data, 
      Object.keys(data[0]), 
      `${item.name}_${activeTab}.csv`
    );
    showToast("Excel Downloaded", "success");
  };

  return (
    <div className="h-full overflow-y-auto" style={{background: 'var(--app-bg)'}}>
      
      {/* HEADER - FIXED */}
      <div className="sticky top-0 z-30 flex justify-between items-center px-3 md:px-6 pb-3" style={{paddingTop: '16px', background:"rgba(var(--app-bg-rgb),0.92)", backdropFilter:"blur(20px)"}}>
        <div className="flex items-center gap-3">
          <button 
            onClick={onBack} 
            className="p-2 rounded-full active:scale-95 transition-all transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl font-black leading-none">
              {item.name}
            </h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase">
              Item Details • {stats.totalRecords} Records
            </p>
          </div>
        </div>
        <button 
          onClick={handleExport} 
          className="p-2.5 rounded-xl active:scale-95 transition-all glass-icon-btn text-emerald-400"
        >
          <Download size={18}/>
        </button>
      </div>

      {/* SCROLLABLE CONTENT */}
      <div className="px-3 md:px-6">
        {/* ITEM INFO CARD */}
        <div className="p-4 rounded-2xl mb-3">
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Package size={16} className="text-blue-500" />
              <span className="text-xs font-bold text-[rgba(148,163,184,0.45)]">Current Stock</span>
            </div>
            <div className="text-2xl font-black ">
              {item.current_stock} <span className="text-sm text-[rgba(148,163,184,0.45)]">{item.unit}</span>
            </div>
          </div>
          <div className="flex gap-4 text-right">
            <div>
              <div className="flex items-center gap-1 text-[10px] text-slate-400 font-bold justify-end">
                <TrendingDown size={10} className="text-green-500" /> Buy
              </div>
              <div className="font-bold text-[rgba(203,213,225,0.75)]">₹{item.purchase_rate || 0}</div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-[10px] text-slate-400 font-bold justify-end">
                <TrendingUp size={10} className="text-blue-500" /> Sell
              </div>
              <div className="font-bold ">₹{item.sale_rate || 0}</div>
            </div>
          </div>
        </div>
        {item.hsn_code && (
          <div className="mt-2 pt-2 border-t border-dashed border-white/08 flex gap-2">
            <span className="text-[10px] text-slate-400 text-[rgba(203,213,225,0.7)] px-2 py-0.5 rounded font-bold">
              HSN: {item.hsn_code}
            </span>
            <span className="text-[10px] text-slate-400 text-[rgba(203,213,225,0.7)] px-2 py-0.5 rounded font-bold">
              GST: {item.gst_percent || 0}%
            </span>
          </div>
        )}
      </div>

      {/* TAB TOGGLE */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setActiveTab('sales')}
          className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
            activeTab === 'sales'
              ? 'bg-green-500 text-white shadow-lg shadow-green-500/20'
              : 'border border-white/12 text-slate-400'
          }`}
        >
          <ShoppingCart size={16} />
          Sales
        </button>
        <button
          onClick={() => setActiveTab('purchases')}
          className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
            activeTab === 'purchases'
              ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20'
              : 'border border-white/12 text-slate-400'
          }`}
        >
          <Truck size={16} />
          Purchases
        </button>
      </div>

      {/* STATS SUMMARY CARD */}
      <div className={`p-4 rounded-2xl shadow-lg mb-3 flex justify-between items-center relative overflow-hidden ${
        activeTab === 'sales' ? 'bg-green-600' : 'bg-orange-600'
      } text-white`}>
        <div className="relative z-10">
          <div className="text-[10px] font-bold opacity-70 uppercase mb-0.5">
            {activeTab === 'sales' ? 'Total Sales' : 'Total Purchases'}
          </div>
          <div className="text-2xl font-black leading-none mb-2">
            ₹{stats.totalAmount.toLocaleString('en-IN')}
          </div>
          <div className="flex gap-3">
            <div className="flex items-center gap-1.5 bg-[rgba(255,255,255,0.06)]/10 px-2 py-1 rounded-lg">
              <Package size={12} />
              <span className="text-[10px] font-bold uppercase">
                Qty: {stats.totalQuantity} {item.unit}
              </span>
            </div>
            <div className="flex items-center gap-1.5 bg-[rgba(255,255,255,0.06)]/10 px-2 py-1 rounded-lg">
              <Hash size={12} />
              <span className="text-[10px] font-bold uppercase">
                Records: {stats.totalRecords}
              </span>
            </div>
          </div>
        </div>
        <div className="bg-[rgba(255,255,255,0.06)]/10 p-3 rounded-full relative z-10">
          {activeTab === 'sales' ? <ShoppingCart size={24} /> : <Truck size={24} />}
        </div>
        {activeTab === 'sales' ? (
          <TrendingUp size={80} className="absolute -bottom-4 -right-4 opacity-10 pointer-events-none" />
        ) : (
          <TrendingDown size={80} className="absolute -bottom-4 -right-4 opacity-10 pointer-events-none" />
        )}
      </div>

      {/* SEARCH + QUICK DATE FILTER */}
      <div className="p-2.5 rounded-xl mb-3 space-y-2 border border-white/08" style={{background:"rgba(255,255,255,0.04)"}}>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={14}/>
            <input 
              className="w-full pl-8 p-2 border border-white/12 rounded-lg text-xs font-bold outline-none" 
              placeholder={activeTab === 'sales' ? "Search Customer..." : "Search Supplier..."} 
              value={searchTerm} 
              onChange={e => setSearchTerm(e.target.value)}
              list="item-search-suggestions" 
            />
            <datalist id="item-search-suggestions">
              {searchSuggestions.map((name, i) => <option key={i} value={name} />)}
            </datalist>
          </div>
        </div>

        {/* Quick range chips — Current Year (default) / Jan…Dec / Custom.
            Horizontally scrollable so all 14 chips fit on a phone screen. */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 -mx-0.5 px-0.5"
          style={{ scrollbarWidth: 'none' }}>
          {([
            { key: 'fy' as QuickKey, label: fyInfo.label },
            ...MONTH_LABELS.map((m, i) => ({ key: `m${i}` as QuickKey, label: m })),
            { key: 'custom' as QuickKey, label: 'Custom' },
          ]).map(opt => {
            const active = quickKey === opt.key;
            const isCustom = opt.key === 'custom';
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => applyQuick(opt.key)}
                className={`flex-shrink-0 px-2.5 py-1 rounded-full text-[11px] font-black transition-all flex items-center gap-1 ${
                  active
                    ? activeTab === 'sales'
                      ? 'bg-green-500 text-white shadow-md shadow-green-500/30'
                      : 'bg-orange-500 text-white shadow-md shadow-orange-500/30'
                    : 'border border-white/12 text-slate-400 active:scale-95'
                }`}
              >
                {isCustom && <Calendar size={10} />}
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Inline range picker — shown only when "Custom" is selected so it
            doesn't crowd the screen during the common quick-filter flow. */}
        {quickKey === 'custom' && (
          <DateRangeFilter
            start={dateRange.start}
            end={dateRange.end}
            onStartChange={v => setDateRange(r => ({...r, start: v}))}
            onEndChange={v => setDateRange(r => ({...r, end: v}))}
          />
        )}
      </div>

      {/* ENTRIES LIST */}
      <div className="space-y-1.5 pb-20">
        {loading ? (
          <div className="text-center py-10 text-[rgba(148,163,184,0.45)] text-xs">Loading...</div>
        ) : filteredEntries.length === 0 ? (
          <div className="text-center py-10 text-[rgba(148,163,184,0.45)] text-xs">
            No {activeTab} found for this item
          </div>
        ) : filteredEntries.map(entry => {
          const itemData = getItemFromEntry(entry);
          const itemAmount = itemData.total || (itemData.quantity * itemData.rate);

          return (
            <div 
              key={entry.id} 
              className="p-3 rounded-xl relative overflow-hidden"
            >
              <div className={`absolute left-0 top-0 bottom-0 w-1 ${
                entry.type === 'sell' ? 'bg-green-500' : 'bg-orange-500'
              }`}></div>

              <div className="pl-2">
                {/* DATE & INVOICE */}
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-[rgba(148,163,184,0.45)]">{entry.date}</span>
                    {entry.invoice_no && (
                      <span className="text-[9px] font-bold text-slate-400 px-1.5 py-0.5 rounded flex items-center gap-1">
                        <FileText size={8}/> #{entry.invoice_no}
                      </span>
                    )}
                  </div>
                  <span className={`text-[9px] font-black uppercase ${
                    entry.type === 'sell' ? 'text-green-600' : 'text-orange-500'
                  }`}>
                    {entry.type === 'sell' ? 'SALE' : 'PURCHASE'}
                  </span>
                </div>

                {/* PARTY & AMOUNT */}
                <div className="flex justify-between items-center mb-2">
                  <div className="font-bold text-sm truncate max-w-[60%]">
                    {entry.party_name}
                  </div>
                  <div className="text-right">
                    <div className="font-black text-base text-[rgba(226,232,240,0.88)] text-[rgba(240,244,255,0.95)]">
                      ₹{Math.round(itemAmount).toLocaleString('en-IN')}
                    </div>
                  </div>
                </div>

                {/* ITEM DETAILS */}
                <div className="overflow-x-auto pt-2 border-t border-dashed border-white/08 -mx-1 px-1">
                  <div className="flex items-center gap-3 text-[11px] text-slate-500 whitespace-nowrap min-w-0">
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Package size={12} className="" style={{color:"rgba(148,163,184,0.45)"}}/>
                      <span className="font-bold">{itemData.quantity} {itemData.unit || item.unit}</span>
                    </div>
                    <span className="text-slate-300 flex-shrink-0">×</span>
                    <span className="font-bold flex-shrink-0">₹{itemData.rate}/{item.unit}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
};

export default ItemDetailView;








