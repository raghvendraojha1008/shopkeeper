import React, { useState, useMemo, useEffect } from 'react';
import { 
  ArrowLeft, TrendingUp, TrendingDown, BarChart3, PieChart,
  Users, Package, Calendar, DollarSign, ArrowUpRight, ArrowDownLeft,
  Target, Zap, Award, AlertTriangle, ChevronDown, ChevronUp
} from 'lucide-react';
import { ApiService } from '../../services/api';

interface AnalyticsDashboardProps {
  user: any;
  ledgerData: any[];
  expenseData: any[];
  transactionData: any[];
  inventoryData: any[];
  settings: any;
  onBack: () => void;
}

// Simple bar component
const Bar: React.FC<{value: number; max: number; color: string}> = ({value, max, color}) => (
  <div className="h-1.5 rounded-full w-full" style={{background:'var(--rgba-white-07)'}}>
    <div className="h-full rounded-full transition-all duration-700"
      style={{width:`${Math.min(100,(value/Math.max(max,1))*100)}%`, background: color}}/>
  </div>
);

// Sparkline mini bars
const Sparkline: React.FC<{data: number[]; color: string}> = ({data, color}) => {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-0.5 h-8">
      {data.map((v, i) => (
        <div key={i} className="flex-1 rounded-sm transition-all"
          style={{height:`${Math.max(8,(v/max)*100)}%`, background: i === data.length-1 ? color : `${color}55`}}/>
      ))}
    </div>
  );
};

const AdvancedAnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  user, ledgerData: propLedger, expenseData: propExpense, transactionData: propTrans, inventoryData: propInv, settings, onBack
}) => {
  const [period, setPeriod] = useState<'week' | 'month' | 'quarter'>('month');
  const [expandSection, setExpandSection] = useState<string | null>('pnl');
  const [dataLoaded, setDataLoaded] = useState(false);
  const [ledgerData, setLedgerData] = useState<any[]>(propLedger || []);
  const [expenseData, setExpenseData] = useState<any[]>(propExpense || []);
  const [transactionData, setTransactionData] = useState<any[]>(propTrans || []);
  const [inventoryData, setInventoryData] = useState<any[]>(propInv || []);

  // Self-load data if not provided via props
  useEffect(() => {
    const needsLoad = !propLedger?.length && !propExpense?.length && !propTrans?.length;
    if (!needsLoad || !user?.uid) { setDataLoaded(true); return; }
    const uid = user.uid;
    Promise.all([
      ApiService.getAll(uid, 'ledger_entries'),
      ApiService.getAll(uid, 'expenses'),
      ApiService.getAll(uid, 'transactions'),
      ApiService.getAll(uid, 'inventory'),
    ]).then(([lSnap, eSnap, tSnap, iSnap]) => {
      setLedgerData(lSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })));
      setExpenseData(eSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })));
      setTransactionData(tSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })));
      setInventoryData(iSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })));
    }).catch(console.error).finally(() => setDataLoaded(true));
  }, [user?.uid]);

  // ── Date helpers ──────────────────────────────────────────────────────────
  const today   = new Date();
  const getDaysBack = (days: number) => {
    const d = new Date(today); d.setDate(d.getDate() - days); return d.toISOString().split('T')[0];
  };
  const periodDays = period === 'week' ? 7 : period === 'month' ? 30 : 90;
  const periodStart = getDaysBack(periodDays);
  const prevStart   = getDaysBack(periodDays * 2);

  const inPeriod   = (date: string) => date >= periodStart;
  const inPrevPeriod = (date: string) => date >= prevStart && date < periodStart;

  // ── P&L ──────────────────────────────────────────────────────────────────
  const pnl = useMemo(() => {
    const sales     = ledgerData.filter(e => e.type === 'sell'     && inPeriod(e.date));
    const purchases = ledgerData.filter(e => e.type === 'purchase' && inPeriod(e.date));
    const expenses  = expenseData.filter(e => inPeriod(e.date));

    const totalSales     = sales.reduce((s,e)     => s + (Number(e.total_amount)||0), 0);
    const totalPurchases = purchases.reduce((s,e) => s + (Number(e.total_amount)||0), 0);
    const totalExpenses  = expenses.reduce((s,e)  => s + (Number(e.amount)||0), 0);
    const grossProfit    = totalSales - totalPurchases;
    const netProfit      = grossProfit - totalExpenses;
    const margin         = totalSales > 0 ? (netProfit / totalSales) * 100 : 0;

    // Previous period for comparison
    const prevSales = ledgerData.filter(e => e.type === 'sell' && inPrevPeriod(e.date))
      .reduce((s,e) => s + (Number(e.total_amount)||0), 0);
    const salesChange = prevSales > 0 ? ((totalSales - prevSales) / prevSales) * 100 : 0;

    return { totalSales, totalPurchases, totalExpenses, grossProfit, netProfit, margin, salesChange };
  }, [ledgerData, expenseData, period]);

  // ── Cash Flow (30-day daily) ───────────────────────────────────────────────
  const cashFlowData = useMemo(() => {
    const days = 30;
    const result: number[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = getDaysBack(i);
      const daySales = ledgerData
        .filter(e => e.type === 'sell' && e.date === d)
        .reduce((s,e) => s + (Number(e.total_amount)||0), 0);
      const dayExp = expenseData
        .filter(e => e.date === d)
        .reduce((s,e) => s + (Number(e.amount)||0), 0);
      result.push(daySales - dayExp);
    }
    return result;
  }, [ledgerData, expenseData]);

  // ── Top Customers ─────────────────────────────────────────────────────────
  const topCustomers = useMemo(() => {
    const map: Record<string, number> = {};
    ledgerData.filter(e => e.type === 'sell' && inPeriod(e.date)).forEach(e => {
      const n = e.party_name || 'Unknown';
      map[n] = (map[n] || 0) + (Number(e.total_amount) || 0);
    });
    return Object.entries(map)
      .sort((a,b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, value]) => ({ name, value }));
  }, [ledgerData, period]);

  // ── Top Items by Revenue ──────────────────────────────────────────────────
  const topItems = useMemo(() => {
    const map: Record<string, {revenue: number; qty: number}> = {};
    ledgerData.filter(e => e.type === 'sell' && inPeriod(e.date)).forEach(e => {
      (e.items || []).forEach((item: any) => {
        const n = item.item_name || 'Unknown';
        if (!map[n]) map[n] = { revenue: 0, qty: 0 };
        map[n].revenue += (Number(item.quantity)||0) * (Number(item.rate)||0);
        map[n].qty     += Number(item.quantity) || 0;
      });
    });
    return Object.entries(map)
      .sort((a,b) => b[1].revenue - a[1].revenue)
      .slice(0, 5)
      .map(([name, v]) => ({ name, ...v }));
  }, [ledgerData, period]);

  // ── Expense Categories ────────────────────────────────────────────────────
  const expCats = useMemo(() => {
    const map: Record<string, number> = {};
    expenseData.filter(e => inPeriod(e.date)).forEach(e => {
      const cat = e.category || 'Other';
      map[cat] = (map[cat] || 0) + (Number(e.amount)||0);
    });
    const total = Object.values(map).reduce((s,v) => s+v, 0);
    return Object.entries(map)
      .sort((a,b) => b[1]-a[1])
      .map(([name, value]) => ({ name, value, pct: total > 0 ? (value/total)*100 : 0 }));
  }, [expenseData, period]);

  // ── 30-day Forecast (simple linear regression) ────────────────────────────
  const forecast = useMemo(() => {
    const last30 = cashFlowData.slice(-30);
    const avg    = last30.reduce((s,v) => s+v, 0) / Math.max(last30.length, 1);
    const trend  = last30.length >= 7
      ? (last30.slice(-7).reduce((s,v) => s+v,0)/7) - (last30.slice(0,7).reduce((s,v) => s+v,0)/7)
      : 0;
    return { avg, trend, next30: Math.max(0, (avg + trend) * 30) };
  }, [cashFlowData]);

  // ── helpers ────────────────────────────────────────────────────────────────
  const fmt = (n: number) => `₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
  const pct  = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
  const green = "var(--col-success)"; const red = "var(--col-danger)"; const blue = "var(--col-info)"; const purple = "var(--col-violet)";

  const Section: React.FC<{id: string; title: string; icon: React.FC<any>; color: string; children: React.ReactNode}> = 
    ({id, title, icon: Icon, color, children}) => {
    const open = expandSection === id;
    return (
      <div className="rounded-2xl overflow-hidden mb-3" style={{background:'var(--rgba-white-04)', border:'1px solid var(--glass-border)'}}>
        <button onClick={() => setExpandSection(open ? null : id)}
          className="w-full flex items-center justify-between px-4 py-3 active:bg-white/5">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl" style={{background:`${color}20`}}>
              <Icon size={14} style={{color}}/>
            </div>
            <span className="text-sm font-black" style={{color: 'var(--text-primary)'}}>{title}</span>
          </div>
          {open ? <ChevronUp size={14} style={{color: 'var(--text-muted)'}}/> : <ChevronDown size={14} style={{color: 'var(--text-muted)'}}/>}
        </button>
        {open && <div className="px-4 pb-4 pt-1">{children}</div>}
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto pb-20" style={{background:'var(--app-bg)'}}>
      {/* HEADER */}
      <div className="sticky top-0 z-30 flex items-center gap-3 px-4 pb-3"
        style={{paddingTop: '16px', background:'rgba(var(--app-bg-rgb),0.93)', backdropFilter:'blur(20px)', borderBottom:'1px solid var(--glass-border)'}}>
        {/* Left — back + title; flex-1 min-w-0 so long subtitle never pushes period toggle off-screen */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <button onClick={onBack} className="flex-shrink-0 p-2 rounded-2xl active:scale-95"
            style={{background:'var(--rgba-white-08)', border:'1px solid var(--glass-border)', color: 'var(--text-muted)'}}>
            <ArrowLeft size={18}/>
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-black truncate">Analytics</h1>
            <p className="text-app-xs font-bold uppercase truncate" style={{color: 'var(--text-muted)'}}>
              {!dataLoaded ? 'Loading…' : 'Business Intelligence'}
            </p>
          </div>
        </div>
        {/* Period toggle — flex-shrink-0 so it's always fully visible */}
        <div className="flex gap-1 p-1 rounded-xl flex-shrink-0" style={{background:'var(--rgba-white-06)', border:'1px solid var(--glass-border)'}}>
          {(['week','month','quarter'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className="text-app-xs font-black uppercase px-2.5 py-1.5 rounded-lg transition-all"
              style={period === p
                ? {background:'var(--col-accent-35)', color:"var(--col-violet)", border:'1px solid var(--col-accent-40)'}
                : {color: 'var(--text-muted)'}}>
              {p === 'quarter' ? 'Q' : p[0].toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-3">

        {/* KPI HERO ROW */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          {[
            { label:'Net Profit', value: pnl.netProfit, color: pnl.netProfit>=0 ? green : red, icon: Target },
            { label:'Gross Margin', value: pnl.margin, color: purple, icon: Award, suffix:'%', raw: pnl.margin.toFixed(1) },
            { label:'Total Sales', value: pnl.totalSales, color: green, icon: TrendingUp,
              sub: pnl.salesChange !== 0 ? `${pct(pnl.salesChange)} vs prev` : undefined },
            { label:'Total Expenses', value: pnl.totalExpenses, color: red, icon: TrendingDown },
          ].map((kpi, i) => {
            const Icon = kpi.icon;
            return (
              <div key={i} className="p-3 rounded-2xl" style={{background:'var(--rgba-white-05)', border:'1px solid var(--glass-border)'}}>
                <div className="flex items-center gap-1.5 mb-2">
                  <Icon size={11} style={{color: kpi.color}}/>
                  <span className="text-app-xs font-bold uppercase tracking-wide" style={{color: 'var(--text-muted)'}}>{kpi.label}</span>
                </div>
                <div className="font-black text-base leading-tight" style={{color: kpi.color}}>
                  {kpi.raw ? `${kpi.raw}${kpi.suffix}` : fmt(kpi.value)}
                </div>
                {kpi.sub && (
                  <div className="text-app-2xs font-bold mt-0.5" style={{color: 'var(--text-muted)'}}>{kpi.sub}</div>
                )}
              </div>
            );
          })}
        </div>

        {/* CASH FLOW SPARKLINE */}
        <div className="p-4 rounded-2xl mb-3" style={{background:'var(--rgba-white-04)', border:'1px solid var(--glass-border)'}}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-app-xs font-bold uppercase tracking-wide mb-0.5" style={{color: 'var(--text-muted)'}}>30-Day Cash Flow</div>
              <div className="text-base font-black" style={{color: forecast.avg >= 0 ? green : red}}>
                Avg {fmt(forecast.avg)}/day
              </div>
            </div>
            <div className="text-right">
              <div className="text-app-xs font-bold uppercase" style={{color: 'var(--text-muted)'}}>30d Forecast</div>
              <div className="text-sm font-black" style={{color: blue}}>{fmt(forecast.next30)}</div>
              <div className="text-app-2xs" style={{color: forecast.trend >= 0 ? green : red}}>
                Trend {forecast.trend >= 0 ? '↑' : '↓'}
              </div>
            </div>
          </div>
          <Sparkline data={cashFlowData.slice(-30)} color={blue}/>
          <div className="flex justify-between mt-1">
            <span className="text-app-2xs" style={{color: 'var(--text-muted)'}}>30d ago</span>
            <span className="text-app-2xs" style={{color: 'var(--text-muted)'}}>Today</span>
          </div>
        </div>

        {/* P&L SECTION */}
        <Section id="pnl" title="Profit & Loss" icon={BarChart3} color={purple}>
          <div className="space-y-2">
            {[
              { label:'Sales Revenue',    value: pnl.totalSales,     color: green },
              { label:'Purchase Cost',    value: -pnl.totalPurchases, color: red  },
              { label:'Gross Profit',     value: pnl.grossProfit,    color: blue, bold: true },
              { label:'Operating Expenses', value: -pnl.totalExpenses, color: red },
              { label:'Net Profit',       value: pnl.netProfit,      color: pnl.netProfit>=0?green:red, bold: true },
            ].map((row, i) => (
              <div key={i}>
                {(row.label === 'Gross Profit' || row.label === 'Net Profit') && (
                  <div className="border-t my-1" style={{borderColor:'var(--rgba-white-07)'}}/>
                )}
                <div className="flex justify-between items-center py-1">
                  <span className={`text-xs ${row.bold ? 'font-black' : 'font-semibold'}`} style={{color: row.bold ? 'var(--text-primary)' : 'var(--text-muted)'}}>
                    {row.label}
                  </span>
                  <span className={`text-xs tabular-nums ${row.bold ? 'font-black' : 'font-bold'}`} style={{color: row.color}}>
                    {row.value < 0 ? '-' : ''}{fmt(Math.abs(row.value))}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* TOP CUSTOMERS */}
        <Section id="customers" title="Top Customers" icon={Users} color={blue}>
          {topCustomers.length === 0
            ? <p className="text-xs text-center py-3" style={{color: 'var(--text-muted)'}}>No sales this period</p>
            : <div className="space-y-2.5">
              {topCustomers.map((c, i) => (
                <div key={i}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold truncate max-w-[60%]" style={{color: 'var(--text-primary)'}}>{c.name}</span>
                    <span className="text-xs font-black tabular-nums" style={{color: green}}>{fmt(c.value)}</span>
                  </div>
                  <Bar value={c.value} max={topCustomers[0].value} color={blue}/>
                </div>
              ))}
            </div>
          }
        </Section>

        {/* TOP ITEMS */}
        <Section id="items" title="Top Items by Revenue" icon={Package} color={green}>
          {topItems.length === 0
            ? <p className="text-xs text-center py-3" style={{color: 'var(--text-muted)'}}>No data</p>
            : <div className="space-y-2.5">
              {topItems.map((item, i) => (
                <div key={i}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold truncate max-w-[55%]" style={{color: 'var(--text-primary)'}}>{item.name}</span>
                    <div className="text-right">
                      <span className="text-xs font-black tabular-nums" style={{color: green}}>{fmt(item.revenue)}</span>
                      <span className="text-app-2xs ml-1" style={{color: 'var(--text-muted)'}}>×{item.qty} units</span>
                    </div>
                  </div>
                  <Bar value={item.revenue} max={topItems[0].revenue} color={green}/>
                </div>
              ))}
            </div>
          }
        </Section>

        {/* EXPENSE BREAKDOWN */}
        <Section id="expenses" title="Expense Breakdown" icon={TrendingDown} color={red}>
          {expCats.length === 0
            ? <p className="text-xs text-center py-3" style={{color: 'var(--text-muted)'}}>No expenses this period</p>
            : <div className="space-y-2.5">
              {expCats.map((cat, i) => (
                <div key={i}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold truncate max-w-[55%]" style={{color: 'var(--text-primary)'}}>{cat.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-app-xs font-bold" style={{color: 'var(--text-muted)'}}>{cat.pct.toFixed(0)}%</span>
                      <span className="text-xs font-black" style={{color: red}}>{fmt(cat.value)}</span>
                    </div>
                  </div>
                  <Bar value={cat.pct} max={100} color={`hsl(${0 + i*30},70%,60%)`}/>
                </div>
              ))}
            </div>
          }
        </Section>

      </div>
    </div>
  );
};

export default AdvancedAnalyticsDashboard;






