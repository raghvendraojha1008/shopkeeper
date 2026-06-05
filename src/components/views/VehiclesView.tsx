import React, { useState, useEffect, useMemo } from 'react';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import { User } from 'firebase/auth';
import { Search, Truck, Phone, Edit2, Trash2, User as UserIcon, ChevronRight, ArrowLeft } from 'lucide-react';
import { ApiService } from '../../services/api';
import { TrashService } from '../../services/trash';
import { useUI } from '../../context/UIContext';
import Header from '../common/Header';
import VehicleDetailView from './VehicleDetailView';
import { AppSettings } from '../../types';

interface VehiclesViewProps { 
    user: User; 
    onAdd: () => void;
    onEdit: (item: any) => void;
    onBack?: () => void;
    appSettings?: AppSettings;
    refreshKey?: number;
}

const VehiclesView: React.FC<VehiclesViewProps> = ({ user, onAdd, onEdit, onBack, appSettings, refreshKey = 0 }) => {
  const { confirm, showToast } = useUI();
  const scrollRef = useScrollMemory('vehicles');
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState<any>(null);

  useEffect(() => {
      const load = async () => {
          setLoading(true);
          try {
              const snap = await ApiService.getAll(user.uid, 'vehicles');
              setVehicles(snap.docs.map(d => ({ id: d.id, ...d.data() })));
          } catch (e) { console.error(e); } finally { setLoading(false); }
      };
      load();
  }, [user.uid, refreshKey]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if(await confirm("Delete Vehicle?", "Moves to Recycle Bin.")) {
          await TrashService.moveToTrash(user.uid, 'vehicles', id);
          setVehicles(p => p.filter(i => i.id !== id));
          showToast("Moved to Trash", "success");
      }
  };

  const filtered = useMemo(() => 
      vehicles.filter(v => v.vehicle_number?.toLowerCase().includes(searchTerm.toLowerCase())),
  [vehicles, searchTerm]);

  // Android-safe scroll preservation: use visibility:hidden + pointer-events:none
  // instead of display:none. display:none removes the element from the render tree —
  // Android WebView may evict it and reset scrollTop. visibility:hidden keeps the
  // element in layout with scrollTop intact. Both views sit inside a position:relative
  // wrapper; the detail view is absolutely overlaid on top.
  return (
    <div style={{ position: 'relative', height: '100%', overflow: 'hidden' }}>
      {selectedVehicle && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 10 }}>
          <VehicleDetailView vehicle={selectedVehicle} user={user} onBack={() => setSelectedVehicle(null)} appSettings={appSettings} />
        </div>
      )}
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto"
        style={{
          background: 'var(--app-bg)',
          WebkitOverflowScrolling: 'touch',
          visibility: selectedVehicle ? 'hidden' : 'visible',
          pointerEvents: selectedVehicle ? 'none' : 'auto',
        }}
      >
       {/* HEADER WITH BACK ARROW */}
       <div className="backdrop-blur-md px-4 py-3 border-b border-white/10 flex justify-between items-center sticky top-0 z-30" style={{background:"rgba(var(--app-bg-rgb),0.92)"}}>
           <div className="flex items-center gap-3">
               {onBack && (
                   <button onClick={onBack} className="p-2 -ml-2 hover:bg-slate-100 hover:bg-[rgba(255,255,255,0.08)] rounded-full transition-colors">
                       <ArrowLeft size={20} className="text-[rgba(226,232,240,0.88)]"/>
                   </button>
               )}
               <div>
                   <h1 className="font-black text-xl tracking-tight">Vehicles</h1>
                   <p className="text-[10px] font-bold text-slate-400 uppercase">{filtered.length} Total</p>
               </div>
           </div>
           <button onClick={onAdd} className="bg-blue-600 text-white p-2.5 rounded-xl shadow-lg active:scale-95 transition-all">
               <Truck size={18} strokeWidth={2.5}/>
           </button>
       </div>

       <div className="px-4 pt-4">
       
       <div className="relative mb-4">
           <Search className="absolute left-3 top-3 text-slate-400" size={16}/>
           <input 
               className="w-full pl-10 p-2.5 border border-white/12 rounded-xl font-bold text-sm outline-none" 
               placeholder="Search vehicles..." 
               value={searchTerm} 
               onChange={e => setSearchTerm(e.target.value)} 
           />
       </div>
       </div>

       <div className="pb-20 space-y-2.5 px-4">
           {loading ? (
               <div className="text-center py-10 text-[rgba(148,163,184,0.45)]">Loading...</div>
           ) : filtered.length === 0 ? (
               <div className="text-center py-16">
                   <Truck size={44} className="mx-auto mb-3" style={{ color: 'rgba(148,163,184,0.12)' }} />
                   <p className="font-black text-sm" style={{ color: 'rgba(148,163,184,0.45)' }}>
                       {vehicles.length === 0 ? 'No vehicles added yet' : 'No vehicles match your search'}
                   </p>
                   <p className="text-xs mt-1" style={{ color: 'rgba(148,163,184,0.25)' }}>
                       {vehicles.length === 0 ? 'Tap + to add your first vehicle' : 'Try a different search term'}
                   </p>
               </div>
           ) : filtered.map(v => (
               <div 
                   key={v.id} 
                   onClick={() => setSelectedVehicle(v)}
                   className="p-3 rounded-3xl border border-white/08 active:scale-[0.97] transition-all cursor-pointer group overflow-hidden"
               >
                   <div className="flex justify-between items-start mb-2">
                        <div className="min-w-0 flex-1 overflow-hidden">
                            <div className="font-black text-base flex items-center gap-2 text-[rgba(226,232,240,0.88)] overflow-hidden">
                                <Truck size={16} className="text-orange-500 flex-shrink-0"/> <span className="truncate">{v.vehicle_number}</span>
                            </div>
                           <div className="text-xs text-[rgba(148,163,184,0.45)] font-bold mt-1 uppercase">
                               {v.model || 'Unknown Model'}
                           </div>
                       </div>
                       <ChevronRight size={18} className="text-slate-300"/>
                   </div>

                   <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-dashed border-white/08">
                       <div className="flex items-center gap-2 text-xs font-medium text-[rgba(203,213,225,0.7)]">
                           <UserIcon size={12} style={{color:"rgba(148,163,184,0.45)"}}/>
                           <span className="truncate">{v.owner_name ? `Owner: ${v.owner_name}` : '—'}</span>
                       </div>
                       <div className="flex items-center gap-2 text-xs font-medium text-[rgba(203,213,225,0.7)]">
                           <UserIcon size={12} style={{color:"rgba(148,163,184,0.45)"}}/>
                           <span className="truncate">{v.driver_name ? `Driver: ${v.driver_name}` : '—'}</span>
                       </div>
                   </div>

                   <div className="flex justify-end gap-2 mt-3 pt-2 border-t border-white/08/50">
                       {(v.owner_phone) && (
                           <a 
                               href={`tel:${v.owner_phone}`} 
                               onClick={(e) => e.stopPropagation()}
                               className="flex items-center gap-1 p-2 bg-[rgba(139,92,246,0.12)] text-[#a78bfa] rounded-lg border border-[rgba(139,92,246,0.2)] text-[10px] font-black"
                           >
                               <Phone size={12}/> Owner
                           </a>
                       )}
                       {(v.driver_phone || v.driver_contact) && (
                           <a 
                               href={`tel:${v.driver_phone || v.driver_contact}`} 
                               onClick={(e) => e.stopPropagation()}
                               className="flex items-center gap-1 p-2 bg-[rgba(16,185,129,0.15)] text-[#34d399] rounded-lg border border-[rgba(16,185,129,0.2)] text-[10px] font-black"
                           >
                               <Phone size={12}/> Driver
                           </a>
                       )}
                       <button 
                           onClick={(e) => { e.stopPropagation(); onEdit(v); }} 
                           className="p-2 bg-[rgba(59,130,246,0.12)] text-[#60a5fa] rounded-lg border border-[rgba(59,130,246,0.18)] font-bold text-xs flex items-center gap-1"
                       >
                           <Edit2 size={14}/> Edit
                       </button>
                       <button 
                           onClick={(e) => handleDelete(v.id, e)} 
                           className="p-2 bg-[rgba(239,68,68,0.12)] text-[#f87171] rounded-lg border border-[rgba(239,68,68,0.18)] hover:bg-red-100"
                       >
                           <Trash2 size={14}/>
                       </button>
                   </div>
               </div>
           ))}
       </div>
    </div>
    </div>
  );
};
export default VehiclesView;







