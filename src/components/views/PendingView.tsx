import React, { useState, useMemo } from 'react';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import { useBackHandler } from '../../services/useBackHandler';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { User } from 'firebase/auth';
import { 
  Search, ArrowUpRight, ArrowDownLeft, ArrowLeft,
  Phone, AlertCircle, ChevronDown, 
  ChevronUp, Package, TrendingUp, TrendingDown, SlidersHorizontal, X, Check,
  User as UserIcon, MessageSquare, History, Calendar, Info, Share2,
  CheckSquare, Square, Send, Users, FileText, Clock, BadgePercent, Zap
} from 'lucide-react';
import { useData } from '../../context/DataContext';
import { computePaymentDistribution } from '../../utils/paymentDistribution';
import PartyDetailView from './PartyDetailView';
import { useUI } from '../../context/UIContext';
import { PendingSkeleton } from '../common/Skeleton';
import { ReminderPdfService } from '../../services/reminderPdf';

interface PendingViewProps {
  user: User;
  onBack?: () => void;
  appSettings?: any;
  initialFilter?: 'receivable' | 'payable';
}

const PendingView: React.FC<PendingViewProps> = ({ user, onBack, appSettings = {}, initialFilter }) => {
  const scrollRef = useScrollMemory('pending');
  const { showToast } = useUI();
  const { useLedger, useTransactions, useParties } = useData();

  // PERF: shared TanStack Query cache — eliminates 3 direct Firestore reads on every mount
  const { data: ledger, isLoading: ledgerLoading } = useLedger(user.uid);
  const { data: transactions, isLoading: txLoading } = useTransactions(user.uid);
  const { data: parties, isLoading: partiesLoading } = useParties(user.uid);
  const loading = ledgerLoading || txLoading || partiesLoading;

  const [activeTab, setActiveTab] = useState<'receivable' | 'payable'>(initialFilter || 'receivable');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Advanced Waiver UI State
  const [showWaiverBox, setShowWaiverBox] = useState(false);
  const [tempWaiver, setTempWaiver] = useState<string>('');
  const [waiverAmount, setWaiverAmount] = useState<number>(() => {
      const saved = localStorage.getItem('pending_waiver_amount');
      return saved ? Number(saved) : 200;
  });

  // Bulk Selection State
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkThreshold, setShowBulkThreshold] = useState(false);
  const [bulkThreshold, setBulkThreshold] = useState<string>('1000');

  // Navigation state for Drill-down
  const [selectedPartyData, setSelectedPartyData] = useState<any>(null);
  useBackHandler(() => setSelectedPartyData(null), !!selectedPartyData, 5);

  // --- OPTIMISTIC UI STATE ---
  const [optimisticUpdates, setOptimisticUpdates] = useState<Set<string>>(new Set());

  // Logic: WhatsApp Automation with Optimistic UI
  const sendWhatsAppReminder = async (order: any) => {
    const contact = order.partyInfo?.contact;
    if (!contact) {
      showToast(`No contact number available for ${order.party_name}`, 'error');
      return;
    }
    
    // Optimistic: Mark as sent immediately
    setOptimisticUpdates(prev => new Set([...prev, order.id]));
    
    const shopName = appSettings?.profile?.firm_name || appSettings?.shopName || "Our Shop";
    const msg = `Greetings from ${shopName}! 👋\n\nRegarding Invoice #${order.invoice_no || order.bill_no}:\nTotal: ₹${order.orderTotal}\nReceived: ₹${order.totalReceived}\nPending: *₹${order.balance.toLocaleString('en-IN')}*\n\nPlease settle this at your earliest convenience. Thank you!`;
    
    const cleanNum = contact.replace(/\D/g, '');
    const phone = cleanNum.length === 10 ? `91${cleanNum}` : cleanNum;
    if (Capacitor.isNativePlatform()) {
      try { await Share.share({ text: msg }); } catch (_) {}
    } else {
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
    }
    
    // Clear optimistic state after 2 seconds
    setTimeout(() => {
      setOptimisticUpdates(prev => {
        const next = new Set(prev);
        next.delete(order.id);
        return next;
      });
    }, 2000);
  };

  // Logic: Generate and share PDF Statement for a party
  const sendPdfStatement = async (partyName: string) => {
    showToast('Generating statement...', 'info');
    
    // Find all unpaid bills for this party
    const partyOrders = filteredOrders.filter(o => 
      o.party_name?.trim().toLowerCase() === partyName?.trim().toLowerCase()
    );
    
    if (partyOrders.length === 0) {
      showToast('No pending bills found for this party', 'error');
      return;
    }
    
    const partyInfo = partyOrders[0].partyInfo || { name: partyName };
    const unpaidBills = partyOrders.map(o => ({
      date: o.date,
      invoice_no: String(o.invoice_no || o.bill_no || '-'),
      items: o.items || [],
      total_amount: o.orderTotal,
      paid: o.totalReceived,
      balance: o.balance,
      daysOld: o.daysOld
    }));
    
    const firmProfile = {
      firm_name: appSettings?.profile?.firm_name || 'Business',
      contact: appSettings?.profile?.contact,
      address: appSettings?.profile?.address
    };
    
    const result = await ReminderPdfService.generateMiniStatement(
      { name: partyInfo.name, contact: partyInfo.contact, address: partyInfo.address },
      unpaidBills,
      firmProfile
    );
    
    if (result) {
      showToast('Statement generated! Share via WhatsApp.', 'success');
    } else {
      showToast('Failed to generate statement', 'error');
    }
  };

  // Logic: Waiver Update
  const handleSaveWaiver = () => {
      const num = parseInt(tempWaiver);
      if (!isNaN(num)) {
          setWaiverAmount(num);
          localStorage.setItem('pending_waiver_amount', num.toString());
      }
      setShowWaiverBox(false);
  };

  // Bulk Selection Logic
  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const selectAllAboveThreshold = () => {
    const threshold = Number(bulkThreshold) || 0;
    
    // O(N) single pass - no nested filters
    const idsToSelect: string[] = [];
    for (const order of filteredOrders) {
      if (order.balance >= threshold && order.partyInfo?.contact) {
        idsToSelect.push(order.id);
      }
    }
    
    setSelectedIds(new Set(idsToSelect));
    setShowBulkThreshold(false);
    
    if (idsToSelect.length === 0) {
      showToast('No customers with contact numbers above this threshold', 'info');
    } else {
      showToast(`Selected ${idsToSelect.length} customers`, 'success');
    }
  };

  const sendBulkReminders = () => {
    const selected: any[] = [];
    for (const order of filteredOrders) {
      if (selectedIds.has(order.id)) {
        selected.push(order);
      }
    }
    
    const withContact = selected.filter(o => o.partyInfo?.contact);
    
    if (withContact.length === 0) {
      showToast('No selected customers have contact numbers', 'error');
      return;
    }

    // Optimistic: Mark all as sent immediately
    setOptimisticUpdates(prev => new Set([...prev, ...Array.from(selectedIds)]));

    // Send to first customer immediately
    sendWhatsAppReminder(withContact[0]);
    
    // Show count message
    if (withContact.length > 1) {
      showToast(`Opened reminder for 1 of ${withContact.length}. Continue manually for others.`, 'info');
    }
    
    // Clear selection after sending
    setSelectedIds(new Set());
    setBulkMode(false);
  };

  const exitBulkMode = () => {
    setBulkMode(false);
    setSelectedIds(new Set());
  };

  // Null-safe arrays (hooks return undefined while loading)
  const safeTransactions = useMemo(() => transactions || [], [transactions]);
  const safeLedger       = useMemo(() => ledger       || [], [ledger]);
  const safeParties      = useMemo(() => parties      || [], [parties]);

  // --- PRE-INDEXED MAPS (O(1) lookups) ---
  const transactionsByBillNo = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const t of safeTransactions) {
      const key = String(t.bill_no);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    // Pre-sort each group by date descending
    for (const [, arr] of map) {
      arr.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
    return map;
  }, [safeTransactions]);

  // Full payment distribution (includes auto-adjusted FIFO payments)
  const paymentStatusMap = useMemo(() => {
    const autoDistribute = appSettings?.automation?.auto_distribute_payments !== false;
    return computePaymentDistribution(safeLedger, safeTransactions, autoDistribute);
  }, [safeLedger, safeTransactions, appSettings]);

  const partiesByName = useMemo(() => {
    const map = new Map<string, any>();
    for (const p of safeParties) {
      map.set(p.name?.trim().toLowerCase(), p);
    }
    return map;
  }, [safeParties]);

  // Pre-index ledger entries by ID for O(1) access (useful for bulk operations)
  const ledgerById = useMemo(() => {
    const map = new Map<string, any>();
    for (const entry of safeLedger) {
      map.set(entry.id, entry);
    }
    return map;
  }, [safeLedger]);

  // --- DATA PROCESSING ENGINE (O(N) with O(1) indexed lookups) ---
  const filteredOrders = useMemo(() => {
    const type = activeTab === 'receivable' ? 'sell' : 'purchase';
    const query = search.toLowerCase();
    
    const results: any[] = [];
    
    for (const order of safeLedger) {
      // First check: type filter (fast boolean check)
      if (order.type !== type) continue;
      
      const refNo = String(order.invoice_no || order.bill_no);
      const orderTotal = Number(order.total_amount) || 0;

      // Use full payment distribution (respects auto-adjust FIFO) for the balance
      const ps = paymentStatusMap.get(order.id);
      const totalReceived = ps ? ps.totalPaid : 0;
      const balance = ps ? Math.max(0, ps.orderTotal - ps.totalPaid) : orderTotal;

      // Keep direct-linked history for display in the expanded row
      const history = transactionsByBillNo.get(refNo) || [];
      
      // Skip waived amounts early (before further processing)
      if (balance <= waiverAmount) continue;
      
      // O(1) lookup for party info via pre-indexed map
      const party = partiesByName.get(order.party_name?.trim().toLowerCase());
      
      // Search filter with early exit
      if (query) {
        const partyNameMatch = order.party_name?.toLowerCase().includes(query);
        const billNoMatch = refNo.includes(query);
        const roleMatch = party?.role?.toLowerCase().includes(query);
        
        if (!partyNameMatch && !billNoMatch && !roleMatch) continue;
      }
      
      // Calculate aging once
      const daysOld = ReminderPdfService.getDaysOld(order.date);
      const agingCategory = ReminderPdfService.getAgingCategory(daysOld);
      const hasAutoPayment = ps && ps.autoPaid > 0;

      results.push({ 
        ...order, 
        orderTotal, 
        totalReceived, 
        balance, 
        partyInfo: party, 
        history, 
        daysOld, 
        agingCategory,
        hasAutoPayment,
        autoPayments: ps?.autoPayments || [],
      });
    }
    
    // Sort once at the end (O(N log N) is acceptable for final sort)
    results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return results;
  }, [safeLedger, paymentStatusMap, transactionsByBillNo, partiesByName, activeTab, search, waiverAmount]);

  // Aging Summary Stats
  const agingSummary = useMemo(() => {
    const current = filteredOrders.filter(o => o.agingCategory === 'current');
    const moderate = filteredOrders.filter(o => o.agingCategory === 'moderate');
    const critical = filteredOrders.filter(o => o.agingCategory === 'critical');
    
    return {
      current: { count: current.length, total: current.reduce((s, o) => s + o.balance, 0) },
      moderate: { count: moderate.length, total: moderate.reduce((s, o) => s + o.balance, 0) },
      critical: { count: critical.length, total: critical.reduce((s, o) => s + o.balance, 0) }
    };
  }, [filteredOrders]);

  const totalOutstanding = filteredOrders.reduce((sum, o) => sum + o.balance, 0);

  if (selectedPartyData) {
    return <PartyDetailView party={selectedPartyData} user={user} onBack={() => setSelectedPartyData(null)} appSettings={appSettings} />;
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto relative" style={{background: 'var(--app-bg)'}}>
      
      {/* STICKY HEADER - Only title row */}
      <div className="sticky top-0 z-30 px-4 pb-3" style={{paddingTop: '16px', background:"rgba(var(--app-bg-rgb),0.93)", backdropFilter:"blur(20px)", boxShadow:"0 1px 0 var(--rgba-white-06)"}}>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <button onClick={bulkMode ? exitBulkMode : onBack} className="flex-shrink-0 p-2 rounded-2xl text-[var(--text-primary)] transition-all active:scale-90">
              {bulkMode ? <X size={20} /> : <ArrowLeft size={20} />}
            </button>
            <div className="min-w-0">
                <h1 className="fit-amount-lg font-black text-[var(--text-primary)] tracking-tight truncate">
                  {bulkMode ? `${selectedIds.size} Selected` : 'Pending Dues'}
                </h1>
                <p className="text-app-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                    <Info size={9}/> {bulkMode ? 'Tap items' : 'Collection'}
                </p>
            </div>
          </div>
          <div className="flex gap-1 flex-shrink-0">
            {activeTab === 'receivable' && !bulkMode && (
              <button 
                onClick={() => setBulkMode(true)} 
                className="p-2.5 bg-[var(--col-emerald-12)] text-emerald-400 rounded-2xl active:bg-emerald-600 active:text-white transition-all border border-[var(--col-emerald-25)]"
                title="Bulk Select"
              >
                <Users size={18} />
              </button>
            )}
            {bulkMode && (
              <button 
                onClick={() => setShowBulkThreshold(true)} 
                className="px-3 py-2 bg-[var(--col-info-12)] text-blue-400 rounded-2xl text-app-xs font-bold active:bg-blue-600 active:text-white transition-all border border-[var(--col-info-25)]"
              >
                Select
              </button>
            )}
            <button 
              onClick={() => { setTempWaiver(waiverAmount.toString()); setShowWaiverBox(true); }} 
              className="p-2.5 bg-[var(--col-info-12)] text-blue-400 rounded-2xl active:bg-blue-600 active:text-white transition-all border border-[var(--col-info-25)]"
            >
               <SlidersHorizontal size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* SCROLLABLE HEADER CONTENT */}
      <div className="p-4 space-y-4">
        {/* HIGH-IMPACT TOTAL CARD - SOFT UI */}
        <div className={`p-4 rounded-[2.5rem] flex justify-between items-center relative overflow-hidden ${activeTab === 'receivable' ? 'border border-emerald-500/20' : 'border border-rose-500/20'}`}>
            <div className="relative z-10 min-w-0">
                <div className="text-app-xs font-black text-slate-500/60 uppercase tracking-[0.15em] mb-0.5">Outstanding</div>
                <div className={`font-black line-clamp-1 ${activeTab === 'receivable' ? 'text-emerald-600' : 'text-rose-600'}`} style={{ fontSize: 'clamp(1.2rem, 3vw, 1.8rem)' }}>
                    ₹{totalOutstanding.toLocaleString('en-IN')}
                </div>
            </div>
            <div className="text-right relative z-10 whitespace-nowrap flex-shrink-0">
                <div className="text-app-xs font-black text-slate-400 uppercase mb-0.5">Threshold</div>
                <div className="text-xs font-black text-[var(--text-primary)] bg-[var(--rgba-white-10)] px-3 py-1 rounded-full shadow-sm inline-block border border-white/20">₹{waiverAmount}</div>
            </div>
            <div className="absolute -right-4 -bottom-4 opacity-5 pointer-events-none">
                {activeTab === 'receivable' ? <TrendingUp size={100}/> : <TrendingDown size={100}/>}
            </div>
        </div>

        {/* AGING ANALYSIS CARDS - SOFT UI */}
        <div className="grid grid-cols-3 gap-2">
          <div className="p-3 rounded-[2rem] border border-emerald-500/25">
            <div className="flex items-center gap-1 mb-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
              <span className="text-app-2xs font-black uppercase text-emerald-600/70">0-15d</span>
            </div>
            <div className="text-base font-black text-emerald-400 line-clamp-1 tabular-nums" style={{ fontSize: 'clamp(0.9rem, 2.5vw, 1.2rem)' }}>₹{agingSummary.current.total.toLocaleString('en-IN')}</div>
            <div className="text-app-xs text-emerald-600/60 font-bold">{agingSummary.current.count} bills</div>
          </div>
          <div className="p-3 rounded-[2rem] border border-amber-500/25">
            <div className="flex items-center gap-1 mb-1">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>
              <span className="text-app-2xs font-black uppercase text-amber-600/70">16-30d</span>
            </div>
            <div className="text-base font-black text-amber-400 line-clamp-1 tabular-nums" style={{ fontSize: 'clamp(0.9rem, 2.5vw, 1.2rem)' }}>₹{agingSummary.moderate.total.toLocaleString('en-IN')}</div>
            <div className="text-app-xs text-amber-600/60 font-bold">{agingSummary.moderate.count} bills</div>
          </div>
          <div className="p-3 rounded-[2rem] border border-rose-500/25 relative overflow-hidden">
            <div className="flex items-center gap-1 mb-1">
              <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></div>
              <span className="text-app-2xs font-black uppercase text-rose-600/70">30+</span>
            </div>
            <div className="text-base font-black text-rose-400 line-clamp-1 tabular-nums" style={{ fontSize: 'clamp(0.9rem, 2.5vw, 1.2rem)' }}>₹{agingSummary.critical.total.toLocaleString('en-IN')}</div>
            <div className="text-app-xs text-rose-600/60 font-bold">{agingSummary.critical.count} bills</div>
            {agingSummary.critical.count > 0 && (
              <div className="absolute -right-2 -top-2 w-6 h-6 bg-rose-500/10 rounded-full"></div>
            )}
          </div>
        </div>

        {/* SEARCH & MODERN TABS */}
        <div className="space-y-2">
            <div className="relative group">
                <Search className="absolute left-3 top-3 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={16} />
                <input 
                    className="w-full pl-10 p-3  border border-white/12 rounded-2xl text-xs font-bold outline-none text-[var(--text-primary)] focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 transition-all"
                    placeholder="Search party, bill or role..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
            </div>

            <div className="flex p-1 rounded-[1rem] border border-slate-200/50 border-white/10/50">
                <button 
                  onClick={() => { setActiveTab('receivable'); exitBulkMode(); }} 
                  className={`flex-1 py-2.5 rounded-[0.8rem] text-app-sm font-black tracking-widest transition-all flex items-center justify-center gap-1.5 ${activeTab === 'receivable' ? 'bg-[var(--rgba-white-08)] text-emerald-600 shadow-md' : 'text-slate-500'}`}
                >
                    <ArrowDownLeft size={14}/> RECEIVABLE
                </button>
                <button 
                  onClick={() => { setActiveTab('payable'); exitBulkMode(); }} 
                  className={`flex-1 py-2.5 rounded-[0.8rem] text-app-sm font-black tracking-widest transition-all flex items-center justify-center gap-1.5 ${activeTab === 'payable' ? 'bg-[var(--rgba-white-08)] text-rose-600 shadow-md' : 'text-slate-500'}`}
                >
                    <ArrowUpRight size={14}/> PAYABLE
                </button>
            </div>
        </div>
      </div>

      {/* DYNAMIC LIST ENGINE */}
      <div className="p-4 space-y-3 pb-40">
        {loading ? (
          <PendingSkeleton count={4} />
        ) : filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 opacity-40 text-center">
            <div className="w-24 h-24 rounded-full flex items-center justify-center mb-6">
              <AlertCircle size={48} className="text-slate-300"/>
            </div>
            <p className="font-black text-slate-500 uppercase tracking-widest text-lg">No Pending Dues</p>
            <p className="text-xs text-[var(--text-muted)] mt-2">Adjust your threshold to see smaller amounts</p>
          </div>
        ) : (
          filteredOrders.map((order) => (
            <div 
              key={order.id} 
              className={`rounded-[2.5rem] border overflow-hidden group transition-all duration-500 hover:shadow-lg ${
                bulkMode && selectedIds.has(order.id) 
                  ? 'border-green-500 ring-2 ring-green-500/20' 
                  : 'border-white/08 hover:border-[var(--col-info-25)]'
              } ${optimisticUpdates.has(order.id) ? 'opacity-60' : ''}`}
            >
              
              {/* PRIMARY ORDER ROW - WIDGET GUARD */}
              <div 
                className="p-4 flex justify-between items-start cursor-pointer active:bg-slate-50 dark:active:bg-slate-800/50"
                onClick={() => bulkMode ? toggleSelect(order.id) : setExpandedId(expandedId === order.id ? null : order.id)}
              >
                {bulkMode && (
                  <div className="mr-3 shrink-0 flex items-center">
                    {selectedIds.has(order.id) ? (
                      <div className="w-6 h-6 bg-green-500 rounded-lg flex items-center justify-center">
                        <Check size={14} className="text-white" strokeWidth={3} />
                      </div>
                    ) : (
                      <div className="w-6 h-6 border-2 border-slate-200 border-white/10 rounded-lg"></div>
                    )}
                  </div>
                )}
                
                <div className="flex-1 min-w-0 pr-3">
                  <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                    <span className="text-app-2xs font-black text-slate-400 px-2 py-0.5 rounded-full uppercase tracking-wider">
                      {order.date}
                    </span>
                    {/* Visual ID Branding Badge */}
                    <span className="text-app-xs font-black text-blue-400 bg-[var(--col-info-12)] px-2 py-0.5 rounded-full font-mono flex items-center gap-1 whitespace-nowrap">
                      {activeTab === 'receivable' ? 'R' : 'P'}-{String(order.invoice_no || order.bill_no).slice(-3)}
                      {Number(order.discount_amount) > 0 && <BadgePercent size={9} className="text-orange-500" />}
                    </span>
                    <span className={`text-app-2xs font-black px-1.5 py-0.5 rounded-full flex items-center gap-0.5 whitespace-nowrap ${
                      order.agingCategory === 'critical' 
                        ? 'bg-[var(--col-danger-15)] text-rose-400 animate-pulse' 
                        : order.agingCategory === 'moderate'
                        ? 'bg-[var(--col-warning-15)] text-amber-400'
                        : 'bg-[var(--col-emerald-15)] text-emerald-400'
                    }`}>
                      <Clock size={8} />
                      {order.daysOld}d
                    </span>
                    {order.hasAutoPayment && !bulkMode && (
                      <span className="text-app-3xs font-black px-1.5 py-0.5 rounded-full flex items-center gap-0.5 whitespace-nowrap" style={{ background: 'var(--col-accent-15)', color: "var(--col-indigo)", border: '1px solid var(--col-accent-25)' }}>
                        <Zap size={7} /> Auto Adj.
                      </span>
                    )}
                    {bulkMode && !order.partyInfo?.contact && (
                      <span className="text-app-2xs font-bold text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded-full whitespace-nowrap">No#</span>
                    )}
                  </div>
                  <h3 className="font-black truncate flex items-center gap-2 text-sm min-w-0">
                    <span className="truncate">{order.party_name}</span>
                    <span className={`text-app-3xs px-1.5 py-0.5 rounded-full uppercase font-black border whitespace-nowrap flex-shrink-0 ${activeTab === 'receivable' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100'}`}>
                       {order.partyInfo?.role || (activeTab === 'receivable' ? 'cust' : 'supp')}
                    </span>
                  </h3>
                </div>

                <div className="text-right flex items-center gap-2 shrink-0 ml-2 flex-shrink-0">
                  <div className="whitespace-nowrap">
                    <div className="text-app-2xs font-black text-slate-400 uppercase tracking-widest mb-0.5">Due</div>
                    <div className={`font-black line-clamp-1 tabular-nums ${activeTab === 'receivable' ? 'text-rose-600' : 'text-amber-600'}`} style={{ fontSize: 'clamp(0.85rem, 2.2vw, 1.1rem)' }}>
                      ₹{order.balance.toLocaleString('en-IN')}
                    </div>
                  </div>
                  {!bulkMode && (
                    <div className={`p-1.5 rounded-xl transition-all duration-500 shrink-0 ${expandedId === order.id ? 'bg-blue-600 text-white rotate-180' : 'bg-slate-50 bg-[var(--rgba-white-06)] text-slate-400'}`}>
                      <ChevronDown size={18}/>
                    </div>
                  )}
                </div>
              </div>

              {/* EXPANDABLE "PRO" SECTION */}
              {!bulkMode && expandedId === order.id && (
                <div className="px-6 pb-6 pt-3 border-t border-dashed border-white/08 animate-in fade-in slide-in-from-top-6 duration-500">
                  
                  {/* COLLECTION PROGRESS BAR */}
                  <div className="mb-6">
                    <div className="flex justify-between text-app-sm font-black uppercase text-slate-400 mb-2 tracking-tighter">
                      <span className="flex items-center gap-1"><History size={10}/> Collection Progress</span>
                      <span className="text-blue-600">{Math.round((order.totalReceived / order.orderTotal) * 100)}% Collected</span>
                    </div>
                    <div className="h-2.5 w-full rounded-full overflow-hidden shadow-inner p-0.5">
                      <div 
                        className={`h-full rounded-full transition-all duration-1000 ease-out shadow-sm ${activeTab === 'receivable' ? 'bg-gradient-to-r from-emerald-400 to-emerald-600' : 'bg-gradient-to-r from-blue-400 to-blue-600'}`} 
                        style={{ width: `${(order.totalReceived / order.orderTotal) * 100}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* FINANCIAL SPLIT CARDS - SOFT UI */}
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="p-4 rounded-[2rem] border border-white/10">
                        <div className="text-app-sm font-black text-slate-400 uppercase flex items-center gap-2 mb-1">
                            <TrendingUp size={14} className="text-slate-300"/> Grand Total
                        </div>
                        <div className="text-lg font-black text-[var(--text-primary)] tabular-nums">₹{order.orderTotal.toLocaleString('en-IN')}</div>
                    </div>
                    <div className="p-4 rounded-[2rem] border border-emerald-500/20 bg-emerald-500/08 text-right">
                        <div className="text-app-sm font-black text-slate-400 uppercase flex items-center justify-end gap-2 mb-1">
                            <TrendingDown size={14} className="text-emerald-400"/> Total Settled
                        </div>
                        <div className="text-lg font-black text-emerald-600 tabular-nums">₹{order.totalReceived.toLocaleString('en-IN')}</div>
                    </div>
                  </div>

                  {/* ITEMIZED BILL BREAKDOWN */}
                  <div className="space-y-3 mb-6">
                    <div className="text-app-sm font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2 mb-3">
                      <Package size={16} className="text-blue-500/40"/> Product Breakdown
                    </div>
                    {order.items?.map((it: any, idx: number) => (
                      <div key={idx} className="flex justify-between items-center text-xs py-3 border-b border-slate-50 border-white/08 last:border-0 hover:bg-slate-50/50 hover:bg-[var(--rgba-white-08)]/20 rounded-xl px-2 transition-colors">
                        <div className="flex flex-col">
                          <span className="font-black text-[var(--text-secondary)] text-[var(--text-secondary)]">{it.item_name}</span>
                          <span className="text-app-sm text-slate-400 font-bold tracking-tight">{it.quantity} {it.unit} • ₹{it.rate}/unit</span>
                        </div>
                        <div className="font-black px-3 py-1 rounded-lg border border-white/10">₹{Number(it.total || 0).toLocaleString('en-IN')}</div>
                      </div>
                    ))}
                    
                    {Number(order.vehicle_rent || 0) > 0 && (
                      <div className="flex justify-between items-center text-app-md py-3 text-orange-600 font-black bg-[var(--col-warning-08)] rounded-2xl px-3 border border-[var(--col-warning-25)]">
                        <span className="flex items-center gap-2">🚚 Transport & Logistics</span>
                        <span>₹{Number(order.vehicle_rent).toLocaleString('en-IN')}</span>
                      </div>
                    )}
                  </div>

                  {/* PAYMENT HISTORY TIMELINE */}
                  <div className="space-y-3 mb-8">
                    <div className="text-app-sm font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2 mb-4">
                      <History size={16} className="text-emerald-500/40"/> Transaction History
                    </div>
                    {order.history?.length > 0 ? (
                      <div className="space-y-4">
                        {order.history.map((t: any, idx: number) => (
                          <div key={idx} className="flex items-start gap-4 relative">
                            {/* Vertical Line Connector */}
                            {idx !== order.history.length - 1 && <div className="absolute left-3.5 top-8 w-0.5 h-6 opacity-20"></div>}
                            
                            <div className="w-7 h-7 bg-[var(--col-emerald-25)] text-emerald-400 rounded-full flex items-center justify-center shrink-0 z-10 border-4 border-col-app-bg">
                                <Check size={12} strokeWidth={4}/>
                            </div>
                            <div className="flex-1 var(--rgba-white-04) p-3 rounded-2xl border border-white/10">
                              <div className="flex justify-between items-center mb-1">
                                <span className="text-sm font-black text-[var(--text-primary)]">₹{Number(t.amount).toLocaleString('en-IN')}</span>
                                <span className="text-app-sm font-bold text-slate-400 flex items-center gap-1">
                                    <Calendar size={10}/> {t.date}
                                </span>
                              </div>
                              <div className="flex justify-between items-center text-app-sm">
                                <span className="text-slate-500 font-bold uppercase tracking-tighter">{t.payment_mode || 'Direct'}</span>
                                {t.remarks && <span className="text-slate-400 italic">"{t.remarks}"</span>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="bg-[var(--rgba-white-06)]/40 p-4 rounded-3xl text-center border border-dashed border-slate-200 border-white/10">
                        <p className="text-app-md text-slate-400 font-bold italic">No payments received yet for this invoice.</p>
                      </div>
                    )}

                    {/* AUTO-ADJUSTED PAYMENTS SECTION */}
                    {order.hasAutoPayment && order.autoPayments?.length > 0 && (
                      <div className="mt-4 p-3 rounded-2xl border border-dashed" style={{ borderColor: 'var(--col-accent-35)', background: 'var(--col-accent-05)' }}>
                        <div className="flex items-center gap-1.5 mb-3">
                          <Zap size={11} style={{ color: "var(--col-indigo)" }} />
                          <span className="text-app-xs font-black uppercase tracking-wider" style={{ color: "var(--col-indigo)" }}>
                            Auto Adjusted Payments
                          </span>
                        </div>
                        <div className="space-y-2">
                          {order.autoPayments.map((ap: any, idx: number) => (
                            <div key={idx} className="flex items-center justify-between text-app-sm">
                              <div className="flex items-center gap-2">
                                <span className="font-mono px-1.5 py-0.5 rounded-md text-app-2xs" style={{ background: 'var(--col-accent-15)', color: "var(--col-indigo-light)" }}>
                                  #{String(ap.txId).slice(-6).toUpperCase()}
                                </span>
                                <span style={{ color: 'rgba(165,180,252,0.65)' }}>{ap.date}</span>
                              </div>
                              <span className="font-black" style={{ color: "var(--col-indigo-light)" }}>₹{Math.round(ap.amount).toLocaleString('en-IN')}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ACTION ECOSYSTEM */}
                  <div className="flex flex-col gap-3">
                    <div className="flex gap-3">
                        <button 
                            onClick={() => setSelectedPartyData(order.partyInfo || { name: order.party_name, role: activeTab === 'receivable' ? 'customer' : 'supplier' })} 
                            className="flex-1 py-4 rounded-[1.5rem] text-app-md font-black uppercase tracking-[0.1em] shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 text-white" style={{background:"linear-gradient(135deg,#4f46e5,#7c3aed)",boxShadow:"0 4px 16px var(--col-indigo-40)"}}
                        >
                            <UserIcon size={16}/> Profile Ledger
                        </button>
                        {order.partyInfo?.contact && (
                            <a 
                                href={`tel:${order.partyInfo.contact}`} 
                                className="p-4 bg-[var(--col-info-12)] text-blue-400 rounded-[1.5rem] active:scale-95 transition-all border border-[var(--col-info-25)]"
                            >
                                <Phone size={24}/>
                            </a>
                        )}
                    </div>

                    {activeTab === 'receivable' && (
                      <div className="flex gap-3">
                        {/* PDF Statement Button */}
                        <button 
                          onClick={() => sendPdfStatement(order.party_name)}
                          className="flex-1 py-4 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-[1.5rem] text-app-md font-black uppercase tracking-[0.1em] shadow-lg shadow-indigo-100 dark:shadow-none active:scale-95 transition-all flex items-center justify-center gap-2"
                        >
                          <FileText size={16}/> Send Statement PDF
                        </button>
                  {/* WhatsApp Quick Reminder */}
                  <button
                    onClick={() => sendWhatsAppReminder(order)}
                    className="p-4 bg-col-whatsapp hover:bg-col-whatsapp-dark text-white rounded-[1.5rem] active:scale-95 transition-all shadow-lg"
                    title="Send WhatsApp reminder"
                  >
                    <MessageSquare size={20} fill="currentColor"/>
                  </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* MODERN WAIVER OVERLAY (TOAST BOX) */}
      {showWaiverBox && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[100] flex items-end sm:items-center justify-center p-4 transition-all">
            <div
              className="waiver-box-root w-full max-w-sm rounded-2xl shadow-[0_24px_48px_-12px_var(--rgba-black-60)] p-5 animate-in slide-in-from-bottom-12 duration-300"
              style={{ background: "var(--col-app-bg-mid)", border: '1px solid var(--glass-border)' }}
            >
                <div className="flex justify-between items-center mb-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-600 text-white rounded-xl">
                          <SlidersHorizontal size={16}/>
                        </div>
                        <h2 className="text-base font-black text-[var(--text-primary)] tracking-tight">Set Waiver</h2>
                    </div>
                    <button onClick={() => setShowWaiverBox(false)} className="p-1.5 text-slate-400 rounded-full transition-colors hover:text-rose-500">
                      <X size={16}/>
                    </button>
                </div>

                <p className="text-app-sm font-bold text-[var(--text-muted)] mb-3 leading-relaxed uppercase tracking-wider">
                   Ignore balances smaller than:
                </p>

                <div className="relative mb-5 group">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-black text-lg text-blue-600/40 group-focus-within:text-blue-500 transition-colors">₹</span>
                    <input
                        type="number"
                        autoFocus
                        value={tempWaiver}
                        onChange={(e) => setTempWaiver(e.target.value)}
                        className="w-full py-3 pl-9 pr-3 rounded-xl text-xl font-black outline-none border-2 border-transparent focus:border-blue-500 transition-all text-[var(--text-primary)]"
                        style={{ background: 'var(--rgba-white-05)', borderColor: 'var(--rgba-white-08)' }}
                        placeholder="0"
                    />
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={() => setShowWaiverBox(false)}
                        className="flex-1 py-2.5 rounded-xl text-slate-400 font-bold text-xs uppercase tracking-wider hover:text-slate-200 transition-colors"
                        style={{ background: 'var(--rgba-white-05)', border: '1px solid var(--glass-border)' }}
                    >
                        Skip
                    </button>
                    <button
                        onClick={handleSaveWaiver}
                        className="flex-[2] py-2.5 bg-blue-600 text-white rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 active:scale-95 transition-all"
                    >
                        <Check size={14} strokeWidth={3}/> Apply Threshold
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* BULK THRESHOLD SELECTION MODAL */}
      {showBulkThreshold && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[100] flex items-end sm:items-center justify-center p-4 transition-all">
            <div
              className="w-full max-w-sm rounded-2xl shadow-[0_24px_48px_-12px_var(--rgba-black-60)] p-5 animate-in slide-in-from-bottom-12 duration-300"
              style={{ background: "var(--col-app-bg-mid)", border: '1px solid var(--glass-border)' }}
            >
                <div className="flex justify-between items-center mb-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-green-600 text-white rounded-xl">
                          <Users size={16}/>
                        </div>
                        <h2 className="text-base font-black text-[var(--text-primary)] tracking-tight">Select by Amount</h2>
                    </div>
                    <button onClick={() => setShowBulkThreshold(false)} className="p-1.5 text-slate-400 rounded-full transition-colors hover:text-rose-500">
                      <X size={16}/>
                    </button>
                </div>

                <p className="text-app-sm font-bold text-[var(--text-muted)] mb-3 leading-relaxed uppercase tracking-wider">
                   Select all customers with dues above:
                </p>

                <div className="relative mb-5 group">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-black text-lg text-green-600/40 group-focus-within:text-green-500 transition-colors">₹</span>
                    <input
                        type="number"
                        autoFocus
                        value={bulkThreshold}
                        onChange={(e) => setBulkThreshold(e.target.value)}
                        className="w-full py-3 pl-9 pr-3 rounded-xl text-xl font-black outline-none border-2 border-transparent focus:border-green-500 transition-all text-[var(--text-primary)]"
                        style={{ background: 'var(--rgba-white-05)', borderColor: 'var(--rgba-white-08)' }}
                        placeholder="1000"
                    />
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={() => setShowBulkThreshold(false)}
                        className="flex-1 py-2.5 rounded-xl text-slate-400 font-bold text-xs uppercase tracking-wider hover:text-slate-200 transition-colors"
                        style={{ background: 'var(--rgba-white-05)', border: '1px solid var(--glass-border)' }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={selectAllAboveThreshold}
                        className="flex-[2] py-2.5 bg-green-600 text-white rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 active:scale-95 transition-all"
                    >
                        <CheckSquare size={14} strokeWidth={3}/> Select All
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* FLOATING BULK ACTION BAR */}
      {bulkMode && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-4 right-4 z-50 animate-in slide-in-from-bottom-8 duration-300">
          <div className="bg-slate-900 bg-[var(--rgba-white-06)] rounded-[2rem] p-4 flex items-center justify-between shadow-[0_20px_60px_-10px_var(--rgba-black-50)]">
            <div className="flex items-center gap-3 pl-2">
              <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
                <Check size={20} className="text-white" strokeWidth={3}/>
              </div>
              <div>
                <div className="text-white font-black text-lg">{selectedIds.size} Selected</div>
                <div className="text-slate-400 text-app-sm font-bold uppercase tracking-wider">Ready to send reminders</div>
              </div>
            </div>
            <button 
              onClick={sendBulkReminders}
              className="px-6 py-4 bg-col-whatsapp text-white rounded-2xl font-black text-xs uppercase tracking-widest flex items-center gap-2 active:scale-95 transition-all shadow-lg"
            >
              <Send size={18}/> Send All
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

export default PendingView;







