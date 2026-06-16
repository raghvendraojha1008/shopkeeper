import React from 'react';
import { Wallet, Trash2, Edit2 } from 'lucide-react';

interface ExpenseRowProps {
  e: any; onEdit?: (e: any) => void; onDelete?: (id: string) => void;
}

const ExpenseRow: React.FC<ExpenseRowProps> = ({ e, onEdit, onDelete }) => {
  const catColors: Record<string,{bg:string;ic:string}> = {
    'fuel':      {bg:'rgba(245,158,11,0.1)', ic:'#d97706'},
    'salary':    {bg:'rgba(99,102,241,0.1)', ic:'#6366f1'},
    'utilities': {bg:'rgba(59,130,246,0.1)', ic:'#3b82f6'},
    'rent':      {bg:'rgba(16,185,129,0.1)', ic:'#10b981'},
    'repair':    {bg:'rgba(239,68,68,0.1)',  ic:'#ef4444'},
  };
  const cat = (e.category || '').toLowerCase();
  const clr = catColors[cat] || {bg:'rgba(100,116,139,0.1)', ic:'#64748b'};

  return (
    <div className="flex items-center gap-3 p-3.5 rounded-[20px] transition-all relative"
      style={{
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(245,158,11,0.2)',
        boxShadow: '0 2px 12px rgba(245,158,11,0.06)',
        borderLeft: '3px solid #f59e0b',
      }}>
      <div className="absolute top-0 left-0 right-0 h-px" style={{background:'linear-gradient(90deg,transparent,rgba(255,255,255,0.1),transparent)'}} />
      <div className="w-10 h-10 rounded-[14px] flex items-center justify-center flex-shrink-0"
        style={{background:'rgba(245,158,11,0.15)', border:'1px solid rgba(245,158,11,0.25)'}}>
        <Wallet size={17} style={{color:'#fbbf24'}} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="font-bold truncate" style={{fontSize:13, color:'rgba(240,244,255,0.88)'}}>
            {e.description || e.category || 'Expense'}
          </span>
          <span className="font-black tabular-nums flex-shrink-0 ml-2"
            style={{fontSize:14, color:'#fbbf24'}}>
            -₹{Math.round(Number(e.amount||0)).toLocaleString('en-IN')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {e.category && (
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded-lg uppercase"
              style={{background:'rgba(245,158,11,0.15)', color:'#fbbf24'}}>{e.category}</span>
          )}
          <span className="text-[10px]" style={{color:'rgba(148,163,184,0.5)'}}>
            {(() => { const s = e.date; if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}); } return new Date(s).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}); })()}
          </span>
        </div>
      </div>

      {(onEdit || onDelete) && (
        <div className="flex gap-1.5 flex-shrink-0">
          {onEdit && (
            <button onClick={()=>onEdit(e)}
              className="w-8 h-8 rounded-[12px] flex items-center justify-center active:scale-90"
              style={{background:'rgba(139,92,246,0.15)', border:'1px solid rgba(139,92,246,0.2)'}}>
              <Edit2 size={13} style={{color:'#a78bfa'}} />
            </button>
          )}
          {onDelete && (
            <button onClick={()=>onDelete(e.id)}
              className="w-8 h-8 rounded-[12px] flex items-center justify-center active:scale-90"
              style={{background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.15)'}}>
              <Trash2 size={13} style={{color:'#f87171'}} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
export default ExpenseRow;








