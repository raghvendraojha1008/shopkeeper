import React, { useState, useEffect } from 'react';
import { X, Save, IndianRupee, FileText, Hash, CreditCard, Calendar, Tag } from 'lucide-react';
import { StaffTransaction, StaffTxType, StaffMember } from '../../types/models';
import { STAFF_TX_LABELS, EXPENSE_PURPOSES, PAYMENT_MODES } from '../../services/staffService';
import { useAddStaffTransaction } from '../../hooks/useStaff';
import { useUI } from '../../context/UIContext';
import { haptic } from '../../utils/haptics';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  uid: string;
  staff: StaffMember;
  createdBy: string;
  defaultType?: StaffTxType;
}

const TX_GROUPS: { label: string; types: StaffTxType[]; color: string; bg: string }[] = [
  { label: 'Pay',      types: ['SALARY_PAYMENT', 'SALARY_ADVANCE'],      color: "var(--col-success)", bg: 'var(--col-emerald-12)' },
  { label: 'Advance',  types: ['EXPENSE_ADVANCE'],                        color: "var(--col-info)", bg: 'var(--col-info-12)' },
  { label: 'Expense',  types: ['STAFF_EXPENSE'],                          color: "var(--col-danger)", bg: 'var(--col-danger-15)'   },
  { label: 'Collect',  types: ['COLLECTION'],                             color: "var(--col-violet)", bg: 'var(--col-violet-12)' },
  { label: 'Settle',   types: ['SETTLEMENT', 'REIMBURSEMENT'],            color: "var(--col-warning)", bg: 'rgba(251,191,36,0.1)'  },
  { label: 'Adjust',   types: ['ADJUSTMENT'],                             color: "var(--col-slate)", bg: 'var(--text-muted)' },
];

const TYPE_COLOR: Record<StaffTxType, string> = {
  SALARY_PAYMENT: "var(--col-success)", SALARY_ADVANCE: "var(--col-success)", EXPENSE_ADVANCE: "var(--col-info)",
  STAFF_EXPENSE: "var(--col-danger)", COLLECTION: "var(--col-violet)", SETTLEMENT: "var(--col-warning)",
  REIMBURSEMENT: "var(--col-warning)", ADJUSTMENT: "var(--col-slate)",
};

const FIELD = 'block text-xs font-bold mb-1 text-[var(--text-muted)]';
const INPUT = 'w-full border border-white/10 bg-[var(--rgba-white-05)] rounded-xl p-2.5 text-sm text-[var(--text-secondary)] outline-none focus:ring-2 focus:ring-violet-500 placeholder-[rgba(148,163,184,0.3)]';

const needsSalaryMonth  = (t: StaffTxType) => t === 'SALARY_PAYMENT' || t === 'SALARY_ADVANCE';
const needsPurpose      = (t: StaffTxType) => t === 'STAFF_EXPENSE';

export default function StaffTransactionModal({ isOpen, onClose, uid, staff, createdBy, defaultType }: Props) {
  const { showToast } = useUI();
  const addTx = useAddStaffTransaction(uid);

  const [type,         setType]         = useState<StaffTxType>(defaultType || 'SALARY_PAYMENT');
  const [amount,       setAmount]       = useState('');
  const [date,         setDate]         = useState(new Date().toISOString().split('T')[0]);
  const [mode,         setMode]         = useState<string>('Cash');
  const [purpose,      setPurpose]      = useState('');
  const [description,  setDescription]  = useState('');
  const [notes,        setNotes]        = useState('');
  const [reference,    setReference]    = useState('');
  const [salaryMonth,  setSalaryMonth]  = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setType(defaultType || 'SALARY_PAYMENT');
    setAmount(''); setDate(new Date().toISOString().split('T')[0]);
    setMode('Cash'); setPurpose(''); setDescription('');
    setNotes(''); setReference('');
    const d = new Date();
    setSalaryMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }, [isOpen, defaultType]);

  if (!isOpen) return null;

  const color = TYPE_COLOR[type];

  const handleSave = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { showToast('Enter a valid amount', 'error'); return; }
    if (needsSalaryMonth(type) && !salaryMonth) { showToast('Select salary month', 'error'); return; }

    setLoading(true);
    try {
      const tx: Omit<StaffTransaction, 'id' | 'created_at' | 'updated_at'> = {
        staff_id: staff.id!,
        type,
        date,
        amount: amt,
        payment_mode:    mode as any,
        purpose:         purpose || undefined,
        description:     description || undefined,
        notes:           notes || undefined,
        reference_number: reference || undefined,
        salary_month:    needsSalaryMonth(type) ? salaryMonth : undefined,
        created_by:      createdBy,
        deleted:         false,
      };
      await addTx.mutateAsync({ tx, createdBy });
      haptic.success();
      showToast('Transaction recorded', 'success');
      onClose();
    } catch {
      showToast('Save failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[70] flex justify-center items-end backdrop-blur-md">
      <div className="w-full max-w-2xl rounded-t-3xl shadow-2xl border border-white/10 flex flex-col"
        style={{ background: 'var(--app-bg)', maxHeight: '92dvh' }}>

        {/* Header */}
        <div className="shrink-0 px-5 pt-5 pb-3 border-b border-white/8 flex items-center justify-between">
          <div>
            <h2 className="font-black text-base text-[var(--text-primary)]">Record Transaction</h2>
            <p className="text-app-sm font-semibold text-[var(--text-muted)]">{staff.name}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl active:scale-90 transition-all"
            style={{ background: 'var(--rgba-white-07)', border: '1px solid var(--glass-border)' }}>
            <X size={18} className="text-[var(--text-muted)]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4" style={{ WebkitOverflowScrolling: 'touch' }}>

          {/* Type picker */}
          <div>
            <label className={FIELD}>Transaction Type</label>
            <div className="space-y-2">
              {TX_GROUPS.map(grp => (
                <div key={grp.label} className="flex flex-wrap gap-2">
                  {grp.types.map(t => (
                    <button key={t} onClick={() => setType(t)}
                      className="px-3 py-1.5 rounded-xl text-app-md font-black transition-all active:scale-95"
                      style={type === t
                        ? { background: grp.bg, border: `1px solid ${grp.color}`, color: grp.color, boxShadow: `0 0 8px ${grp.color}33` }
                        : { background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                      {STAFF_TX_LABELS[t]}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Amount + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={FIELD}><IndianRupee size={11} className="inline mr-1" />Amount *</label>
              <input className={INPUT} type="number" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0.00" style={{ borderColor: amount ? `${color}44` : undefined }} />
            </div>
            <div>
              <label className={FIELD}><Calendar size={11} className="inline mr-1" />Date</label>
              <input className={INPUT} type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
          </div>

          {/* Salary month (conditional) */}
          {needsSalaryMonth(type) && (
            <div>
              <label className={FIELD}><Calendar size={11} className="inline mr-1" />Salary Month</label>
              <input className={INPUT} type="month" value={salaryMonth} onChange={e => setSalaryMonth(e.target.value)} />
            </div>
          )}

          {/* Expense purpose (conditional) */}
          {needsPurpose(type) && (
            <div>
              <label className={FIELD}><Tag size={11} className="inline mr-1" />Purpose</label>
              <select className={INPUT} value={purpose} onChange={e => setPurpose(e.target.value)}>
                <option value="">Select purpose…</option>
                {EXPENSE_PURPOSES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          )}

          {/* Payment mode */}
          <div>
            <label className={FIELD}><CreditCard size={11} className="inline mr-1" />Payment Mode</label>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_MODES.map(m => (
                <button key={m} onClick={() => setMode(m)}
                  className="px-3 py-1.5 rounded-xl text-app-md font-black transition-all active:scale-95"
                  style={mode === m
                    ? { background: 'var(--col-violet-18)', border: '1px solid var(--col-violet-40)', color: "var(--col-violet)" }
                    : { background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className={FIELD}><FileText size={11} className="inline mr-1" />Description</label>
            <input className={INPUT} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional details" />
          </div>

          {/* Reference + Notes */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={FIELD}><Hash size={11} className="inline mr-1" />Reference No.</label>
              <input className={INPUT} value={reference} onChange={e => setReference(e.target.value)} placeholder="UPI ref, cheque…" />
            </div>
            <div>
              <label className={FIELD}>Notes</label>
              <input className={INPUT} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-4 border-t border-white/8" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 16px)' }}>
          <button onClick={handleSave} disabled={loading || !amount}
            className="w-full py-3.5 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${color}cc, ${color}88)`, color: 'white' }}>
            {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={16} />}
            {loading ? 'Saving…' : `Record ${STAFF_TX_LABELS[type]}`}
          </button>
        </div>
      </div>
    </div>
  );
}
