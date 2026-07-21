import React, { useState, useMemo, useCallback } from 'react';
import { User } from 'firebase/auth';
import { ArrowLeft, Plus, Wrench, Edit2, Trash2, Search, X, ChevronRight } from 'lucide-react';
import ServiceDetailView from './ServiceDetailView';
import { ApiService } from '../../services/api';
import { TrashService } from '../../services/trash';
import { useUI } from '../../context/UIContext';
import { useData } from '../../context/DataContext';
import { useRole } from '../../context/RoleContext';
import { ServiceItem } from '../../types/models';
import { generatePrefixedID, seedCountersFromFirestore } from '../../utils/idGenerator';
import { useSoftDelete } from '../common/UndoSnackbar';

interface ServicesViewProps {
  user: User;
  onBack: () => void;
}

const UNIT_OPTIONS = ['Hrs', 'Days', 'Visit', 'Job', 'Kg', 'Pcs', 'Ltr', 'Mtr', 'Trip', 'Set', 'Fixed'];

const EMPTY_FORM = { name: '', unit: 'Hrs', rate_per_unit: '', category: '', notes: '' };

const ServicesView: React.FC<ServicesViewProps> = ({ user, onBack }) => {
  const { showToast } = useUI();
  const { useServices } = useData();
  const { isAdmin } = useRole();

  const { data: servicesRaw, isLoading, setData: setServicesCache } = useServices(user.uid);
  const services = useMemo(() => servicesRaw || [], [servicesRaw]);

  const [selectedService, setSelectedService] = useState<ServiceItem | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<typeof EMPTY_FORM>({ ...EMPTY_FORM });

  const { scheduleDelete } = useSoftDelete();

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return services;
    return services.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.category     || '').toLowerCase().includes(q) ||
      (s.service_code || '').toLowerCase().includes(q) ||
      (s.notes        || '').toLowerCase().includes(q) ||
      (s.unit         || '').toLowerCase().includes(q) ||
      String(s.rate_per_unit ?? '').includes(q)
    );
  }, [services, searchTerm]);

  const openAdd = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  };

  const openEdit = (s: ServiceItem) => {
    setEditingId(s.id || null);
    setForm({
      name: s.name,
      unit: s.unit,
      rate_per_unit: String(s.rate_per_unit),
      category: s.category || '',
      notes: s.notes || '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { showToast('Service name is required', 'error'); return; }
    if (!form.rate_per_unit || Number(form.rate_per_unit) < 0) { showToast('Enter a valid rate', 'error'); return; }
    setSaving(true);
    try {
      const payload: Partial<ServiceItem> = {
        name: form.name.trim(),
        unit: form.unit,
        rate_per_unit: Number(form.rate_per_unit),
        category: form.category.trim(),
        notes: form.notes.trim(),
      };

      if (editingId) {
        await ApiService.update(user.uid, 'services', editingId, payload);
        setServicesCache(old => old.map(s => s.id === editingId ? { ...s, ...payload } : s));
        showToast('Service updated', 'success');
      } else {
        const snap = await ApiService.getAll(user.uid, 'services');
        seedCountersFromFirestore(snap.docs.map((d: any) => d.data().service_code), 'services');
        const service_code = generatePrefixedID('services');
        const full = { ...payload, service_code, created_at: new Date().toISOString() } as ServiceItem;
        const doc = await ApiService.add(user.uid, 'services', full);
        const newItem: ServiceItem = { ...full, id: doc.id };
        setServicesCache(old => [...old, newItem].sort((a, b) => a.name.localeCompare(b.name)));
        showToast('Service added', 'success');
      }
      setShowForm(false);
    } catch (e: any) {
      showToast(e.message || 'Failed to save service', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = useCallback((s: ServiceItem) => {
    scheduleDelete({
      id: s.id!,
      collection: 'services',
      itemName: s.name,
      onOptimistic: () => setServicesCache(p => p.filter(sv => sv.id !== s.id)),
      onRestore: () => setServicesCache(p => [...p, s].sort((a, b) => a.name.localeCompare(b.name))),
      onCommit: async () => { await TrashService.moveToTrash(user.uid, 'services', s.id!); },
    });
  }, [scheduleDelete, setServicesCache, user.uid]);

  if (selectedService) {
    return (
      <ServiceDetailView
        user={user}
        service={selectedService}
        onBack={() => setSelectedService(null)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-6 pb-4 flex-shrink-0">
        <button onClick={onBack} className="p-2.5 rounded-full active:scale-95 transition-all"
          style={{ background: 'var(--rgba-white-08)', border: '1px solid var(--glass-border)' }}>
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-black text-lg text-[var(--text-primary)]">Services</h1>
          <p className="text-app-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
            {services.length} service{services.length !== 1 ? 's' : ''} defined
          </p>
        </div>
        {isAdmin && (
          <button onClick={openAdd}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black active:scale-95 transition-all"
            style={{ background: 'linear-gradient(135deg,rgba(168,85,247,0.85),var(--col-violet-75))', color: 'white', border: '1px solid rgba(168,85,247,0.4)' }}>
            <Plus size={14} /> Add
          </button>
        )}
      </div>

      {/* Search */}
      <div className="px-4 pb-3 flex-shrink-0">
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
          style={{ background: 'var(--rgba-white-06)', border: '1px solid var(--glass-border)' }}>
          <Search size={14} style={{ color: 'var(--text-muted)' }} />
          <input className="flex-1 bg-transparent text-sm font-semibold outline-none"
            style={{ color: 'var(--text-primary)' }}
            placeholder="Search services…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)} />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')}>
              <X size={14} style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-2.5">
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <div className="w-7 h-7 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <div className="w-16 h-16 rounded-[22px] flex items-center justify-center"
              style={{ background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.2)' }}>
              <Wrench size={28} style={{ color: "var(--col-purple)" }} />
            </div>
            <div>
              <p className="font-black text-base text-[var(--text-secondary)]">
                {searchTerm ? 'No results' : 'No services yet'}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {searchTerm ? 'Try a different keyword' : 'Add services like Labour, Transport, Installation…'}
              </p>
            </div>
            {!searchTerm && isAdmin && (
              <button onClick={openAdd}
                className="px-5 py-2.5 rounded-xl text-sm font-black active:scale-95 transition-all"
                style={{ background: 'linear-gradient(135deg,rgba(168,85,247,0.8),var(--col-violet-70))', color: 'white', border: '1px solid rgba(168,85,247,0.4)' }}>
                + Add First Service
              </button>
            )}
          </div>
        )}

        {filtered.map(s => (
          <div key={s.id}
            onClick={() => setSelectedService(s)}
            className="relative rounded-[18px] p-3.5 transition-all cursor-pointer active:scale-[0.98]"
            style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)' }}>
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-[14px] flex-shrink-0 mt-0.5"
                style={{ background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.2)' }}>
                <Wrench size={15} style={{ color: "var(--col-purple)" }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-black text-sm text-[var(--text-primary)]">{s.name}</span>
                  {s.service_code && (
                    <span className="px-1.5 py-0.5 rounded-md text-app-xs font-black tracking-wide"
                      style={{ background: 'rgba(168,85,247,0.15)', color: "var(--col-purple-light)", border: '1px solid rgba(168,85,247,0.25)' }}>
                      {s.service_code}
                    </span>
                  )}
                  {s.category && (
                    <span className="px-1.5 py-0.5 rounded-md text-app-xs font-semibold"
                      style={{ background: 'var(--rgba-white-06)', color: 'var(--text-muted)' }}>
                      {s.category}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="font-black text-base" style={{ color: "var(--col-purple)" }}>
                    ₹{Number(s.rate_per_unit).toLocaleString('en-IN')}
                    <span className="text-app-sm font-semibold ml-1" style={{ color: 'rgba(168,85,247,0.6)' }}>/ {s.unit}</span>
                  </span>
                </div>
                {s.notes && (
                  <p className="text-app-sm mt-1 truncate" style={{ color: 'var(--text-muted)' }}>{s.notes}</p>
                )}
              </div>
              {isAdmin && (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={e => { e.stopPropagation(); openEdit(s); }}
                    className="p-2 rounded-xl active:scale-90 transition-all"
                    style={{ background: 'var(--rgba-white-06)', border: '1px solid var(--glass-border)' }}>
                    <Edit2 size={13} style={{ color: 'var(--text-muted)' }} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); handleDelete(s); }}
                    className="p-2 rounded-xl active:scale-90 transition-all"
                    style={{ background: 'var(--col-danger-08)', border: '1px solid var(--col-danger-15)' }}>
                    <Trash2 size={13} style={{ color: "var(--col-danger)" }} />
                  </button>
                  <ChevronRight size={14} style={{ color: 'rgba(168,85,247,0.4)' }} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add / Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: 'var(--rgba-black-65)', backdropFilter: 'blur(6px)' }}>
          <div className="w-full max-w-md rounded-t-3xl p-5 pb-8 space-y-4 animate-in slide-in-from-bottom duration-300"
            style={{ background: 'var(--modal-sheet-bg)', border: '1px solid var(--glass-border)', borderBottom: 'none' }}>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl" style={{ background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.2)' }}>
                  <Wrench size={15} style={{ color: "var(--col-purple)" }} />
                </div>
                <div>
                  <h3 className="font-black text-sm text-[var(--text-primary)]">
                    {editingId ? 'Edit Service' : 'Add Service'}
                  </h3>
                  <p className="text-app-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
                    {editingId ? 'Update service details' : 'Add to your service master list'}
                  </p>
                </div>
              </div>
              <button onClick={() => setShowForm(false)} className="p-2 rounded-full"
                style={{ background: 'var(--rgba-white-06)' }}>
                <X size={16} style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>

            {/* Name */}
            <div>
              <label className="block text-app-sm font-bold uppercase tracking-wide mb-1.5"
                style={{ color: 'var(--text-muted)' }}>Service Name *</label>
              <input type="text" autoFocus
                className="w-full rounded-xl p-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-purple-500"
                style={{ background: 'var(--rgba-white-06)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
                placeholder="e.g. Labour, Transport, Installation…"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>

            {/* Category */}
            <div>
              <label className="block text-app-sm font-bold uppercase tracking-wide mb-1.5"
                style={{ color: 'var(--text-muted)' }}>Category (Optional)</label>
              <input type="text"
                className="w-full rounded-xl p-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-purple-500"
                style={{ background: 'var(--rgba-white-06)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
                placeholder="e.g. Logistics, Electrical, Civil…"
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
            </div>

            {/* Unit + Rate */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-app-sm font-bold uppercase tracking-wide mb-1.5"
                  style={{ color: 'var(--text-muted)' }}>Unit</label>
                <select
                  className="w-full rounded-xl p-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-purple-500"
                  style={{ background: 'var(--rgba-white-06)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
                  value={form.unit}
                  onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
                  {UNIT_OPTIONS.map(u => <option key={u} value={u} style={{ background: "var(--col-bg-darkest)" }}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-app-sm font-bold uppercase tracking-wide mb-1.5"
                  style={{ color: 'var(--text-muted)' }}>Rate per Unit (₹) *</label>
                <input type="number" inputMode="decimal"
                  className="w-full rounded-xl p-2.5 text-sm font-black outline-none focus:ring-2 focus:ring-purple-500"
                  style={{ background: 'var(--rgba-white-06)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
                  placeholder="0"
                  value={form.rate_per_unit}
                  onChange={e => setForm(f => ({ ...f, rate_per_unit: e.target.value }))} />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-app-sm font-bold uppercase tracking-wide mb-1.5"
                style={{ color: 'var(--text-muted)' }}>Notes (Optional)</label>
              <input type="text"
                className="w-full rounded-xl p-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-purple-500"
                style={{ background: 'var(--rgba-white-06)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
                placeholder="Any additional details…"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            <button onClick={handleSave} disabled={saving}
              className="w-full py-3 rounded-xl font-black text-sm transition-all active:scale-98 disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg,rgba(168,85,247,0.85),var(--col-violet-75))', color: 'white', border: '1px solid rgba(168,85,247,0.4)' }}>
              {saving ? 'Saving…' : editingId ? 'Update Service' : 'Add Service'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ServicesView;
