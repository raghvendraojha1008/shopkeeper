import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useBackHandler } from '../../services/useBackHandler';
import { User } from 'firebase/auth';
import { ArrowLeft, Save } from 'lucide-react';
import { ApiService } from '../../services/api';
import { SyncQueueService } from '../../services/syncQueue';
import { GSTService } from '../../services/gstApi';
import { AppSettings } from '../../types';
import { haptic } from '../../utils/haptics';
import { useUI } from '../../context/UIContext';
import { getIDForEntry, peekNextID, confirmID, seedPartyCounter, confirmPartyCode } from '../../utils/idGenerator';
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
  const [gstStatus, setGstStatus]     = useState<string>('');
  const [formData, setFormData] = useState<any>({});
  const [items, setItems] = useState<any[]>([{ item_name: '', quantity: '', rate: '', hsn_code: '', gst_percent: '', unit: 'Pcs', total: 0, price_type: 'exclusive' }]);

  const [autoAddParty, setAutoAddParty] = useState(true);

  const [linkedPayments, setLinkedPayments] = useState<any[]>([]);
  const [vehicleList, setVehicleList] = useState<string[]>([]);

  const DEFAULT_INVENTORY_UNITS = ['Pcs', 'Kg', 'Gm', 'Mg', 'Ton', 'Ltr', 'Ml', 'Mtr', 'Cm', 'Ft', 'Inch', 'Bag', 'Box', 'Set', 'Doz', 'Pair', 'Pack', 'Roll', 'Sheet', 'Bundle', 'Carton', 'Bottle', 'Can', 'Tube', 'Sack', 'Plate', 'Unit'];
  const [inventoryUnits, setInventoryUnits] = useState<string[]>(
    appSettings.custom_lists?.inventory_units?.length
      ? appSettings.custom_lists.inventory_units
      : DEFAULT_INVENTORY_UNITS
  );

  const handleAddUnit = async (unit: string) => {
    if (!user?.uid || !unit) return;
    const updated = [...inventoryUnits, unit];
    setInventoryUnits(updated);
    try {
      await ApiService.settings.save(user.uid, {
        ...appSettings,
        custom_lists: { ...appSettings.custom_lists, inventory_units: updated },
      });
      showToast(`"${unit}" added to unit list`, 'success');
    } catch {
      showToast('Unit saved locally — will sync when online', 'info');
    }
  };

  // Use the shared React Query cache — no Firestore reads on modal open.
  const uid = user?.uid ?? '';
  const { data: cachedParties }   = useParties(uid);
  const { data: cachedInventory } = useInventory(uid);
  const { data: cachedLedger }    = useLedger(uid);

  const safeParties   = useMemo(() => (cachedParties   || []) as any[], [cachedParties]);
  const safeInventory = useMemo(() => (cachedInventory || []) as any[], [cachedInventory]);
  const safeLedger    = useMemo(() => (cachedLedger    || []) as any[], [cachedLedger]);

  const customers       = useMemo(() => safeParties.filter(p => p.role === 'customer'),   [safeParties]);
  const suppliers       = useMemo(() => safeParties.filter(p => p.role === 'supplier'),   [safeParties]);

  // Keep the party-code counter in sync so all three entry paths (manual, AI,
  // bulk import) share the same sequential P-XXXX counter.
  useEffect(() => {
    if (safeParties.length > 0) {
      seedPartyCounter(safeParties.map((p: any) => p.party_code));
    }
  }, [safeParties]);
  const inventoryList   = useMemo(() => safeInventory,                                    [safeInventory]);
  const itemNames       = useMemo(() => safeInventory.map((i: any) => i.name),            [safeInventory]);
  const availableOrders = useMemo(() => safeLedger,                                       [safeLedger]);
  const ledgerRecords   = useMemo(() => safeLedger,                                       [safeLedger]);

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
      } else {
        // No date supplied (e.g. opened from item/party detail with partial data) — default to today.
        normalised.date = new Date().toISOString().split('T')[0];
      }
      // Seed invoice / bill / transaction ID when the caller didn't supply one
      // (happens when a partial initialData is passed, e.g. { items:[...] } or { party_name:... }).
      if (type === 'sales' && !normalised.invoice_no) {
        normalised.invoice_no = peekNextID('sales');
      }
      if (type === 'purchases' && !normalised.bill_no) {
        normalised.bill_no = peekNextID('purchases');
      }
      if (type === 'transactions') {
        if (!normalised.type) normalised.type = 'received';
        if (!normalised.transaction_id) {
          normalised.transaction_id = peekNextID(normalised.type === 'paid' ? 'payments' : 'receipts');
        }
      }
      setFormData(normalised);
      if (initialData.items) setItems(initialData.items);
    } else {
      const init: any = { date: new Date().toISOString().split('T')[0] };
      if (type === 'transactions') {
        init.type = 'received';
        init.transaction_id = peekNextID('receipts');
      }
      if (type === 'sales') {
        init.invoice_no = peekNextID('sales');
      }
      if (type === 'purchases') {
        init.bill_no = peekNextID('purchases');
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

    // Auto-fill items from last purchase order when supplier is picked
    const isDefaultItems = items.length === 1 && !items[0].item_name;
    if (isDefaultItems && (
      (field === 'party_name' && type === 'purchases') ||
      (field === 'source_supplier' && type === 'sales')
    )) {
      const partyName = value as string;
      const lastOrder = safeLedger
        .filter((e: any) => e.type === 'purchase' && e.party_name === partyName)
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

      if (lastOrder?.items?.length > 0) {
        setItems(lastOrder.items.map((it: any) => ({
          item_name: it.item_name || '',
          quantity: '',
          rate: it.rate || '',
          hsn_code: it.hsn_code || '',
          gst_percent: it.gst_percent || '',
          unit: it.unit || 'Pcs',
          total: 0,
          price_type: it.price_type || 'exclusive',
        })));
        showToast('Items pre-filled from last order', 'info');
      } else {
        // Fallback: use linked_items from party profile
        const partyObj = suppliers.find((p: any) => p.name === partyName);
        if (partyObj?.linked_items?.length > 0) {
          const prefilled = partyObj.linked_items.map((itemName: string) => {
            const invItem = safeInventory.find((i: any) => i.name === itemName);
            return {
              item_name: itemName,
              quantity: '',
              rate: invItem?.purchase_rate || '',
              hsn_code: invItem?.hsn_code || '',
              gst_percent: invItem?.gst_percent || '',
              unit: invItem?.unit || 'Pcs',
              total: 0,
              price_type: invItem?.price_type || 'exclusive',
            };
          });
          setItems(prefilled);
          showToast('Items pre-filled from supplier profile', 'info');
        }
      }
    }
  };

  const handleFetchGSTIN = async () => {
    if (!formData.gstin || formData.gstin.length !== 15) return showToast('Invalid GSTIN', 'error');
    setGstFetching(true);
    setGstStatus('');
    try {
      const data = await GSTService.fetchDetails(formData.gstin);
      if (data) {
        setFormData((prev: any) => ({
          ...prev,
          name: data.tradeName || data.legalName || prev.name,
          legal_name: (data.legalName && data.legalName !== data.tradeName) ? data.legalName : '',
          address: data.address || '',
          state: data.state || prev.state || '',
          gstin: formData.gstin
        }));
        setGstStatus(data.status || '');
        showToast('GST Details Fetched', 'success');
      }
    } catch (e: any) {
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
    const handling = Number(formData.handling_charges) || 0;
    const discount = Number(formData.discount_amount) || 0;
    return itemsTotal + rent + handling - discount;
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
    if (type === 'parties' && !formData.name?.trim()) {
      showToast("Party name is required", "error");
      submittingRef.current = false;
      return;
    }
    if (type === 'inventory' && !formData.name?.trim()) {
      showToast("Item name is required", "error");
      submittingRef.current = false;
      return;
    }
    if (type === 'vehicles' && !formData.vehicle_number?.trim()) {
      showToast("Vehicle number is required", "error");
      submittingRef.current = false;
      return;
    }
    if (type === 'expenses' && !(Number(formData.amount) > 0)) {
      showToast("Please enter an amount", "error");
      submittingRef.current = false;
      return;
    }
    if (type === 'transactions' && !(Number(formData.amount) > 0)) {
      showToast("Please enter an amount", "error");
      submittingRef.current = false;
      return;
    }

    setLoading(true);
    haptic.medium();
    // Determine connectivity BEFORE entering the try block so the toast
    // at the end can reference it even after an early-return path.
    const isOffline = !navigator.onLine;

    try {
      const payload: any = JSON.parse(JSON.stringify(formData));
      let collection = '';

      // ── Collection & payload normalisation (unchanged) ────────────────────────
      if (type === 'sales' || type === 'purchases') {
        collection = 'ledger_entries';
        payload.items = items;
        payload.total_amount = calculateTotal();
        payload.type = type === 'sales' ? 'sell' : 'purchase';
        if (!initialData?.id) {
          if (type === 'sales' && !payload.invoice_no) payload.invoice_no = getIDForEntry('sell');
          else if (type === 'purchases' && !payload.bill_no) payload.bill_no = getIDForEntry('purchase');
          // Advance the counter to the ID being saved (whether auto-peeked or user-edited)
          if (type === 'sales' && payload.invoice_no) confirmID(payload.invoice_no, 'sales');
          else if (type === 'purchases' && payload.bill_no) confirmID(payload.bill_no, 'purchases');
        }
      } else if (type === 'transactions') {
        collection = 'transactions';
        payload.amount = Number(payload.amount);
        if (!initialData?.id && !payload.transaction_id)
          payload.transaction_id = getIDForEntry(payload.type as 'received' | 'paid');
        // Advance the counter to the ID being saved
        if (!initialData?.id && payload.transaction_id)
          confirmID(payload.transaction_id, payload.type === 'received' ? 'receipts' : 'payments');
      } else if (type === 'inventory') {
        collection = 'inventory';
        payload.sale_rate     = Number(payload.sale_rate)     || 0;
        payload.purchase_rate = Number(payload.purchase_rate) || 0;
        payload.quantity      = Number(payload.quantity)      || 0;
        payload.min_stock     = Number(payload.min_stock)     || 0;
        if (!initialData?.id) payload.current_stock = payload.quantity;
        if (!initialData?.id && !payload.item_id) payload.item_id = getIDForEntry('inventory');
      } else if (type === 'expenses') {
        collection = 'expenses';
      } else if (type === 'vehicles') {
        collection = 'vehicles';
      } else if (type === 'parties') {
        collection = 'parties';
        if (payload.role !== 'customer' && payload.role !== 'supplier') payload.role = 'customer';
        if (!initialData?.id && !payload.party_code) payload.party_code = nextPartyCode;
        if (!initialData?.id && payload.party_code) confirmPartyCode(payload.party_code);
      }

      if (onLocalSave) {
        const newLinkedPayments = linkedPayments.filter(p => p._isNew);
        onLocalSave({ ...payload, collection, _linkedPayments: newLinkedPayments });
        onClose();
        haptic.success();
        return;
      }

      // ── Resolve auto-add party (shared between online/offline paths) ──────────
      // FIX: case-insensitive duplicate check prevents "Rahul Traders" / "rahul traders" duplicates
      let autoAddPartyData: any = null;
      if (autoAddParty && payload.party_name &&
          (type === 'sales' || type === 'purchases' || type === 'transactions')) {
        let role = 'customer';
        if (type === 'purchases') role = 'supplier';
        if (type === 'transactions' && payload.type === 'paid') role = 'supplier';
        const exists = [...customers, ...suppliers].some(
          p => (p.name || '').toLowerCase() === (payload.party_name || '').toLowerCase()
        );
        if (!exists) {
          autoAddPartyData = {
            name: payload.party_name, role,
            party_code: nextPartyCode,
            address: payload.address || '',
            contact: '',
            created_at: new Date().toISOString(),
          };
        }
      }

      if (isOffline) {
        // ── OFFLINE PATH ── SyncQueue for every operation (synchronous, instant) ─
        if (autoAddPartyData) {
          SyncQueueService.addToQueue(user.uid, 'create', 'parties', autoAddPartyData);
        }

        if (initialData?.id) {
          SyncQueueService.addToQueue(user.uid, 'update', collection, payload, initialData.id);
          payload.id = initialData.id;
        } else {
          payload.created_at = new Date().toISOString();
          SyncQueueService.addToQueue(user.uid, 'create', collection, payload);
        }

        const newPayments = linkedPayments.filter(p => p._isNew);
        const txTypeOff = type === 'sales' ? 'received' : 'paid';
        newPayments.forEach(pay => {
          SyncQueueService.addToQueue(user.uid, 'create', 'transactions', {
            date: pay.date, amount: pay.amount, payment_mode: pay.payment_mode,
            payment_purpose: pay.payment_purpose, party_name: pay.party_name || payload.party_name,
            bill_no: pay.bill_no || payload.invoice_no || payload.bill_no,
            notes: pay.notes, created_at: new Date().toISOString(),
            type: txTypeOff, transaction_id: getIDForEntry(txTypeOff),
          });
        });

        if ((type === 'sales' || type === 'purchases') && appSettings.automation?.auto_update_inventory) {
          const isSale = type === 'sales';
          (payload.items || []).forEach((lineItem: any) => {
            if (!lineItem.item_name) return;
            const match = inventoryList.find((i: any) =>
              i.name?.toLowerCase() === lineItem.item_name?.toLowerCase()
            );
            if (!match?.id) return;
            const newStock = isSale
              ? Math.max(0, (Number(match.current_stock) || 0) - (Number(lineItem.quantity) || 0))
              : (Number(match.current_stock) || 0) + (Number(lineItem.quantity) || 0);
            SyncQueueService.addToQueue(user.uid, 'update', 'inventory', { current_stock: newStock }, match.id);
          });
        }

      } else {
        // ── ONLINE PATH ── Single WriteBatch commit (1 IndexedDB transaction) ────
        //
        // Previously: N separate await ApiService.add/update() calls → N round-trips
        // to IndexedDB (Firestore's local persistence layer). On Android WebView under
        // memory pressure, each round-trip serialises, causing 2-minute+ "Saving…".
        //
        // Fix: collect ALL write operations into one WriteBatch → one commit()
        // → one IndexedDB transaction for every write at once. The Firestore SDK
        // then syncs to the network in the background without blocking the UI.
        const batchOps: { type: 'add' | 'update'; col: string; data: any; id?: string }[] = [];
        let mainAddIndex = -1;

        if (autoAddPartyData) {
          batchOps.push({ type: 'add', col: 'parties', data: autoAddPartyData });
        }

        if (initialData?.id) {
          batchOps.push({ type: 'update', col: collection, data: payload, id: initialData.id });
          payload.id = initialData.id;
        } else {
          payload.created_at = new Date().toISOString();
          mainAddIndex = batchOps.length;
          batchOps.push({ type: 'add', col: collection, data: payload });
        }

        const newPayments = linkedPayments.filter(p => p._isNew);
        const txType = type === 'sales' ? 'received' : 'paid';
        newPayments.forEach(pay => {
          batchOps.push({
            type: 'add', col: 'transactions',
            data: {
              date: pay.date, amount: pay.amount, payment_mode: pay.payment_mode,
              payment_purpose: pay.payment_purpose, party_name: pay.party_name || payload.party_name,
              bill_no: pay.bill_no || payload.invoice_no || payload.bill_no,
              notes: pay.notes, created_at: new Date().toISOString(),
              type: txType, transaction_id: getIDForEntry(txType),
            },
          });
        });

        if ((type === 'sales' || type === 'purchases') && appSettings.automation?.auto_update_inventory) {
          const isSale = type === 'sales';
          (payload.items || []).forEach((lineItem: any) => {
            if (!lineItem.item_name) return;
            const match = inventoryList.find((i: any) =>
              i.name?.toLowerCase() === lineItem.item_name?.toLowerCase()
            );
            if (!match?.id) return;
            const newStock = isSale
              ? Math.max(0, (Number(match.current_stock) || 0) - (Number(lineItem.quantity) || 0))
              : (Number(match.current_stock) || 0) + (Number(lineItem.quantity) || 0);
            batchOps.push({ type: 'update', col: 'inventory', data: { current_stock: newStock }, id: match.id });
          });
        }

        // THE SINGLE AWAIT — one batch commit replaces every individual write.
        // If the IndexedDB layer hangs (Android WebView memory pressure) the
        // withWriteTimeout guard in ApiService.batchSave will reject with
        // code:'WRITE_TIMEOUT' after 15 s instead of hanging forever.
        let batchResults: { type: string; id: string }[] = [];
        try {
          batchResults = await ApiService.batchSave(user.uid, batchOps);
          if (mainAddIndex >= 0 && batchResults[mainAddIndex]) {
            payload.id = batchResults[mainAddIndex].id;
          }
        } catch (writeErr: any) {
          if (writeErr?.code === 'WRITE_TIMEOUT') {
            // Firestore IndexedDB write timed out — fall back to the durable
            // offline sync queue so the data is never lost.  The sync queue
            // will replay these ops the next time the device has connectivity
            // and a healthy IndexedDB.
            for (const op of batchOps) {
              SyncQueueService.addToQueue(
                user.uid,
                op.type === 'add' ? 'create' : 'update',
                op.col,
                op.data,
                op.id,
              );
            }
            haptic.success();
            showToast('Saved offline — will sync when online', 'info');
            onClose();
            onSuccess?.(payload);
            return;
          }
          throw writeErr;
        }
      }

      haptic.success();
      if (isOffline) {
        showToast('Saved offline — will sync when online', 'info');
      } else {
        showToast(initialData?.id ? 'Entry updated' : 'Entry saved', 'success');
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

          {type === 'inventory' && <InventoryForm
            formData={formData}
            handleChange={handleChange}
            units={inventoryUnits}
            onAddUnit={handleAddUnit}
          />}

          {type === 'parties' && <PartyForm formData={formData} handleChange={handleChange} handleFetchGSTIN={handleFetchGSTIN} gstFetching={gstFetching} gstStatus={gstStatus} inventoryItems={itemNames} />}

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
              staffList={staffList}
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


