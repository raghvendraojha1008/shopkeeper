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
        background: isLowStock ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.06)',
        border: isLowStock ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(255,255,255,0.1)',
        boxShadow: isLowStock ? '0 4px 20px rgba(239,68,68,0.15)' : '0 4px 20px rgba(0,0,0,0.3)',
        backdropFilter: 'blur(20px)',
      }}>
      {/* Sheen */}
      <div className="absolute top-0 left-0 right-0 h-px" style={{background:'linear-gradient(90deg,transparent,rgba(255,255,255,0.15),transparent)'}} />
      
      {isLowStock && (
        <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-full"
          style={{background:'linear-gradient(135deg,#ef4444,#dc2626)', boxShadow:'0 2px 8px rgba(239,68,68,0.5)'}}>
          <AlertTriangle size={8} className="text-white" />
          <span className="text-white text-[8px] font-black uppercase tracking-wide">Low</span>
        </div>
      )}

      <div className="p-4">
        {/* Name + unit */}
        <div className="mb-3">
          <h3 className="font-black mb-1 pr-14"
            style={{fontSize:14, letterSpacing:'-0.02em', lineHeight:1.2, color:'rgba(240,244,255,0.95)'}}>
            <Highlighter text={i.name} highlight={searchTerm} />
          </h3>
          <div className="flex items-center gap-2">
            {i.unit && (
              <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full"
                style={{background:'rgba(139,92,246,0.2)', color:'#a78bfa', border:'1px solid rgba(139,92,246,0.3)'}}>
                {i.unit}
              </span>
            )}
            {i.prefixed_id && (
              <span className="text-[9px] font-mono" style={{color:'rgba(148,163,184,0.5)'}}>{i.prefixed_id}</span>
            )}
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="p-2.5 rounded-[14px]"
            style={{background: isLowStock ? 'rgba(239,68,68,0.12)' : 'rgba(59,130,246,0.1)', border: isLowStock ? '1px solid rgba(239,68,68,0.2)' : '1px solid rgba(59,130,246,0.15)'}}>
            <div className="text-[8px] font-black uppercase tracking-[0.1em] mb-1"
              style={{color: isLowStock ? '#f87171' : '#60a5fa'}}>Stock</div>
            <div className="font-black tabular-nums flex items-baseline gap-1"
              style={{fontSize:15, color: isLowStock ? '#fca5a5' : '#93c5fd'}}>
              {i.current_stock}
              <span className="text-[9px] opacity-60 font-bold">{i.unit || 'pcs'}</span>
            </div>
          </div>
          <div className="p-2.5 rounded-[14px]" style={{background:'rgba(16,185,129,0.1)', border:'1px solid rgba(16,185,129,0.15)'}}>
            <div className="text-[8px] font-black uppercase tracking-[0.1em] mb-1" style={{color:'#34d399'}}>Sell Rate</div>
            <div className="font-black tabular-nums overflow-hidden text-ellipsis whitespace-nowrap"
              style={{fontSize:15, color:'#6ee7b7'}}>{formatCurrency(saleRate)}</div>
          </div>
        </div>

        {/* Buy price & GST */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-bold" style={{color:'rgba(148,163,184,0.6)'}}>Buy: {formatCurrency(i.purchase_rate || 0)}</span>
          {(i.gst_percent || 0) > 0 && (
            <span className="text-[9px] font-black px-2 py-0.5 rounded-full"
              style={{background:'rgba(245,158,11,0.15)', color:'#fbbf24', border:'1px solid rgba(245,158,11,0.2)'}}>
              GST {i.gst_percent}%
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-3" style={{borderTop:'1px solid rgba(255,255,255,0.07)'}}>
          <button onClick={() => onEdit(i)}
            className="flex-1 py-2.5 rounded-[14px] text-[10px] font-black flex items-center justify-center gap-1.5 active:scale-95 transition-all"
            style={{background:'rgba(139,92,246,0.15)', color:'#a78bfa', border:'1px solid rgba(139,92,246,0.2)'}}>
            <Edit2 size={12} /> Edit
          </button>
          {showDelete && (
            <button onClick={() => onDelete(i.id)}
              className="flex-1 py-2.5 rounded-[14px] text-[10px] font-black flex items-center justify-center gap-1.5 active:scale-95 transition-all"
              style={{background:'rgba(239,68,68,0.1)', color:'#f87171', border:'1px solid rgba(239,68,68,0.15)'}}>
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







