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
import { useParties, useInventory, useLedger, useTransactions } from '../../context/DataContext';
import { syncPartyToRecords } from '../../services/partySync';

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
  const gstFetchingRef = useRef(false);
  const [gstStatus, setGstStatus]     = useState<string>('');
  const [formData, setFormData] = useState<any>({});
  const [items, setItems] = useState<any[]>([{ item_name: '', quantity: '', rate: '', hsn_code: '', gst_percent: '', unit: 'Pcs', total: 0, price_type: 'exclusive', _auto_add_to_stock: true }]);

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
  const { data: cachedInventory, refetch: refetchInventory, setData: setInventoryData } = useInventory(uid);
  const { data: cachedLedger,    refetch: refetchLedger }    = useLedger(uid);
  const { refetch: refetchTransactions }                     = useTransactions(uid);

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
      setItems([{ item_name: '', quantity: '', rate: '', hsn_code: '', gst_percent: '', unit: 'Pcs', total: 0, price_type: 'exclusive', _auto_add_to_stock: true }]);
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
    if (gstFetchingRef.current) return;
    gstFetchingRef.current = true;
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
      gstFetchingRef.current = false;
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
          // Stamp the inventory doc ID so submit-time matching uses ID (reliable
          // even when the TanStack Query cache is stale) rather than name only
          // (which fails after a rename or when the cache hasn't caught up).
          updated._item_id   = matchedItem.id;
          updated.hsn_code   = matchedItem.hsn_code || '';
          updated.gst_percent = matchedItem.gst_percent || '';
          updated.rate       = type === 'sales' ? (matchedItem.sale_rate || '') : (matchedItem.purchase_rate || '');
          updated.unit       = matchedItem.unit || 'Pcs';
          updated.price_type = matchedItem.price_type || 'exclusive';
        } else {
          // Typed manually — clear any stale _item_id from a previous selection.
          updated._item_id = undefined;
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

      // ── Attach party_id for reliable cascade on future party edits ───────────
      // For sales, purchases, transactions: look up the party's Firestore doc ID
      // from the cached parties list so the partySync cascade can find this record
      // by ID (not just by name), which survives future name changes.
      if (payload.party_name && (type === 'sales' || type === 'purchases' || type === 'transactions')) {
        const linked = safeParties.find(
          (p: any) => (p.name || '').toLowerCase() === (payload.party_name || '').toLowerCase(),
        );
        if (linked?.id) payload.party_id = linked.id;
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

      // ── WRITE PATH ── Single WriteBatch commit (1 IndexedDB transaction) ───────
      // Firestore's own offline persistence handles the device-offline case:
      // addDoc/updateDoc resolve immediately from the local cache when offline
      // and auto-sync when connectivity returns. We never need to manually
      // detect navigator.onLine here — that API is unreliable on Android WebView.
      //
      // Previously: N separate await ApiService.add/update() calls → N round-trips
      // to IndexedDB (Firestore's local persistence layer). On Android WebView under
      // memory pressure, each round-trip serialises, causing 2-minute+ "Saving…".
      //
      // Fix: collect ALL write operations into one WriteBatch → one commit()
      // → one IndexedDB transaction for every write at once. The Firestore SDK
      // then syncs to the network in the background without blocking the UI.
      //
      // IMPORTANT: inventoryAddedCount / inventoryUpdatedCount are declared here
      // (outer try scope) so they remain readable after the batch write block.
      let inventoryAddedCount   = 0;
      let inventoryUpdatedCount = 0;
      // Hoisted so the background commit and its batchOps snapshot are accessible
      // after the anonymous write-path block closes.
      let capturedCommit: () => Promise<void> = () => Promise.resolve();
      let capturedBatchOps: Array<{ type: 'add' | 'update'; col: string; data: any; id?: string }> = [];
      {
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

        if (type === 'sales' || type === 'purchases') {
          const isSale = type === 'sales';
          const syncQuantity = !!appSettings.automation?.auto_update_inventory;
          const syncInfo = appSettings.automation?.auto_sync_item_info !== false;
          const syncFields: any = appSettings.automation?.sync_item_fields || {};

          items.forEach((lineItem: any) => {
            if (!lineItem.item_name?.trim()) return;
            // Prefer ID-based match — stamped when user picks from autocomplete.
            // This is immune to stale-cache problems: even if the TanStack Query
            // cache hasn't caught up after a previous offline save, the lineItem
            // carries the correct inventory document ID from when autocomplete
            // was rendered, preventing a spurious ADD for an existing stock item.
            const matchById = lineItem._item_id
              ? inventoryList.find((i: any) => i.id === lineItem._item_id)
              : undefined;
            const match = matchById ?? inventoryList.find((i: any) =>
              i.name?.toLowerCase() === lineItem.item_name?.toLowerCase()
            );

            if (!match?.id) {
              // Item not in inventory — auto-add if per-item checkbox is on
              if (lineItem._auto_add_to_stock !== false) {
                const newItem: any = {
                  name: lineItem.item_name.trim(),
                  unit: lineItem.unit || 'Pcs',
                  current_stock: Number(lineItem.quantity) || 0,
                  min_stock: 0,
                  price_type: lineItem.price_type || 'exclusive',
                  sale_rate: isSale ? (Number(lineItem.rate) || 0) : 0,
                  purchase_rate: isSale ? 0 : (Number(lineItem.rate) || 0),
                  gst_percent: Number(lineItem.gst_percent) || 0,
                  created_at: new Date().toISOString(),
                };
                if (lineItem.hsn_code) newItem.hsn_code = lineItem.hsn_code;
                batchOps.push({ type: 'add', col: 'inventory', data: newItem });
                inventoryAddedCount++;
              }
            } else {
              // Existing item — build combined update
              const updateData: any = {};

              // Stock quantity (controlled by existing toggle)
              if (syncQuantity) {
                updateData.current_stock = isSale
                  ? Math.max(0, (Number(match.current_stock) || 0) - (Number(lineItem.quantity) || 0))
                  : (Number(match.current_stock) || 0) + (Number(lineItem.quantity) || 0);
              }

              // Item metadata fields (controlled by smart-sync setting)
              if (syncInfo) {
                if (syncFields.sale_rate !== false && isSale && lineItem.rate !== '') {
                  updateData.sale_rate = Number(lineItem.rate) || 0;
                }
                if (syncFields.purchase_rate !== false && !isSale && lineItem.rate !== '') {
                  updateData.purchase_rate = Number(lineItem.rate) || 0;
                }
                if (syncFields.gst_percent !== false && lineItem.gst_percent !== undefined && lineItem.gst_percent !== '') {
                  updateData.gst_percent = Number(lineItem.gst_percent) || 0;
                  if (lineItem.price_type) updateData.price_type = lineItem.price_type;
                }
                if (syncFields.unit !== false && lineItem.unit) {
                  updateData.unit = lineItem.unit;
                }
              }

              if (Object.keys(updateData).length > 0) {
                batchOps.push({ type: 'update', col: 'inventory', data: updateData, id: match.id });
                inventoryUpdatedCount++;
              }
            }
          });

          // Strip UI-only flags from items before persisting to Firestore
          if (payload.items) {
            // Strip internal UI-only flags before persisting — Firestore rejects unknown reserved keys
            // and these are never needed server-side.
            payload.items = payload.items.map(({ _auto_add_to_stock: _flag, _item_id: _iid, ...rest }: any) => rest);
          }
        }

        // ── INSTANT WRITE — IDs generated locally, commit in background ────────
        // prepareBatch builds the WriteBatch and generates doc IDs synchronously
        // (Firestore uses a client-side CUID algorithm — zero network calls).
        // We grab the IDs immediately, close the modal NOW, then commit to local
        // IndexedDB in the background.  With persistentLocalCache the commit
        // resolves in < 100 ms and Firestore syncs to the server silently.
        // The user never waits on a "Saving…" spinner.
        const { results: batchResults, commit: _commit } = ApiService.prepareBatch(user.uid, batchOps);
        capturedCommit   = _commit;
        capturedBatchOps = batchOps;

        // Resolve IDs without any await
        if (autoAddPartyData && !payload.party_id) {
          const partyOpIdx = batchOps.findIndex(op => op.col === 'parties');
          if (partyOpIdx >= 0 && batchResults[partyOpIdx]?.id) {
            payload.party_id = batchResults[partyOpIdx].id;
          }
        }
        if (mainAddIndex >= 0 && batchResults[mainAddIndex]) {
          payload.id = batchResults[mainAddIndex].id;
        }
      }

      // ── Close modal and report success IMMEDIATELY ────────────────────────
      haptic.success();
      showToast(initialData?.id ? 'Entry updated' : 'Entry saved', 'success');
      if (inventoryAddedCount > 0)
        showToast(`${inventoryAddedCount} item${inventoryAddedCount > 1 ? 's' : ''} added to inventory`, 'info');
      if (inventoryUpdatedCount > 0)
        showToast(`${inventoryUpdatedCount} inventory item${inventoryUpdatedCount > 1 ? 's' : ''} updated`, 'info');
      // Reset loading/guard BEFORE onClose so the button never shows "Saving…"
      // during the modal exit animation. React 18 batches these state updates
      // with the onClose parent state change into a single paint.
      setLoading(false);
      submittingRef.current = false;
      onClose();
      onSuccess?.(payload);

      // ── Fire-and-forget background commit ─────────────────────────────────
      // Snapshot every value we need before the async boundary so nothing can
      // be mutated from underneath us.
      const _uid              = user.uid;
      const _batchOpsSnap     = capturedBatchOps;
      // Snapshot batchResults so we can resolve IDs for new inventory items
      // added in the background commit (needed for the optimistic cache update).
      const _batchResultsSnap = batchResults;
      const _doInvRefresh     = inventoryAddedCount > 0 || inventoryUpdatedCount > 0;
      const _autoPartyLink = autoAddPartyData && payload.party_id && payload.id && collection !== 'parties'
        ? { col: collection, entryId: payload.id as string, partyId: payload.party_id as string }
        : null;
      const _cascade = (type === 'parties' && initialData?.id)
        ? { partyId: initialData.id as string,
            oldName: (initialData.name || '').trim(),
            fields:  { name:    (payload.name    || '').trim(),
                       address: payload.address,
                       site:    payload.site,
                       gstin:   payload.gstin,
                       contact: payload.contact,
                       state:   payload.state } }
        : null;

      // ── Party cascade — fire IMMEDIATELY, independent of commit timing ─────
      // ROOT FIX: The cascade used to live inside capturedCommit().then().
      // On memory-pressured Android (MALI GPU pressure, heavy WebView GC pauses)
      // batch.commit() can take >8 s to notify the JS Promise even though the
      // Firestore SDK has already written to IndexedDB.  Our withWriteTimeout()
      // wrapper fires WRITE_TIMEOUT at 8 s, which causes .then() to be skipped
      // and .catch() to run instead — the cascade is NEVER called.  The party
      // name saves fine (Firestore SDK retries internally), but ALL linked
      // ledger/transaction records are orphaned under the old name forever.
      //
      // The cascade only queries ledger_entries / transactions by party_id or
      // party_name — those records haven't been modified yet regardless of
      // whether the party commit has resolved, so running in parallel is safe.
      if (_cascade) {
        syncPartyToRecords(_uid, _cascade.partyId, _cascade.oldName, _cascade.fields)
          .then(n => {
            if (n > 0)
              showToast(`Updated ${n} linked record${n !== 1 ? 's' : ''}`, 'info');
            refetchLedger();
            refetchTransactions();
          })
          .catch(e => console.error('[partySync] cascade failed:', e));
      }

      // ── Inventory optimistic cache update — fire IMMEDIATELY ──────────────
      // ROOT FIX: Previously this lived inside capturedCommit().then().
      // On memory-pressured Android the 8s WRITE_TIMEOUT fires before .then()
      // is reached, so the inventory cache was NEVER updated even though the
      // Firestore SDK had already written the new item to IndexedDB.
      //
      // IDs are generated synchronously by prepareBatch (client-side CUID),
      // so _batchResultsSnap already has every new item's Firestore ID.
      // We can safely patch the in-memory cache right now, before the commit.
      // The background refetchInventory() in .then() is a secondary reconcile.
      if (_doInvRefresh) {
        setInventoryData((old: any[]) => {
          let updated = [...(old || [])];
          _batchOpsSnap.forEach((op, idx) => {
            if (op.col !== 'inventory') return;
            if (op.type === 'add') {
              const newId = _batchResultsSnap[idx]?.id;
              if (newId && !updated.some((i: any) => i.id === newId)) {
                updated = [{ id: newId, ...op.data }, ...updated];
              }
            } else if (op.type === 'update' && op.id) {
              const itemIdx = updated.findIndex((i: any) => i.id === op.id);
              if (itemIdx >= 0) updated[itemIdx] = { ...updated[itemIdx], ...op.data };
            }
          });
          return updated;
        });
      }

      capturedCommit()
        .then(() => {
          // Background refetch to reconcile any edge-cases (e.g. stock values
          // for items the optimistic update missed, or server-side corrections).
          if (_doInvRefresh) {
            refetchInventory();
          }

          // Link the auto-added party's ID back into the entry (best-effort)
          if (_autoPartyLink) {
            ApiService.update(_uid, _autoPartyLink.col, _autoPartyLink.entryId,
              { party_id: _autoPartyLink.partyId }).catch(() => {});
          }
        })
        .catch(err => {
          console.error('[ManualEntryModal] bg write failed:', err);
          // DUPLICATE PREVENTION: only route to SyncQueue when the device is
          // genuinely offline. With persistentLocalCache the Firestore SDK keeps
          // the batch in its own IndexedDB queue and retries it automatically
          // when connectivity is restored. If we ALSO add the ops to SyncQueue
          // here, both paths eventually write to Firestore → duplicate documents.
          // When offline, the SDK has no persistence across restarts, so the
          // SyncQueue is still needed as the durable fallback.
          if (!navigator.onLine) {
            for (const op of _batchOpsSnap) {
              SyncQueueService.addToQueue(
                _uid,
                op.type === 'add' ? 'create' : 'update',
                op.col, op.data, op.id,
              );
            }
            setTimeout(() => SyncQueueService.processQueue(_uid).catch(() => {}), 1000);
          } else {
            // Online but commit failed (transient server error, network blip, etc.).
            // The optimistic cache update has already been applied — trigger a refetch
            // so the cache reconciles with the true Firestore state rather than
            // staying permanently diverged until the next app restart.
            refetchLedger();
            refetchTransactions();
            if (_doInvRefresh) refetchInventory();
          }
        });
    } catch (err: any) {
      console.error('[ManualEntryModal] Save error:', err?.message || err);
      console.error('[ManualEntryModal] Full error:', err);
      
      // Provide more specific error messages to help with debugging
      let errorMsg = 'Save failed';
      if (err?.code === 'WRITE_TIMEOUT') {
        errorMsg = 'Save timed out — will retry in background';
      } else if (err?.message?.includes('permission')) {
        errorMsg = 'Permission denied — check authentication';
      } else if (err?.message?.includes('offline')) {
        errorMsg = 'Offline — will sync when connection restored';
      } else if (err?.message) {
        errorMsg = `Save failed: ${err.message.substring(0, 50)}`;
      }
      
      showToast(errorMsg, 'error');
      // Clear loading state in the error path — the success path already
      // clears these before onClose() so the button never shows "Saving…"
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


