import React from 'react';
import { Wallet, Trash2, Edit2 } from 'lucide-react';

interface ExpenseRowProps {
  e: any; onEdit?: (e: any) => void; onDelete?: (id: string) => void;
}

const ExpenseRow: React.FC<ExpenseRowProps> = ({ e, onEdit, onDelete }) => {
  const catColors: Record<string,{bg:string;ic:string}> = {
    'fuel':      {bg:'var(--col-warning-15)', ic:"var(--col-amber-dark)"},
    'salary':    {bg:'var(--col-accent-15)', ic:"var(--col-indigo-500)"},
    'utilities': {bg:'var(--col-info-15)', ic:"var(--col-blue)"},
    'rent':      {bg:'var(--col-emerald-15)', ic:"var(--col-emerald)"},
    'repair':    {bg:'var(--col-danger-15)',  ic:"var(--col-red)"},
  };
  const cat = (e.category || '').toLowerCase();
  const clr = catColors[cat] || {bg:'rgba(100,116,139,0.1)', ic:"var(--col-slate-500)"};

  return (
    <div className="flex items-center gap-3 p-3.5 rounded-[20px] transition-all relative"
      style={{
        background: 'var(--rgba-white-06)',
        border: '1px solid var(--col-warning-25)',
        boxShadow: '0 2px 12px var(--col-warning-06)',
        borderLeft: '3px solid #f59e0b',
      }}>
      <div className="absolute top-0 left-0 right-0 h-px" style={{background:'linear-gradient(90deg,transparent,var(--rgba-white-10),transparent)'}} />
      <div className="w-10 h-10 rounded-[14px] flex items-center justify-center flex-shrink-0"
        style={{background:'var(--col-warning-15)', border:'1px solid var(--col-warning-25)'}}>
        <Wallet size={17} style={{color:"var(--col-warning)"}} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="font-bold truncate" style={{fontSize:13, color: 'var(--text-primary)'}}>
            {e.description || e.category || 'Expense'}
          </span>
          <span className="font-black tabular-nums flex-shrink-0 ml-2"
            style={{fontSize:14, color:"var(--col-warning)"}}>
            -₹{Math.round(Number(e.amount||0)).toLocaleString('en-IN')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {e.category && (
            <span className="text-app-xs font-black px-1.5 py-0.5 rounded-lg uppercase"
              style={{background:'var(--col-warning-15)', color:"var(--col-warning)"}}>{e.category}</span>
          )}
          <span className="text-app-sm" style={{color: 'var(--text-muted)'}}>
            {(() => { const s = e.date; if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}); } return new Date(s).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}); })()}
          </span>
        </div>
      </div>

      {(onEdit || onDelete) && (
        <div className="flex gap-1.5 flex-shrink-0">
          {onEdit && (
            <button onClick={()=>onEdit(e)}
              className="w-8 h-8 rounded-[12px] flex items-center justify-center active:scale-90"
              style={{background:'var(--col-violet-15)', border:'1px solid var(--col-violet-25)'}}>
              <Edit2 size={13} style={{color:"var(--col-violet)"}} />
            </button>
          )}
          {onDelete && (
            <button onClick={()=>onDelete(e.id)}
              className="w-8 h-8 rounded-[12px] flex items-center justify-center active:scale-90"
              style={{background:'var(--col-danger-15)', border:'1px solid var(--col-danger-15)'}}>
              <Trash2 size={13} style={{color:"var(--col-danger)"}} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
export default ExpenseRow;








