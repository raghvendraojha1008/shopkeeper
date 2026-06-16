import React, { useState, useEffect } from 'react';
import { X, Save, IndianRupee, FileText, Wallet, AlertCircle, UserCheck } from 'lucide-react';
import { InputField, AutoComplete } from './FormUI';
import { useUI } from '../../../context/UIContext'; // Import UI Context

export const SubPaymentModal = ({ isOpen, onClose, onAdd, defaultData, paymentModes, purposes, maxAmount, isSale, receivedByNames, paidByNames }: any) => {
    const { showToast } = useUI(); // For validation messages
    const [data, setData] = useState<any>({});
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if(isOpen && defaultData) {
            setData({
                date: new Date().toISOString().split('T')[0],
                amount: defaultData.amount || '',
                payment_mode: 'Cash',
                payment_purpose: '', 
                party_name: defaultData.party_name || '',
                address: defaultData.address || '',
                bill_no: defaultData.bill_no || '',
                notes: '',
                received_by: '',
            });
            setError(null);
        }
    }, [isOpen, defaultData]);

    // Live Validation
    const handleAmountChange = (val: string) => {
        const numVal = Number(val);
        setData({ ...data, amount: val });
        
        if (maxAmount && numVal > maxAmount) {
            setError(`Max allowed: ₹${maxAmount.toFixed(2)}`);
        } else {
            setError(null);
        }
    };

    const handleSubmit = () => {
        const numAmount = Number(data.amount);
        
        if(!data.amount || !data.payment_mode) {
             showToast("Please fill amount and mode", "error");
             return;
        }

        if (maxAmount && numAmount > maxAmount) {
            showToast(`Amount cannot exceed ₹${maxAmount.toFixed(2)}`, "error");
            return;
        }

        onAdd(data);
        onClose();
    };

    if(!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-[70] flex justify-center items-center p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl shadow-2xl border border-white/10 flex flex-col animate-in zoom-in-95 duration-200" style={{background:"var(--app-bg)"}}>
                <div className="p-4 border-b border-white/08 flex justify-between items-center  rounded-t-2xl">
                    <h3 className="font-bold text-[rgba(226,232,240,0.88)] text-[rgba(240,244,255,0.95)]">Add Payment</h3>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-slate-200 hover:bg-[rgba(255,255,255,0.08)]"><X size={18}/></button>
                </div>
                
                <div className="p-5 space-y-4">
                    <div className="bg-[rgba(59,130,246,0.08)] p-3 rounded-xl border border-[rgba(59,130,246,0.2)] space-y-2 text-xs">
                        <div className="flex justify-between"><span className="text-slate-500 font-bold">Party:</span><span className="font-bold text-[rgba(240,244,255,0.95)]">{data.party_name}</span></div>
                        <div className="flex justify-between items-center"><span className="text-slate-500 font-bold">Ref #:</span><span className="font-black bg-white bg-[rgba(255,255,255,0.06)] px-2 py-0.5 rounded border border-white/10 text-[rgba(240,244,255,0.95)]">{data.bill_no}</span></div>
                        {maxAmount > 0 && (
                            <div className="flex justify-between items-center mt-2 pt-2 border-t border-white/10">
                                <span className="text-slate-500 font-bold">Pending Balance:</span>
                                <span className="font-black text-red-500">₹{maxAmount.toLocaleString('en-IN', {minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                         <InputField label="Date" field="date" type="date" value={data.date} onChange={(f:string, v:any)=>setData({...data, [f]:v})} />
                         <div className="mb-3">
                            <label className="block text-xs font-bold text-[rgba(148,163,184,0.45)] mb-1">Mode</label>
                            <select className="w-full border border-white/12 bg-[rgba(255,255,255,0.05)] p-2.5 rounded-lg text-sm font-bold text-[rgba(226,232,240,0.88)] h-[42px]" value={data.payment_mode} onChange={e => setData({...data, payment_mode: e.target.value})}>
                                {paymentModes.map((m:string) => <option key={m} value={m}>{m}</option>)}
                            </select>
                         </div>
                    </div>
                    
                    <AutoComplete label="Purpose" value={data.payment_purpose || ''} onChange={(v: string) => setData({...data, payment_purpose: v})} options={purposes || []} icon={Wallet} placeholder="e.g. Advance" />
                    
                    <div>
                        <InputField 
                            label="Amount" 
                            field="amount" 
                            type="number" 
                            icon={IndianRupee} 
                            value={data.amount} 
                            onChange={(f:string, v:any) => handleAmountChange(v)} 
                        />
                        {error && (
                            <div className="flex items-center gap-1 text-red-500 text-xs font-bold mt-1 animate-pulse">
                                <AlertCircle size={12} /> {error}
                            </div>
                        )}
                    </div>

                    <InputField label="Notes" field="notes" icon={FileText} value={data.notes} onChange={(f:string, v:any)=>setData({...data, [f]:v})} placeholder="Note..." />

                    <AutoComplete
                        label={isSale ? 'Received By' : 'Paid By'}
                        value={data.received_by || ''}
                        onChange={(v: string) => setData({...data, received_by: v})}
                        options={isSale
                            ? (receivedByNames || ['Owner', 'Manager', 'Staff'])
                            : (paidByNames    || ['Owner', 'Manager'])
                        }
                        icon={UserCheck}
                        placeholder={isSale ? 'Who collected payment?' : 'Who made payment?'}
                    />
                </div>

                <div className="p-4 border-t border-white/08">
                    <button 
                        onClick={handleSubmit} 
                        disabled={!!error}
                        className="w-full disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-xl font-bold flex justify-center items-center gap-2 shadow-lg active:scale-95 transition-all" style={{background:"linear-gradient(135deg,#4f46e5,#7c3aed)"}}
                    >
                        <Save size={18} /> Add Payment
                    </button>
                </div>
            </div>
        </div>
    );
};






