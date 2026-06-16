import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { 
  X, ArrowRight, Image as ImageIcon, Loader2, AlertTriangle, 
  CheckCircle2, Trash2, Edit2, Package, Sparkles 
} from 'lucide-react';
import { GeminiService } from '../../services/gemini';
import { ApiService } from '../../services/api';
import { useUI } from '../../context/UIContext';
import { AppSettings } from '../../types';
import { haptic } from '../../utils/haptics';
import ManualEntryModal from '../modals/ManualEntryModal';

interface CommandModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  onSuccess?: () => void;
  appSettings?: AppSettings;
}

const CommandModal: React.FC<CommandModalProps> = ({ isOpen, onClose, user, onSuccess, appSettings }) => {
  const { showToast } = useUI();
  
  // Input State
  const [input, setInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  
  // Processing State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Review State
  const [scannedData, setScannedData] = useState<any[] | null>(null);
  
  // Edit State
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  // --- 1. CONTEXT STATE ---
  const [dbLists, setDbLists] = useState<{
      parties: any[];
      inventory: any[];
      expenseTypes: string[];
  }>({ parties: [], inventory: [], expenseTypes: [] });

  // --- 2. FETCH CONTEXT ON OPEN ---
  useEffect(() => {
      if(isOpen) {
          const fetchContext = async () => {
              try {
                  const [pSnap, iSnap] = await Promise.all([
                      ApiService.getAll(user.uid, 'parties'),
                      ApiService.getAll(user.uid, 'inventory')
                  ]);
                  setDbLists({
                      parties: pSnap.docs.map(d => d.data()),
                      inventory: iSnap.docs.map(d => d.data()),
                      expenseTypes: appSettings?.custom_lists?.expense_types || []
                  });
              } catch (e) {
                  console.error("Context fetch failed", e);
              }
          };
          fetchContext();
          
          // Reset
          setScannedData(null);
          setInput('');
          setFile(null);
          setError('');
      }
  }, [isOpen, user, appSettings]);

  // --- 3. ENRICHMENT LOGIC (Auto-Fill) ---
  const enrichEntry = (entry: any) => {
      // Clone to avoid mutation issues
      const enriched = { ...entry };

      // A. Party Details (Phone, GST, Address)
      if (enriched.party_name) {
          const match = dbLists.parties.find(p => (p.name || '').toLowerCase() === enriched.party_name.toLowerCase());
          if (match) {
              enriched.party_name = match.name; // Use DB casing
              enriched.gstin = match.gstin;
              enriched.contact = match.contact; // For parties
              enriched.phone = match.contact;   // For transactions
              enriched.address = match.address;
              
              // Auto-fill Paid By/To based on context
              if (enriched.type === 'sell') enriched.paid_by = match.name;
              if (enriched.type === 'purchase') enriched.paid_to = match.name;
          }
      }

      // B. Inventory Details (Rate, HSN, Tax)
      if (enriched.items && Array.isArray(enriched.items)) {
          enriched.items = enriched.items.map((item: any) => {
              const match = dbLists.inventory.find(i => (i.name || '').toLowerCase() === (item.item_name || '').toLowerCase());
              if (match) {
                  const isSell = enriched.type === 'sell';
                  const dbRate = isSell ? match.sale_rate : match.purchase_rate;
                  
                  // Use DB data if AI didn't provide specific values, or to override
                  const newItem = {
                      ...item,
                      item_name: match.name, // Correct casing
                      hsn_code: match.hsn_code || '',
                      gst_percent: match.gst_percent || '',
                      unit: match.unit || 'Pcs',
                      price_type: match.price_type || 'exclusive',
                      rate: Number(item.rate) || Number(dbRate) || 0
                  };

                  // Auto-calculate Total if missing or if we just found the rate
                  if (!newItem.total || (newItem.quantity && newItem.rate)) {
                      const qty = Number(newItem.quantity) || 0;
                      const rate = Number(newItem.rate) || 0;
                      const gst = Number(newItem.gst_percent) || 0;
                      
                      if (newItem.price_type === 'inclusive') {
                          newItem.total = qty * rate;
                      } else {
                          newItem.total = (qty * rate) * (1 + gst / 100);
                      }
                  }
                  return newItem;
              }
              return item;
          });

          // Recalculate Grand Total based on enriched items
          if (enriched.items.length > 0) {
              enriched.total_amount = enriched.items.reduce((sum: number, i: any) => sum + (Number(i.total) || 0), 0);
          }
      }

      return enriched;
  };

  const handleProcess = async () => {
      if (!input.trim() && !file) return;
      setLoading(true);
      setError('');
      haptic.medium();
      
      try {
          // Prepare Context for AI
          const aiContext = {
              customers: dbLists.parties.filter(p => p.role === 'customer').map(p => p.name),
              suppliers: dbLists.parties.filter(p => p.role === 'supplier').map(p => p.name),
              items: dbLists.inventory.map(i => i.name),
              expenseTypes: dbLists.expenseTypes
          };

          // Call AI with Context
          const commands = await GeminiService.processInput(input, file, aiContext);
          
          if (!commands || commands.length === 0) {
              throw new Error("Could not understand command.");
          }

          // Hydrate/Enrich the data
          const enrichedCommands = commands.map(cmd => enrichEntry(cmd));

          setScannedData(enrichedCommands);
          haptic.success();
      } catch (e: any) {
          console.error(e);
          haptic.error();
          setError(e.message || "Processing failed");
      } finally {
          setLoading(false);
      }
  };

  const handleSaveAll = async () => {
      if(!scannedData || scannedData.length === 0) return;
      setLoading(true);
      
      try {
          let count = 0;
          for (const cmd of scannedData) {
              const { collection, ...data } = cmd;
              if (collection) {
                  await ApiService.add(user.uid, collection, { 
                      ...data, 
                      created_at: new Date().toISOString() 
                  });
                  count++;
              }
          }
          
          showToast(`${count} Actions Saved`, 'success');
          haptic.success();
          if (onSuccess) onSuccess();
          onClose();
      } catch (e: any) {
          console.error(e);
          showToast("Save failed", "error");
      } finally {
          setLoading(false);
      }
  };

  const handleDeleteItem = (index: number) => {
      if(!scannedData) return;
      const newData = scannedData.filter((_, i) => i !== index);
      setScannedData(newData.length > 0 ? newData : null);
  };

  const handleEditItem = (index: number) => {
      setEditIndex(index);
      setShowEditModal(true);
  };

  const handleLocalUpdate = (updatedData: any) => {
      if(scannedData && editIndex !== null) {
          const newData = [...scannedData];
          newData[editIndex] = updatedData;
          setScannedData(newData);
      }
      setShowEditModal(false);
      setEditIndex(null);
  };

  const getModalType = (item: any) => {
      if (!item) return 'sales';
      if (item.collection === 'ledger_entries') return item.type === 'sell' ? 'sales' : 'purchases';
      if (item.collection === 'transactions') return 'transactions';
      if (item.collection === 'inventory') return 'inventory';
      if (item.collection === 'expenses') return 'expenses';
      if (item.collection === 'vehicles') return 'vehicles';
      if (item.collection === 'parties') return 'parties';
      return 'sales';
  };

  if (!isOpen) return null;

  return (
    <>
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="command-modal-root w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl border border-white/10 flex flex-col max-h-[90vh]" style={{background:"var(--app-bg)"}}>
                
                {/* Header */}
                <div className="p-4 border-b border-white/08 flex justify-between items-center" style={{background:"rgba(255,255,255,0.03)"}}>
                    <div className="flex items-center gap-2">
                        <div className="p-2 rounded-lg bg-[rgba(139,92,246,0.18)] text-violet-400">
                            <Sparkles size={18} />
                        </div>
                        <div>
                            <h2 className="font-bold text-lg ">AI Command Center</h2>
                            <p className="text-xs text-[rgba(148,163,184,0.5)]">
                                {scannedData ? "Review & Confirm Entries" : "Type, or Upload Invoice/Audio"}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-200 hover:bg-[rgba(255,255,255,0.08)] rounded-full text-[rgba(240,244,255,0.95)]"><X size={20}/></button>
                </div>

                {error && (
                    <div className="bg-[rgba(239,68,68,0.12)] p-3 flex gap-2 items-center text-[#f87171] text-xs font-bold px-6">
                        <AlertTriangle size={14}/> {error}
                    </div>
                )}

                <div className="p-4 flex-1 overflow-y-auto min-h-[300px]" style={{background:"var(--app-bg)"}}>
                    {scannedData ? (
                        <div className="space-y-3">
                            <div className="bg-[rgba(16,185,129,0.10)] p-3 rounded-xl flex items-center gap-2 text-[#34d399] text-sm font-bold border border-[rgba(16,185,129,0.2)]">
                                <CheckCircle2 size={18} />
                                {scannedData.length} Entries Extracted. Review below.
                            </div>

                            {scannedData.map((item, idx) => (
                                <div key={idx} className="bg-[rgba(255,255,255,0.06)] p-4 rounded-xl border border-white/12 flex justify-between items-center group hover:border-violet-400/30 transition-all">
                                    <div className="flex items-center gap-3">
                                        <div className={`p-2.5 rounded-xl shrink-0 ${item.type === 'sell' || item.type === 'received' ? 'bg-[rgba(16,185,129,0.15)] text-[#34d399]' : 'bg-[rgba(239,68,68,0.12)] text-[#f87171]'}`}>
                                            {item.type === 'sell' ? <Package size={18}/> : <ArrowRight size={18}/>}
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-[10px] font-black uppercase border border-white/15 px-2 py-0.5 rounded tracking-wider">
                                                    {item.collection?.replace('_', ' ') || 'Unknown'}
                                                </span>
                                                {(item.total_amount > 0 || item.amount > 0) && (
                                                    <span className="text-sm font-bold ">
                                                        ₹{item.total_amount || item.amount}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-sm font-medium text-[rgba(203,213,225,0.75)]">
                                                {item.party_name || item.name || item.vehicle_number || item.category || 'New Entry'}
                                            </div>
                                            {item.items && (
                                                <div className="text-xs text-[rgba(148,163,184,0.45)] mt-1">
                                                    {item.items.length} Items: {item.items.map((i:any) => i.item_name).join(', ')}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <button 
                                            onClick={() => handleEditItem(idx)}
                                            className="p-2 bg-[rgba(59,130,246,0.12)] text-[#60a5fa] rounded-lg hover:bg-[rgba(59,130,246,0.2)] transition-colors"
                                            title="Edit & Verify"
                                        >
                                            <Edit2 size={16} />
                                        </button>
                                        <button 
                                            onClick={() => handleDeleteItem(idx)}
                                            className="p-2 bg-[rgba(239,68,68,0.12)] text-[#f87171] rounded-lg hover:bg-[rgba(239,68,68,0.2)] transition-colors"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <textarea 
                                className="w-full h-48 p-4 border border-white/12 bg-[rgba(255,255,255,0.05)] rounded-xl resize-none outline-none focus:ring-2 focus:ring-blue-500 font-medium text-sm transition-all"
                                placeholder="e.g. 'Sold 50 cement bags to Rahul for 15000' or 'Paid 500 for Tea'"
                                value={input}
                                onChange={e => setInput(e.target.value)}
                            />
                            
                            <label className="flex items-center justify-center gap-2 w-full p-6 border-2 border-dashed border-white/10 rounded-xl cursor-pointer hover:bg-[rgba(255,255,255,0.08)] transition-colors">
                                <input type="file" className="hidden" accept="image/*,audio/*" onChange={e => setFile(e.target.files?.[0] || null)} />
                                <ImageIcon size={24} className="" style={{color:"rgba(148,163,184,0.45)"}} />
                                <span className="text-sm font-bold text-[rgba(148,163,184,0.55)]">
                                    {file ? file.name : "Upload Invoice Image or Audio Note"}
                                </span>
                            </label>
                            
                            <p className="text-center text-[10px] text-[rgba(148,163,184,0.45)]">
                                AI will match names with your saved Customers, Suppliers, and Inventory.
                            </p>
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-white/08  flex gap-3">
                    {scannedData ? (
                        <>
                            <button 
                                onClick={() => setScannedData(null)}
                                className="px-6 py-3 rounded-xl font-bold text-[rgba(148,163,184,0.45)] hover:bg-slate-200 transition-colors"
                            >
                                Back
                            </button>
                            <button 
                                onClick={handleSaveAll}
                                disabled={loading} 
                                className="flex-1 bg-green-600 text-white py-3 rounded-xl font-bold text-base shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2"
                            >
                                {loading ? <Loader2 className="animate-spin" /> : <><CheckCircle2 size={20} /> Confirm Save All</>}
                            </button>
                        </>
                    ) : (
                        <button 
                            onClick={handleProcess} 
                            disabled={loading || (!input && !file)}
                            className="w-full py-4 text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition-all shadow-lg" style={{background:"linear-gradient(135deg,#4f46e5,#7c3aed)"}}
                        >
                            {loading ? <Loader2 size={20} className="animate-spin" /> : <><ArrowRight size={20} /> Process Command</>}
                        </button>
                    )}
                </div>
            </div>
        </div>

        {showEditModal && scannedData && editIndex !== null && (
            <ManualEntryModal 
                isOpen={true}
                onClose={() => setShowEditModal(false)}
                // @ts-ignore
                type={getModalType(scannedData[editIndex])}
                user={user}
                appSettings={appSettings || {} as AppSettings}
                initialData={scannedData[editIndex]}
                onLocalSave={handleLocalUpdate} 
            />
        )}
    </>
  );
};

export default CommandModal;






