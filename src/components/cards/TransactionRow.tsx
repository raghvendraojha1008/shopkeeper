import React from 'react';
import { ArrowDownLeft, ArrowUpRight, Trash2, Edit2 } from 'lucide-react';

interface TransactionRowProps {
  t: any; onEdit?: (t: any) => void; onDelete?: (id: string) => void;
}

const TransactionRow: React.FC<TransactionRowProps> = ({ t, onEdit, onDelete }) => {
  const isReceived = t.type === 'received';
  const color = isReceived ? '#059669' : '#dc2626';
  const iconBg = isReceived ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.1)';
  const amtColor = isReceived ? '#059669' : '#dc2626';

  return (
    <div className="flex items-center gap-3 p-3.5 rounded-[20px] transition-all active:scale-[0.98] relative"
      style={{
        background: 'rgba(255,255,255,0.06)',
        border: `1px solid ${isReceived ? 'rgba(16,185,129,0.22)' : 'rgba(239,68,68,0.2)'}`,
        boxShadow: `0 2px 12px ${isReceived ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)'}`,
        borderLeft: `3px solid ${isReceived ? '#10b981' : '#ef4444'}`,
      }}>
      <div className="absolute top-0 left-0 right-0 h-px" style={{background:'linear-gradient(90deg,transparent,rgba(255,255,255,0.1),transparent)'}} />
      {/* Icon */}
      <div className="w-10 h-10 rounded-[14px] flex items-center justify-center flex-shrink-0"
        style={{background: isReceived ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.12)', border:`1px solid ${isReceived ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.2)'}`}}>
        {isReceived
          ? <ArrowDownLeft size={18} style={{color:'#34d399'}} />
          : <ArrowUpRight size={18} style={{color:'#f87171'}} />}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="font-bold truncate" style={{fontSize:13, color:'rgba(240,244,255,0.88)'}}>
            {t.party_name || 'Unknown'}
          </span>
          <span className="font-black tabular-nums flex-shrink-0 ml-2"
            style={{fontSize:14, color: isReceived ? '#6ee7b7' : '#fca5a5'}}>
            {isReceived ? '+' : '-'}₹{Math.round(Number(t.amount||0)).toLocaleString('en-IN')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-black px-1.5 py-0.5 rounded-lg uppercase"
            style={{background: isReceived ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.12)', color: isReceived ? '#34d399' : '#f87171'}}>
            {isReceived ? 'RCV' : 'PAY'}
          </span>
          <span className="text-[10px]" style={{color:'rgba(148,163,184,0.5)'}}>{t.payment_mode || ''}</span>
          <span className="text-[10px]" style={{color:'rgba(148,163,184,0.5)'}}>
            {(() => { const s = t.date; if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}); } return new Date(s).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}); })()}
          </span>
        </div>
      </div>

      {/* Actions */}
      {(onEdit || onDelete) && (
        <div className="flex gap-1.5 flex-shrink-0">
          {onEdit && (
            <button onClick={()=>onEdit(t)}
              className="w-8 h-8 rounded-[12px] flex items-center justify-center active:scale-90 transition-all"
              style={{background:'rgba(139,92,246,0.15)', border:'1px solid rgba(139,92,246,0.2)'}}>
              <Edit2 size={13} style={{color:'#a78bfa'}} />
            </button>
          )}
          {onDelete && (
            <button onClick={()=>onDelete(t.id)}
              className="w-8 h-8 rounded-[12px] flex items-center justify-center active:scale-90 transition-all"
              style={{background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.15)'}}>
              <Trash2 size={13} style={{color:'#f87171'}} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
export default TransactionRow;








