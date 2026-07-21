import React, { useState, useMemo } from 'react';
import { Package, Clock, TrendingDown, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import { generateReorderSuggestions, ReorderSuggestion } from '../../services/geminiEnhanced';

interface ReorderWidgetProps {
  inventory  : any[];
  ledgerData : any[];
  onNavigate : (tab: string) => void;
}

const URGENCY_CONFIG = {
  critical: { color: "var(--col-danger)", bg: 'var(--col-danger-12)',  border: 'var(--col-danger-28)',  dot: "var(--col-red)", label: 'Critical' },
  soon    : { color: "var(--col-warning)", bg: 'var(--col-warning-10)', border: 'var(--col-warning-25)', dot: "var(--col-amber)", label: 'Order Soon' },
  plan    : { color: "var(--col-info)", bg: 'var(--col-info-08)', border: 'var(--col-info-25)',  dot: "var(--col-blue)", label: 'Plan Ahead' },
};

const COLLAPSED_COUNT = 2;

const ReorderWidget: React.FC<ReorderWidgetProps> = ({ inventory, ledgerData, onNavigate }) => {
  const [expanded, setExpanded] = useState(false);

  const suggestions = useMemo(
    () => generateReorderSuggestions(inventory, ledgerData, 3).slice(0, 6),
    [inventory, ledgerData],
  );

  if (suggestions.length === 0) return null;

  const criticalCount = suggestions.filter(s => s.urgency === 'critical').length;
  const soonCount     = suggestions.filter(s => s.urgency === 'soon').length;
  const visibleItems  = expanded ? suggestions : suggestions.slice(0, COLLAPSED_COUNT);
  const hasMore       = suggestions.length > COLLAPSED_COUNT;

  return (
    <div className="rounded-[24px] overflow-hidden"
      style={{ background: 'var(--rgba-white-05)', border: '1px solid var(--glass-border)', backdropFilter: 'blur(20px)' }}>

      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-[12px]" style={{ background: 'var(--col-warning-14)', border: '1px solid var(--col-warning-25)' }}>
            <Package size={14} style={{ color: "var(--col-warning)" }} />
          </div>
          <div>
            <p className="text-sm font-black text-white">Reorder Alerts</p>
            <p className="text-app-xs" style={{ color: 'var(--text-muted)' }}>AI-powered stock analysis</p>
          </div>
        </div>
        <div className="flex gap-1.5">
          {criticalCount > 0 && (
            <span className="text-app-xs font-black px-2 py-0.5 rounded-lg"
              style={{ background: 'var(--col-danger-18)', color: "var(--col-danger)", border: '1px solid var(--col-danger-28)' }}>
              {criticalCount} critical
            </span>
          )}
          {soonCount > 0 && (
            <span className="text-app-xs font-black px-2 py-0.5 rounded-lg"
              style={{ background: 'var(--col-warning-15)', color: "var(--col-warning)", border: '1px solid var(--col-warning-25)' }}>
              {soonCount} soon
            </span>
          )}
        </div>
      </div>

      <div className="px-3 pb-2 space-y-2">
        {visibleItems.map(s => {
          const cfg = URGENCY_CONFIG[s.urgency];
          return (
            <div key={s.itemId}
              className="flex items-center gap-3 px-3.5 py-3 rounded-[18px] relative overflow-hidden"
              style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
              <div className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: cfg.dot, boxShadow: `0 0 6px ${cfg.dot}` }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-xs font-black text-white truncate">{s.itemName}</p>
                  <span className="text-app-2xs font-black px-1.5 py-0.5 rounded-md flex-shrink-0"
                    style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
                    {cfg.label}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-app-xs" style={{ color: 'var(--text-muted)' }}>
                  <span className="flex items-center gap-0.5">
                    <TrendingDown size={9} style={{ color: cfg.color }} />
                    Stock: <span className="font-bold ml-0.5" style={{ color: cfg.color }}>{s.currentStock} {s.unit}</span>
                  </span>
                  {s.salesVelocity > 0 && <span>{s.salesVelocity.toFixed(1)}/day</span>}
                  {s.daysRemaining < 999 && (
                    <span className="flex items-center gap-0.5"><Clock size={8} />{s.daysRemaining}d left</span>
                  )}
                </div>
                <p className="text-app-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{s.reason}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-xs font-black" style={{ color: cfg.color }}>+{s.suggestedQty} {s.unit}</p>
                {(s.estimatedCost || 0) > 0 && (
                  <p className="text-app-2xs" style={{ color: 'var(--text-muted)' }}>
                    ~₹{Math.round(s.estimatedCost!).toLocaleString('en-IN')}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <div className="px-3 pb-2">
          <button
            onClick={() => setExpanded(e => !e)}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-app-sm font-black transition-all active:scale-95"
            style={{ background: 'var(--col-warning-15)', color: "var(--col-warning)", border: '1px solid var(--col-warning-25)' }}
          >
            {expanded ? <><ChevronUp size={12} /> Show less</> : <><ChevronDown size={12} /> Show {suggestions.length - COLLAPSED_COUNT} more</>}
          </button>
        </div>
      )}

      <button
        onClick={() => onNavigate('inventory')}
        className="w-full flex items-center justify-center gap-2 py-3 active:scale-[0.98] transition-all"
        style={{ borderTop: '1px solid var(--glass-border)', background: 'var(--col-warning-07)' }}>
        <span className="text-app-md font-black" style={{ color: "var(--col-warning)" }}>View Full Inventory</span>
        <ChevronRight size={13} style={{ color: "var(--col-warning)" }} />
      </button>
    </div>
  );
};

export default ReorderWidget;
