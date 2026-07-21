import React, { useState, useEffect, useMemo } from 'react';
import { useBackHandler } from '../../services/useBackHandler';
import { 
  Lock, TrendingUp, Settings, Delete, 
  Calendar, Download, AlertCircle, ChevronLeft, 
  Package, Edit2, Check, User, ArrowRight, X
} from 'lucide-react';
import DateRangeFilter from '../common/DateRangeFilter';
import { ApiService } from '../../services/api'; 
import { exportService } from '../../services/export';
import { useUI } from '../../context/UIContext';
import ReauthModal from '../common/ReauthModal';
import { getPinStrength } from '../../utils/passwordStrength';
import { getDefaultDateRange } from '../../utils/filterPeriod';

// Add CSS to hide spinners + light-mode lock-screen overrides
const styles = `
  .no-spinner::-webkit-inner-spin-button, 
  .no-spinner::-webkit-outer-spin-button { 
    -webkit-appearance: none; 
    margin: 0; 
  }
  .no-spinner {
    -moz-appearance: textfield;
  }

  /* ── Lock screen — light mode ── */
  [data-theme-mode="light"] .insight-lock-screen {
    background: var(--app-bg) !important;
  }
  [data-theme-mode="light"] .insight-back-btn {
    background: var(--surface-2) !important;
    border-color: var(--glass-border) !important;
    color: var(--text-primary) !important;
  }
  [data-theme-mode="light"] .insight-keypad-btn {
    background: var(--surface-2) !important;
    border-color: var(--glass-border) !important;
    color: var(--text-primary) !important;
  }
  [data-theme-mode="light"] .insight-keypad-btn:hover {
    background: var(--surface-3) !important;
  }
  [data-theme-mode="light"] .insight-modal-root .border-white\/12,
  [data-theme-mode="light"] .insight-modal-root .border-white\/10 {
    border-color: var(--glass-border) !important;
  }
`;

interface InsightModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: any;
  appSettings?: any;
}

const InsightModal: React.FC<InsightModalProps> = ({ isOpen, onClose, user, appSettings }) => {
  const { showToast } = useUI();

  // Register with central back stack — Android back closes this modal
  useBackHandler(onClose, isOpen, 10);
  
  // --- AUTH STATE ---
  const [isLocked, setIsLocked] = useState(true);
  const [pin, setPin] = useState('');
  const [storedPin, setStoredPin] = useState(localStorage.getItem('insight_pin') || '1234');
  const [changingPin, setChangingPin] = useState(false);
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  const [showReauth, setShowReauth] = useState(false);
  const [wrongAttempts, setWrongAttempts] = useState(0);

  // ── 5-minute grace period ─────────────────────────────────────────────────
  // If the modal was unlocked less than 5 min ago this session, skip PIN.
  const GRACE_MS = 5 * 60 * 1000;
  const GRACE_KEY = 'insight_unlocked_at';

  // --- DATA STATE ---
  const [loading, setLoading] = useState(false);
  const [inventory, setInventory] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  
  // --- SETTINGS STATE ---
  // Key format: "ItemName-HSN-GST" to ensure uniqueness
  const [margins, setMargins] = useState<Record<string, number>>(() => {
      const saved = localStorage.getItem('insight_margins');
      return saved ? JSON.parse(saved) : {};
  });

  const [profitOverrides, setProfitOverrides] = useState<Record<string, number>>(() => {
      const saved = localStorage.getItem('insight_profit_overrides');
      return saved ? JSON.parse(saved) : {};
  });

  const [editingProfitId, setEditingProfitId] = useState<string | null>(null);
  const [tempProfit, setTempProfit] = useState('');

  const [dateRange, setDateRange] = useState(() => {
    const dr = getDefaultDateRange(appSettings);
    if (dr.start || dr.end) return dr;
    return { start: '', end: '' };
  });

  const [activeView, setActiveView] = useState<'report' | 'margins'>('report');

  // On open: check grace period; on close: reset pin input and wrong attempts
  useEffect(() => {
      if (!isOpen) {
          setPin('');
          setWrongAttempts(0);
          // Don't setIsLocked(true) here — let grace period persist across reopens
      } else {
          const lastUnlock = parseInt(sessionStorage.getItem(GRACE_KEY) ?? '0', 10);
          if (Date.now() - lastUnlock < GRACE_MS) {
              setIsLocked(false);   // still within grace → skip PIN
          } else {
              setIsLocked(true);    // grace expired → require PIN
          }
      }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Load data whenever lock is lifted
  useEffect(() => {
      if (isOpen && !isLocked && user) {
          loadData();
      }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isLocked, user]);

  const loadData = async () => {
      setLoading(true);
      try {
          const [invSnap, ledgerSnap] = await Promise.all([
              ApiService.getAll(user.uid, 'inventory'),
              ApiService.getAll(user.uid, 'ledger_entries')
          ]);

          setInventory(invSnap.docs.map(d => d.data()));
          const allSales = ledgerSnap.docs
              .map(d => ({id: d.id, ...d.data()}))
              .filter((d: any) => d.type === 'sell');
          
          setSales(allSales);
      } catch (e) {
          console.error(e);
          showToast("Failed to load data", "error");
      } finally {
          setLoading(false);
      }
  };

  // --- HELPERS ---
  const getItemKey = (name: string, hsn: string | number, gst: string | number) => {
      return `${name?.trim()}-${hsn || ''}-${gst || 0}`;
  };

  // --- LOGIC ---
  const handleNumClick = (num: string) => {
      if (pin.length < 4) {
          if (navigator.vibrate) navigator.vibrate(10);
          const nextPin = pin + num;
          setPin(nextPin);
          if (nextPin.length === 4) setTimeout(() => validatePin(nextPin), 200);
      }
  };

  const handleBackspace = () => {
      if (navigator.vibrate) navigator.vibrate(10);
      setPin(prev => prev.slice(0, -1));
  };

  const validatePin = (inputPin: string) => {
      if (inputPin === storedPin) {
          sessionStorage.setItem(GRACE_KEY, String(Date.now()));
          setIsLocked(false);
          setPin('');
          setShowReauth(false);
          setWrongAttempts(0);
          if (navigator.vibrate) navigator.vibrate([10, 30, 10]);
      } else {
          setWrongAttempts(w => w + 1);
          showToast("Incorrect PIN", "error");
          setPin('');
          if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
      }
  };

  const handleClearInsightPin = () => {
      localStorage.removeItem('insight_pin');
      setStoredPin('1234');
      setShowReauth(false);
      setPin('');
      sessionStorage.setItem(GRACE_KEY, String(Date.now()));
      showToast("Insight PIN reset to default (1234)", "success");
      setIsLocked(false);
  };

  const handleChangePin = () => {
      if (oldPin !== storedPin) return showToast("Current PIN is incorrect", "error");
      if (newPin.length < 4) return showToast("New PIN must be 4 digits", "error");
      if (newPin !== confirmNewPin) return showToast("PINs do not match", "error");
      localStorage.setItem('insight_pin', newPin);
      setStoredPin(newPin);
      setChangingPin(false);
      setOldPin('');
      setNewPin('');
      setConfirmNewPin('');
      showToast("Security PIN Updated", "success");
  };

  const handleMarginChange = (key: string, val: string) => {
      const num = parseFloat(val) || 0;
      setMargins(prev => {
          const updated = { ...prev, [key]: num };
          localStorage.setItem('insight_margins', JSON.stringify(updated));
          return updated;
      });
  };

  const startEditingProfit = (id: string, currentVal: number) => {
      setEditingProfitId(id);
      setTempProfit(currentVal.toString());
  };

  const saveProfitOverride = (id: string) => {
      const num = parseFloat(tempProfit);
      if (!isNaN(num)) {
          setProfitOverrides(prev => {
              const updated = { ...prev, [id]: num };
              localStorage.setItem('insight_profit_overrides', JSON.stringify(updated));
              return updated;
          });
      }
      setEditingProfitId(null);
  };

  const processedData = useMemo(() => {
      if (!sales.length) return { totalProfit: 0, rows: [] };

      let totalProfit = 0;
      const rows: any[] = [];

      sales.forEach(sale => {
          if (dateRange.start && sale.date < dateRange.start) return;
          if (dateRange.end && sale.date > dateRange.end) return;

          (sale.items || []).forEach((item: any, index: number) => {
              const rowId = `${sale.id}_${index}`;
              const qty = Number(item.quantity) || 0;
              const rate = Number(item.rate) || 0;
              
              // Generate Composite Key for Lookup
              const marginKey = getItemKey(item.item_name, item.hsn_code, item.gst_percent);
              const marginPerUnit = margins[marginKey] || 0;
              
              const defaultProfit = qty * marginPerUnit;
              const itemProfit = profitOverrides[rowId] !== undefined ? profitOverrides[rowId] : defaultProfit;

              totalProfit += itemProfit;

              rows.push({
                  id: rowId,
                  date: sale.date,
                  invoice: sale.invoice_no,
                  customer: sale.party_name,
                  item: item.item_name,
                  hsn: item.hsn_code || '-',
                  gst: item.gst_percent || 0,
                  qty: qty,
                  rate: rate,
                  profit: itemProfit,
                  isOverridden: profitOverrides[rowId] !== undefined
              });
          });
      });

      rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      return { totalProfit, rows };
  }, [sales, margins, profitOverrides, dateRange]);

  const handleDownload = async () => {
      if (processedData.rows.length === 0) return showToast("No data to export", "error");
      const csvRows = processedData.rows.map(r => ({
          Date: r.date,
          Invoice: r.invoice,
          Customer: r.customer,
          Item: r.item,
          HSN: r.hsn,
          'GST %': r.gst,
          Quantity: r.qty,
          Rate: r.rate,
          'Total Profit': r.profit
      }));
      await exportService.exportToCSV(csvRows, ['Date', 'Invoice', 'Customer', 'Item', 'HSN', 'GST %', 'Quantity', 'Rate', 'Total Profit'], `Profit_Report_${dateRange.start}.csv`);
      showToast("Report Downloaded", "success");
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/90 z-[100] flex justify-center items-center p-0 md:p-4 backdrop-blur-md animate-in fade-in duration-200">
      <style>{styles}</style>
      <div className="insight-modal-root w-full md:max-w-4xl h-full md:h-[95vh] md:rounded-3xl shadow-2xl flex flex-col overflow-hidden relative border-0 md:border border-white/12" style={{background:'var(--app-bg)'}}>
        
        {/* --- LOCK SCREEN --- */}
        {isLocked ? (
           <div className="insight-lock-screen flex-1 flex flex-col items-center justify-center p-6 text-center relative bg-col-app-bg">
               <button onClick={onClose} className="insight-back-btn absolute left-6 p-2 bg-[var(--rgba-white-08)] rounded-full text-[var(--text-muted)] border border-white/10" style={{ top: 'max(24px, calc(env(safe-area-inset-top, 0px) + 12px))' }}>
                   <ChevronLeft size={24} />
               </button>
               <div className="mb-8">
                   <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-[var(--col-info-15)] text-col-info border border-[var(--col-info-25)]">
                       <Lock size={32} />
                   </div>
                   <h2 className="text-xl font-black mb-1 text-[var(--text-primary)]">Restricted Access</h2>
                   <p className="text-xs font-bold text-[var(--text-muted)]">Enter PIN to access Business Insights</p>
               </div>
               <div className="flex gap-4 mb-3">
                   {[0, 1, 2, 3].map((i) => (
                       <div key={i} className={`w-4 h-4 rounded-full transition-all duration-200 ${i < pin.length ? 'bg-blue-600 scale-110 shadow-lg' : 'bg-[var(--rgba-white-09)]'}`} />
                   ))}
               </div>
               {/* Default PIN hint — shown for first 3 attempts when user has not set a custom PIN */}
               {!localStorage.getItem('insight_pin') && wrongAttempts < 3 && (
                   <p className="text-xs font-semibold mb-6" style={{ color: 'rgba(251,191,36,0.75)' }}>
                       Default PIN: <span className="font-black tracking-[0.25em]">1234</span>
                   </p>
               )}
               {localStorage.getItem('insight_pin') && wrongAttempts === 0 && <div className="mb-6" />}
               {localStorage.getItem('insight_pin') && wrongAttempts > 0 && <div className="mb-6" />}
               <div className="grid grid-cols-3 gap-4 w-full max-w-[280px]">
                   {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                       <button key={num} onClick={() => handleNumClick(num.toString())} className="insight-keypad-btn h-16 w-full rounded-2xl text-2xl font-bold text-white transition-all active:scale-95 bg-[var(--rgba-white-07)] border border-white/12 backdrop-blur-sm">{num}</button>
                   ))}
                   <div /> 
                   <button onClick={() => handleNumClick('0')} className="insight-keypad-btn h-16 w-full rounded-2xl text-2xl font-bold text-white transition-all active:scale-95 bg-[var(--rgba-white-07)] border border-white/12 backdrop-blur-sm">0</button>
                   <button onClick={handleBackspace} className="h-16 w-full flex items-center justify-center text-red-500 hover:bg-[var(--col-danger-15)] rounded-2xl transition-colors"><Delete size={28} /></button>
               </div>

               {/* Forgot PIN — only shown after 3 consecutive wrong attempts */}
               {wrongAttempts >= 3 && (
                   <button
                       onClick={() => setShowReauth(true)}
                       className="mt-6 text-xs font-bold transition-all active:scale-95"
                       style={{ color: 'rgba(96,165,250,0.7)' }}
                   >
                       Forgot PIN?
                   </button>
               )}

               {showReauth && (
                   <ReauthModal
                       title="Verify Identity"
                       subtitle="Confirm your account to reset the Insight PIN"
                       onVerified={handleClearInsightPin}
                       onCancel={() => setShowReauth(false)}
                   />
               )}
           </div>
        ) : (
            /* --- MAIN DASHBOARD (Unlocked) --- */
            <div className="flex flex-col h-full animate-in zoom-in-95 duration-200">
                
                {/* HEADER */}
                <div className="px-4 pb-3 shrink-0 flex items-center gap-2" style={{ paddingTop: 'max(16px, calc(env(safe-area-inset-top, 0px) + 8px))' }}>
                    {/* Left — back + title; flex-1 min-w-0 so it never pushes the right side off-screen */}
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <button onClick={onClose} className="flex-shrink-0 p-1.5 rounded-full transition-colors bg-[var(--rgba-white-08)] border border-white/10 text-[var(--text-secondary)]"><ChevronLeft size={20}/></button>
                        <h2 className="text-base font-black flex items-center gap-1.5 truncate min-w-0">
                            <TrendingUp className="text-green-400 flex-shrink-0" size={16}/>
                            <span className="truncate">Profit Insight</span>
                        </h2>
                    </div>
                    {/* Right — view toggle + settings; flex-shrink-0 so it's never clipped */}
                    <div className="flex gap-1.5 flex-shrink-0">
                        <div className="flex rounded-lg p-0.5 bg-[var(--rgba-white-07)] border border-white/10">
                            <button onClick={() => setActiveView('report')} className={`px-2.5 py-1.5 rounded-md text-app-sm font-bold uppercase transition-all ${activeView === 'report' ? 'bg-[var(--col-violet-35)] text-col-violet' : 'text-slate-400'}`}>Report</button>
                            <button onClick={() => setActiveView('margins')} className={`px-2.5 py-1.5 rounded-md text-app-sm font-bold uppercase transition-all ${activeView === 'margins' ? 'bg-[var(--col-violet-35)] text-col-violet' : 'text-slate-400'}`}>Margins</button>
                        </div>
                        <button onClick={() => setChangingPin(!changingPin)} className="flex-shrink-0 p-2 rounded-xl bg-[var(--rgba-white-07)] border border-white/10">
                            <Settings size={16} />
                        </button>
                    </div>
                </div>

                {/* PIN CHANGE OVERLAY */}
                {changingPin && (
                    <div className="px-4 py-3 border-b bg-[var(--col-warning-08)] border-[var(--col-warning-25)] animate-in slide-in-from-top">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-bold flex items-center gap-2 text-col-warning"><Lock size={14}/> Change PIN</span>
                            <button onClick={() => { setChangingPin(false); setOldPin(''); setNewPin(''); setConfirmNewPin(''); }} className="p-1 text-[var(--col-warning-70)] rounded-md bg-[var(--rgba-white-07)] border border-white/10"><X size={14}/></button>
                        </div>
                        <div className="flex flex-col gap-2 w-full">
                            <input className="w-full px-3 py-2 text-sm font-bold rounded-lg border border-[var(--col-warning-35)] bg-[var(--rgba-white-06)] text-white text-center no-spinner" placeholder="Current PIN" maxLength={4} type="password" value={oldPin} onChange={e => setOldPin(e.target.value)}/>
                            <div>
                                <input className="w-full px-3 py-2 text-sm font-bold rounded-lg border border-[var(--col-warning-35)] bg-[var(--rgba-white-06)] text-white text-center no-spinner" placeholder="New PIN (4 digits)" maxLength={4} type="number" value={newPin} onChange={e => setNewPin(e.target.value)}/>
                                {(() => { const s = getPinStrength(newPin); return s && s.level !== 'strong' ? <p className="text-app-sm font-bold mt-1 px-1" style={{ color: s.color }}>⚠ {s.message}</p> : null; })()}
                            </div>
                            <input className="w-full px-3 py-2 text-sm font-bold rounded-lg border border-[var(--col-warning-35)] bg-[var(--rgba-white-06)] text-white text-center no-spinner" placeholder="Confirm New PIN" maxLength={4} type="number" value={confirmNewPin} onChange={e => setConfirmNewPin(e.target.value)}/>
                            <button onClick={handleChangePin} className="w-full py-2.5 rounded-lg text-sm font-bold text-white active:scale-95 transition-all" style={{ background: 'var(--col-warning-85)' }}>Save PIN</button>
                        </div>
                    </div>
                )}

                {/* BODY CONTENT */}
                <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                    
                    {/* --- VIEW: REPORT --- */}
                    {activeView === 'report' && (
                        <>
                            {/* 1. PROFIT SUMMARY */}
                            <div className="px-4 pt-2 pb-1 shrink-0 border-b border-white/10">
                                <div className="text-app-sm font-bold text-slate-400 uppercase tracking-widest mb-1 text-center">Total Net Profit</div>
                                <div className="text-4xl font-black text-center tracking-tighter">
                                    <span className="text-xl text-slate-400 align-top mr-1">₹</span>
                                    {processedData.totalProfit.toLocaleString('en-IN')}
                                </div>
                                
                                <div className="mt-3 flex items-center justify-center gap-2 w-full min-w-0">
                                    <DateRangeFilter
                                        start={dateRange.start}
                                        end={dateRange.end}
                                        onStartChange={v => setDateRange(p => ({...p, start: v}))}
                                        onEndChange={v => setDateRange(p => ({...p, end: v}))}
                                        compact
                                        className="flex-1 min-w-0"
                                    />
                                    <button onClick={handleDownload} className="bg-blue-600 text-white p-2 rounded-xl shadow-lg shadow-blue-200 dark:shadow-none active:scale-95 transition-all shrink-0">
                                        <Download size={16}/>
                                    </button>
                                </div>
                            </div>

                            {/* 3. CARD LIST */}
                            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                                {processedData.rows.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-20 text-[var(--text-muted)]">
                                        <AlertCircle size={32} className="mb-2 opacity-50"/>
                                        <p className="text-xs font-bold">No sales found.</p>
                                    </div>
                                ) : (
                                    processedData.rows.map((row, i) => (
                                        <div key={i} className="p-3 rounded-xl border border-white/10 flex items-center justify-between active:scale-[0.99] transition-transform bg-[var(--rgba-white-04)]">
                                            
                                            <div className="flex-1 min-w-0 pr-3">
                                                <div className="flex justify-between items-center mb-1">
                                                    <div className="flex items-center gap-1.5">
                                                        <User size={12} className="text-blue-500"/>
                                                        <span className="text-xs font-bold truncate max-w-[120px]">{row.customer || 'Unknown'}</span>
                                                    </div>
                                                    <span className="text-app-xs font-bold text-[var(--text-muted)]">{new Date(row.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-xs text-[var(--text-secondary)] truncate">{row.item}</span>
                                                    <span className="text-app-xs font-medium text-slate-400 px-1.5 py-0.5 rounded">
                                                        {row.qty} x ₹{row.rate}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="shrink-0 flex flex-col items-end">
                                                <div className="text-app-2xs font-bold text-slate-400 uppercase mb-0.5">Net Profit</div>
                                                {editingProfitId === row.id ? (
                                                    <div className="flex items-center gap-1">
                                                        <input 
                                                            autoFocus
                                                            type="number" 
                                                            className="w-20 border border-blue-500 rounded-lg p-1 text-right text-base font-black outline-none no-spinner"
                                                            value={tempProfit}
                                                            onChange={e => setTempProfit(e.target.value)}
                                                            onBlur={() => saveProfitOverride(row.id)}
                                                            onKeyDown={e => e.key === 'Enter' && saveProfitOverride(row.id)}
                                                        />
                                                        <button onClick={() => saveProfitOverride(row.id)} className="text-col-success bg-[var(--col-emerald-12)] rounded p-1"><Check size={16}/></button>
                                                    </div>
                                                ) : (
                                                    <div 
                                                        onClick={() => startEditingProfit(row.id, row.profit)}
                                                        className={`font-black text-base flex items-center justify-end gap-1 cursor-pointer py-1 pl-2 rounded-lg hover:bg-[var(--rgba-white-05)] transition-colors ${row.isOverridden ? 'text-blue-600' : 'text-green-600'}`}
                                                    >
                                                        <span>+₹{Math.round(row.profit).toLocaleString('en-IN')}</span>
                                                        <Edit2 size={10} className="opacity-40"/>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </>
                    )}

                    {/* --- VIEW: MARGIN SETTINGS --- */}
                    {activeView === 'margins' && (
                        <div className="flex-1 flex flex-col min-h-0">
                            <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-0" style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
                                <div className="p-3 rounded-xl mb-2 border border-[var(--col-info-25)] bg-[var(--col-info-15)] flex gap-3 items-center">
                                    <AlertCircle className="text-blue-600 shrink-0" size={18}/>
                                    <p className="text-app-sm text-blue-400 font-bold">
                                        Set your default profit margin per unit. Items are matched by Name, HSN & GST.
                                    </p>
                                </div>

                                {inventory.map((item: any) => {
                                    // Generate Unique Key for this specific item configuration
                                    const key = getItemKey(item.name, item.hsn_code, item.gst_percent);
                                    
                                    return (
                                        <div key={item.id} className="p-3 rounded-xl border border-white/10 flex items-center justify-between">
                                            <div className="flex items-center gap-3 overflow-hidden">
                                                <div className="p-2 rounded-lg text-slate-500"><Package size={18}/></div>
                                                <div className="min-w-0">
                                                    <div className="font-bold text-sm text-[var(--text-secondary)] truncate">{item.name}</div>
                                                    <div className="flex gap-2 text-app-xs font-bold text-slate-400 uppercase mt-0.5">
                                                        {item.hsn_code && <span className="px-1 rounded">HSN: {item.hsn_code}</span>}
                                                        {item.gst_percent > 0 && <span className="px-1 rounded">GST: {item.gst_percent}%</span>}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1 p-1 rounded-lg border border-white/12 w-24">
                                                <span className="text-app-sm font-bold text-slate-400 pl-2">₹</span>
                                                <input 
                                                    type="number" 
                                                    placeholder="0"
                                                    className="w-full bg-transparent py-1 px-1 text-right font-black text-green-600 outline-none text-sm no-spinner"
                                                    value={margins[key] || ''}
                                                    onChange={e => handleMarginChange(key, e.target.value)}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            
                            <div className="p-4 border-t border-white/08 shrink-0">
                                <button onClick={() => setActiveView('report')} className="w-full py-3.5 rounded-xl font-bold text-sm shadow-lg active:scale-95 transition-all text-white" style={{background:"linear-gradient(135deg,#4f46e5,#7c3aed)",boxShadow:"0 4px 16px var(--col-indigo-40)"}}>
                                    Done
                                </button>
                            </div>
                        </div>
                    )}

                </div>
            </div>
        )}
      </div>
    </div>
  );
};

export default InsightModal;






