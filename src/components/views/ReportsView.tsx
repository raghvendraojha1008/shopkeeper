import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import { User } from 'firebase/auth';
import { 
  Filter, Download, ArrowUpRight, ArrowDownLeft, 
  Truck, Package, Banknote, FileText, ArrowLeft, TrendingUp, TrendingDown, BarChart3,
  Search, User as UserIcon, Tag, Layers, Briefcase, Receipt, FileSpreadsheet
} from 'lucide-react';
import DateRangeFilter from '../common/DateRangeFilter';
import { getDefaultDateRange } from '../../utils/filterPeriod';
import { ApiService } from '../../services/api';
import { exportService } from '../../services/export';
import { exportServiceV2 } from '../../services/exportServiceV2';
import { useUI } from '../../context/UIContext';
import { formatCurrency } from '../../utils/helpers';
import GSTR1ExportModal from '../common/GSTR1ExportModal';
import { TelemetryService } from '../../services/telemetryService';

interface ReportsViewProps {
  user: User;
  onBack: () => void;
}

const ReportsView: React.FC<ReportsViewProps> = ({ user, onBack }) => {
  const scrollRef = useScrollMemory('reports');
  const { showToast } = useUI();
  const [loading, setLoading] = useState(true);
  
  // Data State
  const [mergedData,   setMergedData]   = useState<any[]>([]);
  const [ledgerRaw,    setLedgerRaw]    = useState<any[]>([]); // raw for GSTR-1
  const [partiesRaw,   setPartiesRaw]   = useState<any[]>([]); // raw parties for GSTR-1 GSTIN lookup
  const [appSettings,  setAppSettings]  = useState<any>(null); // for GSTR-1
  const [partyList,    setPartyList]    = useState<string[]>([]);
  const [itemList,     setItemList]     = useState<string[]>([]);
  const [purposeList,  setPurposeList]  = useState<string[]>([]);

  // Filter State
  const [mainTab,    setMainTab]    = useState<'all' | 'orders' | 'transactions'>('all');
  const [subFilter,  setSubFilter]  = useState<string>('all'); 
  const [searchParty,       setSearchParty]       = useState('');
  const [searchSecondary,   setSearchSecondary]   = useState('');
  const [dateRange,         setDateRange]         = useState({ start: '', end: '' });

  // Modal State
  const [showGSTR1Modal, setShowGSTR1Modal] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);

  // Close the download chooser when the user clicks anywhere outside it.
  useEffect(() => {
    if (!showDownloadMenu) return;
    const onDocClick = (e: MouseEvent) => {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(e.target as Node)) {
        setShowDownloadMenu(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showDownloadMenu]);

  // Reset sub-filters and search when main tab changes
  useEffect(() => { 
      setSubFilter('all'); 
      setSearchSecondary(''); 
  }, [mainTab]);

  // FINAL MODULE — feature usage telemetry. Service dedups same-day repeats.
  useEffect(() => { TelemetryService.trackScreen(user.uid, 'reports'); }, [user.uid]);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [ledgerSnap, transSnap, partiesSnap, invSnap, settingsSnap] = await Promise.all([
          ApiService.getAll(user.uid, 'ledger_entries'),
          ApiService.getAll(user.uid, 'transactions'),
          ApiService.getAll(user.uid, 'parties'),
          ApiService.getAll(user.uid, 'inventory'),
          ApiService.settings.get(user.uid)
        ]);

        setDateRange(prev => (prev.start === '' && prev.end === '') ? getDefaultDateRange(settingsSnap) : prev);
        setAppSettings(settingsSnap);

        const orders = ledgerSnap.docs.map(d => {
            const data = d.data();
            return {
                id: d.id, ...data, docType: 'order',
                sortDate: data.date,
                rent: Number(data.vehicle_rent) || 0,
                itemTotal: (Number(data.total_amount) || 0) - (Number(data.vehicle_rent) || 0),
                itemNames: data.items?.map((i:any) => i.item_name.toLowerCase()).join(' ') || ''
            };
        });

        // Keep raw ledger for GSTR-1 (need items, hsn_code, gst_percent, gstin)
        setLedgerRaw(ledgerSnap.docs.map(d => ({ id: d.id, ...d.data() })));

        const transactions = transSnap.docs.map(d => {
            const data = d.data();
            return {
                id: d.id, ...data, docType: 'transaction',
                sortDate: data.date,
                amount: Number(data.amount) || 0
            };
        });

        const all = [...orders, ...transactions].sort((a, b) => new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime());
        setMergedData(all);

        const partiesData = partiesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        setPartiesRaw(partiesData);
        setPartyList(partiesData.map((p: any) => p.name));
        setItemList(invSnap.docs.map(d => d.data().name));
        
        if(settingsSnap && settingsSnap.custom_lists && settingsSnap.custom_lists.purposes) {
            setPurposeList(settingsSnap.custom_lists.purposes);
        }

      } catch (e) { console.error(e); } finally { setLoading(false); }
    };
    loadData();
  }, [user.uid]);

  const filtered = useMemo(() => {
      return mergedData.filter(item => {
          const inDate = (!dateRange.start || item.sortDate >= dateRange.start) && (!dateRange.end || item.sortDate <= dateRange.end);
          if (!inDate) return false;

          if (mainTab === 'orders' && item.docType !== 'order') return false;
          if (mainTab === 'transactions' && item.docType !== 'transaction') return false;

          if (subFilter !== 'all') {
              if (item.type !== subFilter) return false;
          }

          if (searchParty && !item.party_name?.toLowerCase().includes(searchParty.toLowerCase())) return false;

          if (searchSecondary) {
              const term = searchSecondary.toLowerCase();
              if (mainTab === 'transactions') {
                  if (item.docType === 'transaction') return item.payment_purpose?.toLowerCase().includes(term);
                  return false;
              } else {
                  if (item.docType === 'order') return item.itemNames?.includes(term);
                  return false;
              }
          }

          return true;
      });
  }, [mergedData, dateRange, mainTab, subFilter, searchParty, searchSecondary]);

  const stats = useMemo(() => {
      return filtered.reduce((acc, item) => {
          if (item.docType === 'order') {
              acc.itemVolume += item.itemTotal;
              acc.rentVolume += item.rent;
          } else {
              if (item.type === 'received') acc.totalIn  += item.amount;
              if (item.type === 'paid')     acc.totalOut += item.amount;
          }
          return acc;
      }, { itemVolume: 0, rentVolume: 0, totalIn: 0, totalOut: 0 });
  }, [filtered]);

  const handleExport = async () => {
      if (filtered.length === 0) return showToast("No data", "error");

      const rows: string[][] = [];
      const header = ['Date', 'Invoice', 'Category', 'Type', 'Party', 'Item Name', 'Qty', 'Unit', 'Rate', 'GST%', 'Item Total', 'Rent', 'Grand Total', 'Purpose', 'Payment Mode', 'Notes'];
      rows.push(header);

      for (const f of filtered) {
          if (f.docType === 'order') {
              const items: any[] = Array.isArray(f.items) && f.items.length > 0 ? f.items : [null];
              const rent = Number(f.vehicle_rent) || 0;
              items.forEach((item, idx) => {
                  rows.push([
                      f.sortDate || '', idx === 0 ? (f.invoice_no || f.prefixed_id || '-') : '',
                      idx === 0 ? 'Order' : '', idx === 0 ? (f.type || '') : '',
                      idx === 0 ? (f.party_name || '-') : '',
                      item ? item.item_name : '-',
                      item ? String(item.quantity ?? '') : '', item ? (item.unit || '') : '',
                      item ? String(item.rate ?? '') : '', item ? String(item.gst_percent ?? '') : '',
                      item ? String(item.total ?? '') : '', idx === 0 ? String(rent) : '',
                      idx === 0 ? String(f.itemTotal ?? '') : '',
                      idx === 0 ? (f.payment_purpose || '-') : '',
                      idx === 0 ? (f.payment_mode || '') : '', idx === 0 ? (f.notes || '') : '',
                  ]);
              });
          } else {
              rows.push([
                  f.sortDate || '', f.invoice_no || '-', 'Transaction', f.type || '',
                  f.party_name || '-', '-', '', '', '', '', '', '',
                  String(f.amount ?? ''), f.payment_purpose || '-', f.payment_mode || '', f.notes || '',
              ]);
          }
      }

      const csvContent = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
      await exportService.shareOrDownload(csvContent, `Report_${mainTab}.csv`, 'text/csv');
      showToast("Report CSV Downloaded", "success");
  };

  const handlePdfExport = async () => {
      if (filtered.length === 0) return showToast("No data for PDF", "error");
      try {
          const settings = await ApiService.settings.get(user.uid);
          await exportServiceV2.filteredReportToPdf({
              filtered,
              mainTab,
              dateRange,
              profile: (settings as any)?.profile,
          });
          showToast("Report PDF Generated!", "success");
      } catch (e: any) { console.error('Report PDF error:', e); showToast('PDF failed: ' + (e?.message || String(e)), "error"); }
  };

  const getFilterIcon = (type: string) => {
      switch(type) {
          case 'all': return <Layers size={16}/>;
          case 'sell': return <TrendingUp size={16}/>;
          case 'purchase': return <TrendingDown size={16}/>;
          case 'received': return <ArrowDownLeft size={16}/>;
          case 'paid': return <ArrowUpRight size={16}/>;
          default: return <Filter size={16}/>;
      }
  };

  return (
    <div className="flex flex-col h-full" style={{background: 'var(--app-bg)'}}>
      
      {/* STICKY HEADER */}
      <div className="sticky top-0 z-20 px-3 pt-3 pb-2 md:px-6" style={{background:"rgba(var(--app-bg-rgb),0.95)", backdropFilter:"blur(20px)", boxShadow:"0 1px 0 var(--rgba-white-05)"}}>
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
              <button onClick={onBack} className="p-2 rounded-full active:scale-95 transition-all"><ArrowLeft size={20} /></button>
              <div>
                  <h1 className="text-xl font-black leading-none">Reports</h1>
                  <p className="text-app-sm font-bold text-slate-400 uppercase">{filtered.length} Records</p>
              </div>
          </div>
          <div className="flex gap-2 items-center">
              {/* COMPACT ICON FILTERS */}
              {mainTab === 'orders' && (
                  <div className="flex rounded-xl p-1 gap-1 border border-white/10">
                      {['all', 'sell', 'purchase'].map(t => (
                          <button key={t} onClick={() => setSubFilter(t)} className={`p-2 rounded-md transition-all ${subFilter === t ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30' : 'text-slate-400 hover:text-slate-300'}`} title={t}>
                              {getFilterIcon(t)}
                          </button>
                      ))}
                  </div>
              )}
              {mainTab === 'transactions' && (
                  <div className="flex rounded-xl p-1 gap-1 border border-white/10">
                      {['all', 'received', 'paid'].map(t => (
                          <button key={t} onClick={() => setSubFilter(t)} className={`p-2 rounded-md transition-all ${subFilter === t ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30' : 'text-slate-400 hover:text-slate-300'}`} title={t}>
                              {getFilterIcon(t)}
                          </button>
                      ))}
                  </div>
              )}

              {/* ── GST RETURN BUTTON (NEW) ── */}
              <button
                onClick={() => setShowGSTR1Modal(true)}
                title="Export GSTR-1"
                className="p-2.5 rounded-xl active:scale-95 transition-all"
                style={{ background: 'var(--col-emerald-12)', border: '1px solid var(--col-emerald-25)' }}
              >
                <Receipt size={18} style={{ color: "var(--col-success)" }} />
              </button>

              {/* ── Single download button → opens CSV / PDF chooser ───────── */}
              <div className="relative" ref={downloadMenuRef}>
                <button
                  onClick={() => setShowDownloadMenu(v => !v)}
                  title="Download report"
                  aria-haspopup="menu"
                  aria-expanded={showDownloadMenu}
                  className="p-2.5 rounded-xl active:scale-95 transition-all glass-icon-btn text-emerald-400"
                >
                  <Download size={18}/>
                </button>
                {showDownloadMenu && (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 z-30 rounded-2xl overflow-hidden min-w-[220px]"
                    style={{
                      background: 'var(--dropdown-bg)',
                      backdropFilter: 'blur(20px)',
                      border: '1px solid var(--glass-border)',
                      boxShadow: '0 16px 40px var(--rgba-black-45)',
                    }}
                  >
                    <button
                      role="menuitem"
                      onClick={() => { setShowDownloadMenu(false); handleExport(); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-emerald-500/10 hover:bg-emerald-500/5 transition-colors"
                    >
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                        style={{ background: 'var(--col-emerald-12)', border: '1px solid var(--col-emerald-25)' }}>
                        <FileSpreadsheet size={16} style={{ color: "var(--col-success)" }} />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Download CSV</p>
                        <p className="text-app-sm" style={{ color: 'var(--text-muted)' }}>Filtered list • Excel-friendly</p>
                      </div>
                    </button>
                    <div style={{ height: 1, background: 'var(--rgba-white-06)' }} />
                    <button
                      role="menuitem"
                      onClick={() => { setShowDownloadMenu(false); handlePdfExport(); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-violet-500/10 hover:bg-violet-500/5 transition-colors"
                    >
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                        style={{ background: 'var(--col-violet-14)', border: '1px solid var(--col-violet-25)' }}>
                        <FileText size={16} style={{ color: "var(--col-violet)" }} />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Download PDF</p>
                        <p className="text-app-sm" style={{ color: 'var(--text-muted)' }}>Full report • All sections</p>
                      </div>
                    </button>
                  </div>
                )}
              </div>
          </div>
        </div>
      </div>

      {/* SCROLLABLE BODY */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 md:px-6 pb-20">

        {/* SUMMARY CARD */}
        <div className="p-4 rounded-2xl shadow-lg mt-3 mb-3 flex justify-between items-center relative overflow-hidden" style={{background:"linear-gradient(135deg,var(--col-indigo-85),var(--col-accent-70))"}}>
          <div className="absolute top-0 left-0 right-0 h-px" style={{background:"linear-gradient(90deg,transparent,var(--rgba-white-18),transparent)"}} />
          <div className="relative z-10">
              {mainTab === 'transactions' ? (
                  <>
                      <div className="text-app-sm font-bold opacity-70 uppercase mb-0.5">Net Cash Flow</div>
                      <div className="text-2xl font-black leading-none mb-1">{formatCurrency(stats.totalIn - stats.totalOut)}</div>
                      <div className="text-app-sm opacity-80"><span className="text-green-300">In: {formatCurrency(stats.totalIn)}</span> • <span className="text-red-300">Out: {formatCurrency(stats.totalOut)}</span></div>
                  </>
              ) : (
                  <>
                      <div className="text-app-sm font-bold opacity-70 uppercase mb-0.5">Item Volume (Excl. Rent)</div>
                      <div className="text-2xl font-black leading-none mb-2">{formatCurrency(stats.itemVolume)}</div>
                      {stats.rentVolume > 0 && (<div className="flex items-center gap-1.5 text-orange-300 bg-[var(--rgba-white-06)]/10 px-2 py-1 rounded-lg w-fit"><Truck size={12} /><span className="text-app-sm font-bold uppercase">Rent: {formatCurrency(stats.rentVolume)}</span></div>)}
                  </>
              )}
          </div>
          <div className="bg-[var(--rgba-white-06)]/10 p-3 rounded-full relative z-10"><BarChart3 size={24} className="text-white"/></div>
          <TrendingUp size={80} className="absolute -bottom-4 -right-4 text-white opacity-5 pointer-events-none"/>
        </div>

        {/* FILTERS & SEARCH */}
        <div className="p-2.5 rounded-xl mb-3 space-y-2 border border-white/08 bg-[var(--rgba-white-04)]">
            <div className="flex gap-2">
                {['all', 'orders', 'transactions'].map((t) => (
                    <button key={t} onClick={() => setMainTab(t as any)} className={`flex-1 py-2 rounded-lg text-app-sm font-black uppercase tracking-wider transition-all ${mainTab === t ? 'bg-[var(--col-violet-25)] text-violet-300 border border-[var(--col-violet-35)]' : 'bg-[var(--rgba-white-04)] text-[var(--text-muted)] hover:bg-[var(--rgba-white-07)]'}`}>{t}</button>
                ))}
            </div>

            <div className="flex gap-2">
                <div className="relative flex-1">
                    <UserIcon size={12} className="absolute left-2.5 top-2.5 text-slate-400"/>
                    <input className="w-full pl-7 p-2 border border-white/12 rounded-lg text-xs font-bold outline-none" placeholder="Search Party..." value={searchParty} onChange={e => setSearchParty(e.target.value)} list="party-list" />
                    <datalist id="party-list">{partyList.map((p, i) => <option key={i} value={p}/>)}</datalist>
                </div>
                <div className="relative flex-1">
                    {mainTab === 'transactions' ? (
                         <>
                             <Briefcase size={12} className="absolute left-2.5 top-2.5 text-slate-400"/>
                             <input className="w-full pl-7 p-2 border border-white/12 rounded-lg text-xs font-bold outline-none" placeholder="Search Purpose..." value={searchSecondary} onChange={e => setSearchSecondary(e.target.value)} list="purpose-list" />
                             <datalist id="purpose-list">{purposeList.map((p, idx) => <option key={idx} value={p}/>)}</datalist>
                         </>
                    ) : (
                         <>
                             <Tag size={12} className="absolute left-2.5 top-2.5 text-slate-400"/>
                             <input className="w-full pl-7 p-2 border border-white/12 rounded-lg text-xs font-bold outline-none" placeholder="Search Item..." value={searchSecondary} onChange={e => setSearchSecondary(e.target.value)} list="item-list" />
                             <datalist id="item-list">{itemList.map((i, idx) => <option key={idx} value={i}/>)}</datalist>
                         </>
                    )}
                </div>
            </div>

            <DateRangeFilter
                start={dateRange.start}
                end={dateRange.end}
                onStartChange={v => setDateRange(r => ({...r, start: v}))}
                onEndChange={v => setDateRange(r => ({...r, end: v}))}
            />
        </div>

        {/* LIST */}
        <div className="space-y-2">
          {loading ? <div className="text-center py-10 text-[var(--text-muted)] text-xs">Loading...</div> : filtered.map(item => {
              if (item.docType === 'order') {
                  const isSell = item.type === 'sell';
                  return (
                      <div key={item.id} className="p-3 rounded-xl relative overflow-hidden bg-[var(--rgba-white-05)] border border-white/08">
                          <div className={`absolute left-0 top-0 bottom-0 w-1 ${isSell ? 'bg-green-500' : 'bg-red-500'}`}></div>
                          <div className="pl-2">
                              <div className="flex justify-between items-center mb-1">
                                  <span className="text-app-xs font-bold text-[var(--text-muted)]">{item.date} • #{item.invoice_no || '-'}</span>
                                  <span className={`text-app-xs font-black uppercase ${isSell ? 'text-green-600' : 'text-red-500'}`}>{isSell ? 'SALE' : 'PURCHASE'}</span>
                              </div>
                              <div className="flex justify-between items-center mb-2">
                                  <div className="font-bold text-sm truncate max-w-[65%] text-[var(--text-primary)]">{item.party_name}</div>
                                  <div className="font-black text-base">{formatCurrency(item.itemTotal)}</div>
                              </div>
                              <div className="border-t border-dashed border-slate-200 border-white/10 pt-2 mt-2">
                                  {item.items && item.items.map((i:any, idx:number) => (
                                      <div key={idx} className="flex justify-between text-app-sm text-[var(--text-muted)] mb-0.5">
                                          <span className="font-medium">{i.item_name}</span>
                                          <span>{i.quantity} {i.unit} x ₹{i.rate}</span>
                                      </div>
                                  ))}
                                  {item.rent > 0 && (<div className="flex justify-end items-center gap-1 text-app-sm font-bold text-orange-500 mt-1"><Truck size={10}/> Rent: {formatCurrency(item.rent)}</div>)}
                              </div>
                          </div>
                      </div>
                  );
              } else {
                  const isIn = item.type === 'received';
                  return (
                      <div key={item.id} className="p-3 rounded-xl relative overflow-hidden bg-[var(--rgba-white-05)] border border-white/08">
                          <div className={`absolute left-0 top-0 bottom-0 w-1 ${isIn ? 'bg-blue-500' : 'bg-orange-500'}`}></div>
                          <div className="pl-2">
                              <div className="flex justify-between items-center mb-1">
                                  <span className="text-app-xs font-bold text-[var(--text-muted)]">{item.date}</span>
                                  <span className={`text-app-xs font-black uppercase ${isIn ? 'text-blue-600' : 'text-orange-500'}`}>{isIn ? 'RECEIVED' : 'PAID'}</span>
                              </div>
                              <div className="flex justify-between items-center mb-1">
                                  <div className="font-bold text-sm truncate max-w-[65%] text-[var(--text-primary)]">{item.party_name}</div>
                                  <div className={`font-black text-base ${isIn ? 'text-blue-600' : 'text-orange-500'}`}>{isIn ? '+' : '-'}{formatCurrency(item.amount)}</div>
                              </div>
                              {item.payment_purpose && (
                                  <div className="text-app-sm text-slate-500 italic border-t border-dashed border-[var(--rgba-white-07)] pt-1 mt-1">
                                      Purpose: <span className="font-semibold not-italic">{item.payment_purpose}</span>
                                  </div>
                              )}
                          </div>
                      </div>
                  );
              }
          })}
          {filtered.length === 0 && <div className="text-center py-10 text-[var(--text-muted)]"><p className="text-xs">No entries found.</p></div>}
        </div>
      </div>

      {/* GSTR-1 EXPORT MODAL */}
      {showGSTR1Modal && (
        <GSTR1ExportModal
          ledgerEntries={ledgerRaw}
          parties={partiesRaw}
          settings={appSettings}
          onClose={() => setShowGSTR1Modal(false)}
          onToast={(msg, type) => showToast(msg, type)}
        />
      )}
    </div>
  );
};

export default ReportsView;
