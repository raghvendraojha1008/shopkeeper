import React, { useState, useEffect, useRef, useMemo } from "react";
import { InputField, AutoComplete } from "./FormUI";
import {
  Package,
  Hash,
  IndianRupee,
  Layers,
  AlertTriangle,
  Briefcase,
  UserCheck,
  Banknote,
  MapPin,
  Truck,
  FileText,
  Wallet,
  Search,
  Loader2,
  User,
  Phone,
  BookUser,
  X,
  ChevronDown,
  Plus,
} from "lucide-react";
import {
  getAllContactsNative,
  pickContactFromDevice,
  loadContactsFromWebPicker,
  loadContactsFromGoogle,
  searchContacts,
  isNativeContacts,
  isPickerAvailable,
  type AppContact,
} from "../../../services/contactPickerService";

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
    <div
      className="absolute left-0 right-0 top-full mt-1 z-50 rounded-2xl overflow-hidden"
      style={{
        background: "var(--modal-bg)",
        border: "1px solid var(--glass-border)",
        backdropFilter: "blur(20px)",
        boxShadow: "0 8px 32px var(--rgba-black-50)",
      }}
    >
      <div
        className="px-3 py-2 flex items-center gap-1.5 border-b"
        style={{ borderColor: "var(--rgba-white-06)" }}
      >
        <BookUser size={11} style={{ color: "var(--col-violet-70)" }} />
        <span
          className="text-xs font-black uppercase tracking-wider"
          style={{ color: "var(--col-violet-70)" }}
        >
          From Contacts
        </span>
      </div>
      <div>
        {suggestions.map((c, i) => (
          <button
            key={i}
            type="button"
            className="w-full text-left px-3 py-3 flex items-center gap-3 transition-all active:bg-white/10"
            style={{
              borderBottom:
                i < suggestions.length - 1
                  ? "1px solid var(--glass-border)"
                  : "none",
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(c);
            }}
            onTouchStart={(e) => {
              e.preventDefault();
              onSelect(c);
            }}
          >
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
              style={{
                background: "var(--col-violet-15)",
                border: "1px solid var(--col-violet-25)",
              }}
            >
              <span
                className="text-base font-black"
                style={{ color: "var(--col-violet)" }}
              >
                {c.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div
                className="text-sm font-bold truncate"
                style={{ color: "var(--text-primary)" }}
              >
                {c.name}
              </div>
              {c.phone && (
                <div
                  className="text-xs font-semibold mt-0.5"
                  style={{ color: "var(--text-muted)" }}
                >
                  {c.phone}
                </div>
              )}
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
export const PartyForm = ({
  formData,
  handleChange,
  handleFetchGSTIN,
  gstFetching,
  gstStatus,
  inventoryItems = [],
}: any) => {
  const [contacts, setContacts] = useState<AppContact[]>([]);
  const [nameSuggestions, setNameSugg] = useState<AppContact[]>([]);
  const [phoneSuggestions, setPhoneSugg] = useState<AppContact[]>([]);
  const [nameDropdown, setNameDropdown] = useState(false);
  const [phoneDropdown, setPhoneDropdown] = useState(false);
  const [pickingContact, setPickingContact] = useState(false);
  const [loadingBulk, setLoadingBulk] = useState(false);
  const [bulkLoadDone, setBulkLoadDone] = useState(false);
  const nameRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLDivElement>(null);
  const nameDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const phoneDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  const pickerAvail = isPickerAvailable();
  const nativeMode = isNativeContacts();

  // Linked items state (for supplier role)
  const [itemSearch, setItemSearch] = useState("");
  const [itemDropdownOpen, setItemDropdownOpen] = useState(false);
  const itemSearchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        itemSearchRef.current &&
        !itemSearchRef.current.contains(e.target as Node)
      ) {
        setItemDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const linkedItems: string[] = useMemo(
    () => formData.linked_items || [],
    [formData.linked_items],
  );

  const filteredItemOptions = useMemo(() => {
    const lower = itemSearch.toLowerCase();
    return (inventoryItems as string[]).filter(
      (name) =>
        !linkedItems.includes(name) && name.toLowerCase().includes(lower),
    );
  }, [inventoryItems, linkedItems, itemSearch]);

  const addLinkedItem = (name: string) => {
    if (!linkedItems.includes(name)) {
      handleChange("linked_items", [...linkedItems, name]);
    }
    setItemSearch("");
    setItemDropdownOpen(false);
  };

  const removeLinkedItem = (name: string) => {
    handleChange(
      "linked_items",
      linkedItems.filter((n) => n !== name),
    );
  };

  // Native: silently bulk-load all contacts on mount (static import fixes the
  // dynamic-import timing bug that caused silent failures on Android).
  useEffect(() => {
    if (!nativeMode) return;
    setLoadingBulk(true);
    getAllContactsNative()
      .then((all) => {
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
    loadContactsFromGoogle()
      .then((all) => {
        if (all.length > 0) {
          setContacts(all);
          setBulkLoadDone(true);
        }
      })
      .catch(() => {});
  }, [nativeMode]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (nameRef.current && !nameRef.current.contains(e.target as Node))
        setNameDropdown(false);
      if (phoneRef.current && !phoneRef.current.contains(e.target as Node))
        setPhoneDropdown(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    return () => {
      clearTimeout(nameDebounceRef.current);
      clearTimeout(phoneDebounceRef.current);
    };
  }, []);

  const onNameChange = (val: string) => {
    handleChange("name", val);
    if (contacts.length > 0) {
      clearTimeout(nameDebounceRef.current);
      nameDebounceRef.current = setTimeout(() => {
        setNameSugg(searchContacts(contacts, val));
        setNameDropdown(val.trim().length > 0);
      }, 150);
    }
  };

  const onPhoneChange = (val: string) => {
    handleChange("contact", val);
    if (contacts.length > 0) {
      clearTimeout(phoneDebounceRef.current);
      phoneDebounceRef.current = setTimeout(() => {
        setPhoneSugg(searchContacts(contacts, val));
        setPhoneDropdown(val.trim().length > 0);
      }, 150);
    }
  };

  const selectContact = (c: AppContact) => {
    handleChange("name", c.name);
    handleChange("contact", c.phone);
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
    } catch (_) {
    } finally {
      setLoadingBulk(false);
    }
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
      {/* Party ID field — read-only once assigned */}
      <div>
        <label
          className="block text-xs font-bold mb-1 flex items-center gap-1"
          style={{ color: "var(--text-muted)" }}
        >
          <Hash size={12} /> Party ID
          <span
            className="ml-1 text-app-xs font-semibold px-1.5 py-0.5 rounded-md"
            style={{
              background: "var(--text-muted)",
              color: "var(--text-muted)",
            }}
          >
            auto · locked
          </span>
        </label>
        <input
          readOnly
          className="w-full border rounded-lg p-2.5 text-sm font-mono font-black outline-none uppercase cursor-default select-all"
          style={{
            background: "var(--col-violet-05)",
            border: "1px solid var(--col-violet-15)",
            color: "var(--col-violet)",
            opacity: formData.party_code ? 1 : 0.5,
          }}
          value={formData.party_code || ""}
          placeholder={formData.role === "supplier" ? "S-0001" : "C-0001"}
        />
        <p
          className="text-app-sm mt-0.5 font-semibold"
          style={{ color: "var(--text-muted)" }}
        >
          Auto-assigned · {formData.role === "supplier" ? "S-" : "C-"} prefix ·
          cannot be changed after save
        </p>
      </div>

      {/* GSTIN row */}
      <div className="flex gap-2 items-end mb-3">
        <div className="flex-1">
          <label className="block text-xs font-bold text-[var(--text-muted)] mb-1 flex items-center gap-1">
            <Hash size={12} /> GSTIN (Optional)
          </label>
          <input
            className="w-full border border-white/12 rounded-lg p-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500 uppercase bg-[var(--rgba-white-05)] text-[var(--text-secondary)]"
            value={formData.gstin || ""}
            onChange={(e) =>
              handleChange("gstin", e.target.value.toUpperCase())
            }
            placeholder="27ABCDE1234F1Z5"
            maxLength={15}
          />
        </div>
        <button
          type="button"
          onClick={handleFetchGSTIN}
          disabled={gstFetching || !formData.gstin}
          className="bg-blue-600 disabled:bg-slate-300 text-white p-2.5 rounded-lg font-bold text-xs h-[42px] flex items-center gap-1 shadow-md active:scale-95 transition-all"
        >
          {gstFetching ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Search size={16} />
          )}{" "}
          Fetch
        </button>
      </div>

      {/* GST Status badge — shown after a successful fetch */}
      {gstStatus && (
        <div className="flex items-center gap-2 -mt-1 mb-1">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-app-sm font-black"
            style={
              gstStatus.toLowerCase() === "active"
                ? {
                    background: "var(--col-emerald-12)",
                    color: "var(--col-success)",
                    border: "1px solid var(--col-emerald-25)",
                  }
                : {
                    background: "var(--col-danger-15)",
                    color: "var(--col-danger)",
                    border: "1px solid var(--col-danger-22)",
                  }
            }
          >
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{
                background:
                  gstStatus.toLowerCase() === "active" ? "var(--col-success)" : "var(--col-danger)",
              }}
            />
            GST: {gstStatus}
          </span>
        </div>
      )}

      {/* ── Contact actions row (web only) ─────────────────────────────── */}
      {pickerAvail && !nativeMode && (
        <div className="flex gap-2">
          {/* Bulk-load for suggestions */}
          {!bulkLoadDone ? (
            <button
              type="button"
              onClick={handleLoadContactsWeb}
              disabled={loadingBulk}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95"
              style={{
                background: "var(--col-accent-15)",
                border: "1px solid var(--col-accent-25)",
                color: "var(--col-indigo-light)",
              }}
            >
              {loadingBulk ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  Loading contacts…
                </>
              ) : (
                <>
                  <BookUser size={13} />
                  Load contacts for suggestions
                </>
              )}
            </button>
          ) : (
            <div
              className="flex-1 flex items-center gap-1.5 px-3 py-2 rounded-xl"
              style={{
                background: "var(--col-emerald-07)",
                border: "1px solid var(--col-emerald-18)",
              }}
            >
              <BookUser size={12} style={{ color: "var(--col-success)" }} />
              <span
                className="text-app-md font-bold"
                style={{ color: "var(--col-success)" }}
              >
                {contacts.length} contacts loaded — type to search
              </span>
            </div>
          )}
          {/* One-shot picker — always available */}
          <button
            type="button"
            onClick={handlePickFromDevice}
            disabled={pickingContact}
            className="px-3 py-2.5 rounded-xl font-bold flex items-center gap-1.5 transition-all active:scale-95 text-xs"
            style={{
              background: "var(--col-violet-15)",
              border: "1px solid var(--col-violet-25)",
              color: "var(--col-violet)",
            }}
          >
            {pickingContact ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Phone size={13} />
            )}
            {pickingContact ? "Opening…" : "Pick one"}
          </button>
        </div>
      )}

      {/* Native: show loading / loaded badge */}
      {nativeMode && (
        <div
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg"
          style={{
            background: "var(--rgba-white-04)",
            border: "1px solid var(--glass-border)",
          }}
        >
          {loadingBulk ? (
            <>
              <Loader2
                size={11}
                className="animate-spin"
                style={{ color: "var(--text-muted)" }}
              />
              <span
                className="text-app-sm"
                style={{ color: "var(--text-muted)" }}
              >
                Loading contacts…
              </span>
            </>
          ) : bulkLoadDone ? (
            <>
              <BookUser size={11} style={{ color: "var(--col-success)" }} />
              <span
                className="text-app-sm font-bold"
                style={{ color: "var(--col-success)" }}
              >
                {contacts.length} contacts ready — type to search
              </span>
            </>
          ) : (
            <>
              <BookUser size={11} style={{ color: "var(--text-muted)" }} />
              <span
                className="text-app-sm"
                style={{ color: "var(--text-muted)" }}
              >
                No contacts loaded (check permission)
              </span>
            </>
          )}
        </div>
      )}

      {/* Name field with inline suggestions (native) or picker icon (web) */}
      <div ref={nameRef} className="relative">
        <label className="block text-xs font-bold text-[var(--text-muted)] mb-1 flex items-center gap-1">
          <Briefcase size={12} /> Party Name (Firm Name)
        </label>
        <div className="relative">
          <Briefcase
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            size={14}
            style={{ color: "var(--text-muted)" }}
          />
          <input
            className="w-full border border-white/12 rounded-lg p-2.5 pl-8 pr-10 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500 bg-[var(--rgba-white-05)] text-[var(--text-secondary)]"
            value={formData.name || ""}
            onChange={(e) => onNameChange(e.target.value)}
            onFocus={() => {
              if (contacts.length > 0) {
                setNameSugg(searchContacts(contacts, formData.name || ""));
                setNameDropdown(true);
              }
            }}
            onBlur={() => setTimeout(() => setNameDropdown(false), 200)}
            placeholder="Business Name"
          />
          {/* Book icon inside field: on native shows dropdown of loaded contacts;
              on web (picker available) picks one contact directly */}
          {(pickerAvail || nativeMode) && contacts.length > 0 && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-all active:scale-90"
              style={{ color: "var(--col-violet-60)" }}
              onMouseDown={(e) => {
                e.preventDefault();
                setNameSugg(contacts.slice(0, 4));
                setNameDropdown(true);
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                setNameSugg(contacts.slice(0, 4));
                setNameDropdown(true);
              }}
              title="Browse contacts"
            >
              <BookUser size={15} />
            </button>
          )}
        </div>
        <ContactSuggestions
          suggestions={nameSuggestions}
          onSelect={selectContact}
          visible={nameDropdown && contacts.length > 0}
        />
      </div>

      <InputField
        label="Legal Name (Owner)"
        field="legal_name"
        icon={UserCheck}
        value={formData.legal_name}
        onChange={handleChange}
        placeholder="Legal Owner Name"
      />

      {/* Phone field with inline suggestions */}
      <div ref={phoneRef} className="relative">
        <label className="block text-xs font-bold text-[var(--text-muted)] mb-1 flex items-center gap-1">
          <Phone size={12} /> Phone
        </label>
        <div className="relative">
          <Phone
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            size={14}
            style={{ color: "var(--text-muted)" }}
          />
          <input
            type="tel"
            className="w-full border border-white/12 rounded-lg p-2.5 pl-8 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500 bg-[var(--rgba-white-05)] text-[var(--text-secondary)]"
            value={formData.contact || ""}
            onChange={(e) => onPhoneChange(e.target.value)}
            onFocus={() => {
              if (contacts.length > 0) {
                setPhoneSugg(searchContacts(contacts, formData.contact || ""));
                setPhoneDropdown(true);
              }
            }}
            onBlur={() => setTimeout(() => setPhoneDropdown(false), 200)}
            placeholder="Mobile number"
          />
        </div>
        <ContactSuggestions
          suggestions={phoneSuggestions}
          onSelect={selectContact}
          visible={phoneDropdown && contacts.length > 0}
        />
      </div>

      {/* Role */}
      <div className="mb-3">
        <label className="block text-xs font-bold text-[var(--text-muted)] mb-1">
          Role
        </label>
        <select
          className="w-full border border-white/12 bg-[var(--rgba-white-05)] p-2.5 rounded-lg text-sm font-bold text-[var(--text-secondary)]"
          value={formData.role || "customer"}
          onChange={(e) => handleChange("role", e.target.value)}
        >
          <option value="customer">Customer</option>
          <option value="supplier">Supplier</option>
        </select>
      </div>

      <InputField
        label="Address"
        field="address"
        icon={MapPin}
        value={formData.address}
        onChange={handleChange}
      />
      <InputField
        label="State"
        field="state"
        icon={MapPin}
        value={formData.state}
        onChange={handleChange}
        placeholder="e.g. Maharashtra"
      />
      <InputField
        label="Site / Delivery Location (Optional)"
        field="site"
        icon={Truck}
        value={formData.site}
        onChange={handleChange}
        placeholder="e.g. Factory Gate, Plot 12"
      />
      <InputField
        label="Credit Limit (Optional)"
        field="credit_limit"
        type="number"
        icon={IndianRupee}
        value={formData.credit_limit}
        onChange={handleChange}
        placeholder="Max outstanding amount"
      />

      {/* Opening Balance */}
      <div>
        <label
          className="block text-xs font-bold mb-2 flex items-center gap-1"
          style={{ color: "var(--text-muted)" }}
        >
          <IndianRupee size={12} /> Opening Balance (Optional)
        </label>
        <div className="space-y-2">
          <div
            className="grid grid-cols-2 gap-1.5 p-1 rounded-xl"
            style={{
              background: "var(--rgba-white-04)",
              border: "1px solid var(--glass-border)",
            }}
          >
            {[
              { val: "they_owe", label: "Receivable" },
              { val: "we_owe", label: "Payable" },
            ].map((opt) => (
              <button
                key={opt.val}
                type="button"
                onClick={() => handleChange("opening_balance_type", opt.val)}
                className="py-2 rounded-lg text-xs font-bold transition-all"
                style={
                  (formData.opening_balance_type || "they_owe") === opt.val
                    ? {
                        background: "var(--col-violet-25)",
                        color: "var(--col-violet)",
                        border: "1px solid var(--col-violet-35)",
                      }
                    : { color: "var(--text-muted)" }
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {/* Date — left */}
            <div>
              <label
                className="block text-app-sm font-bold mb-1"
                style={{ color: "var(--text-muted)" }}
              >
                As of Date
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={formData.opening_balance_date || ""}
                  onChange={(e) =>
                    handleChange("opening_balance_date", e.target.value)
                  }
                  className="w-full px-3 py-2.5 rounded-[10px] text-xs font-semibold focus:outline-none transition-all"
                  style={{
                    background: "var(--rgba-white-06)",
                    border: "1px solid var(--glass-border)",
                    color: formData.opening_balance_date
                      ? "var(--text-secondary)"
                      : "transparent",
                    colorScheme: "dark",
                  }}
                />
                {!formData.opening_balance_date && (
                  <span
                    className="absolute inset-0 flex items-center px-3 text-xs font-semibold pointer-events-none select-none"
                    style={{ color: "var(--text-muted)" }}
                  >
                    DD/MM/YYYY
                  </span>
                )}
              </div>
            </div>
            {/* Amount — right */}
            <InputField
              label="Amount"
              field="opening_balance"
              type="number"
              icon={IndianRupee}
              value={formData.opening_balance || ""}
              onChange={handleChange}
              placeholder="Leave blank if none"
            />
          </div>
        </div>
      </div>

      {/* Linked items — only shown when role is supplier */}
      {formData.role === "supplier" && inventoryItems.length > 0 && (
        <div className="space-y-2">
          <label className="block text-xs font-bold text-[var(--text-muted)] flex items-center gap-1">
            <Package size={12} /> Items Supplied (Optional)
          </label>

          {/* Selected items as pills */}
          {linkedItems.length > 0 && (
            <div className="flex flex-wrap gap-1.5 p-2.5 rounded-xl border border-white/10 bg-[var(--rgba-white-03)]">
              {linkedItems.map((name) => (
                <span
                  key={name}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold"
                  style={{
                    background: "rgba(251,191,36,0.12)",
                    color: "var(--col-warning)",
                    border: "1px solid rgba(251,191,36,0.22)",
                  }}
                >
                  {name}
                  <button
                    type="button"
                    onClick={() => removeLinkedItem(name)}
                    className="ml-0.5 rounded-full hover:bg-white/10 transition-all p-0.5"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Search + dropdown */}
          <div className="relative" ref={itemSearchRef}>
            <div className="relative">
              <Search
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: "var(--text-muted)" }}
              />
              <input
                className="w-full border border-white/12 rounded-lg p-2.5 pl-8 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500 bg-[var(--rgba-white-05)] text-[var(--text-secondary)]"
                placeholder="Search items to add…"
                value={itemSearch}
                onChange={(e) => {
                  setItemSearch(e.target.value);
                  setItemDropdownOpen(true);
                }}
                onFocus={() => setItemDropdownOpen(true)}
                onBlur={() => setTimeout(() => setItemDropdownOpen(false), 200)}
              />
            </div>
            {itemDropdownOpen && filteredItemOptions.length > 0 && (
              <div
                className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl overflow-hidden max-h-44 overflow-y-auto"
                style={{
                  background: "var(--modal-bg)",
                  border: "1px solid var(--glass-border)",
                  backdropFilter: "blur(20px)",
                  boxShadow: "0 8px 32px var(--rgba-black-50)",
                }}
              >
                {filteredItemOptions.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="w-full text-left px-3 py-2.5 text-sm font-bold transition-all active:bg-white/10 flex items-center gap-2"
                    style={{
                      color: "var(--text-primary)",
                      borderBottom: "1px solid var(--glass-border)",
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addLinkedItem(name);
                    }}
                    onTouchStart={(e) => {
                      e.preventDefault();
                      addLinkedItem(name);
                    }}
                  >
                    <Package
                      size={12}
                      style={{ color: "rgba(251,191,36,0.6)", flexShrink: 0 }}
                    />
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {linkedItems.length === 0 && (
            <p
              className="text-app-sm font-semibold px-1"
              style={{ color: "var(--text-muted)" }}
            >
              Link items this supplier provides — helps auto-fill purchase
              orders
            </p>
          )}
        </div>
      )}
    </div>
  );
};

const DEFAULT_UNITS = [
  "Pcs",
  "Kg",
  "Gm",
  "Mg",
  "Ton",
  "Ltr",
  "Ml",
  "Mtr",
  "Cm",
  "Ft",
  "Inch",
  "Bag",
  "Box",
  "Set",
  "Doz",
  "Pair",
  "Pack",
  "Roll",
  "Sheet",
  "Bundle",
  "Carton",
  "Bottle",
  "Can",
  "Tube",
  "Sack",
  "Plate",
  "Unit",
];

/* ══ Other forms — unchanged ════════════════════════════════════════════════ */
export const InventoryForm = ({
  formData,
  handleChange,
  units,
  onAddUnit,
}: any) => {
  const unitList: string[] = units && units.length > 0 ? units : DEFAULT_UNITS;
  const currentUnit: string = formData.unit || "Pcs";

  const [showPicker, setShowPicker] = useState(false);
  const [showAddNew, setShowAddNew] = useState(false);
  const [newUnitText, setNewUnitText] = useState("");

  const selectUnit = (u: string) => {
    handleChange("unit", u);
    setShowPicker(false);
    setShowAddNew(false);
    setNewUnitText("");
  };

  const handleSaveNew = () => {
    const trimmed = newUnitText.trim();
    if (!trimmed) return;
    onAddUnit?.(trimmed);
    handleChange("unit", trimmed);
    setShowPicker(false);
    setShowAddNew(false);
    setNewUnitText("");
  };

  return (
    <div className="space-y-4">
      <InputField
        label="Item Name"
        field="name"
        icon={Package}
        value={formData.name}
        onChange={handleChange}
        placeholder="e.g. Cement Bag 50kg"
      />
      <div className="grid grid-cols-2 gap-3">
        <div className="mb-3">
          <label className="block text-xs font-bold text-[var(--text-muted)] mb-1">
            Unit
          </label>
          {/* Trigger button */}
          <button
            type="button"
            onClick={() => {
              setShowPicker((p) => !p);
              setShowAddNew(false);
              setNewUnitText("");
            }}
            className="w-full flex items-center justify-between border border-white/12 bg-[var(--rgba-white-05)] p-2.5 rounded-lg text-sm font-bold text-[var(--text-secondary)] outline-none"
          >
            <span>{currentUnit}</span>
            <ChevronDown
              size={14}
              className={`transition-transform ${showPicker ? "rotate-180" : ""}`}
              style={{ color: "var(--text-muted)" }}
            />
          </button>

          {/* Dropdown panel */}
          {showPicker && (
            <div
              className="mt-1 rounded-xl overflow-hidden"
              style={{
                background: "var(--dropdown-bg)",
                border: '1px solid var(--glass-border)',
                zIndex: 10,
                position: "relative",
              }}
            >
              {/* Unit grid */}
              <div className="p-2 flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                {unitList.map((u: string) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => selectUnit(u)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                    style={
                      u === currentUnit
                        ? {
                            background: "var(--col-accent-35)",
                            color: "var(--col-violet)",
                            border: "1px solid var(--col-accent-50)",
                          }
                        : {
                            background: "var(--rgba-white-06)",
                            color: "var(--text-secondary)",
                            border: "1px solid var(--glass-border)",
                          }
                    }
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
                    style={{ color: "rgba(167,139,250,0.8)" }}
                  >
                    <Plus size={13} /> Add new unit
                  </button>
                ) : (
                  <div className="flex gap-2 p-2">
                    <input
                      autoFocus
                      type="text"
                      value={newUnitText}
                      onChange={(e) => setNewUnitText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSaveNew()}
                      placeholder="e.g. Quintal, Trolley…"
                      className="flex-1 bg-[var(--rgba-white-07)] border border-white/12 rounded-lg px-3 py-2 text-xs font-bold outline-none text-[var(--text-secondary)] placeholder:text-[var(--text-muted)]"
                    />
                    <button
                      type="button"
                      onClick={handleSaveNew}
                      className="px-3 py-2 rounded-lg text-xs font-bold"
                      style={{
                        background: "var(--col-accent-35)",
                        color: "var(--col-violet)",
                        border: "1px solid var(--col-accent-40)",
                      }}
                    >
                      Save
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <InputField
          label="HSN Code"
          field="hsn_code"
          icon={Hash}
          value={formData.hsn_code}
          onChange={handleChange}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 p-3 rounded-xl border border-white/10 bg-[var(--rgba-white-04)]">
        <InputField
          label="Purchase Rate"
          field="purchase_rate"
          type="number"
          icon={IndianRupee}
          value={formData.purchase_rate}
          onChange={handleChange}
        />
        <InputField
          label="Sale Rate"
          field="sale_rate"
          type="number"
          icon={IndianRupee}
          value={formData.sale_rate}
          onChange={handleChange}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="mb-3">
          <label className="block text-xs font-bold text-[var(--text-muted)] mb-1">
            GST Tax %
          </label>
          <input
            type="number"
            list="gst_rates"
            className="w-full border border-white/12 bg-[var(--rgba-white-05)] p-2.5 rounded-lg text-sm font-bold text-[var(--text-secondary)] outline-none"
            value={formData.gst_percent || ""}
            onChange={(e) => handleChange("gst_percent", e.target.value)}
            placeholder="Custom or Select"
          />
          <datalist id="gst_rates">
            <option value="0" />
            <option value="5" />
            <option value="12" />
            <option value="18" />
            <option value="28" />
          </datalist>
        </div>
        <div className="mb-3">
          <label className="block text-xs font-bold text-[var(--text-muted)] mb-1">
            Rate Type
          </label>
          <div className="flex rounded-lg p-1 border border-white/12 h-[42px]">
            <button
              type="button"
              onClick={() => handleChange("price_type", "exclusive")}
              className={`flex-1 rounded-md text-xs font-bold transition-all ${(formData.price_type || "exclusive") === "exclusive" ? "bg-[var(--col-violet-25)] text-col-violet" : "text-[var(--text-muted)]"}`}
            >
              Exclusive
            </button>
            <button
              type="button"
              onClick={() => handleChange("price_type", "inclusive")}
              className={`flex-1 rounded-md text-xs font-bold transition-all ${formData.price_type === "inclusive" ? "bg-[var(--col-emerald-25)] text-col-success" : "text-[var(--text-muted)]"}`}
            >
              Inclusive
            </button>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 p-3 rounded-xl border border-[var(--col-warning-25)] bg-[var(--col-warning-07)]">
        <InputField
          label="Opening Stock"
          field="quantity"
          type="number"
          icon={Layers}
          value={formData.quantity}
          onChange={handleChange}
        />
        <InputField
          label="Low Stock Warning"
          field="min_stock"
          type="number"
          icon={AlertTriangle}
          value={formData.min_stock}
          onChange={handleChange}
          placeholder="Alert at..."
        />
      </div>
    </div>
  );
};

export const VehicleForm = ({ formData, handleChange }: any) => {
  const handleVehicleNum = (_field: string, val: string) =>
    handleChange("vehicle_number", val.toUpperCase());
  return (
    <div className="space-y-3">
      <InputField
        label="Vehicle Number"
        field="vehicle_number"
        icon={Truck}
        value={formData.vehicle_number}
        onChange={handleVehicleNum}
        placeholder="MH 04 AB 1234"
      />
      <InputField
        label="Vehicle Model"
        field="model"
        icon={Truck}
        value={formData.model}
        onChange={handleChange}
        placeholder="e.g. Tata Ace, Mahindra Pickup"
      />
      <div className="grid grid-cols-2 gap-3">
        <InputField
          label="Owner Name"
          field="owner_name"
          icon={User}
          value={formData.owner_name || ""}
          onChange={handleChange}
          placeholder="Owner name"
        />
        <InputField
          label="Owner Phone"
          field="owner_phone"
          icon={Phone}
          value={formData.owner_phone || ""}
          onChange={handleChange}
          placeholder="Owner phone"
          type="tel"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <InputField
          label="Driver Name"
          field="driver_name"
          icon={User}
          value={formData.driver_name}
          onChange={handleChange}
        />
        <InputField
          label="Driver Phone"
          field="driver_phone"
          icon={Phone}
          value={formData.driver_phone}
          onChange={handleChange}
          type="tel"
        />
      </div>
    </div>
  );
};

export const ExpenseForm = ({ formData, handleChange, expenseTypes }: any) => (
  <>
    <div className="grid grid-cols-2 gap-3">
      <InputField
        label="Date"
        field="date"
        type="date"
        value={formData.date}
        onChange={handleChange}
      />
      <InputField
        label="Amount"
        field="amount"
        type="number"
        icon={IndianRupee}
        value={formData.amount}
        onChange={handleChange}
      />
    </div>
    <AutoComplete
      label="Expense Type"
      value={formData.category || ""}
      onChange={(v: string) => handleChange("category", v)}
      options={expenseTypes || []}
      icon={Wallet}
      placeholder="e.g. Rent, Tea, Salary"
    />
    <InputField
      label="Note"
      field="notes"
      icon={FileText}
      value={formData.notes}
      onChange={handleChange}
      placeholder="Description (Optional)..."
    />
  </>
);
