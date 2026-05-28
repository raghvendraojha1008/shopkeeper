import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useBackHandler } from '../../services/useBackHandler';
import { User } from 'firebase/auth';
import { ArrowLeft, Save } from 'lucide-react';
import { ApiService } from '../../services/api';
import { RecurringService, advanceDate } from '../../services/recurringService';
import { SyncQueueService } from '../../services/syncQueue';
import { GSTService } from '../../services/gstApi';
import { AppSettings } from '../../types';
import { haptic } from '../../utils/haptics';
import { useUI } from '../../context/UIContext';
import { getIDForEntry } from '../../utils/idGenerator';
import { useEditPassword } from '../../context/EditPasswordContext';
import { useParties, useInventory, useLedger } from '../../context/DataContext';

// IMPORT SUB-COMPONENTS
import { InventoryForm, PartyForm, VehicleForm, ExpenseForm } from './manual/SimpleForms';
import { OrderForm, TransactionForm } from './manual/TransactionForms';

interface ManualEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'sales' | 'purchases' | 'transactions' | 'inventory' |
        'expenses' | 'vehicles' | 'parties';
  user: User | null;
  initialData?: any;
  appSettings: AppSettings;
  onSuccess?: (data: any) => void;
  onLocalSave?: (data: any) => void;
}

const ManualEntryModal: React.FC<ManualEntryModalProps> = ({ isOpen, onClose, type, user, initialData, appSettings, onSuccess, onLocalSave }) => {
  const { showToast } = useUI();
  const { requireEditPassword } = useEditPassword();

  // Register with central back stack — Android back closes this modal
  useBackHandler(onClose, isOpen, 10);

  const [loading, setLoading] = useState(false);
  const [gstFetching, setGstFetching] = useState(false);
  const [formData, setFormData] = useState<any>({});
  const [items, setItems] = useState<any[]>([{ item_name: '', quantity: '', rate: '', hsn_code: '', gst_percent: '', unit: 'Pcs', total: 0, price_type: 'exclusive' }]);

  const [autoAddParty, setAutoAddParty] = useState(true);

  const [linkedPayments, setLinkedPayments] = useState<any[]>([]);
  const [vehicleList, setVehicleList] = useState<string[]>([]);

  // Use the shared React Query cache — no Firestore reads on modal open.
  const uid = user?.uid ?? '';
  const { data: cachedParties }   = useParties(uid);
  const { data: cachedInventory } = useInventory(uid);
  const { data: cachedLedger }    = useLedger(uid);

  const customers     = useMemo(() => (cachedParties as any[]).filter(p => p.role === 'customer'),   [cachedParties]);
  const suppliers     = useMemo(() => (cachedParties as any[]).filter(p => p.role === 'supplier'),   [cachedParties]);
  const inventoryList = useMemo(() => cachedInventory as any[],                                       [cachedInventory]);
  const itemNames     = useMemo(() => (cachedInventory as any[]).map(i => i.name),                   [cachedInventory]);
  const availableOrders = useMemo(() => cachedLedger as any[],                                       [cachedLedger]);
  const ledgerRecords   = useMemo(() => cachedLedger as any[],                                       [cachedLedger]);

  // FIX (Critical #1): Guard ref prevents the form-init block from running more than once
  // per modal open, even if parent causes re-renders while the async load() is in flight.
  const initializedRef = useRef(false);
  // Guard against rapid double-taps before `loading` state propagates
  const submittingRef = useRef(false);

  // ── EFFECT 1: runs ONCE on open — initialises formData immediately ──────────────
  // Separated from the async data-load effect so a parent re-render can never
  // wipe out what the user has already typed.
  useEffect(() => {
    if (!isOpen) {
      // Reset guard when modal closes so next open reinitialises correctly.
      initializedRef.current = false;
      return;
    }
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (initialData) {
      // Normalise the date field to YYYY-MM-DD so the date input always
      // receives a valid value, regardless of how it was stored (ISO timestamp
      // string, Firestore Timestamp object, or already YYYY-MM-DD).
      const normalised = { ...initialData };
      if (normalised.date) {
        if (normalised.date?.toDate) {
          // Firestore Timestamp object
          normalised.date = normalised.date.toDate().toISOString().split('T')[0];
        } else if (typeof normalised.date === 'string' && normalised.date.length > 10) {
          // Full ISO string like "2026-04-15T00:00:00.000Z"
          normalised.date = normalised.date.split('T')[0];
        }
      }
      setFormData(normalised);
      if (initialData.items) setItems(initialData.items);
    } else {
      const init: any = { date: new Date().toISOString().split('T')[0] };
      if (type === 'transactions') {
        init.type = 'received';
        init.transaction_id = getIDForEntry('received');
      }
      if (type === 'sales') {
        init.invoice_no = getIDForEntry('sell');
      }
      if (type === 'purchases') {
        init.bill_no = getIDForEntry('purchase');
      }
      // FIX (Bug 4): Default role to 'customer' so an untouched dropdown
      // doesn't silently save the new party as a supplier.
      if (type === 'parties') {
        init.role = 'customer';
      }
      setFormData(init);
      setItems([{ item_name: '', quantity: '', rate: '', hsn_code: '', gst_percent: '', unit: 'Pcs', total: 0, price_type: 'exclusive' }]);
    }
    setLinkedPayments([]);
    setAutoAddParty(true);
  }, [isOpen]); // intentionally omit initialData/type — we only want this once per open

  // ── EFFECT 2: lightweight async load — only fetches what isn't in the
  //    shared React Query cache (vehicles, and linked payments for edits).
  useEffect(() => {
    if (!isOpen || !user) return;

    const load = async () => {
      // Vehicles are not in the cache — fetch them.
      const veh = await ApiService.getAll(user.uid, 'vehicles');
      setVehicleList(veh.docs.map((d: any) => d.data().vehicle_number));

      // For editing an existing sale/purchase: load payments already linked to it.
      if (initialData && (type === 'sales' || type === 'purchases')) {
        const refNo = type === 'sales' ? initialData.invoice_no : initialData.bill_no;
        if (refNo) {
          const allTrans = await ApiService.getAll(user.uid, 'transactions');
          const relevant = allTrans.docs
            .map((d: any) => ({ id: d.id, ...d.data() }))
            .filter((t: any) => String(t.bill_no) === String(refNo));
          setLinkedPayments(relevant);
        }
      }
    };

    load();
  }, [isOpen, user, type]); // intentionally excludes initialData to avoid re-running on edit open

  const handleChange = (field: string, value: any) => {
    setFormData((p: any) => {
      const newState = { ...p, [field]: value };
      if (field === 'party_name') {
        const allParties = [...customers, ...suppliers];
        const matchedParty = allParties.find(party => party.name === value);
        if (matchedParty) {
          if (matchedParty.address) newState.address = matchedParty.address;
          if (matchedParty.site) {
            newState.site = matchedParty.site;
            newState.different_site = true;
          }
        }
        if (type === 'sales') newState.paid_by = value;
        else if (type === 'purchases') newState.paid_to = value;
      }
      // When user picks a linked invoice/bill, extract the invoice_no and store as bill_no
      if (field === 'linked_invoice') {
        const invoicePart = String(value).split(' | ')[0]?.trim();
        newState.bill_no = (invoicePart && invoicePart !== 'No Inv') ? invoicePart : '';
      }
      return newState;
    });
  };

  const handleFetchGSTIN = async () => {
    if (!formData.gstin || formData.gstin.length !== 15) return showToast('Invalid GSTIN', 'error');
    setGstFetching(true);
    try {
      const data = await GSTService.fetchDetails(formData.gstin);
      if (data) {
        setFormData((prev: any) => ({
          ...prev,
          name: data.tradeName || data.legalName || prev.name,
          legal_name: (data.legalName && data.legalName !== data.tradeName) ? data.legalName : '',
          address: data.address || '',
          gstin: formData.gstin
        }));
        showToast('GST Details Fetched', 'success');
      }
    } catch (e: any) {
      // FIX (Bug 3): Surface the actual error so users know whether the GSTIN
      // is invalid, the lookup is unconfigured, or it was a network issue.
      // Previously we showed a generic toast that looked like the form had
      // crashed. Note: this is wrapped in try/catch and the form modal is
      // never closed by the fetch failing (Fetch button has type="button").
      showToast(e?.message || 'Failed to fetch GST details', 'error');
    } finally {
      setGstFetching(false);
    }
  };

  const activePartyList = useMemo(() => {
    const custNames = customers.map(c => c.name);
    const suppNames = suppliers.map(s => s.name);
    if (type === 'sales') return custNames;
    if (type === 'purchases') return suppNames;
    if (type === 'transactions') return formData.type === 'received' ? custNames : suppNames;
    return [...custNames, ...suppNames];
  }, [type, formData.type, customers, suppliers]);

  const filteredOrders = useMemo(() => {
    if (type !== 'transactions') return [];
    const relevantType = formData.type === 'received' ? 'sell' : 'purchase';
    return availableOrders
      .filter(o => o.type === relevantType)
      .map(o => `${o.invoice_no || 'No Inv'} | ${o.party_name} | ${o.date}`);
  }, [availableOrders, formData.type, type]);

  const handleItemChange = (idx: number, field: string, value: any) => {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const updated = { ...it, [field]: value };

      if (field === 'item_name') {
        const matchedItem = inventoryList.find(x => x.name === value);
        if (matchedItem) {
          updated.hsn_code = matchedItem.hsn_code || '';
          updated.gst_percent = matchedItem.gst_percent || '';
          updated.rate = type === 'sales' ? (matchedItem.sale_rate || '') : (matchedItem.purchase_rate || '');
          updated.unit = matchedItem.unit || 'Pcs';
          updated.price_type = matchedItem.price_type || 'exclusive';
        }
      }

      const rate = Number(updated.rate) || 0;
      const gst = Number(updated.gst_percent) || 0;

      if (field === 'total') {
        const newTotal = Number(value) || 0;
        updated.total = newTotal;
        if (rate > 0) {
          const effectiveRate = updated.price_type === 'inclusive' ? rate : rate * (1 + gst / 100);
          updated.quantity = (newTotal / effectiveRate).toFixed(2);
        } else {
          updated.quantity = 0;
        }
      } else {
        const qty = Number(updated.quantity) || 0;
        if (updated.price_type === 'inclusive') updated.total = qty * rate;
        else updated.total = (qty * rate) * (1 + gst / 100);
      }
      return updated;
    }));
  };

  const calculateTotal = () => {
    const itemsTotal = items.reduce((s, i) => s + (Number(i.total) || 0), 0);
    const rent = Number(formData.vehicle_rent) || 0;
    const discount = Number(formData.discount_amount) || 0;
    return itemsTotal + rent - discount;
  };

  const handleRemoveLinkedPayment = async (index: number, payment: any) => {
    if (!payment._isNew && payment.id) {
      try {
        if (navigator.onLine) {
          await ApiService.delete(user!.uid, 'transactions', payment.id);
          showToast("Payment record deleted", "success");
        } else {
          SyncQueueService.addToQueue(user!.uid, 'delete', 'transactions', {}, payment.id);
          showToast("Deletion queued — will apply when online", "info");
        }
      } catch (e) {
        console.error(e);
        showToast("Failed to delete payment", "error");
        return;
      }
    }
    setLinkedPayments(prev => prev.filter((_, i) => i !== index));
  };

  // Compute next sequential party code — stable memo based on loaded data.
  // This re-computes whenever customers/suppliers change (i.e. after Effect 2 loads).
  // Using useMemo avoids stale-closure issues and prevents showing P-0001 before data loads.
  const nextPartyCode = useMemo((): string => {
    const all = [...customers, ...suppliers];
    const maxNum = all.reduce((max, p) => {
      if (!p.party_code) return max;
      const n = parseInt(String(p.party_code).replace(/^P-/, ''), 10);
      return !isNaN(n) && n > max ? n : max;
    }, 0);
    return `P-${String(maxNum + 1).padStart(4, '0')}`;
  }, [customers, suppliers]);

  const handleSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e) e.preventDefault();
    if (!user || loading || submittingRef.current) return;
    submittingRef.current = true;

    // Require edit password when editing an existing entry
    if (initialData?.id) {
      const ok = await requireEditPassword();
      if (!ok) { submittingRef.current = false; return; }
    }

    if (type !== 'parties' && type !== 'vehicles' && type !== 'inventory' && !formData.date) {
      showToast("Please enter a date", "error");
      submittingRef.current = false;
      return;
    }
    if (
      (type === 'sales' || type === 'purchases' || type === 'transactions') &&
      !formData.party_name?.trim()
    ) {
      showToast("Please enter a party name", "error");
      submittingRef.current = false;
      return;
    }
    if (
      (type === 'sales' || type === 'purchases') &&
      !items.some((i: any) => i.item_name?.trim())
    ) {
      showToast("Please add at least one item", "error");
      submittingRef.current = false;
      return;
    }

    setLoading(true);
    haptic.medium();
    try {
      const payload: any = JSON.parse(JSON.stringify(formData));
      let collection = '';

      // --- AUTO ADD PARTY LOGIC ---
      if (autoAddParty && payload.party_name &&
        (type === 'sales' || type === 'purchases' || type === 'transactions')) {

        let role = 'customer';
        if (type === 'purchases') role = 'supplier';
        if (type === 'transactions' && payload.type === 'paid') role = 'supplier';

        // FIX (Medium #2): Case-insensitive duplicate check to prevent "Rahul Traders" / "rahul traders" duplicates
        const exists = [...customers, ...suppliers].some(
          p => (p.name || '').toLowerCase() === (payload.party_name || '').toLowerCase()
        );

        if (!exists) {
          const newParty = {
            name: payload.party_name,
            role: role,
            party_code: nextPartyCode,
            address: payload.address || '',
            contact: '',
            created_at: new Date().toISOString()
          };
          if (navigator.onLine) {
            await ApiService.add(user.uid, 'parties', newParty);
          } else {
            SyncQueueService.addToQueue(user.uid, 'create', 'parties', newParty);
          }
        }
      }
      // ----------------------------

      if (type === 'sales' || type === 'purchases') {
        collection = 'ledger_entries';
        payload.items = items;
        payload.total_amount = calculateTotal();
        payload.type = type === 'sales' ? 'sell' : 'purchase';

        if (!initialData?.id) {
          if (type === 'sales' && !payload.invoice_no) {
            payload.invoice_no = getIDForEntry('sell');
          } else if (type === 'purchases' && !payload.bill_no) {
            payload.bill_no = getIDForEntry('purchase');
          }
        }
      } else if (type === 'transactions') {
        collection = 'transactions';
        payload.amount = Number(payload.amount);

        if (!initialData?.id && !payload.transaction_id) {
          payload.transaction_id = getIDForEntry(payload.type as 'received' | 'paid');
        }
      } else if (type === 'inventory') {
        collection = 'inventory';
        payload.sale_rate = Number(payload.sale_rate) || 0;
        payload.purchase_rate = Number(payload.purchase_rate) || 0;
        payload.quantity = Number(payload.quantity) || 0;
        payload.min_stock = Number(payload.min_stock) || 0;

        // FIX (Issue #3): InventoryForm saves opening stock to `payload.quantity`
        // but every view that tracks stock reads `item.current_stock`. For new
        // items, sync current_stock from quantity so stock is never zero on create.
        // For edits we do NOT overwrite current_stock — it is managed by sale/purchase
        // auto-deductions and should not be reset to the opening quantity on every edit.
        if (!initialData?.id) {
          payload.current_stock = payload.quantity;
        }

        if (!initialData?.id && !payload.item_id) {
          payload.item_id = getIDForEntry('inventory');
        }
      } else if (type === 'expenses') collection = 'expenses';
      else if (type === 'vehicles') collection = 'vehicles';
      else if (type === 'parties') {
        collection = 'parties';

        // FIX (Bug 4): Defensive default — if the role somehow arrives undefined
        // (e.g. user never opened the dropdown), persist it as 'customer' to
        // match the visible default in the form. Without this, the parties
        // list shows the new entry under "Suppliers".
        if (payload.role !== 'customer' && payload.role !== 'supplier') {
          payload.role = 'customer';
        }

        if (!initialData?.id && !payload.party_code) {
          payload.party_code = nextPartyCode;
        }
      }

      if (onLocalSave) {
        const newLinkedPayments = linkedPayments.filter(p => p._isNew);
        onLocalSave({ ...payload, collection, _linkedPayments: newLinkedPayments });
        onClose();
        haptic.success();
        return;
      }

      const isOffline = !navigator.onLine;

      if (initialData?.id) {
        if (isOffline) {
          SyncQueueService.addToQueue(user.uid, 'update', collection, payload, initialData.id);
        } else {
          await ApiService.update(user.uid, collection, initialData.id, payload);
        }
        payload.id = initialData.id;
      } else {
        payload.created_at = new Date().toISOString();
        if (isOffline) {
          SyncQueueService.addToQueue(user.uid, 'create', collection, payload);
        } else {
          const addResult = await ApiService.add(user.uid, collection, payload);
          payload.id = addResult.id;
        }
      }

      if (linkedPayments.length > 0) {
        const newPayments = linkedPayments.filter(p => p._isNew);
        const txType = type === 'sales' ? 'received' : 'paid';
        newPayments.forEach(pay => {
          const transPayload = {
            date: pay.date,
            amount: pay.amount,
            payment_mode: pay.payment_mode,
            payment_purpose: pay.payment_purpose,
            party_name: pay.party_name || payload.party_name,
            bill_no: pay.bill_no || payload.invoice_no || payload.bill_no,
            notes: pay.notes,
            created_at: new Date().toISOString(),
            type: txType,
            transaction_id: getIDForEntry(txType)
          };
          if (isOffline) {
            SyncQueueService.addToQueue(user.uid, 'create', 'transactions', transPayload);
          } else {
            ApiService.add(user.uid, 'transactions', transPayload);
          }
        });
        if (!isOffline) await new Promise(r => setTimeout(r, 0)); // flush microtasks
      }

      // Inventory auto-update — uses the cached inventory list (no extra Firestore read).
      if (!isOffline && (type === 'sales' || type === 'purchases') && appSettings.automation?.auto_update_inventory) {
        const isSale = type === 'sales';
        const stockUpdates = (payload.items || []).map(async (lineItem: any) => {
          if (!lineItem.item_name) return;
          const match = inventoryList.find((i: any) =>
            i.name?.toLowerCase() === lineItem.item_name?.toLowerCase()
          );
          if (!match?.id) return;
          const current = Number(match.current_stock) || 0;
          const qty     = Number(lineItem.quantity) || 0;
          const newStock = isSale ? Math.max(0, current - qty) : current + qty;
          await ApiService.update(user.uid, 'inventory', match.id, { current_stock: newStock });
        });
        await Promise.all(stockUpdates);
      }

      // Create recurring template if user toggled Recurring
      if (type === 'transactions' && !initialData?.id && formData.isRecurring && formData.recurringInterval) {
        const today = new Date().toISOString().split('T')[0];
        await RecurringService.create(user.uid, {
          type: payload.type,
          party_name: payload.party_name,
          amount: payload.amount,
          payment_mode: payload.payment_mode,
          payment_purpose: payload.payment_purpose,
          notes: payload.notes,
          interval: formData.recurringInterval,
          nextDue: advanceDate(today, formData.recurringInterval),
        }).catch(() => {});
      }

      haptic.success();
      if (isOffline) {
        showToast('Saved offline — will sync when online', 'info');
      } else {
        showToast(
          formData.isRecurring && type === 'transactions' && !initialData?.id
            ? `Entry saved · Recurring ${formData.recurringInterval} template created`
            : (initialData?.id ? 'Entry updated' : 'Entry saved'),
          'success',
        );
      }
      onClose();
      onSuccess?.(payload);
    } catch (err) {
      console.error(err);
      showToast('Save failed', 'error');
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  if (!isOpen) return null;
  const staffList = appSettings.custom_lists?.staff || ['Owner', 'Manager', 'Staff'];

  const displayedPartyCode = type === 'parties'
    ? (formData.party_code || initialData?.party_code || nextPartyCode)
    : null;

  return (
    <div className="fixed inset-0 bg-black/80 z-[60] flex justify-center items-end p-0 backdrop-blur-md" style={{paddingBottom: 'env(safe-area-inset-bottom, 0px)'}}>
      <div className="keyboard-aware-sheet w-full max-w-2xl rounded-t-3xl shadow-2xl h-auto flex flex-col border border-white/12 transform transition-all" style={{background:"var(--app-bg)", maxHeight:'92dvh'}}>
        <div className="p-4 flex items-center gap-3 shrink-0 rounded-t-3xl border-b border-white/10" style={{background:"linear-gradient(135deg,rgba(79,70,229,0.25),rgba(124,58,237,0.15))"}}>
          <button onClick={onClose} className="p-2 rounded-full transition-all active:scale-90" style={{background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.15)'}}><ArrowLeft size={18}/></button>
          <div className="flex-1 min-w-0">
            <h2 className="font-black text-base leading-tight capitalize tracking-tight">
              {initialData ? 'Edit' : 'New'} {type === 'sales' ? 'Sale' : type === 'purchases' ? 'Purchase' : type === 'transactions' ? 'Payment' : type === 'inventory' ? 'Item' : type}
            </h2>
            <p className="text-[10px] font-bold text-[rgba(148,163,184,0.5)] mt-0.5">
              {type === 'sales' || type === 'purchases' ? 'Fill details + add items below' : 'Fill all required fields'}
            </p>
          </div>
          {displayedPartyCode && (
            <div className="shrink-0 px-2.5 py-1.5 rounded-xl font-mono text-sm font-black"
              style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', color: '#a78bfa' }}>
              {displayedPartyCode}
            </div>
          )}
        </div>
        <form onSubmit={handleSubmit} className="keyboard-scroll-inner p-5 overflow-y-auto flex-1 space-y-4 bg-[#0b0e1a]">

          {type === 'inventory' && <InventoryForm formData={formData} handleChange={handleChange} />}

          {type === 'parties' && <PartyForm formData={formData} handleChange={handleChange} handleFetchGSTIN={handleFetchGSTIN} gstFetching={gstFetching} />}

          {type === 'vehicles' && <VehicleForm formData={formData} handleChange={handleChange} />}

          {type === 'expenses' && <ExpenseForm formData={formData} handleChange={handleChange} expenseTypes={appSettings.custom_lists?.expense_types} />}

          {(type === 'sales' || type === 'purchases') && (
            <OrderForm
              type={type} formData={formData} handleChange={handleChange}
              items={items} setItems={setItems} itemNames={itemNames}
              handleItemChange={handleItemChange}
              customers={customers.map(c => c.name)}
              suppliers={suppliers.map(s => s.name)}
              vehicleList={vehicleList} staffList={staffList}
              calculateTotal={calculateTotal}
              linkedPayments={linkedPayments}
              setLinkedPayments={setLinkedPayments}
              onRemoveLinkedPayment={handleRemoveLinkedPayment}
              appSettings={appSettings}
              autoAddParty={autoAddParty}
              setAutoAddParty={setAutoAddParty}
            />
          )}

          {type === 'transactions' && (
            <TransactionForm
              formData={formData} handleChange={handleChange}
              activePartyList={activePartyList} filteredOrders={filteredOrders}
              availableOrders={availableOrders}
              appSettings={appSettings}
              autoAddParty={autoAddParty}
              setAutoAddParty={setAutoAddParty}
            />
          )}
        </form>
        <div className="shrink-0 border-t border-white/08 bg-[#0b0e1a]"
          style={{ padding: '12px 16px', paddingBottom: 'max(16px, calc(env(safe-area-inset-bottom, 0px) + 12px))' }}>
          <button onClick={handleSubmit} disabled={loading}
            className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white py-3.5 rounded-xl font-bold text-lg shadow-lg active:scale-95 transition-all flex justify-center items-center gap-2">
            {loading ? 'Saving...' : <><Save size={20}/> Save Record</>}
          </button>
        </div>
      </div>
    </div>
  );
};
export default ManualEntryModal;


