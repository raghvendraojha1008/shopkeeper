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
    ? { bg: 'rgba(59,130,246,0.1)', text: '#2563eb', border: 'rgba(59,130,246,0.2)' }
    : { bg: 'rgba(245,158,11,0.1)', text: '#d97706', border: 'rgba(245,158,11,0.2)' };

  const balanceColor = isCredit ? '#059669' : isDebit ? '#dc2626' : '#64748b';
  const balanceBg = isCredit ? 'rgba(16,185,129,0.1)' : isDebit ? 'rgba(239,68,68,0.1)' : 'rgba(0,0,0,0.05)';

  const initials = (party.name || '?').split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase();

  return (
    <div onClick={onClick}
      className="rounded-[22px] overflow-hidden transition-all active:scale-[0.97] cursor-pointer relative"
      style={{
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      }}>
      <div className="absolute top-0 left-0 right-0 h-px" style={{background:'linear-gradient(90deg,transparent,rgba(255,255,255,0.14),transparent)'}} />
      <div className="p-4">
        <div className="flex items-center gap-3 mb-3">
          {/* Avatar */}
          <div className="w-11 h-11 rounded-[16px] flex items-center justify-center font-black text-white flex-shrink-0"
            style={{
              background: isCustomer ? 'linear-gradient(145deg,#3b82f6,#2563eb)' : 'linear-gradient(145deg,#f59e0b,#d97706)',
              boxShadow: isCustomer ? '0 4px 16px rgba(59,130,246,0.4)' : '0 4px 16px rgba(245,158,11,0.4)',
              fontSize: 14,
            }}>
            {initials}
          </div>

          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="flex items-center gap-2 mb-0.5 min-w-0">
              <h3 className="font-black truncate min-w-0" style={{fontSize:14, letterSpacing:'-0.02em', color:'rgba(240,244,255,0.9)'}}>
                <Highlighter text={party.name} highlight={searchTerm} />
              </h3>
            </div>
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="flex-shrink-0 text-[9px] font-black px-2 py-0.5 rounded-full capitalize"
                style={{background:roleColor.bg, color:roleColor.text, border:`1px solid ${roleColor.border}`}}>
                {party.role || 'party'}
              </span>
              {party.contact && (
                <span className="text-[10px] font-medium flex items-center gap-1 truncate min-w-0" style={{color:'rgba(148,163,184,0.6)'}}>
                  <Phone size={9} className="flex-shrink-0" /><span className="truncate">{party.contact}</span>
                </span>
              )}
            </div>
          </div>

          {/* Balance */}
          <div className="flex-shrink-0 w-[86px] px-2 py-2 rounded-[14px] text-right"
            style={{background: isCredit ? 'rgba(16,185,129,0.12)' : isDebit ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.05)', border: `1px solid ${isCredit ? 'rgba(16,185,129,0.2)' : isDebit ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.08)'}`}}>
            <div className="text-[8px] font-black uppercase tracking-wide mb-0.5"
              style={{color: isCredit ? '#34d399' : isDebit ? '#f87171' : 'rgba(148,163,184,0.5)'}}>
              {isCredit ? 'To Receive' : isDebit ? 'To Pay' : 'Settled'}
            </div>
            <div className="font-black tabular-nums truncate" style={{fontSize:12, color: isCredit ? '#6ee7b7' : isDebit ? '#fca5a5' : 'rgba(148,163,184,0.5)'}}>
              {abs > 0 ? `₹${Math.round(abs).toLocaleString('en-IN')}` : '—'}
            </div>
          </div>
        </div>

        {party.address && (
          <div className="flex items-center gap-1.5 mb-3 text-[10px]" style={{color:'rgba(148,163,184,0.5)'}}>
            <MapPin size={10} className="flex-shrink-0" />
            <span className="truncate">{party.address}</span>
          </div>
        )}

        {/* Actions */}
        {(onEdit || onDelete) && (
          <div className="flex gap-2 pt-3" style={{borderTop:'1px solid rgba(255,255,255,0.07)'}}>
            {onEdit && (
              <button onClick={onEdit}
                className="flex-1 py-2.5 rounded-[14px] text-[10px] font-black flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                style={{background:'rgba(139,92,246,0.15)', color:'#a78bfa', border:'1px solid rgba(139,92,246,0.2)'}}>
                <Edit2 size={12} /> Edit
              </button>
            )}
            {onDelete && (
              <button onClick={onDelete}
                className="flex-1 py-2.5 rounded-[14px] text-[10px] font-black flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                style={{background:'rgba(239,68,68,0.1)', color:'#f87171', border:'1px solid rgba(239,68,68,0.15)'}}>
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








