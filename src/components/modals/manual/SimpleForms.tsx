import React, { useState, useEffect, useRef } from 'react';
import { InputField, AutoComplete } from './FormUI';
import {
  Package, Hash, IndianRupee, Layers, AlertTriangle,
  Briefcase, UserCheck, Banknote, MapPin, Truck, FileText,
  Wallet, Search, Loader2, User, Phone, BookUser, X, ChevronDown,
} from 'lucide-react';
import {
  getAllContactsNative, pickContactFromDevice, searchContacts,
  isNativeContacts, isPickerAvailable,
  type AppContact,
} from '../../../services/contactPickerService';

/* ═══════════════════════════════════════════════════════
   ContactSuggestions — top-4 dropdown shown under name/phone
═══════════════════════════════════════════════════════ */
const ContactSuggestions: React.FC<{
  suggestions: AppContact[];
  onSelect: (c: AppContact) => void;
  visible: boolean;
}> = ({ suggestions, onSelect, visible }) => {
  if (!visible || suggestions.length === 0) return null;
  return (
    <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-2xl overflow-hidden"
      style={{ background: 'rgba(15,20,50,0.97)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(20px)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
      <div className="px-3 py-2 flex items-center gap-1.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <BookUser size={11} style={{ color: 'rgba(139,92,246,0.7)' }} />
        <span className="text-xs font-black uppercase tracking-wider" style={{ color: 'rgba(139,92,246,0.7)' }}>From Contacts</span>
      </div>
      <div>
        {suggestions.map((c, i) => (
          <button key={i} type="button"
            className="w-full text-left px-3 py-3 flex items-center gap-3 transition-all active:bg-white/10"
            style={{ borderBottom: i < suggestions.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}
            onMouseDown={e => { e.preventDefault(); onSelect(c); }}
            onTouchStart={e => { e.preventDefault(); onSelect(c); }}>
            <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.2)' }}>
              <span className="text-base font-black" style={{ color: '#a78bfa' }}>
                {c.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold truncate" style={{ color: 'rgba(240,244,255,0.92)' }}>{c.name}</div>
              {c.phone && <div className="text-xs font-semibold mt-0.5" style={{ color: 'rgba(148,163,184,0.6)' }}>{c.phone}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════
   PartyForm  — contact suggestions + device picker
═══════════════════════════════════════════════════════ */
export const PartyForm = ({ formData, handleChange, handleFetchGSTIN, gstFetching }: any) => {
  const [contacts, setContacts]           = useState<AppContact[]>([]);
  const [nameSuggestions, setNameSugg]    = useState<AppContact[]>([]);
  const [phoneSuggestions, setPhoneSugg]  = useState<AppContact[]>([]);
  const [nameDropdown, setNameDropdown]   = useState(false);
  const [phoneDropdown, setPhoneDropdown] = useState(false);
  const [pickingContact, setPickingContact] = useState(false);
  const nameRef          = useRef<HTMLDivElement>(null);
  const phoneRef         = useRef<HTMLDivElement>(null);
  const nameDebounceRef  = useRef<ReturnType<typeof setTimeout>>();
  const phoneDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  const pickerAvail = isPickerAvailable();
  const nativeMode  = isNativeContacts();

  // On native: silently load all contacts in background so typing shows suggestions
  useEffect(() => {
    if (!nativeMode) return;
    getAllContactsNative().then(all => setContacts(all)).catch(() => {});
  }, [nativeMode]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (nameRef.current  && !nameRef.current.contains(e.target as Node))  setNameDropdown(false);
      if (phoneRef.current && !phoneRef.current.contains(e.target as Node)) setPhoneDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    return () => {
      clearTimeout(nameDebounceRef.current);
      clearTimeout(phoneDebounceRef.current);
    };
  }, []);

  const onNameChange = (val: string) => {
    handleChange('name', val);
    if (contacts.length > 0) {
      clearTimeout(nameDebounceRef.current);
      nameDebounceRef.current = setTimeout(() => {
        setNameSugg(searchContacts(contacts, val));
        setNameDropdown(val.trim().length > 0);
      }, 200);
    }
  };

  const onPhoneChange = (val: string) => {
    handleChange('contact', val);
    if (contacts.length > 0) {
      clearTimeout(phoneDebounceRef.current);
      phoneDebounceRef.current = setTimeout(() => {
        setPhoneSugg(searchContacts(contacts, val));
        setPhoneDropdown(val.trim().length > 0);
      }, 200);
    }
  };

  const selectContact = (c: AppContact) => {
    handleChange('name',    c.name);
    handleChange('contact', c.phone);
    setNameDropdown(false);
    setPhoneDropdown(false);
  };

  // One-shot device contact picker (web Contact Picker API or native)
  const handlePickFromDevice = async () => {
    setPickingContact(true);
    try {
      const c = await pickContactFromDevice();
      if (c) selectContact(c);
    } finally {
      setPickingContact(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* GSTIN row */}
      <div className="flex gap-2 items-end mb-3">
        <div className="flex-1">
          <label className="block text-xs font-bold text-[rgba(148,163,184,0.55)] mb-1 flex items-center gap-1"><Hash size={12}/> GSTIN (Optional)</label>
          <input className="w-full border border-white/12 rounded-lg p-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500 uppercase bg-[rgba(255,255,255,0.05)] text-[rgba(226,232,240,0.88)]"
            value={formData.gstin || ''} onChange={e => handleChange('gstin', e.target.value.toUpperCase())}
            placeholder="27ABCDE1234F1Z5" maxLength={15} />
        </div>
        <button type="button" onClick={handleFetchGSTIN} disabled={gstFetching || !formData.gstin}
          className="bg-blue-600 disabled:bg-slate-300 text-white p-2.5 rounded-lg font-bold text-xs h-[42px] flex items-center gap-1 shadow-md active:scale-95 transition-all">
          {gstFetching ? <Loader2 size={16} className="animate-spin"/> : <Search size={16}/>} Fetch
        </button>
      </div>

      {/* One-shot contact picker button — shown on web when picker API is available */}
      {pickerAvail && !nativeMode && (
        <button type="button" onClick={handlePickFromDevice} disabled={pickingContact}
          className="w-full py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-95"
          style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', color: '#a78bfa' }}>
          {pickingContact ? <Loader2 size={14} className="animate-spin"/> : <BookUser size={14}/>}
          {pickingContact ? 'Opening contacts…' : 'Pick from device contacts'}
        </button>
      )}

      {/* Name field with inline suggestions (native) or picker icon (web) */}
      <div ref={nameRef} className="relative">
        <label className="block text-xs font-bold text-[rgba(148,163,184,0.55)] mb-1 flex items-center gap-1">
          <Briefcase size={12}/> Party Name (Firm Name)
        </label>
        <div className="relative">
          <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" size={14} style={{ color: 'rgba(148,163,184,0.45)' }}/>
          <input
            className="w-full border border-white/12 rounded-lg p-2.5 pl-8 pr-10 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500 bg-[rgba(255,255,255,0.05)] text-[rgba(226,232,240,0.88)]"
            value={formData.name || ''}
            onChange={e => onNameChange(e.target.value)}
            onFocus={() => {
              if (contacts.length > 0) {
                setNameSugg(searchContacts(contacts, formData.name || ''));
                setNameDropdown(true);
              }
            }}
            onBlur={() => setTimeout(() => setNameDropdown(false), 200)}
            placeholder="Business Name"
          />
          {/* Contact book icon inside field — shown on picker-capable platforms AND on native (background contacts) */}
          {(pickerAvail || nativeMode) && (
            <button type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-all active:scale-90"
              style={{ color: pickingContact ? '#a78bfa' : 'rgba(139,92,246,0.5)' }}
              onMouseDown={e => {
                e.preventDefault();
                if (nativeMode) {
                  // On native: show all loaded contacts in dropdown so user can pick
                  if (contacts.length > 0) {
                    setNameSugg(contacts.slice(0, 8));
                    setNameDropdown(true);
                  } else {
                    // Contacts not loaded yet — trigger load then show
                    getAllContactsNative().then(all => {
                      setContacts(all);
                      setNameSugg(all.slice(0, 8));
                      setNameDropdown(all.length > 0);
                    });
                  }
                } else {
                  handlePickFromDevice();
                }
              }}
              onTouchStart={e => {
                e.preventDefault();
                if (nativeMode) {
                  if (contacts.length > 0) {
                    setNameSugg(contacts.slice(0, 8));
                    setNameDropdown(true);
                  } else {
                    getAllContactsNative().then(all => {
                      setContacts(all);
                      setNameSugg(all.slice(0, 8));
                      setNameDropdown(all.length > 0);
                    });
                  }
                } else {
                  handlePickFromDevice();
                }
              }}
              title="Pick from contacts">
              {pickingContact ? <Loader2 size={15} className="animate-spin"/> : <BookUser size={15}/>}
            </button>
          )}
        </div>
        <ContactSuggestions suggestions={nameSuggestions} onSelect={selectContact} visible={nameDropdown && contacts.length > 0}/>
      </div>

      {(formData.legal_name || formData.gstin) && (
        <InputField label="Legal Name (Owner)" field="legal_name" icon={UserCheck}
          value={formData.legal_name} onChange={handleChange} placeholder="Legal Owner Name"/>
      )}

      {/* Phone field with inline suggestions */}
      <div ref={phoneRef} className="relative">
        <label className="block text-xs font-bold text-[rgba(148,163,184,0.55)] mb-1 flex items-center gap-1">
          <Phone size={12}/> Phone
        </label>
        <div className="relative">
          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" size={14} style={{ color: 'rgba(148,163,184,0.45)' }}/>
          <input
            type="tel"
            className="w-full border border-white/12 rounded-lg p-2.5 pl-8 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500 bg-[rgba(255,255,255,0.05)] text-[rgba(226,232,240,0.88)]"
            value={formData.contact || ''}
            onChange={e => onPhoneChange(e.target.value)}
            onFocus={() => {
              if (contacts.length > 0) {
                setPhoneSugg(searchContacts(contacts, formData.contact || ''));
                setPhoneDropdown(true);
              }
            }}
            onBlur={() => setTimeout(() => setPhoneDropdown(false), 200)}
            placeholder="Mobile number"
          />
        </div>
        <ContactSuggestions suggestions={phoneSuggestions} onSelect={selectContact} visible={phoneDropdown && contacts.length > 0}/>
      </div>

      {/* Role */}
      <div className="mb-3">
        <label className="block text-xs font-bold text-[rgba(148,163,184,0.45)] mb-1">Role</label>
        <select className="w-full border border-white/12 bg-[rgba(255,255,255,0.05)] p-2.5 rounded-lg text-sm font-bold text-[rgba(226,232,240,0.88)]"
          value={formData.role || 'customer'} onChange={e => handleChange('role', e.target.value)}>
          <option value="customer">Customer</option>
          <option value="supplier">Supplier</option>
        </select>
      </div>

      <InputField label="Address" field="address" icon={MapPin} value={formData.address} onChange={handleChange}/>
      <InputField label="Site / Delivery Location (Optional)" field="site" icon={Truck} value={formData.site} onChange={handleChange} placeholder="e.g. Factory Gate, Plot 12"/>
    </div>
  );
};

/* ══ Other forms — unchanged ════════════════════════════════════════════════ */
export const InventoryForm = ({ formData, handleChange }: any) => (
  <div className="space-y-4">
    <InputField label="Item Name" field="name" icon={Package} value={formData.name} onChange={handleChange} placeholder="e.g. Cement Bag 50kg"/>
    <div className="grid grid-cols-2 gap-3">
      <div className="mb-3">
        <label className="block text-xs font-bold text-[rgba(148,163,184,0.45)] mb-1">Unit</label>
        <select className="w-full border border-white/12 bg-[rgba(255,255,255,0.05)] p-2.5 rounded-lg text-sm font-bold text-[rgba(226,232,240,0.88)]"
          value={formData.unit || 'Pcs'} onChange={e => handleChange('unit', e.target.value)}>
          {['Pcs','Kg','Bag','Ltr','Mtr','Box','Set','Doz'].map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <InputField label="HSN Code" field="hsn_code" icon={Hash} value={formData.hsn_code} onChange={handleChange}/>
    </div>
    <div className="grid grid-cols-2 gap-3 p-3 rounded-xl border border-white/10 bg-[rgba(255,255,255,0.04)]">
      <InputField label="Purchase Rate" field="purchase_rate" type="number" icon={IndianRupee} value={formData.purchase_rate} onChange={handleChange}/>
      <InputField label="Sale Rate" field="sale_rate" type="number" icon={IndianRupee} value={formData.sale_rate} onChange={handleChange}/>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <div className="mb-3">
        <label className="block text-xs font-bold text-[rgba(148,163,184,0.45)] mb-1">GST Tax %</label>
        <input type="number" list="gst_rates"
          className="w-full border border-white/12 bg-[rgba(255,255,255,0.05)] p-2.5 rounded-lg text-sm font-bold text-[rgba(226,232,240,0.88)] outline-none"
          value={formData.gst_percent || ''} onChange={e => handleChange('gst_percent', e.target.value)} placeholder="Custom or Select"/>
        <datalist id="gst_rates"><option value="0"/><option value="5"/><option value="12"/><option value="18"/><option value="28"/></datalist>
      </div>
      <div className="mb-3">
        <label className="block text-xs font-bold text-[rgba(148,163,184,0.45)] mb-1">Rate Type</label>
        <div className="flex rounded-lg p-1 border border-white/12 h-[42px]">
          <button type="button" onClick={() => handleChange('price_type','exclusive')}
            className={`flex-1 rounded-md text-xs font-bold transition-all ${(formData.price_type||'exclusive')==='exclusive' ? 'bg-[rgba(139,92,246,0.25)] text-[#a78bfa]' : 'text-[rgba(148,163,184,0.4)]'}`}>
            Exclusive
          </button>
          <button type="button" onClick={() => handleChange('price_type','inclusive')}
            className={`flex-1 rounded-md text-xs font-bold transition-all ${formData.price_type==='inclusive' ? 'bg-[rgba(16,185,129,0.2)] text-[#34d399]' : 'text-[rgba(148,163,184,0.4)]'}`}>
            Inclusive
          </button>
        </div>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-3 p-3 rounded-xl border border-[rgba(245,158,11,0.2)] bg-[rgba(245,158,11,0.07)]">
      <InputField label="Opening Stock" field="quantity" type="number" icon={Layers} value={formData.quantity} onChange={handleChange}/>
      <InputField label="Low Stock Warning" field="min_stock" type="number" icon={AlertTriangle} value={formData.min_stock} onChange={handleChange} placeholder="Alert at..."/>
    </div>
  </div>
);

export const VehicleForm = ({ formData, handleChange }: any) => (
  <div className="space-y-3">
    <InputField label="Vehicle Number" field="vehicle_number" icon={Truck} value={formData.vehicle_number} onChange={handleChange} placeholder="MH 04 AB 1234"/>
    <InputField label="Vehicle Model" field="model" icon={Truck} value={formData.model} onChange={handleChange} placeholder="e.g. Tata Ace, Mahindra Pickup"/>
    <div className="grid grid-cols-2 gap-3">
      <InputField label="Owner Name" field="owner_name" icon={User} value={formData.owner_name || ''} onChange={handleChange} placeholder="Owner name"/>
      <InputField label="Owner Phone" field="owner_phone" icon={Phone} value={formData.owner_phone || ''} onChange={handleChange} placeholder="Owner phone" type="tel"/>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <InputField label="Driver Name" field="driver_name" icon={User} value={formData.driver_name} onChange={handleChange}/>
      <InputField label="Driver Phone" field="driver_phone" icon={Phone} value={formData.driver_phone} onChange={handleChange}/>
    </div>
  </div>
);

export const ExpenseForm = ({ formData, handleChange, expenseTypes }: any) => (
  <>
    <div className="grid grid-cols-2 gap-3">
      <InputField label="Date" field="date" type="date" value={formData.date} onChange={handleChange}/>
      <InputField label="Amount" field="amount" type="number" icon={IndianRupee} value={formData.amount} onChange={handleChange}/>
    </div>
    <AutoComplete label="Expense Type" value={formData.category||''} onChange={(v:string)=>handleChange('category',v)} options={expenseTypes||[]} icon={Wallet} placeholder="e.g. Rent, Tea, Salary"/>
    <InputField label="Note" field="notes" icon={FileText} value={formData.notes} onChange={handleChange} placeholder="Description (Optional)..."/>
  </>
);






