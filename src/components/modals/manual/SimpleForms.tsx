import React, { useState, useEffect, useRef, useMemo } from 'react';
import { InputField, AutoComplete } from './FormUI';
import {
  Package, Hash, IndianRupee, Layers, AlertTriangle,
  Briefcase, UserCheck, Banknote, MapPin, Truck, FileText,
  Wallet, Search, Loader2, User, Phone, BookUser, X, ChevronDown, Plus,
} from 'lucide-react';
import {
  getAllContactsNative, pickContactFromDevice, loadContactsFromWebPicker,
  loadContactsFromGoogle,
  searchContacts, isNativeContacts, isPickerAvailable,
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
export const PartyForm = ({ formData, handleChange, handleFetchGSTIN, gstFetching, gstStatus, inventoryItems = [] }: any) => {
  const [contacts, setContacts]           = useState<AppContact[]>([]);
  const [nameSuggestions, setNameSugg]    = useState<AppContact[]>([]);
  const [phoneSuggestions, setPhoneSugg]  = useState<AppContact[]>([]);
  const [nameDropdown, setNameDropdown]   = useState(false);
  const [phoneDropdown, setPhoneDropdown] = useState(false);
  const [pickingContact, setPickingContact]   = useState(false);
  const [loadingBulk,    setLoadingBulk]      = useState(false);
  const [bulkLoadDone,   setBulkLoadDone]     = useState(false);
  const nameRef          = useRef<HTMLDivElement>(null);
  const phoneRef         = useRef<HTMLDivElement>(null);
  const nameDebounceRef  = useRef<ReturnType<typeof setTimeout>>();
  const phoneDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  const pickerAvail = isPickerAvailable();
  const nativeMode  = isNativeContacts();

  // Linked items state (for supplier role)
  const [itemSearch, setItemSearch]           = useState('');
  const [itemDropdownOpen, setItemDropdownOpen] = useState(false);
  const itemSearchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (itemSearchRef.current && !itemSearchRef.current.contains(e.target as Node)) {
        setItemDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const linkedItems: string[] = useMemo(() => formData.linked_items || [], [formData.linked_items]);

  const filteredItemOptions = useMemo(() => {
    const lower = itemSearch.toLowerCase();
    return (inventoryItems as string[]).filter(
      name => !linkedItems.includes(name) && name.toLowerCase().includes(lower)
    );
  }, [inventoryItems, linkedItems, itemSearch]);

  const addLinkedItem = (name: string) => {
    if (!linkedItems.includes(name)) {
      handleChange('linked_items', [...linkedItems, name]);
    }
    setItemSearch('');
    setItemDropdownOpen(false);
  };

  const removeLinkedItem = (name: string) => {
    handleChange('linked_items', linkedItems.filter(n => n !== name));
  };

  // Native: silently bulk-load all contacts on mount (static import fixes the
  // dynamic-import timing bug that caused silent failures on Android).
  useEffect(() => {
    if (!nativeMode) return;
    setLoadingBulk(true);
    getAllContactsNative()
      .then(all => {
        setContacts(all);
        if (all.length > 0) setBulkLoadDone(true);
      })
      .catch(() => {})
      .finally(() => setLoadingBulk(false));
  }, [nativeMode]);

  // Web: auto-load from Google Contacts (People API) if the user signed in with
  // Google and the OAuth token is still valid. Falls back silently so the manual
  // "Load contacts" button still appears if no token is available.
  useEffect(() => {
    if (nativeMode) return;
    loadContactsFromGoogle().then(all => {
      if (all.length > 0) {
        setContacts(all);
        setBulkLoadDone(true);
      }
    }).catch(() => {});
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
      }, 150);
    }
  };

  const onPhoneChange = (val: string) => {
    handleChange('contact', val);
    if (contacts.length > 0) {
      clearTimeout(phoneDebounceRef.current);
      phoneDebounceRef.current = setTimeout(() => {
        setPhoneSugg(searchContacts(contacts, val));
        setPhoneDropdown(val.trim().length > 0);
      }, 150);
    }
  };

  const selectContact = (c: AppContact) => {
    handleChange('name',    c.name);
    handleChange('contact', c.phone);
    setNameDropdown(false);
    setPhoneDropdown(false);
  };

  // Web: bulk-load many contacts from OS picker (multiple:true) for suggestions
  const handleLoadContactsWeb = async () => {
    setLoadingBulk(true);
    try {
      const all = await loadContactsFromWebPicker();
      if (all.length > 0) {
        setContacts(all);
        setBulkLoadDone(true);
      }
    } catch (_) {}
    finally { setLoadingBulk(false); }
  };

  // One-shot device contact picker — picks a single contact, fills the form
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

      {/* GST Status badge — shown after a successful fetch */}
      {gstStatus && (
        <div className="flex items-center gap-2 -mt-1 mb-1">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black"
            style={
              gstStatus.toLowerCase() === 'active'
                ? { background: 'rgba(16,185,129,0.12)', color: '#34d399', border: '1px solid rgba(16,185,129,0.25)' }
                : { background: 'rgba(239,68,68,0.1)',  color: '#f87171', border: '1px solid rgba(239,68,68,0.22)' }
            }>
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: gstStatus.toLowerCase() === 'active' ? '#34d399' : '#f87171' }} />
            GST: {gstStatus}
          </span>
        </div>
      )}

      {/* ── Contact actions row (web only) ─────────────────────────────── */}
      {pickerAvail && !nativeMode && (
        <div className="flex gap-2">
          {/* Bulk-load for suggestions */}
          {!bulkLoadDone ? (
            <button type="button" onClick={handleLoadContactsWeb} disabled={loadingBulk}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95"
              style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', color: '#a5b4fc' }}>
              {loadingBulk
                ? <><Loader2 size={13} className="animate-spin"/>Loading contacts…</>
                : <><BookUser size={13}/>Load contacts for suggestions</>}
            </button>
          ) : (
            <div className="flex-1 flex items-center gap-1.5 px-3 py-2 rounded-xl"
              style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.18)' }}>
              <BookUser size={12} style={{ color: '#34d399' }}/>
              <span className="text-[11px] font-bold" style={{ color: '#34d399' }}>
                {contacts.length} contacts loaded — type to search
              </span>
            </div>
          )}
          {/* One-shot picker — always available */}
          <button type="button" onClick={handlePickFromDevice} disabled={pickingContact}
            className="px-3 py-2.5 rounded-xl font-bold flex items-center gap-1.5 transition-all active:scale-95 text-xs"
            style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', color: '#a78bfa' }}>
            {pickingContact ? <Loader2 size={13} className="animate-spin"/> : <Phone size={13}/>}
            {pickingContact ? 'Opening…' : 'Pick one'}
          </button>
        </div>
      )}

      {/* Native: show loading / loaded badge */}
      {nativeMode && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
          {loadingBulk
            ? <><Loader2 size={11} className="animate-spin" style={{ color: 'rgba(148,163,184,0.5)' }}/><span className="text-[10px]" style={{ color: 'rgba(148,163,184,0.5)' }}>Loading contacts…</span></>
            : bulkLoadDone
              ? <><BookUser size={11} style={{ color: '#34d399' }}/><span className="text-[10px] font-bold" style={{ color: '#34d399' }}>{contacts.length} contacts ready — type to search</span></>
              : <><BookUser size={11} style={{ color: 'rgba(148,163,184,0.35)' }}/><span className="text-[10px]" style={{ color: 'rgba(148,163,184,0.35)' }}>No contacts loaded (check permission)</span></>
          }
        </div>
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
          {/* Book icon inside field: on native shows dropdown of loaded contacts;
              on web (picker available) picks one contact directly */}
          {(pickerAvail || nativeMode) && contacts.length > 0 && (
            <button type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-all active:scale-90"
              style={{ color: 'rgba(139,92,246,0.6)' }}
              onMouseDown={e => {
                e.preventDefault();
                setNameSugg(contacts.slice(0, 4));
                setNameDropdown(true);
              }}
              onTouchStart={e => {
                e.preventDefault();
                setNameSugg(contacts.slice(0, 4));
                setNameDropdown(true);
              }}
              title="Browse contacts">
              <BookUser size={15}/>
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
      <InputField label="State" field="state" icon={MapPin} value={formData.state} onChange={handleChange} placeholder="e.g. Maharashtra"/>
      <InputField label="Site / Delivery Location (Optional)" field="site" icon={Truck} value={formData.site} onChange={handleChange} placeholder="e.g. Factory Gate, Plot 12"/>
      <InputField label="Credit Limit (Optional)" field="credit_limit" type="number" icon={IndianRupee} value={formData.credit_limit} onChange={handleChange} placeholder="Max outstanding amount"/>

      {/* Opening Balance */}
      <div>
        <label className="block text-xs font-bold mb-2 flex items-center gap-1" style={{color:'rgba(148,163,184,0.55)'}}>
          <IndianRupee size={12}/> Opening Balance (Optional)
        </label>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl" style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)'}}>
            {([
              {val:'they_owe', label:'They Owe Us'},
              {val:'we_owe',   label:'We Owe Them'},
            ]).map(opt => (
              <button key={opt.val} type="button"
                onClick={() => handleChange('opening_balance_type', opt.val)}
                className="py-2 rounded-lg text-xs font-bold transition-all"
                style={(formData.opening_balance_type || 'they_owe') === opt.val
                  ? {background:'rgba(139,92,246,0.25)',color:'#a78bfa',border:'1px solid rgba(139,92,246,0.3)'}
                  : {color:'rgba(148,163,184,0.45)'}}>
                {opt.label}
              </button>
            ))}
          </div>
          <InputField label="" field="opening_balance" type="number" icon={IndianRupee}
            value={formData.opening_balance || ''} onChange={handleChange} placeholder="Amount (leave blank if none)"/>
        </div>
      </div>

      {/* Linked items — only shown when role is supplier */}
      {formData.role === 'supplier' && inventoryItems.length > 0 && (
        <div className="space-y-2">
          <label className="block text-xs font-bold text-[rgba(148,163,184,0.55)] flex items-center gap-1">
            <Package size={12}/> Items Supplied (Optional)
          </label>

          {/* Selected items as pills */}
          {linkedItems.length > 0 && (
            <div className="flex flex-wrap gap-1.5 p-2.5 rounded-xl border border-white/10 bg-[rgba(255,255,255,0.03)]">
              {linkedItems.map(name => (
                <span key={name}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold"
                  style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.22)' }}>
                  {name}
                  <button type="button" onClick={() => removeLinkedItem(name)}
                    className="ml-0.5 rounded-full hover:bg-white/10 transition-all p-0.5">
                    <X size={10}/>
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Search + dropdown */}
          <div className="relative" ref={itemSearchRef}>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(148,163,184,0.45)' }}/>
              <input
                className="w-full border border-white/12 rounded-lg p-2.5 pl-8 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500 bg-[rgba(255,255,255,0.05)] text-[rgba(226,232,240,0.88)]"
                placeholder="Search items to add…"
                value={itemSearch}
                onChange={e => { setItemSearch(e.target.value); setItemDropdownOpen(true); }}
                onFocus={() => setItemDropdownOpen(true)}
                onBlur={() => setTimeout(() => setItemDropdownOpen(false), 200)}
              />
            </div>
            {itemDropdownOpen && filteredItemOptions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl overflow-hidden max-h-44 overflow-y-auto"
                style={{ background: 'rgba(15,20,50,0.97)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(20px)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                {filteredItemOptions.map(name => (
                  <button key={name} type="button"
                    className="w-full text-left px-3 py-2.5 text-sm font-bold transition-all active:bg-white/10 flex items-center gap-2"
                    style={{ color: 'rgba(226,232,240,0.88)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                    onMouseDown={e => { e.preventDefault(); addLinkedItem(name); }}
                    onTouchStart={e => { e.preventDefault(); addLinkedItem(name); }}>
                    <Package size={12} style={{ color: 'rgba(251,191,36,0.6)', flexShrink: 0 }}/>
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {linkedItems.length === 0 && (
            <p className="text-[10px] font-semibold px-1" style={{ color: 'rgba(148,163,184,0.35)' }}>
              Link items this supplier provides — helps auto-fill purchase orders
            </p>
          )}
        </div>
      )}
    </div>
  );
};

const DEFAULT_UNITS = ['Pcs', 'Kg', 'Gm', 'Mg', 'Ton', 'Ltr', 'Ml', 'Mtr', 'Cm', 'Ft', 'Inch', 'Bag', 'Box', 'Set', 'Doz', 'Pair', 'Pack', 'Roll', 'Sheet', 'Bundle', 'Carton', 'Bottle', 'Can', 'Tube', 'Sack', 'Plate', 'Unit'];

/* ══ Other forms — unchanged ════════════════════════════════════════════════ */
export const InventoryForm = ({ formData, handleChange, units, onAddUnit }: any) => {
  const unitList: string[] = units && units.length > 0 ? units : DEFAULT_UNITS;
  const currentUnit: string = formData.unit || 'Pcs';

  const [showPicker, setShowPicker] = useState(false);
  const [showAddNew, setShowAddNew] = useState(false);
  const [newUnitText, setNewUnitText] = useState('');

  const selectUnit = (u: string) => {
    handleChange('unit', u);
    setShowPicker(false);
    setShowAddNew(false);
    setNewUnitText('');
  };

  const handleSaveNew = () => {
    const trimmed = newUnitText.trim();
    if (!trimmed) return;
    onAddUnit?.(trimmed);
    handleChange('unit', trimmed);
    setShowPicker(false);
    setShowAddNew(false);
    setNewUnitText('');
  };

  return (
  <div className="space-y-4">
    <InputField label="Item Name" field="name" icon={Package} value={formData.name} onChange={handleChange} placeholder="e.g. Cement Bag 50kg"/>
    <div className="grid grid-cols-2 gap-3">
      <div className="mb-3">
        <label className="block text-xs font-bold text-[rgba(148,163,184,0.45)] mb-1">Unit</label>
        {/* Trigger button */}
        <button
          type="button"
          onClick={() => { setShowPicker(p => !p); setShowAddNew(false); setNewUnitText(''); }}
          className="w-full flex items-center justify-between border border-white/12 bg-[rgba(255,255,255,0.05)] p-2.5 rounded-lg text-sm font-bold text-[rgba(226,232,240,0.88)] outline-none"
        >
          <span>{currentUnit}</span>
          <ChevronDown size={14} className={`transition-transform ${showPicker ? 'rotate-180' : ''}`} style={{ color: 'rgba(148,163,184,0.5)' }}/>
        </button>

        {/* Dropdown panel */}
        {showPicker && (
          <div className="mt-1 rounded-xl border border-white/12 overflow-hidden" style={{ background: 'rgba(15,18,40,0.98)', zIndex: 10, position: 'relative' }}>
            {/* Unit grid */}
            <div className="p-2 flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
              {unitList.map((u: string) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => selectUnit(u)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                  style={u === currentUnit
                    ? { background: 'rgba(99,102,241,0.3)', color: '#a78bfa', border: '1px solid rgba(99,102,241,0.5)' }
                    : { background: 'rgba(255,255,255,0.06)', color: 'rgba(203,213,225,0.8)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  {u}
                </button>
              ))}
            </div>

            {/* Add new section */}
            <div className="border-t border-white/08">
              {!showAddNew ? (
                <button
                  type="button"
                  onClick={() => setShowAddNew(true)}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold"
                  style={{ color: 'rgba(167,139,250,0.8)' }}
                >
                  <Plus size={13}/> Add new unit
                </button>
              ) : (
                <div className="flex gap-2 p-2">
                  <input
                    autoFocus
                    type="text"
                    value={newUnitText}
                    onChange={e => setNewUnitText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSaveNew()}
                    placeholder="e.g. Quintal, Trolley…"
                    className="flex-1 bg-[rgba(255,255,255,0.07)] border border-white/12 rounded-lg px-3 py-2 text-xs font-bold outline-none text-[rgba(226,232,240,0.9)] placeholder:text-[rgba(148,163,184,0.35)]"
                  />
                  <button
                    type="button"
                    onClick={handleSaveNew}
                    className="px-3 py-2 rounded-lg text-xs font-bold"
                    style={{ background: 'rgba(99,102,241,0.3)', color: '#a78bfa', border: '1px solid rgba(99,102,241,0.4)' }}
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
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
};

export const VehicleForm = ({ formData, handleChange }: any) => {
  const handleVehicleNum = (_field: string, val: string) =>
    handleChange('vehicle_number', val.toUpperCase());
  return (
    <div className="space-y-3">
      <InputField label="Vehicle Number" field="vehicle_number" icon={Truck}
        value={formData.vehicle_number} onChange={handleVehicleNum}
        placeholder="MH 04 AB 1234"/>
      <InputField label="Vehicle Model" field="model" icon={Truck}
        value={formData.model} onChange={handleChange}
        placeholder="e.g. Tata Ace, Mahindra Pickup"/>
      <div className="grid grid-cols-2 gap-3">
        <InputField label="Owner Name" field="owner_name" icon={User}
          value={formData.owner_name || ''} onChange={handleChange} placeholder="Owner name"/>
        <InputField label="Owner Phone" field="owner_phone" icon={Phone}
          value={formData.owner_phone || ''} onChange={handleChange}
          placeholder="Owner phone" type="tel"/>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <InputField label="Driver Name" field="driver_name" icon={User}
          value={formData.driver_name} onChange={handleChange}/>
        <InputField label="Driver Phone" field="driver_phone" icon={Phone}
          value={formData.driver_phone} onChange={handleChange} type="tel"/>
      </div>
    </div>
  );
};

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






