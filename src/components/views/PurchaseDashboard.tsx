import React, { useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import { 
  ArrowLeft, TrendingDown, BarChart3, Package, Search 
} from 'lucide-react';
import { useData } from '../../context/DataContext';
import { formatCurrency } from '../../utils/helpers';
import DateRangeFilter from '../common/DateRangeFilter';
import { parseDateSafe, toDateStrSafe } from '../../utils/dateUtils';

interface PurchaseDashboardProps {
  user: User;
  onBack: () => void;
}

function parseRecordDate(raw: any): Date {
  return parseDateSafe(raw);
}
function toDateString(raw: any): string {
  return toDateStrSafe(raw);
}

const PurchaseDashboard: React.FC<PurchaseDashboardProps> = ({ user, onBack }) => {
  const { useLedger } = useData();
  const { data: ledgerRaw, isLoading: loading } = useLedger(user.uid);
  const purchases = useMemo(() => (ledgerRaw || []).filter((d: any) => d.type === 'purchase'), [ledgerRaw]);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [dateRange, setDateRange] = useState({
      start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
      end: new Date().toISOString().split('T')[0]
  });

  const stats = useMemo(() => {
      const filtered = purchases.filter(p => {
          const inDate = toDateString(p.date) >= dateRange.start && toDateString(p.date) <= dateRange.end;
          return inDate;
      });

      let totalCost = 0; 
      const itemMap: any = {};

      filtered.forEach(purchase => {
          const rent = Number(purchase.vehicle_rent) || 0;
          const fullTotal = Number(purchase.total_amount) || 0;
          const netTotal = fullTotal - rent;
          
          totalCost += netTotal;

          if(purchase.items) {
              purchase.items.forEach((item: any) => {
                  if(!itemMap[item.item_name]) {
                      itemMap[item.item_name] = { 
                          name: item.item_name, 
                          qty: 0, 
                          unit: item.unit || 'Units',
                          count: 0,
                          value: 0
                      };
                  }
                  itemMap[item.item_name].qty += Number(item.quantity) || 0;
                  itemMap[item.item_name].count += 1;
                  const val = (Number(item.quantity) || 0) * (Number(item.rate) || 0);
                  itemMap[item.item_name].value += val;
              });
          }
      });

      const itemList = Object.values(itemMap).sort((a: any, b: any) => b.value - a.value);

      const finalItems = searchTerm 
          ? itemList.filter((i:any) => (i.name || '').toLowerCase().includes(searchTerm.toLowerCase()))
          : itemList;

      return { totalCost, finalItems, count: filtered.length };
  }, [purchases, dateRange, searchTerm]);

  return (
    <div className="flex flex-col h-full px-3 pt-3 md:px-6" style={{background: 'var(--app-bg)'}}>
      
      <div className="flex items-center gap-3 mb-4">
          <button onClick={onBack} className="p-2 rounded-full active:scale-95 transition-all glass-icon-btn">
              <ArrowLeft size={20} />
          </button>
          <div>
              <h1 className="text-xl font-black leading-none">Purchase Overview</h1>
              <p className="text-[10px] font-bold text-slate-400 uppercase">Item-wise Analysis</p>
          </div>
      </div>

      <div className="p-5 rounded-2xl shadow-lg mb-4 flex justify-between items-center relative overflow-hidden shrink-0" style={{background:"linear-gradient(135deg,rgba(239,68,68,0.8),rgba(220,38,38,0.9))"}}>
           <div className="relative z-10">
               <div className="text-[10px] font-bold opacity-80 uppercase mb-1">Total Purchase Cost (Excl. Rent)</div>
               <div className="fit-amount-xl font-black leading-none mb-2 text-white">{formatCurrency(stats.totalCost)}</div>
               <div className="flex gap-3 text-[10px] font-bold bg-[rgba(255,255,255,0.06)]/10 px-2 py-1 rounded-lg w-fit">
                   <Package size={12}/> {stats.count} Bills
               </div>
           </div>
           <div className="bg-[rgba(255,255,255,0.06)]/10 p-3 rounded-full relative z-10">
               <TrendingDown size={32} className="text-white"/>
           </div>
           <BarChart3 size={100} className="absolute -bottom-4 -right-4 text-white opacity-10 pointer-events-none"/>
       </div>

      <div className="p-2.5 rounded-xl mb-4 space-y-2 bg-[rgba(255,255,255,0.04)] border border-white/08">
           <div className="flex gap-2">
               <div className="flex-1 relative">
                   <Search className="absolute left-3 top-2.5 text-slate-400" size={14}/>
                   <input className="w-full pl-8 p-2 border border-white/12 bg-[rgba(255,255,255,0.05)] rounded-lg text-xs font-bold outline-none text-[rgba(226,232,240,0.88)]" placeholder="Search Item Name..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
               </div>
           </div>
           <DateRangeFilter
               start={dateRange.start}
               end={dateRange.end}
               onStartChange={v => setDateRange(r => ({...r, start: v}))}
               onEndChange={v => setDateRange(r => ({...r, end: v}))}
           />
      </div>

      <div className="flex-1 overflow-y-auto pb-20 space-y-2">
          {loading ? <div className="text-center py-10 text-[rgba(148,163,184,0.45)]">Loading...</div> : stats.finalItems.map((item: any, i: number) => (
              <div key={i} className="p-4 rounded-xl flex justify-between items-center bg-[rgba(255,255,255,0.05)] border border-white/08">
                  <div>
                      <div className="text-sm font-bold ">{item.name}</div>
                      <div className="text-[10px] text-slate-500 font-bold mt-1">
                          {item.count} Purchases
                      </div>
                  </div>
                  <div className="text-right">
                      <div className="text-base font-black text-[#f87171]">
                          {item.qty} <span className="text-[10px] text-slate-400 font-bold uppercase">{item.unit}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 font-bold">
                          Total Value: {formatCurrency(item.value)}
                      </div>
                  </div>
              </div>
          ))}
          {stats.finalItems.length === 0 && (
              <div className="text-center py-10 text-[rgba(148,163,184,0.45)] text-xs">No items purchased in this period.</div>
          )}
      </div>
    </div>
  );
};

export default PurchaseDashboard;







