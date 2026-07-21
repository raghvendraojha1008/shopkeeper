import React from 'react';
import { Edit2, Trash2, AlertTriangle, Layers } from 'lucide-react';
import { formatCurrency } from '../../utils/helpers';
import { Highlighter } from '../common/Highlighter';

interface InventoryCardProps {
  i: any; onEdit: (item: any) => void; onDelete: (id: string) => void;
  showDelete?: boolean; searchTerm?: string;
}

const InventoryCard: React.FC<InventoryCardProps> = React.memo(({ i, onEdit, onDelete, showDelete = true, searchTerm = '' }) => {
  const minStock = i.min_stock || 5;
  const isLowStock = (i.current_stock || 0) <= minStock;
  const saleRate = i.sale_rate || i.default_rate || 0;

  return (
    <div className="rounded-[22px] overflow-hidden transition-all active:scale-[0.97] relative"
      style={{
        background: isLowStock ? 'var(--col-danger-08)' : 'var(--rgba-white-06)',
        border: isLowStock ? '1px solid var(--col-danger-35)' : '1px solid var(--glass-border)',
        boxShadow: isLowStock ? '0 4px 20px var(--col-danger-15)' : '0 4px 20px var(--rgba-black-35)',
        backdropFilter: 'blur(20px)',
      }}>
      {/* Sheen */}
      <div className="absolute top-0 left-0 right-0 h-px" style={{background:'linear-gradient(90deg,transparent,var(--rgba-white-15),transparent)'}} />
      
      {isLowStock && (
        <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-full"
          style={{background:'linear-gradient(135deg,#ef4444,#dc2626)', boxShadow:'0 2px 8px var(--col-danger-50)'}}>
          <AlertTriangle size={8} className="text-white" />
          <span className="text-white text-app-2xs font-black uppercase tracking-wide">Low</span>
        </div>
      )}

      <div className="p-4">
        {/* Name + unit */}
        <div className="mb-3">
          <h3 className="font-black mb-1 pr-14"
            style={{fontSize:14, letterSpacing:'-0.02em', lineHeight:1.2, color: 'var(--text-primary)'}}>
            <Highlighter text={i.name} highlight={searchTerm} />
          </h3>
          <div className="flex items-center gap-2">
            {i.unit && (
              <span className="text-app-xs font-black uppercase px-2 py-0.5 rounded-full"
                style={{background:'var(--col-violet-25)', color:"var(--col-violet)", border:'1px solid var(--col-violet-35)'}}>
                {i.unit}
              </span>
            )}
            {i.prefixed_id && (
              <span className="text-app-xs font-mono" style={{color: 'var(--text-muted)'}}>{i.prefixed_id}</span>
            )}
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="p-2.5 rounded-[14px]"
            style={{background: isLowStock ? 'var(--col-danger-12)' : 'var(--col-info-15)', border: isLowStock ? '1px solid var(--col-danger-25)' : '1px solid var(--col-info-15)'}}>
            <div className="text-app-2xs font-black uppercase tracking-[0.1em] mb-1"
              style={{color: isLowStock ? "var(--col-danger)" : "var(--col-info)"}}>Stock</div>
            <div className="font-black tabular-nums flex items-baseline gap-1"
              style={{fontSize:15, color: isLowStock ? "var(--col-danger-light)" : "var(--col-info-light)"}}>
              {i.current_stock}
              <span className="text-app-xs opacity-60 font-bold">{i.unit || 'pcs'}</span>
            </div>
          </div>
          <div className="p-2.5 rounded-[14px]" style={{background:'var(--col-emerald-15)', border:'1px solid var(--col-emerald-15)'}}>
            <div className="text-app-2xs font-black uppercase tracking-[0.1em] mb-1" style={{color:"var(--col-success)"}}>Sell Rate</div>
            <div className="font-black tabular-nums overflow-hidden text-ellipsis whitespace-nowrap"
              style={{fontSize:15, color:"var(--col-success-light)"}}>{formatCurrency(saleRate)}</div>
          </div>
        </div>

        {/* Buy price & GST */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-app-sm font-bold" style={{color: 'var(--text-muted)'}}>Buy: {formatCurrency(i.purchase_rate || 0)}</span>
          {(i.gst_percent || 0) > 0 && (
            <span className="text-app-xs font-black px-2 py-0.5 rounded-full"
              style={{background:'var(--col-warning-15)', color:"var(--col-warning)", border:'1px solid var(--col-warning-25)'}}>
              GST {i.gst_percent}%
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-3" style={{borderTop:'1px solid var(--glass-border)'}}>
          <button onClick={() => onEdit(i)}
            className="flex-1 py-2.5 rounded-[14px] text-app-sm font-black flex items-center justify-center gap-1.5 active:scale-95 transition-all"
            style={{background:'var(--col-violet-15)', color:"var(--col-violet)", border:'1px solid var(--col-violet-25)'}}>
            <Edit2 size={12} /> Edit
          </button>
          {showDelete && (
            <button onClick={() => onDelete(i.id)}
              className="flex-1 py-2.5 rounded-[14px] text-app-sm font-black flex items-center justify-center gap-1.5 active:scale-95 transition-all"
              style={{background:'var(--col-danger-15)', color:"var(--col-danger)", border:'1px solid var(--col-danger-15)'}}>
              <Trash2 size={12} /> Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
InventoryCard.displayName = 'InventoryCard';
export default InventoryCard;







