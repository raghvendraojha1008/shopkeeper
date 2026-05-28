import React from 'react';
import { Truck, Edit2, Trash2, MapPin, Phone, Hash } from 'lucide-react';

interface VehicleCardProps {
  v: any; onEdit: (item: any) => void; onDelete: (id: string, e: React.MouseEvent) => void;
  onClick?: () => void;
}

const VehicleCard: React.FC<VehicleCardProps> = ({ v, onEdit, onDelete, onClick }) => {
  const typeColors: Record<string,{bg:string;ic:string;card:string}> = {
    'truck':    {bg:'rgba(59,130,246,0.12)',  ic:'#2563eb', card:'rgba(59,130,246,0.06)'},
    'tempo':    {bg:'rgba(245,158,11,0.12)',  ic:'#d97706', card:'rgba(245,158,11,0.06)'},
    'car':      {bg:'rgba(16,185,129,0.12)',  ic:'#059669', card:'rgba(16,185,129,0.06)'},
    'bike':     {bg:'rgba(99,102,241,0.12)',  ic:'#4f46e5', card:'rgba(99,102,241,0.06)'},
  };
  const t = typeColors[(v.type||'').toLowerCase()] || {bg:'rgba(100,116,139,0.1)',ic:'#64748b',card:'rgba(100,116,139,0.05)'};

  return (
    <div onClick={onClick}
      className="rounded-[22px] overflow-hidden transition-all active:scale-[0.97] cursor-pointer relative"
      style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', boxShadow:'0 4px 20px rgba(0,0,0,0.3)', backdropFilter:'blur(20px)'}}>
      <div className="absolute top-0 left-0 right-0 h-px" style={{background:'linear-gradient(90deg,transparent,rgba(255,255,255,0.14),transparent)'}} />
      <div className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-[18px] flex items-center justify-center flex-shrink-0"
            style={{background:t.bg, border:`1px solid ${t.ic}30`}}>
            <Truck size={22} style={{color:t.ic}} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-black truncate mb-0.5" style={{fontSize:14, letterSpacing:'-0.02em', color:'rgba(240,244,255,0.9)'}}>
              {v.name || v.vehicle_number || 'Vehicle'}
            </h3>
            <div className="flex items-center gap-2">
              {v.type && (
                <span className="text-[9px] font-black px-2 py-0.5 rounded-full capitalize"
                  style={{background:t.bg, color:t.ic, border:`1px solid ${t.ic}30`}}>{v.type}</span>
              )}
              {v.vehicle_number && (
                <span className="text-[9px] font-mono flex items-center gap-0.5" style={{color:'rgba(148,163,184,0.55)'}}>
                  <Hash size={8}/>{v.vehicle_number}
                </span>
              )}
            </div>
          </div>
        </div>

        {(v.driver_name || v.driver_contact) && (
          <div className="px-3 py-2.5 rounded-[14px] mb-3 flex items-center gap-3"
            style={{background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.08)'}}>
            {v.driver_name && (
              <span className="text-[10px] font-bold truncate flex-1" style={{color:'rgba(203,213,225,0.7)'}}>{v.driver_name}</span>
            )}
            {v.driver_contact && (
              <span className="text-[10px] flex items-center gap-1 flex-shrink-0" style={{color:'rgba(148,163,184,0.55)'}}>
                <Phone size={9}/>{v.driver_contact}
              </span>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-2.5" style={{borderTop:'1px solid rgba(255,255,255,0.07)'}}>
          <button onClick={(e)=>{e.stopPropagation();onEdit(v);}}
            className="flex-1 py-2.5 rounded-[14px] text-[10px] font-black flex items-center justify-center gap-1.5 active:scale-95"
            style={{background:'rgba(139,92,246,0.15)', color:'#a78bfa', border:'1px solid rgba(139,92,246,0.2)'}}>
            <Edit2 size={12}/> Edit
          </button>
          <button onClick={(e)=>{e.stopPropagation();onDelete(v.id,e);}}
            className="flex-1 py-2.5 rounded-[14px] text-[10px] font-black flex items-center justify-center gap-1.5 active:scale-95"
            style={{background:'rgba(239,68,68,0.1)', color:'#f87171', border:'1px solid rgba(239,68,68,0.15)'}}>
            <Trash2 size={12}/> Delete
          </button>
        </div>
      </div>
    </div>
  );
};
export default VehicleCard;







