import React, { useMemo, useState, useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import {
  ArrowLeft, Receipt, ShoppingCart, Wallet, Footprints,
  X, Calendar, Hash, User as UserIcon, Tag, FileText,
  TrendingUp, TrendingDown, Package, CreditCard, ChevronRight,
  IndianRupee, MapPin,
} from 'lucide-react';
import { useData } from '../../context/DataContext';
import { ApiService } from '../../services/api';
import { formatCurrency } from '../../utils/helpers';

interface GameTimelineViewProps {
  user: User;
  onBack: () => void;
}

interface TimelineStep {
  id: string;
  date: string;
  amount: number;
  type: 'transaction' | 'order' | 'expense';
  label: string;
  sub: string;
  raw: any;          // full original record for detail view
}

// ── Type config ────────────────────────────────────────────────────────────────
const TYPE_CONFIG = {
  transaction: {
    bg: 'bg-[var(--col-emerald-07)]',
    border: 'border-[var(--col-emerald-25)]',
    accent: 'bg-emerald-500',
    text: 'text-col-success',
    badge: 'bg-[var(--col-emerald-15)] text-col-success-light',
    icon: Wallet,
    dot: 'bg-emerald-500 shadow-emerald-500/40',
    drawerAccent: "var(--col-success)",
    drawerBg: 'var(--col-emerald-08)',
    drawerBorder: 'var(--col-emerald-25)',
  },
  order: {
    bg: 'bg-[var(--col-info-07)]',
    border: 'border-[var(--col-info-25)]',
    accent: 'bg-blue-500',
    text: 'text-col-info',
    badge: 'bg-[var(--col-info-15)] text-col-info-light',
    icon: ShoppingCart,
    dot: 'bg-blue-500 shadow-blue-500/40',
    drawerAccent: "var(--col-info)",
    drawerBg: 'var(--col-info-08)',
    drawerBorder: 'var(--col-info-25)',
  },
  expense: {
    bg: 'bg-[rgba(244,63,94,0.07)]',
    border: 'border-[rgba(244,63,94,0.2)]',
    accent: 'bg-rose-500',
    text: 'text-col-danger',
    badge: 'bg-[rgba(244,63,94,0.15)] text-col-danger-light',
    icon: Receipt,
    dot: 'bg-rose-500 shadow-rose-500/40',
    drawerAccent: "var(--col-danger)",
    drawerBg: 'var(--col-danger-08)',
    drawerBorder: 'var(--col-danger-25)',
  },
};

// ── Detail field row ──────────────────────────────────────────────────────────
const DetailRow: React.FC<{ icon: React.FC<any>; label: string; value: React.ReactNode; color?: string }> = ({
  icon: Icon, label, value, color = 'var(--text-muted)',
}) => (
  <div className="flex items-start gap-3 py-2.5"
    style={{ borderBottom: '1px solid var(--glass-border)' }}>
    <div className="p-1.5 rounded-lg mt-0.5 flex-shrink-0"
      style={{ background: 'var(--rgba-white-06)' }}>
      <Icon size={12} style={{ color }} />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-app-xs font-bold uppercase tracking-widest mb-0.5"
        style={{ color: 'var(--text-muted)' }}>{label}</p>
      <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{value}</div>
    </div>
  </div>
);

// ── Line-item row for orders ──────────────────────────────────────────────────
const LineItemRow: React.FC<{ item: any; index: number }> = ({ item, index }) => (
  <div className="flex items-center gap-2 py-2 px-3 rounded-xl mb-1.5"
    style={{ background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)' }}>
    <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-app-xs font-black"
      style={{ background: 'var(--col-violet-25)', color: "var(--col-violet)" }}>
      {index + 1}
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>
        {item.item_name || 'Unknown Item'}
      </p>
      <p className="text-app-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
        {item.quantity || 0} {item.unit || 'Pcs'} × ₹{Number(item.rate || 0).toLocaleString('en-IN')}
        {item.gst_percent ? ` + ${item.gst_percent}% GST` : ''}
      </p>
    </div>
    <p className="text-sm font-black flex-shrink-0" style={{ color: "var(--col-info)" }}>
      ₹{Number(item.total || 0).toLocaleString('en-IN')}
    </p>
  </div>
);

// ── Detail Drawer ─────────────────────────────────────────────────────────────
const DetailDrawer: React.FC<{ step: TimelineStep | null; onClose: () => void }> = ({ step, onClose }) => {
  if (!step) return null;
  const cfg = TYPE_CONFIG[step.type];
  const Icon = cfg.icon;
  const r = step.raw;

  // Determine title and secondary fields based on type
  const isOrder = step.type === 'order';
  const isTx    = step.type === 'transaction';
  const isExp   = step.type === 'expense';

  const items: any[] = r.items || [];
  const totalGst = items.reduce((s: number, i: any) => {
    const base = Number(i.rate || 0) * Number(i.quantity || 0);
    const gst  = base * (Number(i.gst_percent || 0) / 100);
    return s + gst;
  }, 0);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 z-40 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className="timeline-detail-root fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300"
        style={{
          background: "var(--col-bg-dark)",
          border: '1px solid var(--glass-border)',
          borderBottom: 'none',
          maxHeight: '85dvh',
          display: 'flex',
          flexDirection: 'column',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background:  'var(--rgba-white-15)' }} />
        </div>

        {/* Header */}
        <div className="px-5 pb-4 flex items-start justify-between gap-3 flex-shrink-0"
          style={{ borderBottom: `1px solid ${cfg.drawerBorder}` }}>
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl" style={{ background: cfg.drawerBg, border: `1px solid ${cfg.drawerBorder}` }}>
              <Icon size={22} style={{ color: cfg.drawerAccent }} />
            </div>
            <div>
              <p className="text-app-sm font-black uppercase tracking-widest"
                style={{ color: cfg.drawerAccent }}>{step.type} · {step.sub}</p>
              <h2 className="text-lg font-black leading-tight" style={{ color: 'var(--text-primary)' }}>
                {step.label}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full flex-shrink-0 mt-0.5 active:scale-90 transition-all"
            style={{ background: 'var(--rgba-white-08)', border: '1px solid var(--glass-border)' }}>
            <X size={16} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        {/* Amount Hero */}
        <div className="px-5 py-4 flex-shrink-0"
          style={{ background: `${cfg.drawerBg}`, borderBottom: `1px solid ${cfg.drawerBorder}` }}>
          <p className="text-app-xs font-black uppercase tracking-widest mb-1"
            style={{ color: `${cfg.drawerAccent}88` }}>Amount</p>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl" style={{ color: cfg.drawerAccent }}>₹</span>
            <span className="text-4xl font-black" style={{ color: cfg.drawerAccent }}>
              {Number(step.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
          {isOrder && totalGst > 0 && (
            <p className="text-app-sm font-semibold mt-1" style={{ color: 'var(--text-muted)' }}>
              incl. ₹{totalGst.toLocaleString('en-IN', { maximumFractionDigits: 2 })} GST
            </p>
          )}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-2" style={{ WebkitOverflowScrolling: 'touch' }}>

          {/* Common fields */}
          <DetailRow icon={Calendar}  label="Date"       value={r.date || '—'}          color={cfg.drawerAccent} />
          {r.party_name && (
            <DetailRow icon={UserIcon} label="Party"     value={r.party_name}            color={cfg.drawerAccent} />
          )}
          {(r.invoice_no || r.bill_no) && (
            <DetailRow icon={Hash}    label="Invoice / Bill No" value={r.invoice_no || r.bill_no} color={cfg.drawerAccent} />
          )}

          {/* Order-specific */}
          {isOrder && (
            <>
              <DetailRow
                icon={Tag}
                label="Type"
                value={
                  <span className={`px-2 py-0.5 rounded-full text-app-sm font-black ${cfg.badge}`}>
                    {r.type === 'sell' ? '📈 Sale' : '📦 Purchase'}
                  </span>
                }
                color={cfg.drawerAccent}
              />
              {r.vehicle_no && (
                <DetailRow icon={CreditCard} label="Vehicle" value={r.vehicle_no} color={cfg.drawerAccent} />
              )}
              {r.vehicle_rent > 0 && (
                <DetailRow
                  icon={IndianRupee}
                  label="Vehicle Rent"
                  value={`₹${Number(r.vehicle_rent).toLocaleString('en-IN')}`}
                  color={cfg.drawerAccent}
                />
              )}
              {r.payment_mode && (
                <DetailRow icon={CreditCard} label="Payment Mode" value={r.payment_mode} color={cfg.drawerAccent} />
              )}
              {r.site && (
                <DetailRow icon={MapPin} label="Delivery Site" value={r.site} color={cfg.drawerAccent} />
              )}
              {r.discount_amount > 0 && (
                <DetailRow
                  icon={Tag}
                  label="Discount"
                  value={`₹${Number(r.discount_amount).toLocaleString('en-IN')}`}
                  color={cfg.drawerAccent}
                />
              )}
              {r.notes && (
                <DetailRow icon={FileText} label="Notes" value={r.notes} color={cfg.drawerAccent} />
              )}

              {/* Line items */}
              {items.length > 0 && (
                <div className="mt-4 mb-2">
                  <p className="text-app-xs font-black uppercase tracking-widest mb-3"
                    style={{ color: 'var(--text-muted)' }}>
                    {items.length} Item{items.length > 1 ? 's' : ''}
                  </p>
                  {items.map((item: any, i: number) => (
                    <LineItemRow key={i} item={item} index={i} />
                  ))}
                  {/* Totals summary */}
                  <div className="mt-3 p-3 rounded-2xl space-y-2"
                    style={{ background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)' }}>
                    {totalGst > 0 && (
                      <div className="flex justify-between">
                        <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>GST</span>
                        <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                          ₹{totalGst.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}
                    {r.vehicle_rent > 0 && (
                      <div className="flex justify-between">
                        <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Vehicle Rent</span>
                        <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                          ₹{Number(r.vehicle_rent).toLocaleString('en-IN')}
                        </span>
                      </div>
                    )}
                    {r.discount_amount > 0 && (
                      <div className="flex justify-between">
                        <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Discount</span>
                        <span className="text-xs font-bold" style={{ color: "var(--col-danger)" }}>
                          −₹{Number(r.discount_amount).toLocaleString('en-IN')}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between pt-1" style={{ borderTop: '1px solid var(--glass-border)' }}>
                      <span className="text-sm font-black" style={{ color: 'var(--text-primary)' }}>Total</span>
                      <span className="text-sm font-black" style={{ color: cfg.drawerAccent }}>
                        ₹{Number(r.total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Transaction-specific */}
          {isTx && (
            <>
              <DetailRow
                icon={isTx && r.type === 'received' ? TrendingUp : TrendingDown}
                label="Direction"
                value={
                  <span className={`px-2 py-0.5 rounded-full text-app-sm font-black ${cfg.badge}`}>
                    {r.type === 'received' ? '⬇ Received' : '⬆ Paid'}
                  </span>
                }
                color={cfg.drawerAccent}
              />
              {r.payment_mode && (
                <DetailRow icon={CreditCard} label="Payment Mode" value={r.payment_mode} color={cfg.drawerAccent} />
              )}
              {(r.bill_no || r.invoice_no) && (
                <DetailRow icon={Hash} label="Ref Bill No" value={r.bill_no || r.invoice_no} color={cfg.drawerAccent} />
              )}
              {r.payment_purpose && (
                <DetailRow icon={Tag} label="Purpose" value={r.payment_purpose} color={cfg.drawerAccent} />
              )}
              {r.received_by && (
                <DetailRow icon={UserIcon} label="Received By" value={r.received_by} color={cfg.drawerAccent} />
              )}
              {r.paid_by && (
                <DetailRow icon={UserIcon} label="Paid By" value={r.paid_by} color={cfg.drawerAccent} />
              )}
              {r.notes && (
                <DetailRow icon={FileText} label="Notes" value={r.notes} color={cfg.drawerAccent} />
              )}
            </>
          )}

          {/* Expense-specific */}
          {isExp && (
            <>
              {r.category && (
                <DetailRow icon={Tag} label="Category" value={r.category} color={cfg.drawerAccent} />
              )}
              {r.payment_mode && (
                <DetailRow icon={CreditCard} label="Payment Mode" value={r.payment_mode} color={cfg.drawerAccent} />
              )}
              {r.description && (
                <DetailRow icon={FileText} label="Description" value={r.description} color={cfg.drawerAccent} />
              )}
            </>
          )}

          {/* GST info for orders */}
          {isOrder && r.gstin && (
            <DetailRow icon={FileText} label="GSTIN" value={r.gstin} color={cfg.drawerAccent} />
          )}

          {/* Spacer */}
          <div className="h-6" />
        </div>

        {/* Footer close button */}
        <div className="px-5 py-4 flex-shrink-0"
          style={{ borderTop: '1px solid var(--glass-border)' }}>
          <button
            onClick={onClose}
            className="w-full py-3.5 rounded-2xl font-black text-sm active:scale-95 transition-all"
            style={{ background: 'var(--rgba-white-07)', color: 'var(--text-muted)', border: '1px solid var(--glass-border)' }}>
            Close
          </button>
        </div>
      </div>
    </>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
const GameTimelineView: React.FC<GameTimelineViewProps> = ({ user, onBack }) => {
  const { useTransactions, useLedger } = useData();
  const { data: transactionsRaw, isLoading: tLoading } = useTransactions(user.uid);
  const { data: ledgerRaw,       isLoading: lLoading } = useLedger(user.uid);
  const transactions = useMemo(() => transactionsRaw || [], [transactionsRaw]);
  const ledger       = useMemo(() => ledgerRaw       || [], [ledgerRaw]);
  // useExpenses is not in DataContextType - fetch directly from Firestore
  const [expenses, setExpenses] = useState<any[]>([]);
  const [eLoading, setELoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setELoading(true);
    ApiService.getAll(user.uid, 'expenses')
      .then(snap => {
        if (!cancelled) {
          setExpenses(snap.docs.map((d: any) => ({ id: d.id, ...d.data() })));
          setELoading(false);
        }
      })
      .catch(() => { if (!cancelled) setELoading(false); });
    return () => { cancelled = true; };
  }, [user.uid]);

  const [selectedStep, setSelectedStep] = useState<TimelineStep | null>(null);
  const [filterDate, setFilterDate] = useState<string | null>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  const steps: TimelineStep[] = useMemo(() => {
    const all: TimelineStep[] = [];

    transactions.forEach(t => {
      all.push({
        id: t.id,
        date: t.date,
        amount: Number(t.amount),
        type: 'transaction',
        label: t.party_name || 'Unknown',
        sub: t.type === 'received' ? 'Received' : 'Paid',
        raw: t,
      });
    });

    ledger.forEach(l => {
      all.push({
        id: l.id,
        date: l.date,
        amount: Number(l.total_amount),
        type: 'order',
        label: l.party_name || 'Unknown',
        sub: l.type === 'sell' ? 'Sale' : 'Purchase',
        raw: l,
      });
    });

    if (Array.isArray(expenses)) {
      expenses.forEach((e: any) => {
        all.push({
          id: e.id,
          date: e.date,
          amount: Number(e.amount),
          type: 'expense',
          label: e.category || e.description || 'Expense',
          sub: e.payment_mode || 'Cash',
          raw: e,
        });
      });
    }

    all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return all;
  }, [transactions, ledger, expenses]);

  const visibleSteps = useMemo(() =>
    filterDate ? steps.filter(s => s.date === filterDate) : steps.slice(0, 150),
  [steps, filterDate]);

  const loading = tLoading || lLoading || eLoading;

  return (
    <div className="h-full overflow-y-auto relative" style={{ background: 'var(--app-bg)' }}>
      {/* Sticky Header */}
      <div className="sticky top-0 z-30 px-4 pb-3"
        style={{
          paddingTop: '12px',
          background: 'rgba(var(--app-bg-rgb),0.93)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 1px 0 var(--rgba-white-06)',
        }}>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-2xl text-[var(--text-primary)] active:scale-90 transition-all">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-black leading-none flex items-center gap-2">
              <Footprints size={18} className="text-primary" /> Timeline
            </h1>
            <p className="text-app-sm font-bold text-slate-400 uppercase">
              {filterDate ? `${visibleSteps.length} on ${filterDate}` : `${visibleSteps.length} Steps · tap any card`}
            </p>
          </div>

          {/* Date filter controls */}
          <div className="flex items-center gap-1.5">
            {filterDate && (
              <button
                onClick={() => setFilterDate(null)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-app-sm font-black active:scale-90 transition-all"
                style={{ background: 'var(--col-danger-15)', border: '1px solid var(--col-danger-25)', color: "var(--col-danger)" }}
              >
                <X size={11} /> Clear
              </button>
            )}
            <div className="relative">
              <button
                className="p-2 rounded-xl active:scale-90 transition-all"
                style={{
                  background: filterDate ? 'rgba(96,165,250,0.2)' : 'var(--rgba-white-07)',
                  border: filterDate ? '1px solid rgba(96,165,250,0.35)' : '1px solid var(--glass-border)',
                }}
              >
                <Calendar size={16} style={{ color: filterDate ? "var(--col-info)" : 'var(--text-muted)' }} />
              </button>
              {/* Invisible date input overlays the button to open native date picker */}
              <input
                ref={dateInputRef}
                type="date"
                value={filterDate || ''}
                onChange={e => setFilterDate(e.target.value || null)}
                className="absolute inset-0 opacity-0 w-full cursor-pointer"
                style={{ zIndex: 1 }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Timeline board */}
      <div className="px-4 py-6 pb-24">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : visibleSteps.length === 0 ? (
          <div className="text-center py-20 text-slate-400 text-sm font-bold">
            {filterDate ? `No entries on ${filterDate}` : 'No data yet'}
          </div>
        ) : (
          <div className="relative">
            {/* Central zig-zag connector line */}
            <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-gradient-to-b from-emerald-500 via-blue-500 to-rose-500 -translate-x-1/2 rounded-full opacity-40" />

            {visibleSteps.map((step, i) => {
              const isLeft = i % 2 === 0;
              const cfg = TYPE_CONFIG[step.type];
              const Icon = cfg.icon;

              return (
                <div key={step.id + i} className="relative mb-4">
                  {/* Center dot */}
                  <div className={`absolute left-1/2 top-4 w-3.5 h-3.5 rounded-full -translate-x-1/2 z-10 ${cfg.dot} shadow-lg ring-2 ring-[#0b0e1a]`} />

                  {/* Horizontal arm */}
                  <div
                    className={`absolute top-[22px] h-0.5 ${cfg.accent} opacity-40`}
                    style={{
                      left:      isLeft ? 'calc(50% - 2px)' : 'auto',
                      right:     isLeft ? 'auto' : 'calc(50% - 2px)',
                      width:     'calc(50% - 40px)',
                      transform: isLeft ? 'scaleX(-1)' : 'none',
                    }}
                  />

                  {/* Card — clickable */}
                  <div className={`${isLeft ? 'mr-[54%]' : 'ml-[54%]'}`}>
                    <button
                      onClick={() => setSelectedStep(step)}
                      className={`w-full text-left ${cfg.bg} ${cfg.border} border rounded-2xl p-3 shadow-sm relative overflow-hidden active:scale-[0.97] transition-all`}
                    >
                      {/* Step number */}
                      <div className={`absolute ${isLeft ? 'right-2' : 'left-2'} top-2 w-5 h-5 rounded-full ${cfg.accent} text-white text-app-xs font-black flex items-center justify-center`}>
                        {i + 1}
                      </div>

                      {/* Accent stripe */}
                      <div className={`absolute ${isLeft ? 'left-0' : 'right-0'} top-0 bottom-0 w-1 ${cfg.accent}`} />

                      <div className="flex items-center gap-1.5 mb-1 pl-1">
                        <Icon size={12} className={cfg.text} />
                        <span className={`text-app-xs font-black uppercase tracking-wider ${cfg.text}`}>
                          {step.type}
                        </span>
                      </div>

                      <div className="font-black text-sm truncate leading-tight">
                        {step.label}
                      </div>

                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-app-sm font-bold text-[var(--text-muted)]">{step.date}</span>
                        <span className={`text-xs font-black ${cfg.text}`}>
                          {formatCurrency(step.amount)}
                        </span>
                      </div>

                      {step.sub && (
                        <span className={`inline-block mt-1.5 text-app-xs font-bold px-2 py-0.5 rounded-full ${cfg.badge}`}>
                          {step.sub}
                        </span>
                      )}

                      {/* Tap hint chevron */}
                      <ChevronRight
                        size={12}
                        className={`absolute ${isLeft ? 'right-6' : 'left-6'} bottom-3 opacity-30 ${cfg.text}`}
                      />
                    </button>
                  </div>
                </div>
              );
            })}

            {/* End marker */}
            <div className="flex justify-center mt-2">
              <div className="w-4 h-4 rounded-full bg-[var(--rgba-white-08)] ring-2 ring-[var(--rgba-white-15)]" />
            </div>
          </div>
        )}
      </div>

      {/* Detail Drawer */}
      <DetailDrawer step={selectedStep} onClose={() => setSelectedStep(null)} />
    </div>
  );
};

export default GameTimelineView;





