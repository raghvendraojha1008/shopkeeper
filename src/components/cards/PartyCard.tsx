import React from 'react';
import { Phone, MapPin, Edit2, Trash2, TrendingUp, TrendingDown, Users } from 'lucide-react';
import { Highlighter } from '../common/Highlighter';

interface PartyCardProps {
  party: any;
  balance?: number;
  onEdit?: (e: React.MouseEvent) => void;
  onDelete?: (e: React.MouseEvent) => void;
  onClick?: () => void;
  searchTerm?: string;
}

const PartyCard: React.FC<PartyCardProps> = ({ party, balance = 0, onEdit, onDelete, onClick, searchTerm = '' }) => {
  const isCredit = balance > 0;
  const isDebit = balance < 0;
  const abs = Math.abs(balance);
  const isCustomer = party.role === 'customer';

  const roleColor = isCustomer
    ? { bg: 'var(--col-info-15)', text: "var(--col-blue-600)", border: 'var(--col-info-25)' }
    : { bg: 'var(--col-warning-15)', text: "var(--col-amber-dark)", border: 'var(--col-warning-25)' };

  const balanceColor = isCredit ? "var(--col-emerald-dark)" : isDebit ? "var(--col-red-dark)" : "var(--col-slate-500)";
  const balanceBg = isCredit ? 'var(--col-emerald-15)' : isDebit ? 'var(--col-danger-15)' : 'var(--rgba-black-05)';

  const initials = (party.name || '?').split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase();

  return (
    <div onClick={onClick}
      className="rounded-[22px] overflow-hidden transition-all active:scale-[0.97] cursor-pointer relative"
      style={{
        background: 'var(--rgba-white-06)',
        border: '1px solid var(--glass-border)',
        boxShadow: '0 4px 20px var(--rgba-black-35)',
      }}>
      <div className="absolute top-0 left-0 right-0 h-px" style={{background:'linear-gradient(90deg,transparent,var(--rgba-white-14),transparent)'}} />
      <div className="p-4">
        <div className="flex items-center gap-3 mb-3">
          {/* Avatar */}
          <div className="w-11 h-11 rounded-[16px] flex items-center justify-center font-black text-white flex-shrink-0"
            style={{
              background: isCustomer ? 'linear-gradient(145deg,#3b82f6,#2563eb)' : 'linear-gradient(145deg,#f59e0b,#d97706)',
              boxShadow: isCustomer ? '0 4px 16px var(--col-info-40)' : '0 4px 16px var(--col-warning-40)',
              fontSize: 14,
            }}>
            {initials}
          </div>

          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="flex items-center gap-2 mb-0.5 min-w-0">
              <h3 className="font-black truncate min-w-0" style={{fontSize:14, letterSpacing:'-0.02em', color: 'var(--text-primary)'}}>
                <Highlighter text={party.name} highlight={searchTerm} />
              </h3>
            </div>
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="flex-shrink-0 text-app-xs font-black px-2 py-0.5 rounded-full capitalize"
                style={{background:roleColor.bg, color:roleColor.text, border:`1px solid ${roleColor.border}`}}>
                {party.role || 'party'}
              </span>
              {party.contact && (
                <span className="text-app-sm font-medium flex items-center gap-1 truncate min-w-0" style={{color: 'var(--text-muted)'}}>
                  <Phone size={9} className="flex-shrink-0" /><span className="truncate">{party.contact}</span>
                </span>
              )}
            </div>
          </div>

          {/* Balance */}
          <div className="flex-shrink-0 w-[86px] px-2 py-2 rounded-[14px] text-right"
            style={{background: isCredit ? 'var(--col-emerald-12)' : isDebit ? 'var(--col-danger-15)' : 'var(--rgba-white-05)', border: `1px solid ${isCredit ? 'var(--col-emerald-25)' : isDebit ? 'var(--col-danger-15)' : 'var(--rgba-white-08)'}`}}>
            <div className="text-app-2xs font-black uppercase tracking-wide mb-0.5"
              style={{color: isCredit ? "var(--col-success)" : isDebit ? "var(--col-danger)" : 'var(--text-muted)'}}>
              {isCredit ? 'To Receive' : isDebit ? 'To Pay' : 'Settled'}
            </div>
            <div className="font-black tabular-nums truncate" style={{fontSize:12, color: isCredit ? "var(--col-success-light)" : isDebit ? "var(--col-danger-light)" : 'var(--text-muted)'}}>
              {abs > 0 ? `₹${Math.round(abs).toLocaleString('en-IN')}` : '—'}
            </div>
          </div>
        </div>

        {party.address && (
          <div className="flex items-center gap-1.5 mb-3 text-app-sm" style={{color: 'var(--text-muted)'}}>
            <MapPin size={10} className="flex-shrink-0" />
            <span className="truncate">{party.address}</span>
          </div>
        )}

        {/* Actions */}
        {(onEdit || onDelete) && (
          <div className="flex gap-2 pt-3" style={{borderTop:'1px solid var(--glass-border)'}}>
            {onEdit && (
              <button onClick={onEdit}
                className="flex-1 py-2.5 rounded-[14px] text-app-sm font-black flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                style={{background:'var(--col-violet-15)', color:"var(--col-violet)", border:'1px solid var(--col-violet-25)'}}>
                <Edit2 size={12} /> Edit
              </button>
            )}
            {onDelete && (
              <button onClick={onDelete}
                className="flex-1 py-2.5 rounded-[14px] text-app-sm font-black flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                style={{background:'var(--col-danger-15)', color:"var(--col-danger)", border:'1px solid var(--col-danger-15)'}}>
                <Trash2 size={12} /> Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
export default PartyCard;








