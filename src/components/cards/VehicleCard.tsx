import React from 'react';
import { Truck, Edit2, Trash2, MapPin, Phone, Hash } from 'lucide-react';

interface VehicleCardProps {
  v: any; onEdit: (item: any) => void; onDelete: (id: string, e: React.MouseEvent) => void;
  onClick?: () => void;
}

const VehicleCard: React.FC<VehicleCardProps> = ({ v, onEdit, onDelete, onClick }) => {
  const typeColors: Record<string,{bg:string;ic:string;card:string}> = {
    'truck':    {bg:'var(--col-info-12)',  ic:"var(--col-blue-600)", card:'var(--col-info-06)'},
    'tempo':    {bg:'var(--col-warning-12)',  ic:"var(--col-amber-dark)", card:'var(--col-warning-06)'},
    'car':      {bg:'var(--col-emerald-12)',  ic:"var(--col-emerald-dark)", card:'var(--col-emerald-06)'},
    'bike':     {bg:'var(--col-accent-12)',  ic:"var(--col-indigo-600)", card:'var(--col-accent-06)'},
  };
  const t = typeColors[(v.type||'').toLowerCase()] || {bg:'rgba(100,116,139,0.1)',ic:"var(--col-slate-500)",card:'rgba(100,116,139,0.05)'};

  return (
    <div onClick={onClick}
      className="rounded-[22px] overflow-hidden transition-all active:scale-[0.97] cursor-pointer relative"
      style={{background:'var(--rgba-white-06)', border:'1px solid var(--glass-border)', boxShadow:'0 4px 20px var(--rgba-black-35)', backdropFilter:'blur(20px)'}}>
      <div className="absolute top-0 left-0 right-0 h-px" style={{background:'linear-gradient(90deg,transparent,var(--rgba-white-14),transparent)'}} />
      <div className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-[18px] flex items-center justify-center flex-shrink-0"
            style={{background:t.bg, border:`1px solid ${t.ic}30`}}>
            <Truck size={22} style={{color:t.ic}} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-black truncate mb-0.5" style={{fontSize:14, letterSpacing:'-0.02em', color: 'var(--text-primary)'}}>
              {v.name || v.vehicle_number || 'Vehicle'}
            </h3>
            <div className="flex items-center gap-2">
              {v.type && (
                <span className="text-app-xs font-black px-2 py-0.5 rounded-full capitalize"
                  style={{background:t.bg, color:t.ic, border:`1px solid ${t.ic}30`}}>{v.type}</span>
              )}
              {v.vehicle_number && (
                <span className="text-app-xs font-mono flex items-center gap-0.5" style={{color: 'var(--text-muted)'}}>
                  <Hash size={8}/>{v.vehicle_number}
                </span>
              )}
            </div>
          </div>
        </div>

        {(v.driver_name || v.driver_contact) && (
          <div className="px-3 py-2.5 rounded-[14px] mb-3 flex items-center gap-3"
            style={{background:'var(--rgba-white-05)', border:'1px solid var(--glass-border)'}}>
            {v.driver_name && (
              <span className="text-app-sm font-bold truncate flex-1" style={{color: 'var(--text-secondary)'}}>{v.driver_name}</span>
            )}
            {v.driver_contact && (
              <span className="text-app-sm flex items-center gap-1 flex-shrink-0" style={{color: 'var(--text-muted)'}}>
                <Phone size={9}/>{v.driver_contact}
              </span>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-2.5" style={{borderTop:'1px solid var(--glass-border)'}}>
          <button onClick={(e)=>{e.stopPropagation();onEdit(v);}}
            className="flex-1 py-2.5 rounded-[14px] text-app-sm font-black flex items-center justify-center gap-1.5 active:scale-95"
            style={{background:'var(--col-violet-15)', color:"var(--col-violet)", border:'1px solid var(--col-violet-25)'}}>
            <Edit2 size={12}/> Edit
          </button>
          <button onClick={(e)=>{e.stopPropagation();onDelete(v.id,e);}}
            className="flex-1 py-2.5 rounded-[14px] text-app-sm font-black flex items-center justify-center gap-1.5 active:scale-95"
            style={{background:'var(--col-danger-15)', color:"var(--col-danger)", border:'1px solid var(--col-danger-15)'}}>
            <Trash2 size={12}/> Delete
          </button>
        </div>
      </div>
    </div>
  );
};
export default VehicleCard;







