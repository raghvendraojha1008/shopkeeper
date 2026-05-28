import React, { useState, useEffect, useMemo } from 'react';
import { User } from 'firebase/auth';
import { 
  ArrowLeft, TrendingUp, BarChart3, Package, Search, Filter 
} from 'lucide-react';
import { ApiService } from '../../services/api';
import { formatCurrency } from '../../utils/helpers';
import DateRangeFilter from '../common/DateRangeFilter';
import { parseDateSafe, toDateStrSafe } from '../../utils/dateUtils';

interface SalesDashboardProps {
  user: User;
  onBack: () => void;
}

function parseRecordDate(raw: any): Date {
  return parseDateSafe(raw);
}
function toDateString(raw: any): string {
  return toDateStrSafe(raw);
}

const SalesDashboard: React.FC<SalesDashboardProps> = ({ user, onBack }) => {
  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Date Filter (Default: This Month)
  const [dateRange, setDateRange] = useState({
      start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
      end: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const snap = await ApiService.getAll(user.uid, 'ledger_entries');
        // Filter only 'sell' entries
        const data = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter((d: any) => d.type === 'sell');
        setSales(data);
      } catch (e) { console.error(e); } 
      finally { setLoading(false); }
    };
    load();
  }, [user]);

  // --- AGGREGATION ENGINE ---
  const stats = useMemo(() => {
      const filtered = sales.filter(s => {
          const inDate = toDateString(s.date) >= dateRange.start && toDateString(s.date) <= dateRange.end;
          return inDate;
      });

      let totalRevenue = 0; // Excludes Rent
      const itemMap: any = {};

      filtered.forEach(sale => {
          // Calculate Net Item Total (Total - Rent)
          const rent = Number(sale.vehicle_rent) || 0;
          const fullTotal = Number(sale.total_amount) || 0;
          const netTotal = fullTotal - rent;
          
          totalRevenue += netTotal;

          // Aggregating Items
          if(sale.items) {
              sale.items.forEach((item: any) => {
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
                  
                  // Item Value approximation (qty * rate)
                  // Note: This is raw value, doesn't account for individual item tax unless stored
                  const val = (Number(item.quantity) || 0) * (Number(item.rate) || 0);
                  itemMap[item.item_name].value += val;
              });
          }
      });

      const itemList = Object.values(itemMap).sort((a: any, b: any) => b.value - a.value);

      // Search Filtering on Items
      const finalItems = searchTerm 
          ? itemList.filter((i:any) => (i.name || '').toLowerCase().includes(searchTerm.toLowerCase()))
          : itemList;

      return { totalRevenue, finalItems, count: filtered.length };
  }, [sales, dateRange, searchTerm]);

  return (
    <div className="flex flex-col h-full px-3 pt-3 md:px-6" style={{background: 'var(--app-bg)'}}>
      
      {/* HEADER */}
      <div className="flex items-center gap-3 mb-4">
          <button onClick={onBack} className="p-2 rounded-full active:scale-95 transition-all glass-icon-btn">
              <ArrowLeft size={20} />
          </button>
          <div>
              <h1 className="text-xl font-black leading-none">Sales Overview</h1>
              <p className="text-[10px] font-bold text-slate-400 uppercase">Item-wise Analysis</p>
          </div>
      </div>

      {/* TOTAL CARD */}
      <div className="p-5 rounded-2xl shadow-lg mb-4 flex justify-between items-center relative overflow-hidden shrink-0" style={{background:"linear-gradient(135deg,rgba(16,185,129,0.8),rgba(5,150,105,0.9))"}}>
           <div className="relative z-10">
               <div className="text-[10px] font-bold opacity-80 uppercase mb-1">Total Sales Volume (Excl. Rent)</div>
               <div className="fit-amount-xl font-black leading-none mb-2 text-white">{formatCurrency(stats.totalRevenue)}</div>
               <div className="flex gap-3 text-[10px] font-bold bg-[rgba(255,255,255,0.06)]/10 px-2 py-1 rounded-lg w-fit">
                   <Package size={12}/> {stats.count} Invoices
               </div>
           </div>
           <div className="bg-[rgba(255,255,255,0.06)]/10 p-3 rounded-full relative z-10">
               <TrendingUp size={32} className="text-white"/>
           </div>
           <BarChart3 size={100} className="absolute -bottom-4 -right-4 text-white opacity-10 pointer-events-none"/>
       </div>

      {/* CONTROLS */}
      <div className="p-2.5 rounded-xl mb-4 space-y-2 bg-[rgba(255,255,255,0.04)] border border-white/08">
           <div className="flex gap-2">
               <div className="flex-1 relative">
                   <Search className="absolute left-3 top-2.5 text-slate-400" size={14}/>
                   <input 
                       className="w-full pl-8 p-2 border border-white/12 bg-[rgba(255,255,255,0.05)] rounded-lg text-xs font-bold outline-none text-[rgba(226,232,240,0.88)]" 
                       placeholder="Search Item Name..." 
                       value={searchTerm} 
                       onChange={e => setSearchTerm(e.target.value)} 
                   />
               </div>
           </div>
           <DateRangeFilter
               start={dateRange.start}
               end={dateRange.end}
               onStartChange={v => setDateRange(r => ({...r, start: v}))}
               onEndChange={v => setDateRange(r => ({...r, end: v}))}
           />
      </div>

      {/* ITEM LIST */}
      <div className="flex-1 overflow-y-auto pb-20 space-y-2">
          {loading ? <div className="text-center py-10 text-[rgba(148,163,184,0.45)]">Loading...</div> : stats.finalItems.map((item: any, i: number) => (
              <div key={i} className="p-4 rounded-xl flex justify-between items-center bg-[rgba(255,255,255,0.05)] border border-white/08">
                  <div>
                      <div className="text-sm font-bold ">{item.name}</div>
                      <div className="text-[10px] text-slate-500 font-bold mt-1">
                          {item.count} Orders
                      </div>
                  </div>
                  <div className="text-right">
                      <div className="text-base font-black text-[#34d399]">
                          {item.qty} <span className="text-[10px] text-slate-400 font-bold uppercase">{item.unit}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 font-bold">
                          Total Value: {formatCurrency(item.value)}
                      </div>
                  </div>
              </div>
          ))}
          {stats.finalItems.length === 0 && (
              <div className="text-center py-10 text-[rgba(148,163,184,0.45)] text-xs">No items sold in this period.</div>
          )}
      </div>
    </div>
  );
};

export default SalesDashboard;







