import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Edit2, Trash2, Calendar, Truck, Package, CreditCard, Banknote, Share2, BadgePercent, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Printer } from 'lucide-react';
import { formatDate, formatCurrency } from '../../utils/helpers';
import { Highlighter } from '../common/Highlighter';

interface LedgerCardProps {
  l: any; onEdit: (item: any) => void; onDelete: (id: string) => void;
  onPrint?: (item: any) => void; showDelete?: boolean; searchTerm?: string;
}

const LedgerCard: React.FC<LedgerCardProps> = React.memo(({ l, onEdit, onDelete, onPrint, showDelete = true, searchTerm = '' }) => {
  const [expanded, setExpanded] = useState(false);
  const isPurchase = l.type === 'purchase';
  const itemCount = l.items ? l.items.length : 0;
  const discount = Number(l.discount_amount) || 0;
  const displayId = l.prefixed_id || l.invoice_no;
  const accentColor = isPurchase ? '#f97316' : '#3b82f6';
  const accentBg = isPurchase ? 'rgba(249,115,22,0.1)' : 'rgba(59,130,246,0.1)';
  const amountColor = isPurchase ? '#ea580c' : '#1d4ed8';

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = `*Invoice*\nType: ${isPurchase ? 'Purchase' : 'Sale'}\nParty: ${l.party_name}\nDate: ${formatDate(l.date)}\nAmount: ${formatCurrency(l.total_amount)}\nInvoice: ${displayId || 'NA'}`;
    if (Capacitor.isNativePlatform()) {
      try { await Share.share({ text }); } catch (_) {}
    } else {
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    }
  };

  return (
    <div className="rounded-[22px] overflow-hidden transition-all active:scale-[0.98] relative"
      style={{
        background: 'rgba(255,255,255,0.06)',
        border: `1px solid ${isPurchase ? 'rgba(249,115,22,0.25)' : 'rgba(59,130,246,0.22)'}`,
        boxShadow: `0 4px 20px ${isPurchase ? 'rgba(249,115,22,0.12)' : 'rgba(59,130,246,0.1)'}, 0 0 0 0 transparent`,
        borderLeft: `3px solid ${accentColor}`,
      }}>
      {/* Sheen */}
      <div className="absolute top-0 left-0 right-0 h-px" style={{background:`linear-gradient(90deg, ${accentColor}40, rgba(255,255,255,0.15), transparent)`}} />
      
      <div className="p-4 pl-3.5">
        {/* Header row */}
        <div className="flex justify-between items-start mb-2.5">
          <div className="min-w-0 flex-1 mr-3">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full"
                style={{background:accentBg, border:`1px solid ${accentColor}30`}}>
                {isPurchase ? <TrendingDown size={10} style={{color:accentColor}} /> : <TrendingUp size={10} style={{color:accentColor}} />}
                <span className="text-[9px] font-black uppercase tracking-wide" style={{color:accentColor}}>
                  {isPurchase ? 'Purchase' : 'Sale'}
                </span>
              </div>
              {displayId && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-lg"
                  style={{background:'rgba(255,255,255,0.07)', color:'rgba(148,163,184,0.7)'}}>
                  #{displayId}
                </span>
              )}
              {discount > 0 && (
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
                  style={{background:'rgba(245,158,11,0.15)', color:'#fbbf24', border:'1px solid rgba(245,158,11,0.2)'}}>
                  <BadgePercent size={8} /> Disc
                </span>
              )}
            </div>
            <h3 className="font-black truncate" style={{fontSize:14, letterSpacing:'-0.02em', color:'rgba(240,244,255,0.9)'}}>
              <Highlighter text={l.party_name} highlight={searchTerm} />
            </h3>
            <div className="flex items-center gap-3 mt-1 text-[10px]" style={{color:'rgba(148,163,184,0.55)'}}>
              <span className="flex items-center gap-1"><Calendar size={9}/> {formatDate(l.date)}</span>
              {l.vehicle && <span className="flex items-center gap-1 truncate"><Truck size={9}/> {l.vehicle}</span>}
            </div>
          </div>

          {/* Amount */}
          <div className="flex-shrink-0 text-right">
            <div className="font-black tabular-nums" style={{fontSize:15, color:amountColor}}>
              {formatCurrency(l.total_amount)}
            </div>
            <div className="flex items-center justify-end gap-1 mt-0.5 text-[9px] font-bold"
              style={{color:'rgba(148,163,184,0.5)'}}>
              {l.payment_mode === 'online' ? <CreditCard size={9}/> : <Banknote size={9}/>}
              {l.payment_mode || 'Cash'}
            </div>
          </div>
        </div>

        {/* Items preview */}
        {itemCount > 0 && (
          <button onClick={()=>setExpanded(!expanded)}
            className="w-full flex items-center justify-between px-2.5 py-2 rounded-[12px] mb-2.5 transition-all"
            style={{background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.08)'}}>
            <div className="flex items-center gap-2">
              <Package size={11} style={{color:'rgba(148,163,184,0.5)'}} />
              <span className="text-[10px] font-bold" style={{color:'rgba(148,163,184,0.7)'}}>
                {l.items[0]?.item_name}{itemCount > 1 ? ` +${itemCount-1} more` : ''}
              </span>
            </div>
            {expanded ? <ChevronUp size={13} style={{color:'rgba(148,163,184,0.5)'}} /> : <ChevronDown size={13} style={{color:'rgba(148,163,184,0.5)'}} />}
          </button>
        )}

        {/* Expanded items */}
        {expanded && l.items && (
          <div className="mb-3 rounded-[14px] overflow-hidden" style={{background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)'}}>
            {l.items.map((item: any, idx: number) => (
              <div key={idx} className="flex justify-between items-center px-3 py-2 text-xs"
                style={{borderBottom: idx < l.items.length-1 ? '1px solid rgba(255,255,255,0.05)' : 'none'}}>
                <span className="font-bold truncate flex-1" style={{color:'rgba(226,232,240,0.8)'}}>{item.item_name}</span>
                <span className="mx-2 flex-shrink-0" style={{color:'rgba(148,163,184,0.5)'}}>{item.quantity} {item.unit}</span>
                <span className="font-black tabular-nums flex-shrink-0" style={{color:'rgba(226,232,240,0.8)'}}>₹{item.rate}</span>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2.5" style={{borderTop:'1px solid rgba(255,255,255,0.07)'}}>
          <button onClick={()=>onEdit(l)}
            className="flex-1 py-2.5 rounded-[14px] text-[10px] font-black flex items-center justify-center gap-1.5 active:scale-95 transition-all"
            style={{background:'rgba(139,92,246,0.15)', color:'#a78bfa', border:'1px solid rgba(139,92,246,0.2)'}}>
            <Edit2 size={12} /> Edit
          </button>
          {onPrint && (
            <button onClick={()=>onPrint(l)}
              className="w-10 h-10 rounded-[14px] flex items-center justify-center active:scale-95 transition-all"
              style={{background:'rgba(16,185,129,0.12)', color:'#34d399', border:'1px solid rgba(16,185,129,0.2)'}}>
              <Printer size={14} />
            </button>
          )}
          <button onClick={handleShare}
            className="w-10 h-10 rounded-[14px] flex items-center justify-center active:scale-95 transition-all"
            style={{background:'rgba(37,211,102,0.1)', color:'#4ade80', border:'1px solid rgba(37,211,102,0.15)'}}>
            <Share2 size={14} />
          </button>
          {showDelete && (
            <button onClick={()=>onDelete(l.id)}
              className="w-10 h-10 rounded-[14px] flex items-center justify-center active:scale-95 transition-all"
              style={{background:'rgba(239,68,68,0.1)', color:'#f87171', border:'1px solid rgba(239,68,68,0.15)'}}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
LedgerCard.displayName = 'LedgerCard';
export default LedgerCard;








