import React, { useMemo } from 'react';
import {
  Target, Activity, Zap, TrendingUp, TrendingDown,
  ArrowUpRight, ArrowDownLeft, ArrowRightLeft,
} from 'lucide-react';

interface Metrics {
  sales: number; purchase: number; expense: number;
  received: number; paid: number;
  pendingReceivable: number; pendingPayable: number;
}

interface DashboardAnalyticsWidgetProps {
  metrics    : Metrics;
  ledgerData : any[];
  loading    : boolean;
  onNavigate : (tab: string) => void;
}

// ─── Sparkline SVG ────────────────────────────────────────────────────────────
const Sparkline: React.FC<{ data: number[]; color: string }> = ({ data, color }) => {
  if (data.length < 2) return <div style={{ width: 64, height: 22 }} />;
  const max = Math.max(...data, 1), min = Math.min(...data, 0), rng = max - min || 1;
  const W = 64, H = 22;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - ((v - min) / rng) * (H - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = pts.split(' ').at(-1)!.split(',');
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />
    </svg>
  );
};

// ─── Circular ring ────────────────────────────────────────────────────────────
const Ring: React.FC<{ pct: number; color: string }> = ({ pct, color }) => {
  const r = 22, c = 2 * Math.PI * r, safe = Math.max(0, Math.min(pct, 100));
  return (
    <div className="relative flex-shrink-0" style={{ width: 56, height: 56 }}>
      <svg width="56" height="56" viewBox="0 0 56 56" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4.5" />
        <circle cx="28" cy="28" r={r} fill="none" stroke={color} strokeWidth="4.5"
          strokeDasharray={`${(safe / 100) * c} ${c}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(0.34,1.56,0.64,1)' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[11px] font-black" style={{ color }}>{Math.round(safe)}%</span>
        <span className="text-[7px]" style={{ color: 'rgba(148,163,184,0.35)' }}>margin</span>
      </div>
    </div>
  );
};

// ─── Stat pill ────────────────────────────────────────────────────────────────
const Pill: React.FC<{
  icon: React.ElementType; label: string; value: number;
  color: string; bg: string; border: string; loading: boolean; onClick?: () => void;
}> = ({ icon: Icon, label, value, color, bg, border, loading, onClick }) => {
  const fmt = (n: number) => {
    const a = Math.abs(n);
    if (a >= 1e7) return `${(n/1e7).toFixed(1)}Cr`;
    if (a >= 1e5) return `${(n/1e5).toFixed(1)}L`;
    if (a >= 1e3) return `${(n/1e3).toFixed(1)}K`;
    return Math.round(n).toLocaleString('en-IN');
  };
  return (
    <button onClick={onClick} disabled={!onClick}
      className="flex flex-col gap-2 p-3.5 rounded-[20px] text-left active:scale-[0.97] transition-all relative overflow-hidden w-full"
      style={{ background: bg, border: `1px solid ${border}`, backdropFilter: 'blur(16px)' }}>
      <div className="absolute top-0 left-0 right-0 h-px"
        style={{ background: `linear-gradient(90deg,transparent,${color}3a,transparent)` }} />
      <div className="flex items-center gap-1.5">
        <Icon size={11} style={{ color }} />
        <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: 'rgba(148,163,184,0.45)' }}>{label}</span>
      </div>
      {loading
        ? <div className="h-5 w-16 rounded-lg animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
        : <span className="text-[17px] font-black tabular-nums leading-none" style={{ color }}>
            <span style={{ fontSize: '58%', opacity: 0.55 }}>₹</span>{fmt(value)}
          </span>}
    </button>
  );
};

// ─── Main ─────────────────────────────────────────────────────────────────────
const DashboardAnalyticsWidget: React.FC<DashboardAnalyticsWidgetProps> = ({
  metrics, ledgerData, loading, onNavigate,
}) => {
  // 7-day + prev-7-day daily sales.
  //
  // Optimisation: the full ledger can hold thousands of rows over years.  We
  // skip every record whose epoch is older than 14 days *before* doing any
  // date-object work, so the inner loop on a large dataset is bounded by the
  // number of recent sales — not the entire ledger history.
  const { weekSales, prevWeekSales } = useMemo(() => {
    const cur = Array(7).fill(0), prv = Array(7).fill(0);
    const now    = Date.now();
    const cutoff = now - 14 * 86400000;

    for (let idx = 0; idx < ledgerData.length; idx++) {
      const l: any = ledgerData[idx];
      if (l.type !== 'sell') continue;

      // Cheap epoch check first — Firestore Timestamps expose `.seconds`.
      const epoch =
        l.date?.toDate     ? l.date.toDate().getTime()
      : l.date?.seconds    ? l.date.seconds * 1000
      : typeof l.date === 'string' || typeof l.date === 'number'
                           ? new Date(l.date).getTime()
      :                      0;
      if (!epoch || epoch < cutoff) continue;

      const diff = Math.floor((now - epoch) / 86400000);
      const amt  = Number(l.total_amount) || 0;
      if (diff >= 0 && diff < 7)  cur[6 - diff] += amt;
      else if (diff < 14)         prv[6 - (diff - 7)] += amt;
    }
    return { weekSales: cur, prevWeekSales: prv };
  }, [ledgerData]);

  const curTotal  = weekSales.reduce((a, b) => a + b, 0);
  const prevTotal = prevWeekSales.reduce((a, b) => a + b, 0);
  const growth    = prevTotal > 0 ? ((curTotal - prevTotal) / prevTotal) * 100 : 0;

  const profit   = metrics.sales - metrics.purchase - metrics.expense;
  const margin   = metrics.sales > 0 ? (profit / metrics.sales) * 100 : 0;
  const pos      = profit >= 0;
  const netCash  = metrics.received - metrics.paid;
  const netOut   = metrics.pendingReceivable - metrics.pendingPayable;
  const total    = metrics.sales + metrics.purchase || 1;
  const salesPct = (metrics.sales / total) * 100;

  return (
    <div className="space-y-3">

      {/* ── Profit card ── */}
      <div className="rounded-[24px] p-4 relative overflow-hidden"
        style={{ background: pos ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${pos ? 'rgba(16,185,129,0.22)' : 'rgba(239,68,68,0.22)'}`, backdropFilter: 'blur(20px)' }}>
        <div className="absolute top-0 left-0 right-0 h-px"
          style={{ background: `linear-gradient(90deg,transparent,${pos ? 'rgba(52,211,153,0.4)' : 'rgba(248,113,113,0.4)'},transparent)` }} />

        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1.5 rounded-xl" style={{ background: pos ? 'rgba(16,185,129,0.18)' : 'rgba(239,68,68,0.14)' }}>
                <Target size={12} style={{ color: pos ? '#34d399' : '#f87171' }} />
              </div>
              <p className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: 'rgba(148,163,184,0.5)' }}>Net Profit</p>
            </div>

            {loading
              ? <div className="h-7 w-28 rounded-lg animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
              : <p className="text-[26px] font-black tabular-nums leading-none"
                  style={{ color: pos ? '#6ee7b7' : '#fca5a5' }}>
                  <span style={{ fontSize: '54%', opacity: 0.55 }}>₹</span>
                  {Math.abs(profit).toLocaleString('en-IN')}
                  {!pos && <span style={{ fontSize: '40%', color: '#f87171', marginLeft: 4 }}>▼ Loss</span>}
                </p>}

            <p className="text-[9px] mt-1" style={{ color: 'rgba(148,163,184,0.4)' }}>Sales − Purchase − Expenses</p>

            {!loading && (
              <div className="flex items-center gap-2 mt-2.5">
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-xl"
                  style={{ background: growth >= 0 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.12)' }}>
                  {growth >= 0 ? <TrendingUp size={9} style={{ color: '#34d399' }} /> : <TrendingDown size={9} style={{ color: '#f87171' }} />}
                  <span className="text-[9px] font-black" style={{ color: growth >= 0 ? '#34d399' : '#f87171' }}>
                    {Math.abs(growth).toFixed(1)}% sales vs last week
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <Ring pct={margin} color={pos ? '#34d399' : '#f87171'} />
            <Sparkline data={weekSales} color={pos ? '#34d399' : '#f87171'} />
            <p className="text-[8px]" style={{ color: 'rgba(148,163,184,0.3)' }}>7-day sales</p>
          </div>
        </div>
      </div>

      {/* ── 4 stat pills ── */}
      <div className="grid grid-cols-2 gap-3">
        <Pill icon={ArrowRightLeft} label="Cash Flow"   value={netCash}
          color={netCash >= 0 ? '#93c5fd' : '#fcd34d'}
          bg={netCash >= 0 ? 'rgba(59,130,246,0.08)' : 'rgba(245,158,11,0.08)'}
          border={netCash >= 0 ? 'rgba(59,130,246,0.2)' : 'rgba(245,158,11,0.2)'}
          loading={loading} />

        <Pill icon={Activity} label="Outstanding" value={netOut}
          color="#c4b5fd" bg="rgba(139,92,246,0.08)" border="rgba(139,92,246,0.2)"
          loading={loading} onClick={() => onNavigate('pending-dashboard')} />

        <Pill icon={ArrowUpRight}  label="To Receive" value={metrics.pendingReceivable}
          color="#6ee7b7" bg="rgba(16,185,129,0.08)" border="rgba(16,185,129,0.2)"
          loading={loading} onClick={() => onNavigate('pending-dashboard')} />

        <Pill icon={ArrowDownLeft} label="To Pay" value={metrics.pendingPayable}
          color="#fca5a5" bg="rgba(239,68,68,0.08)" border="rgba(239,68,68,0.18)"
          loading={loading} onClick={() => onNavigate('pending-dashboard')} />
      </div>

      {/* ── Sales vs Purchase bar ── */}
      <div className="rounded-[20px] p-4"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', backdropFilter: 'blur(16px)' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Zap size={11} style={{ color: '#fbbf24' }} />
            <p className="text-[9px] font-black uppercase tracking-[0.15em]" style={{ color: 'rgba(148,163,184,0.5)' }}>Sales vs Purchase</p>
          </div>
          {!loading && (
            <span className="text-[9px] font-black px-2 py-0.5 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(148,163,184,0.5)' }}>
              {Math.round(salesPct)}% / {Math.round(100 - salesPct)}%
            </span>
          )}
        </div>
        {loading ? (
          <div className="h-3 rounded-full animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
        ) : (
          <>
            <div className="flex justify-between text-[9px] font-black mb-1.5">
              <span style={{ color: '#34d399' }}>Sales ₹{metrics.sales.toLocaleString('en-IN')}</span>
              <span style={{ color: '#f87171' }}>Purchase ₹{metrics.purchase.toLocaleString('en-IN')}</span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden flex gap-0.5" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${salesPct}%`, background: 'linear-gradient(90deg,#059669,#34d399)' }} />
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${100 - salesPct}%`, background: 'linear-gradient(90deg,#dc2626,#f87171)' }} />
            </div>
            <p className="text-[9px] mt-1.5 text-right" style={{ color: pos ? '#34d399' : '#f87171', fontWeight: 900 }}>
              {pos ? '▲' : '▼'} ₹{Math.abs(profit).toLocaleString('en-IN')} profit · Expenses ₹{metrics.expense.toLocaleString('en-IN')}
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default DashboardAnalyticsWidget;







