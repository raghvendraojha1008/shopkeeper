import React, { useState, useMemo, useCallback } from 'react';
import { User } from 'firebase/auth';
import { 
  ArrowLeft, Plus, Trash2, Search, Hash, Calendar, Package, 
  AlertTriangle, X, Download
} from 'lucide-react';
import { ApiService } from '../../services/api';
import { TrashService } from '../../services/trash';
import { exportService } from '../../services/export';
import { useUI } from '../../context/UIContext';
import { useData } from '../../context/DataContext';
import { WasteEntry } from '../../types/models';
import { generatePrefixedID } from '../../utils/idGenerator';
import { formatDate, formatCurrency } from '../../utils/helpers';

interface WasteViewProps {
  user: User;
  onBack: () => void;
}

const WasteView: React.FC<WasteViewProps> = ({ user, onBack }) => {
  const { confirm, showToast } = useUI();
  const { useWaste, useInventory } = useData();
  const { data: wasteEntries, isLoading, refetch, setData } = useWaste(user.uid);
  const { data: inventoryItems, refetch: refetchInventory } = useInventory(user.uid);

  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  // Add form state
  const [formItemId, setFormItemId] = useState('');
  const [formItemName, setFormItemName] = useState('');
  const [formQuantity, setFormQuantity] = useState('');
  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0]);
  const [formReason, setFormReason] = useState<'Wasted' | 'Self-Used'>('Wasted');
  
  const [formNote, setFormNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(() =>
    wasteEntries.filter(w =>
      w.item_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      w.prefixed_id?.toLowerCase().includes(searchTerm.toLowerCase())
    ),
  [wasteEntries, searchTerm]);

  const totalWasteQty = useMemo(() =>
    filtered.reduce((sum, w) => sum + (Number(w.quantity) || 0), 0),
  [filtered]);

  const handleSelectItem = (itemId: string) => {
    const item = inventoryItems.find(i => i.id === itemId);
    if (item) {
      setFormItemId(item.id || '');
      setFormItemName(item.name);
    }
  };

  const handleAdd = useCallback(async () => {
    if (!formItemName || !formQuantity || Number(formQuantity) <= 0) {
      return showToast('Fill all fields correctly', 'error');
    }

    setSubmitting(true);
    const prefixed_id = generatePrefixedID('waste');
    const newEntry: Omit<WasteEntry, 'id'> = {
      item_id: formItemId,
      item_name: formItemName,
      quantity: Number(formQuantity),
      date: formDate,
      reason: formReason,
      note: formNote,
      prefixed_id,
      created_at: new Date().toISOString(),
    };

    // Optimistic UI: add to local list immediately
    const tempId = `temp_${Date.now()}`;
    setData(old => [{ id: tempId, ...newEntry }, ...old]);

    try {
      await ApiService.add(user.uid, 'waste_entries', newEntry);
      // Also update inventory stock optimistically
      if (formItemId) {
        const item = inventoryItems.find(i => i.id === formItemId);
        if (item) {
          const newStock = Math.max(0, (item.current_stock || 0) - Number(formQuantity));
          await ApiService.update(user.uid, 'inventory', formItemId, { current_stock: newStock });
          refetchInventory();
        }
      }
      refetch();
      showToast(`Waste entry ${prefixed_id} added`, 'success');
      // Reset form
      setFormItemId('');
      setFormItemName('');
      setFormQuantity('');
      setFormReason('Wasted');
      setFormNote('');
      setShowAddForm(false);
    } catch (err) {
      // Revert optimistic update
      setData(old => old.filter(w => w.id !== tempId));
      showToast('Failed to add waste entry', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [formItemId, formItemName, formQuantity, formDate, formReason, user.uid, inventoryItems, setData, refetch, refetchInventory, showToast]);

  const handleDelete = useCallback(async (id: string) => {
    if (await confirm('Delete Waste Entry?', 'Moves to Recycle Bin.')) {
      const snapshot = wasteEntries;
      setData(old => old.filter(w => w.id !== id));
      showToast('Moved to Trash', 'success');
      try {
        await TrashService.moveToTrash(user.uid, 'waste_entries', id);
      } catch {
        setData(() => snapshot);
        showToast('Delete failed, rolled back', 'error');
      }
    }
  }, [wasteEntries, user.uid, confirm, showToast, setData]);

  const handleExport = async () => {
    if (filtered.length === 0) return showToast('No data to export', 'error');
    const data = filtered.map(w => ({
      ID: w.prefixed_id || '-',
      Item: w.item_name,
      Quantity: w.quantity,
      Date: w.date,
      Reason: w.reason,
    }));
    await exportService.exportToCSV(data, Object.keys(data[0]), 'Waste_Entries.csv');
    showToast('Waste data exported', 'success');
  };

  return (
    <div className="h-full overflow-y-auto" style={{background: 'var(--app-bg)'}}>
      {/* STICKY HEADER */}
      <div className="sticky top-0 z-30 px-4 pb-2" style={{paddingTop: '16px', background:"rgba(var(--app-bg-rgb),0.92)", backdropFilter:"blur(20px)"}}>
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="p-2 rounded-full transition-all active:scale-90" style={{background:"rgba(0,0,0,0.06)", color:"#475569"}}>
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-lg font-black tracking-tight">Waste / Self-Use</h1>
            <p className="text-[10px] font-bold uppercase text-[rgba(148,163,184,0.45)]">{filtered.length} Entries</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className="p-2 rounded-xl transition-all active:scale-95 text-[#60a5fa]" style={{background:"rgba(59,130,246,0.12)",border:"1px solid rgba(59,130,246,0.2)"}}>
            <Download size={16} />
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            className="text-white p-2 rounded-xl shadow-lg transition-all active:scale-95" style={{background:"linear-gradient(135deg,#4f46e5,#7c3aed)"}}
          >
            <Plus size={16} />
          </button>
        </div>
      </div>
      </div>

      {/* SCROLLABLE CONTENT */}
      <div className="px-4">

      {/* SUMMARY */}
      <div className="bg-[rgba(245,158,11,0.08)] p-3 rounded-2xl border border-[rgba(245,158,11,0.2)] mb-3 flex items-center gap-3">
        <div className="p-2 bg-[rgba(245,158,11,0.15)] rounded-xl">
          <AlertTriangle size={18} className="text-amber-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold text-amber-400 uppercase">Total Wasted / Self-Used</div>
          <div className="font-black text-lg text-[#fbbf24] tabular-nums">{totalWasteQty} units</div>
        </div>
      </div>

      {/* SEARCH */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
        <input
          className="w-full pl-9 p-2.5 text-sm font-bold outline-none text-[rgba(226,232,240,0.88)] placeholder-slate-400" style={{background:"rgba(255,255,255,0.06)", border:"1.5px solid rgba(0,0,0,0.06)", borderRadius:"16px", boxShadow:"0 2px 8px rgba(0,0,0,0.04)"}}
          placeholder="Search waste entries..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>

      {/* LIST */}
      <div className="pb-20 space-y-2.5">
        {isLoading ? (
          <div className="text-center py-10 text-[rgba(148,163,184,0.45)]">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-[rgba(148,163,184,0.45)]">
            <AlertTriangle size={32} className="mx-auto mb-2 opacity-30" />
            <p className="font-bold text-sm">No waste entries</p>
            <p className="text-xs">Tap + to add a waste or self-use entry</p>
          </div>
        ) : (
          filtered.map(w => (
            <div
              key={w.id}
              className="p-3 rounded-3xl border border-white/08 relative overflow-hidden group transition-all active:scale-[0.98]"
            >
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-orange-500" />
              <div className="flex justify-between items-start pl-2 overflow-hidden">
                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="flex items-center gap-2 mb-1 overflow-hidden flex-wrap">
                    <h3 className="font-bold text-sm text-[rgba(226,232,240,0.88)] text-[rgba(240,244,255,0.95)] leading-none truncate">
                      {w.item_name}
                    </h3>
                    {/* W-XXX ID Badge */}
                    {w.prefixed_id && (
                      <span className="text-[9px] font-mono bg-[rgba(245,158,11,0.15)] text-amber-400 px-1.5 py-0.5 rounded flex items-center gap-1 flex-shrink-0">
                        <Hash size={9} /> {w.prefixed_id}
                      </span>
                    )}
                    <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded flex-shrink-0 whitespace-nowrap ${
                      w.reason === 'Wasted'
                        ? 'bg-[rgba(239,68,68,0.15)] text-red-400'
                        : 'bg-[rgba(59,130,246,0.15)] text-blue-400'
                    }`}>
                      {w.reason}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-[rgba(148,163,184,0.45)]">
                    <span className="flex items-center gap-1 flex-shrink-0">
                      <Calendar size={10} /> {formatDate(w.date)}
                    </span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0 pl-2 flex items-center gap-2">
                  <div>
                    <div className="font-black text-base text-amber-400 tabular-nums whitespace-nowrap">
                      {w.quantity}
                    </div>
                    <div className="text-[9px] text-slate-400 font-bold">qty</div>
                  </div>
                  <button
                    onClick={() => handleDelete(w.id!)}
                    className="text-slate-400 hover:text-red-600 p-1.5 bg-[rgba(255,255,255,0.08)] rounded-full shadow-sm hover:shadow transition-colors active:scale-95"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      </div>

      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center" onClick={() => setShowAddForm(false)}>
          <div
            className="w-full max-w-lg rounded-t-3xl p-5 space-y-4 animate-slide-up pb-40 border border-white/10"
            style={{ background: 'rgba(var(--app-bg-rgb),0.97)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h2 className="font-black text-lg ">Add Waste Entry</h2>
              <button onClick={() => setShowAddForm(false)} className="p-2 rounded-full hover:bg-slate-100 hover:bg-[rgba(255,255,255,0.08)] transition-all active:scale-95 ">
                <X size={18} />
              </button>
            </div>

            {/* Item Select */}
            <div>
              <label className="text-[10px] font-bold text-[rgba(148,163,184,0.45)] uppercase mb-1 block">Select Item</label>
              <select
                value={formItemId}
                onChange={e => handleSelectItem(e.target.value)}
                className="w-full p-2.5 bg-slate-50 bg-[rgba(255,255,255,0.06)] border border-white/12 rounded-xl text-sm font-bold text-[rgba(240,244,255,0.95)] outline-none"
              >
                <option value="">-- Choose Item --</option>
                {inventoryItems.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name} (Stock: {item.current_stock} {item.unit})
                  </option>
                ))}
              </select>
              {/* FIX 10: Warn user when no item is selected — stock won't be deducted */}
              {!formItemId && formItemName && (
                <p className="text-[10px] text-amber-400 mt-1 font-bold">
                  ⚠ Item not linked to inventory — stock will not be deducted automatically.
                </p>
              )}
            </div>

            {/* Quantity & Date Row */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-[10px] font-bold text-[rgba(148,163,184,0.45)] uppercase mb-1 block">Quantity</label>
                <input
                  type="number"
                  value={formQuantity}
                  onChange={e => setFormQuantity(e.target.value)}
                  placeholder="0"
                  className="w-full p-2.5 bg-slate-50 bg-[rgba(255,255,255,0.06)] border border-white/12 rounded-xl text-sm font-bold text-[rgba(240,244,255,0.95)] outline-none tabular-nums"
                />
              </div>
              <div className="flex-1">
                <label className="text-[10px] font-bold text-[rgba(148,163,184,0.45)] uppercase mb-1 block">Date</label>
                <input
                  type="date"
                  value={formDate}
                  onChange={e => setFormDate(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 bg-[rgba(255,255,255,0.06)] border border-white/12 rounded-xl text-sm font-bold text-[rgba(240,244,255,0.95)] outline-none"
                />
              </div>
            </div>

            {/* Reason Toggle */}
            <div>
              <label className="text-[10px] font-bold text-[rgba(148,163,184,0.45)] uppercase mb-1 block">Reason</label>
              <div className="flex gap-2">
                {(['Wasted', 'Self-Used'] as const).map(reason => (
                  <button
                    key={reason}
                    onClick={() => setFormReason(reason)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 ${
                      formReason === reason
                        ? reason === 'Wasted'
                          ? 'bg-red-500 text-white'
                          : 'bg-blue-500 text-white'
                        : 'text-slate-400 text-[rgba(148,163,184,0.45)]'
                    }`}
                  >
                    {reason}
                  </button>
                ))}
              </div>
            </div>

            {/* Note Input */}
            <div>
              <label className="text-[10px] font-bold text-[rgba(148,163,184,0.45)] uppercase mb-1 block">Notes</label>
              <textarea
                value={formNote}
                onChange={e => setFormNote(e.target.value)}
                placeholder="Add any additional notes..."
                className="w-full p-2.5 bg-slate-50 bg-[rgba(255,255,255,0.06)] border border-white/12 rounded-xl text-sm font-normal text-[rgba(240,244,255,0.95)] outline-none resize-none"
                rows={3}
              />
            </div>

            {/* Submit */}
            <button
              onClick={handleAdd}
              disabled={submitting}
              className="w-full text-white py-3 rounded-xl font-bold text-sm shadow-lg transition-all active:scale-95 disabled:opacity-50" style={{background:"linear-gradient(135deg,#4f46e5,#7c3aed)"}}
            >
              {submitting ? 'Adding...' : 'Add Waste Entry'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default WasteView;







