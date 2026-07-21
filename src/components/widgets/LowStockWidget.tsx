import React, { useState, useMemo } from 'react';
import { AlertTriangle, Package, ArrowRight, Clock, TrendingDown, ChevronDown, ChevronUp } from 'lucide-react';
import { InventoryItem } from '../../types/models';

interface SalesRecord {
  items?: { item_name: string; quantity: number }[];
  date: string;
  type?: string;
}

interface LowStockWidgetProps {
  items: InventoryItem[];
  salesData?: SalesRecord[];
  onViewAll?: () => void;
  onItemClick?: (item: InventoryItem) => void;
}

const calcDaysRemaining = (item: InventoryItem, salesData: SalesRecord[]): number | null => {
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  let totalQty = 0;
  for (const record of salesData) {
    if (record.type && record.type !== 'sell') continue;
    const recordDate = new Date(record.date).getTime();
    if (recordDate < thirtyDaysAgo || recordDate > now) continue;
    if (record.items) {
      for (const li of record.items) {
        if (li.item_name?.toLowerCase() === item.name?.toLowerCase()) {
          totalQty += li.quantity || 0;
        }
      }
    }
  }
  if (totalQty === 0) return null;
  const avgDaily = totalQty / 30;
  if (avgDaily <= 0) return null;
  return Math.round((item.current_stock || 0) / avgDaily);
};

const COLLAPSED_COUNT = 2;

const LowStockWidget: React.FC<LowStockWidgetProps> = ({ items, salesData = [], onViewAll, onItemClick }) => {
  const [expanded, setExpanded] = useState(false);

  const enrichedItems = useMemo(() => {
    return items.map(item => ({
      ...item,
      daysRemaining: salesData.length > 0 ? calcDaysRemaining(item, salesData) : null,
    }));
  }, [items, salesData]);

  if (items.length === 0) {
    return (
      <div className="bg-[var(--col-emerald-08)] p-4 rounded-2xl border border-[var(--col-emerald-25)]">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[var(--col-emerald-15)] rounded-xl">
            <Package size={20} className="text-col-success" />
          </div>
          <div>
            <div className="font-bold text-sm text-col-success-light">All Stock OK</div>
            <div className="text-xs text-[rgba(110,231,183,0.7)]">No items below minimum level</div>
          </div>
        </div>
      </div>
    );
  }

  const visibleItems = expanded ? enrichedItems : enrichedItems.slice(0, COLLAPSED_COUNT);
  const hasMore = enrichedItems.length > COLLAPSED_COUNT;

  return (
    <div className="bg-[var(--col-danger-07)] p-4 rounded-2xl border border-[var(--col-danger-18)]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-[var(--col-danger-15)] rounded-lg">
            <AlertTriangle size={16} className="text-col-danger" />
          </div>
          <span className="font-bold text-sm text-col-danger-light">
            Low Stock Alert ({items.length})
          </span>
        </div>
        {onViewAll && (
          <button onClick={onViewAll} className="text-app-sm font-bold text-col-danger flex items-center gap-1 hover:underline">
            View All <ArrowRight size={12} />
          </button>
        )}
      </div>

      <div className="space-y-2">
        {visibleItems.map((item) => (
          <div
            key={item.id}
            onClick={() => onItemClick?.(item)}
            className="bg-[var(--rgba-white-06)] p-2.5 rounded-xl flex items-center justify-between cursor-pointer hover:bg-[var(--rgba-white-10)] transition-colors gap-3 overflow-hidden"
          >
            <div className="min-w-0 flex-1">
              <div className="font-bold text-sm truncate">{item.name}</div>
              <div className="text-app-sm text-[var(--text-muted)]">Min: {item.min_stock} {item.unit}</div>
              {item.daysRemaining !== null && (
                <div className={`text-app-sm font-bold mt-0.5 flex items-center gap-1 ${
                  item.daysRemaining <= 3 ? 'text-red-400' : item.daysRemaining <= 7 ? 'text-orange-400' : 'text-yellow-400'
                }`}>
                  <Clock size={10} />
                  {item.daysRemaining <= 0 ? 'Out of stock based on sales velocity!' : `~${item.daysRemaining}d left at current pace`}
                </div>
              )}
            </div>
            <div className="text-right flex-shrink-0">
              <div className="font-black text-base text-red-400 tabular-nums whitespace-nowrap">{item.current_stock}</div>
              <div className="text-app-xs text-[var(--text-muted)]">{item.unit}</div>
            </div>
          </div>
        ))}
      </div>

      {enrichedItems.some(i => i.daysRemaining !== null && i.daysRemaining <= 3) && (
        <div className="mt-2 bg-[var(--col-danger-12)] rounded-lg p-2 flex items-center gap-2">
          <TrendingDown size={14} className="text-red-600 flex-shrink-0" />
          <span className="text-app-sm font-bold text-red-400">
            {enrichedItems.filter(i => i.daysRemaining !== null && i.daysRemaining <= 3).length} item(s) will run out within 3 days. Order now!
          </span>
        </div>
      )}

      {hasMore && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-app-sm font-black transition-all active:scale-95"
          style={{ background: 'var(--col-danger-15)', color: "var(--col-danger)", border: '1px solid var(--col-danger-25)' }}
        >
          {expanded ? <><ChevronUp size={12} /> Show less</> : <><ChevronDown size={12} /> Show {enrichedItems.length - COLLAPSED_COUNT} more</>}
        </button>
      )}
    </div>
  );
};

export default LowStockWidget;
