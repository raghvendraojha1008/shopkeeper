import React, { useState, useEffect } from 'react';
import { X, User, Phone, MapPin, Calendar, DollarSign, FileText, Save, UserX, UserCheck } from 'lucide-react';
import { StaffMember, SalaryType } from '../../types/models';
import { useCreateStaff, useUpdateStaff, useDeactivateStaff } from '../../hooks/useStaff';
import { useUI } from '../../context/UIContext';
import { haptic } from '../../utils/haptics';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  uid: string;
  createdBy: string;
  initialData?: StaffMember | null;
}

const SALARY_TYPES: { value: SalaryType; label: string }[] = [
  { value: 'monthly',  label: 'Monthly' },
  { value: 'daily',    label: 'Daily'   },
  { value: 'weekly',   label: 'Weekly'  },
  { value: 'contract', label: 'Contract'},
];

const FIELD = 'block text-xs font-bold mb-1 text-[var(--text-muted)]';
const INPUT = 'w-full border border-white/10 bg-[var(--rgba-white-05)] rounded-xl p-2.5 text-sm text-[var(--text-secondary)] outline-none focus:ring-2 focus:ring-violet-500 placeholder-[rgba(148,163,184,0.3)]';

export default function StaffFormModal({ isOpen, onClose, uid, createdBy, initialData }: Props) {
  const { showToast } = useUI();
  const isEdit = !!initialData?.id;

  const [form, setForm] = useState<Omit<StaffMember, 'id' | 'staff_code' | 'created_at' | 'updated_at' | 'created_by'>>({
    name: '', phone: '', address: '', joining_date: '', monthly_salary: undefined,
    salary_type: 'monthly', status: 'active', notes: '',
  });
  const [loading, setLoading] = useState(false);

  const createStaff   = useCreateStaff(uid);
  const updateStaff   = useUpdateStaff(uid);
  const deactivate    = useDeactivateStaff(uid);

  useEffect(() => {
    if (!isOpen) return;
    if (initialData) {
      setForm({
        name:           initialData.name           || '',
        phone:          initialData.phone          || '',
        address:        initialData.address        || '',
        joining_date:   initialData.joining_date   || '',
        monthly_salary: initialData.monthly_salary,
        salary_type:    initialData.salary_type    || 'monthly',
        status:         initialData.status         || 'active',
        notes:          initialData.notes          || '',
      });
    } else {
      setForm({ name: '', phone: '', address: '', joining_date: '', monthly_salary: undefined, salary_type: 'monthly', status: 'active', notes: '' });
    }
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  const set = (k: keyof typeof form, v: any) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) { showToast('Name is required', 'error'); return; }
    setLoading(true);
    try {
      if (isEdit && initialData?.id) {
        await updateStaff.mutateAsync({ staffId: initialData.id, data: { ...form, monthly_salary: form.monthly_salary ? Number(form.monthly_salary) : undefined }, updatedBy: createdBy });
        showToast('Staff updated', 'success');
      } else {
        await createStaff.mutateAsync({ data: { ...form, monthly_salary: form.monthly_salary ? Number(form.monthly_salary) : undefined }, createdBy });
        showToast('Staff added', 'success');
      }
      haptic.success();
      onClose();
    } catch {
      showToast('Save failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivate = async () => {
    if (!initialData?.id) return;
    const newStatus = initialData.status === 'active' ? 'inactive' : 'active';
    setLoading(true);
    try {
      await updateStaff.mutateAsync({ staffId: initialData.id, data: { status: newStatus }, updatedBy: createdBy });
      showToast(newStatus === 'active' ? 'Staff reactivated' : 'Staff deactivated', 'info');
      haptic.success();
      onClose();
    } catch {
      showToast('Failed', 'error');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[70] flex justify-center items-end backdrop-blur-md">
      <div className="w-full max-w-2xl rounded-t-3xl shadow-2xl border border-white/10 flex flex-col"
        style={{ background: 'var(--app-bg)', maxHeight: '90dvh' }}>

        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/8">
          <div>
            <h2 className="font-black text-base text-[var(--text-primary)]">{isEdit ? 'Edit Staff' : 'Add Staff Member'}</h2>
            {initialData?.staff_code && <p className="text-app-sm text-[var(--text-muted)] font-mono">{initialData.staff_code}</p>}
          </div>
          <button onClick={onClose} className="p-2 rounded-xl transition-all active:scale-90"
            style={{ background: 'var(--rgba-white-07)', border: '1px solid var(--glass-border)' }}>
            <X size={18} className="text-[var(--text-muted)]" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4" style={{ WebkitOverflowScrolling: 'touch' }}>

          {/* Name */}
          <div>
            <label className={FIELD}><User size={11} className="inline mr-1" />Name *</label>
            <input className={INPUT} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Staff name" />
          </div>

          {/* Phone + Joining date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={FIELD}><Phone size={11} className="inline mr-1" />Phone</label>
              <input className={INPUT} value={form.phone || ''} onChange={e => set('phone', e.target.value)} placeholder="Mobile number" type="tel" />
            </div>
            <div>
              <label className={FIELD}><Calendar size={11} className="inline mr-1" />Joining Date</label>
              <input className={INPUT} type="date" value={form.joining_date || ''} onChange={e => set('joining_date', e.target.value)} />
            </div>
          </div>

          {/* Address */}
          <div>
            <label className={FIELD}><MapPin size={11} className="inline mr-1" />Address</label>
            <input className={INPUT} value={form.address || ''} onChange={e => set('address', e.target.value)} placeholder="Optional" />
          </div>

          {/* Salary */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={FIELD}><DollarSign size={11} className="inline mr-1" />Monthly Salary (₹)</label>
              <input className={INPUT} type="number" value={form.monthly_salary ?? ''} onChange={e => set('monthly_salary', e.target.value === '' ? undefined : Number(e.target.value))} placeholder="e.g. 15000" />
            </div>
            <div>
              <label className={FIELD}>Salary Type</label>
              <select className={INPUT} value={form.salary_type} onChange={e => set('salary_type', e.target.value as SalaryType)}>
                {SALARY_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className={FIELD}><FileText size={11} className="inline mr-1" />Notes</label>
            <textarea className={INPUT + ' resize-none'} rows={2} value={form.notes || ''} onChange={e => set('notes', e.target.value)} placeholder="Optional" />
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-4 border-t border-white/8 space-y-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 16px)' }}>
          {isEdit && (
            <button onClick={handleDeactivate} disabled={loading}
              className="w-full py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-95"
              style={{ background: 'var(--col-danger-15)', border: '1px solid var(--col-danger-25)', color: "var(--col-danger)" }}>
              {initialData?.status === 'active' ? <><UserX size={16}/>Deactivate Staff</> : <><UserCheck size={16}/>Reactivate Staff</>}
            </button>
          )}
          <button onClick={handleSave} disabled={loading || !form.name.trim()}
            className="w-full py-3.5 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', color: 'white' }}>
            {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={16}/>}
            {loading ? 'Saving…' : (isEdit ? 'Save Changes' : 'Add Staff Member')}
          </button>
        </div>
      </div>
    </div>
  );
}
