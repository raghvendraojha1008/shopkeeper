import React from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowDownRight, ArrowUpLeft, Trash2, Edit2 } from 'lucide-react';

interface TransactionRowProps {
  t: any;
  onEdit?: (t: any) => void;
  onDelete?: (id: string) => void;
  /** Party role context — used to detect reverse/unusual payments */
  partyRole?: 'customer' | 'supplier';
}

const TransactionRow: React.FC<TransactionRowProps> = ({ t, onEdit, onDelete, partyRole }) => {
  const isReceived = t.type === 'received';

  // A reverse payment is one that goes against the expected direction for the party role:
  // - Customer + paid (firm refunded/paid back customer)
  // - Supplier + received (supplier refunded/paid back firm)
  const isReverse = partyRole
    ? (partyRole === 'customer' && t.type === 'paid') ||
      (partyRole === 'supplier' && t.type === 'received')
    : false;

  // Colour scheme:
  // Normal received  → green
  // Normal paid      → red
  // Reverse payment  → amber/orange (stands out as unusual)
  let borderColor: string;
  let iconBgColor: string;
  let iconColor: string;
  let amtColor: string;
  let badgeBg: string;
  let badgeColor: string;
  let badgeLabel: string;
  let amtPrefix: string;

  if (isReverse) {
    borderColor = 'rgba(251,146,60,0.35)';
    iconBgColor = 'rgba(251,146,60,0.15)';
    iconColor = "var(--col-orange-400)";
    amtColor = "var(--col-orange-400)";
    badgeBg = 'rgba(251,146,60,0.15)';
    badgeColor = "var(--col-orange-400)";
    badgeLabel = isReceived ? 'REV-RCV' : 'REV-PAY';
    amtPrefix = isReceived ? '+' : '-';
  } else if (isReceived) {
    borderColor = 'var(--col-emerald-22)';
    iconBgColor = 'var(--col-emerald-15)';
    iconColor = "var(--col-success)";
    amtColor = "var(--col-success-light)";
    badgeBg = 'var(--col-emerald-15)';
    badgeColor = "var(--col-success)";
    badgeLabel = 'RCV';
    amtPrefix = '+';
  } else {
    borderColor = 'var(--col-danger-25)';
    iconBgColor = 'var(--col-danger-12)';
    iconColor = "var(--col-danger)";
    amtColor = "var(--col-danger-light)";
    badgeBg = 'var(--col-danger-12)';
    badgeColor = "var(--col-danger)";
    badgeLabel = 'PAY';
    amtPrefix = '-';
  }

  const IconComponent = isReverse
    ? (isReceived ? ArrowDownRight : ArrowUpLeft)
    : (isReceived ? ArrowDownLeft : ArrowUpRight);

  return (
    <div className="flex items-center gap-3 p-3.5 rounded-[20px] transition-all active:scale-[0.98] relative"
      style={{
        background: isReverse ? 'rgba(251,146,60,0.05)' : 'var(--rgba-white-06)',
        border: `1px solid ${borderColor}`,
        boxShadow: `0 2px 12px ${isReverse ? 'rgba(251,146,60,0.08)' : isReceived ? 'var(--col-emerald-08)' : 'var(--col-danger-08)'}`,
        borderLeft: `3px solid ${isReverse ? "var(--col-orange-400)" : isReceived ? "var(--col-emerald)" : "var(--col-red)"}`,
      }}>
      <div className="absolute top-0 left-0 right-0 h-px" style={{background:'linear-gradient(90deg,transparent,var(--rgba-white-10),transparent)'}} />

      {/* Icon */}
      <div className="w-10 h-10 rounded-[14px] flex items-center justify-center flex-shrink-0"
        style={{background: iconBgColor, border:`1px solid ${borderColor}`}}>
        <IconComponent size={18} style={{color: iconColor}} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="font-bold truncate" style={{fontSize:13, color: 'var(--text-primary)'}}>
            {t.party_name || 'Unknown'}
          </span>
          <span className="font-black tabular-nums flex-shrink-0 ml-2"
            style={{fontSize:14, color: amtColor}}>
            {amtPrefix}₹{Math.round(Number(t.amount||0)).toLocaleString('en-IN')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-app-xs font-black px-1.5 py-0.5 rounded-lg uppercase"
            style={{background: badgeBg, color: badgeColor}}>
            {badgeLabel}
          </span>
          {isReverse && (
            <span className="text-app-xs font-bold px-1 py-0.5 rounded italic"
              style={{background:'rgba(251,146,60,0.1)', color:'rgba(251,146,60,0.7)'}}>
              reverse
            </span>
          )}
          <span className="text-app-sm" style={{color: 'var(--text-muted)'}}>{t.payment_mode || ''}</span>
          <span className="text-app-sm" style={{color: 'var(--text-muted)'}}>
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
              style={{background:'var(--col-violet-15)', border:'1px solid var(--col-violet-25)'}}>
              <Edit2 size={13} style={{color:"var(--col-violet)"}} />
            </button>
          )}
          {onDelete && (
            <button onClick={()=>onDelete(t.id)}
              className="w-8 h-8 rounded-[12px] flex items-center justify-center active:scale-90 transition-all"
              style={{background:'var(--col-danger-15)', border:'1px solid var(--col-danger-15)'}}>
              <Trash2 size={13} style={{color:"var(--col-danger)"}} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
export default TransactionRow;








