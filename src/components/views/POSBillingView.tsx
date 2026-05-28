/**
 * POSBillingView — Single-screen Quick Billing flow.
 *
 * Designed to compete with Vyapar's task-based POS:
 *   1. Pick / type customer (defaults to Cash Sale).
 *   2. Search or scan item → it lands in the cart at qty 1
 *      (re-tapping the same item just bumps the qty).
 *   3. Tweak qty / rate inline with stepper buttons.
 *   4. One tap to "Save" or "Save & Share" — writes the
 *      ledger_entry, decrements stock, optionally creates
 *      a new party, then generates + shares the invoice PDF.
 *
 * No nested modals, no multi-step flow — the whole bill
 * lives on this one screen so a shopkeeper can ring up a
 * sale in under 10 seconds.
 */

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { User } from 'firebase/auth';
import {
  ArrowLeft, Search, ScanLine, Plus, Minus, Trash2, ShoppingCart,
  Save, Share2, Loader2, X, UserCircle2, Package, Receipt,
  Pencil, Check, Download, Printer, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useUI } from '../../context/UIContext';
import { useData } from '../../context/DataContext';
import { ApiService } from '../../services/api';
import { SyncQueueService } from '../../services/syncQueue';
import { ProfessionalInvoiceService } from '../../services/professionalInvoice';
import { fmtINR } from '../../utils/gstUtils';
import { getIDForEntry } from '../../utils/idGenerator';
import {
  buildInvoiceData,
  computeInvoiceTotals,
  isInterstateSale,
  formatInvoiceNumber,
  type InvoiceLineInput,
} from '../../utils/invoiceBuilder';
import { AppSettings } from '../../types';
import BarcodeScanner from '../common/BarcodeScanner';
import { haptic } from '../../utils/haptics';
import { perfMonitor } from '../../utils/perfMonitor';
import { TelemetryService } from '../../services/telemetryService';
import { saveDraft, restoreDraft, clearDraft as clearPosDraft } from '../../utils/draftStorage';

interface POSBillingViewProps {
  user        : User;
  appSettings : AppSettings;
  onBack      : () => void;
}

// ── Cart line — keeps just enough data to rebuild the ledger payload ───────
interface CartLine {
  key         : string;        // stable id (item.id or generated)
  item_name   : string;
  hsn_code    : string;
  unit        : string;
  rate        : number;
  quantity    : number;
  gst_percent : number;
  price_type  : 'inclusive' | 'exclusive';
  inventoryId?: string;        // for stock decrement
  stockOnHand?: number;        // for low-stock warning during entry
}

const POSBillingView: React.FC<POSBillingViewProps> = ({ user, appSettings, onBack }) => {
  const { showToast } = useUI();
  const { useInventory, useParties, useLedger } = useData();
  const { data: inventory, setData: setInventoryCache } = useInventory(user.uid);
  const { data: parties }                               = useParties(user.uid);
  const { setData: setLedgerCache }                     = useLedger(user.uid);

  // FINAL MODULE — feature usage telemetry. Service dedups same-day repeats.
  useEffect(() => { TelemetryService.trackScreen(user.uid, 'pos'); }, [user.uid]);

  // ── Customer ────────────────────────────────────────────────────────────
  // Default to cash sale; the user can either type a new name (auto-add later)
  // or pick an existing customer from the dropdown that opens on focus.
  const [partyName, setPartyName]       = useState('');
  const [partyAddress, setPartyAddress] = useState('');
  const [partyPhone, setPartyPhone]     = useState('');
  const [partyGstin, setPartyGstin]     = useState('');
  const [partyId, setPartyId]           = useState<string | null>(null);
  const [showPartyList, setShowPartyList] = useState(false);
  const [showCustomerExtras, setShowCustomerExtras] = useState(false);

  // ── Rounding toggle (Module 3 spec §3) ─────────────────────────────────
  // Most Indian shopkeepers prefer rounded grand totals so cash drawers
  // never have to deal with paise. The user can toggle this off for B2B
  // invoices where every paisa matters.
  const [roundToRupee, setRoundToRupee] = useState(true);

  // ── Totals panel collapsed by default to maximise input space ───────────
  // On mobile, the keyboard takes up half the screen. Keeping the totals
  // collapsed shows only the Grand Total bar + action buttons so the user
  // can still see the search + cart while typing.
  const [totalsExpanded, setTotalsExpanded] = useState(false);

  // ── Item search + cart ──────────────────────────────────────────────────
  const [search, setSearch]   = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [cart, setCart]       = useState<CartLine[]>([]);
  const [saving, setSaving]   = useState(false);
  // Ref guard prevents double-submission on rapid taps before the `saving`
  // state update propagates to the disabled button (mirrors ManualEntryModal).
  const savingRef             = useRef(false);
  const searchInputRef        = useRef<HTMLInputElement>(null);
  // Long-press → edit sheet for a cart line.
  const [editKey, setEditKey] = useState<string | null>(null);
  const longPressTimer        = useRef<number | null>(null);
  const longPressFired        = useRef<boolean>(false);

  // Re-focus the search input on the next paint. Doing it inside rAF (vs
  // straight after setState) means the suggestion list has already been
  // unmounted, so the focus call is reliable on Android where the soft
  // keyboard would otherwise dismiss.
  const refocusSearch = useCallback(() => {
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      setSearchFocused(true);
    });
  }, []);

  // Stable invoice number — generated once when this screen mounts so the
  // user sees the same number until the bill is saved.
  // Two values:
  //   • rawInvoiceNo  — internal counter id from getIDForEntry('sell'),
  //                     used as the ledger_entry primary key (offline-safe,
  //                     multi-device-safe via Firestore seeding).
  //   • displayInvoiceNo — user-facing "INV-0001" formatted using
  //                     profile.invoice_prefix (defaults to "INV").
  const [rawInvoiceNo] = useState<string>(() => getIDForEntry('sell'));
  const displayInvoiceNo = useMemo(
    () => formatInvoiceNumber(rawInvoiceNo, appSettings?.profile?.invoice_prefix),
    [rawInvoiceNo, appSettings?.profile?.invoice_prefix],
  );
  const today       = useMemo(() => new Date().toISOString().split('T')[0], []);

  // ── Cart draft recovery (Module 3, 6, 14) ──────────────────────────────────
  // The POS screen is the most interruption-prone flow — a call or low-memory
  // event while ringing up a sale would lose everything without this.
  //
  // Strategy:
  //  • Mount:  restore draft if the cart is still empty (no double-load)
  //  • Change: debounce-save cart + customer state every 1.5 s
  //  • Save:   clear draft on successful persist() (see clearPosDraft call below)
  const POS_DRAFT_KEY = `pos-cart-${user.uid}`;

  useEffect(() => {
    const result = restoreDraft<{
      cart        : CartLine[];
      partyName   : string;
      partyId     : string | null;
      partyAddress: string;
      partyPhone  : string;
      partyGstin  : string;
    }>(POS_DRAFT_KEY, { uid: user.uid, expiryMs: 12 * 60 * 60 * 1000 });

    if (!result.found || !result.data) return;
    const d = result.data;
    if (!d.cart?.length) return;   // empty cart draft — nothing to restore

    setCart(d.cart);
    if (d.partyName)   setPartyName(d.partyName);
    if (d.partyId)     setPartyId(d.partyId);
    if (d.partyAddress) setPartyAddress(d.partyAddress);
    if (d.partyPhone)  setPartyPhone(d.partyPhone);
    if (d.partyGstin)  setPartyGstin(d.partyGstin);

    const itemCount = d.cart.length;
    const mins      = Math.round(result.ageMs / 60_000);
    const when      = mins < 2 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
    showToast(`Cart restored — ${itemCount} item${itemCount !== 1 ? 's' : ''} (saved ${when})`, 'info');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  useEffect(() => {
    if (cart.length === 0 && !partyName) return; // nothing worth persisting
    const t = setTimeout(() => {
      saveDraft(POS_DRAFT_KEY, { cart, partyName, partyId, partyAddress, partyPhone, partyGstin }, { uid: user.uid });
    }, 1500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, partyName, partyId, partyAddress, partyPhone, partyGstin]);

  // Detect intra-state vs inter-state from the firm's GSTIN ↔ customer's GSTIN
  // (memoised so the UI only repaints when one of the GSTINs changes).
  const interstate = useMemo(
    () => isInterstateSale(appSettings?.profile?.gstin, partyGstin),
    [appSettings?.profile?.gstin, partyGstin],
  );

  // ── Suggestions for item search ─────────────────────────────────────────
  // Match by name, hsn, or barcode field — case-insensitive, ranked by
  // "starts with" first to keep the most-relevant matches at the top.
  // Wrapped in perfMonitor so we can verify search stays under the 50ms
  // spec target even when inventory grows past 1000 items.
  const itemSuggestions = useMemo(() => {
    const end = perfMonitor.start('pos.item.search');
    try {
      const q = search.trim().toLowerCase();
      if (!q && !searchFocused) return [];
      const list = (inventory as any[]).filter((i: any) => {
        if (!q) return true;
        const name    = String(i.name || '').toLowerCase();
        const hsn     = String(i.hsn_code || '').toLowerCase();
        const barcode = String(i.barcode || '').toLowerCase();
        return name.includes(q) || hsn.includes(q) || barcode === q;
      });
      list.sort((a: any, b: any) => {
        if (!q) return String(a.name || '').localeCompare(String(b.name || ''));
        const an = String(a.name || '').toLowerCase().startsWith(q) ? 0 : 1;
        const bn = String(b.name || '').toLowerCase().startsWith(q) ? 0 : 1;
        return an - bn;
      });
      return list.slice(0, 8);
    } finally {
      end();
    }
  }, [search, searchFocused, inventory]);

  // ── Customer suggestions (only customers, not suppliers) ────────────────
  const partySuggestions = useMemo(() => {
    const q = partyName.trim().toLowerCase();
    return (parties as any[])
      .filter(p => p.role === 'customer')
      .filter(p => !q || String(p.name || '').toLowerCase().includes(q))
      .slice(0, 6);
  }, [parties, partyName]);

  // ── Add an inventory item to the cart (or bump qty if already there) ────
  const addToCart = (inv: any) => {
    const stock = Number(inv.current_stock) || 0;
    setCart(prev => {
      const existing = prev.find(l => l.key === (inv.id || inv.name));
      if (existing) {
        return prev.map(l => l.key === existing.key ? { ...l, quantity: l.quantity + 1 } : l);
      }
      return [
        ...prev,
        {
          key         : inv.id || inv.name,
          item_name   : inv.name,
          hsn_code    : inv.hsn_code || '',
          unit        : inv.unit || 'Pcs',
          rate        : Number(inv.sale_rate) || 0,
          quantity    : 1,
          gst_percent : Number(inv.gst_percent) || 0,
          price_type  : (inv.price_type as 'inclusive' | 'exclusive') || 'exclusive',
          inventoryId : inv.id,
          stockOnHand : stock,
        },
      ];
    });
    haptic.light();
    // Non-blocking warning — let the shopkeeper add anyway (back-orders, fresh
    // stock not yet entered, etc) but flag it so they know.
    if (stock <= 0) {
      showToast(`${inv.name} is out of stock — added anyway`, 'info');
    }
    setSearch('');
    refocusSearch();
  };

  // ── Barcode scan handler — looks up by barcode/hsn or falls back to name ─
  const handleScanned = (code: string) => {
    setShowScanner(false);
    const match = (inventory as any[]).find((i: any) =>
      String(i.barcode || '').toLowerCase() === code.toLowerCase() ||
      String(i.hsn_code || '').toLowerCase() === code.toLowerCase()
    );
    if (match) {
      addToCart(match);
      showToast(`Added ${match.name}`, 'success');
    } else {
      showToast(`No item matches "${code}"`, 'error');
      setSearch(code);            // pre-fill so the user can continue typing
    }
  };

  const updateLine = (key: string, patch: Partial<CartLine>) => {
    setCart(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));
  };

  const removeLine = (key: string) => {
    setCart(prev => prev.filter(l => l.key !== key));
    haptic.light();
  };

  const incQty = (key: string) => {
    const line = cart.find(l => l.key === key);
    if (!line) return;
    updateLine(key, { quantity: line.quantity + 1 });
  };
  const decQty = (key: string) => {
    const line = cart.find(l => l.key === key);
    if (!line) return;
    if (line.quantity <= 1) { removeLine(key); return; }
    updateLine(key, { quantity: line.quantity - 1 });
  };

  // ── Totals (subtotal, GST split, round-off, grand total) — memoised ─────
  // Delegates to invoiceBuilder.computeInvoiceTotals so the live UI numbers
  // match the PDF byte-for-byte. Honours interstate (CGST+SGST vs IGST) and
  // the Round-off toggle.
  const totals = useMemo(() => {
    const lines: InvoiceLineInput[] = cart.map(l => ({
      item_name  : l.item_name,
      hsn_code   : l.hsn_code || '',
      quantity   : l.quantity,
      unit       : l.unit,
      rate       : l.rate,
      gst_percent: l.gst_percent || 0,
      price_type : l.price_type,
    }));
    const { totals: t } = computeInvoiceTotals(lines, interstate, roundToRupee);
    return {
      ...t,
      itemCount: cart.length,
      qtyCount : cart.reduce((s, l) => s + l.quantity, 0),
    };
  }, [cart, interstate, roundToRupee]);

  // ── Save (and optionally share) the bill ────────────────────────────────
  // Instrumented end-to-end so we can verify the spec's "Billing < 5s"
  // target (perfMonitor warns once in dev if we ever overshoot).
  const persist = async (): Promise<any | null> => {
    if (cart.length === 0) {
      showToast('Add at least one item', 'error');
      return null;
    }
    if (savingRef.current) return null;
    savingRef.current = true;

    setSaving(true);
    const endPerf   = perfMonitor.start('pos.bill.save');
    const isOffline = !navigator.onLine;

    // Declared before try so catch can reference them for rollback and telemetry.
    let resolvedPartyId = partyId;
    const resolvedParty = partyName.trim();
    const tempId        = `temp_${Date.now()}`;

    try {
      // 1. Create the party on-the-fly when the user typed a name that isn't
      //    in the customers list yet (mirrors ManualEntryModal's auto-add).
      if (!resolvedPartyId && resolvedParty) {
        const existing = (parties as any[]).find(
          p => p.role === 'customer' && p.name?.toLowerCase() === resolvedParty.toLowerCase()
        );
        if (existing) {
          resolvedPartyId = existing.id;
        } else if (!isOffline) {
          const partyPayload: any = {
            name: resolvedParty, role: 'customer',
            address: partyAddress || '',
            phone: partyPhone || '',
            gstin: partyGstin || '',
            created_at: new Date().toISOString(),
          };
          const r = await ApiService.add(user.uid, 'parties', partyPayload);
          resolvedPartyId = r.id;
        } else {
          SyncQueueService.addToQueue(user.uid, 'create', 'parties', {
            name: resolvedParty, role: 'customer',
            address: partyAddress || '',
            phone: partyPhone || '',
            gstin: partyGstin || '',
            created_at: new Date().toISOString(),
          });
        }
      }

      // 2. Build the ledger payload using the same shape as ManualEntryModal
      //    so existing views (LedgerView, PartyStatement, reports) just work.
      const items = cart.map(l => ({
        item_name:   l.item_name,
        quantity:    String(l.quantity),
        rate:        String(l.rate),
        unit:        l.unit,
        hsn_code:    l.hsn_code || '',
        gst_percent: String(l.gst_percent || 0),
        price_type:  l.price_type,
        total:       l.quantity * l.rate,
      }));

      const payload: any = {
        type:           'sell',
        date:           today,
        invoice_no:     displayInvoiceNo,   // user-facing INV-0001 format
        prefixed_id:    rawInvoiceNo,       // raw counter id (collision-safe)
        party_name:     resolvedParty || 'Cash Sale',
        party_id:       resolvedPartyId || null,
        address:        partyAddress || '',
        party_phone:    partyPhone || '',
        party_gstin:    partyGstin || '',
        is_interstate:  interstate,         // freezes the GST split for re-prints
        round_off:      totals.roundOff,
        round_to_rupee: roundToRupee,
        items,
        subtotal:       totals.subtotal,
        cgst_amount:    totals.totalCgst,
        sgst_amount:    totals.totalSgst,
        igst_amount:    totals.totalIgst,
        gst_amount:     totals.totalGst,
        total_amount:   totals.grandTotal,
        created_at:     new Date().toISOString(),
      };

      // 3. Optimistic UI update — inject the new entry into the ledger cache
      //    and decrement inventory immediately so both views update without
      //    waiting for the Firestore round-trip.
      setLedgerCache(old => [{ ...payload, id: tempId }, ...old]);

      // Snapshot original stock values keyed by item id BEFORE decrementing so
      // the rollback can restore exact values even when Math.max(0,...) capped
      // the decrement (e.g. selling 3 units when only 1 was in stock).
      const stockSnapshot = new Map<string, number>(
        (inventory as any[]).map((item: any) => [item.id, Number(item.current_stock) || 0])
      );

      // Apply optimistic inventory decrement immediately — online and offline alike.
      // Offline rollback is handled in the catch block using stockSnapshot.
      if (appSettings?.automation?.auto_update_inventory !== false) {
        setInventoryCache(old => old.map(item => {
          const li = items.find(
            (l: any) => String(l.item_name).toLowerCase() === String(item.name).toLowerCase()
          );
          if (!li) return item;
          const newStock = Math.max(0, (Number(item.current_stock) || 0) - Number(li.quantity));
          return { ...item, current_stock: newStock };
        }));
      }

      // 4. Write to Firestore (or queue when offline).
      if (isOffline) {
        SyncQueueService.addToQueue(user.uid, 'create', 'ledger_entries', payload);
        showToast('Saved offline — will sync', 'info');
      } else {
        const r = await ApiService.add(user.uid, 'ledger_entries', payload);
        payload.id = r.id;
        // Replace the optimistic temp entry with the confirmed Firestore document.
        setLedgerCache(old => old.map(e => e.id === tempId ? { ...payload } : e));
      }

      // 5. Persist the stock decrements — queue via SyncQueueService when offline
      //    so stock is updated the moment connectivity returns (not silently dropped).
      if (appSettings?.automation?.auto_update_inventory !== false) {
        await Promise.all(items.map(async (li: any) => {
          const match = (inventory as any[]).find(
            (i: any) => String(i.name || '').toLowerCase() === String(li.item_name).toLowerCase()
          );
          if (!match?.id) return;
          const newStock = Math.max(0, (Number(match.current_stock) || 0) - Number(li.quantity));
          if (isOffline) {
            SyncQueueService.addToQueue(user.uid, 'update', 'inventory', { current_stock: newStock }, match.id);
          } else {
            await ApiService.update(user.uid, 'inventory', match.id, { current_stock: newStock });
          }
        }));
      }

      haptic.success();
      clearPosDraft(`pos-cart-${user.uid}`);   // Module 3 — invalidate draft on success
      return payload;
    } catch (e: any) {
      // Rollback optimistic ledger update.
      setLedgerCache(old => old.filter(entry => entry.id !== tempId));
      // Rollback optimistic inventory decrements using the pre-decrement snapshot
      // so stock is restored to its exact original value (avoids overshoot when
      // the decrement was capped by Math.max(0,...)).
      // Runs unconditionally because the optimistic decrement now happens
      // regardless of online/offline state.
      if (appSettings?.automation?.auto_update_inventory !== false) {
        setInventoryCache(old => old.map(item => {
          const original = stockSnapshot.get(item.id);
          return original !== undefined ? { ...item, current_stock: original } : item;
        }));
      }
      TelemetryService.logError(user.uid, 'api', `POS save failed: ${e?.message || 'Unknown'}`, {
        partyId: resolvedPartyId,
        lineCount: cart.length,
      });
      showToast('Save failed: ' + (e?.message || 'Unknown'), 'error');
      return null;
    } finally {
      endPerf();
      setSaving(false);
      savingRef.current = false;
    }
  };

  const handleSave = async () => {
    const saved = await persist();
    if (saved) {
      // FINAL MODULE — DAU/feature analytics
      TelemetryService.trackInvoice(user.uid);
      showToast(`Bill ${displayInvoiceNo} saved — ${fmtINR(totals.grandTotal)}`, 'success');
      onBack();
    }
  };

  // ── Build the InvoiceData object the renderer expects ───────────────────
  // Used by Save & Share, Download, and Print so all three paths render
  // identical PDFs (same template, same totals, same round-off).
  const buildPdfInvoice = (saved: any) => buildInvoiceData(
    saved,
    appSettings.profile,
    appSettings.invoice_template || {},
    { roundToRupee, partyGstin },
  );

  const handleSaveAndShare = async () => {
    const saved = await persist();
    if (!saved) return;
    TelemetryService.trackInvoice(user.uid);
    try {
      const invoice = buildPdfInvoice(saved);
      await ProfessionalInvoiceService.generateInvoice(invoice);
      showToast(`Bill ${displayInvoiceNo} shared`, 'success');
      onBack();
    } catch (e: any) {
      console.error('Share failed:', e);
      TelemetryService.logError(user.uid, 'pdf', `Share failed: ${e?.message || 'Unknown'}`);
      // Bill is already saved, so don't roll back — just notify and stay
      // on screen so the user can retry the share.
      showToast('Saved, but share failed: ' + (e?.message || 'Unknown'), 'error');
    }
  };

  // Save the bill, then trigger a download/save of the PDF — useful when the
  // user wants a local copy (web) or a file in their Downloads folder (native).
  const handleSaveAndDownload = async () => {
    const saved = await persist();
    if (!saved) return;
    TelemetryService.trackInvoice(user.uid);
    try {
      const invoice = buildPdfInvoice(saved);
      await ProfessionalInvoiceService.downloadInvoice(invoice);
      showToast(`Bill ${displayInvoiceNo} downloaded`, 'success');
      onBack();
    } catch (e: any) {
      console.error('Download failed:', e);
      TelemetryService.logError(user.uid, 'pdf', `Download failed: ${e?.message || 'Unknown'}`);
      showToast('Saved, but download failed: ' + (e?.message || 'Unknown'), 'error');
    }
  };

  // Save the bill, then open the browser print dialog. Skipped on native
  // platforms (use share → print app instead) so we don't open a blank tab.
  const handleSaveAndPrint = async () => {
    const saved = await persist();
    if (!saved) return;
    TelemetryService.trackInvoice(user.uid);
    try {
      const invoice = buildPdfInvoice(saved);
      await ProfessionalInvoiceService.printInvoice(invoice);
      showToast(`Bill ${displayInvoiceNo} sent to printer`, 'success');
      onBack();
    } catch (e: any) {
      console.error('Print failed:', e);
      TelemetryService.logError(user.uid, 'pdf', `Print failed: ${e?.message || 'Unknown'}`);
      showToast('Saved, but print failed: ' + (e?.message || 'Unknown'), 'error');
    }
  };

  // Close the party dropdown when the user taps outside of it.
  const partyBoxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showPartyList) return;
    const onDocClick = (e: MouseEvent) => {
      if (!partyBoxRef.current?.contains(e.target as Node)) setShowPartyList(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showPartyList]);

  // Cancel any pending long-press timer on unmount so we don't fire after the
  // component is gone (which would call setEditKey on a dead instance).
  useEffect(() => () => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current);
    }
  }, []);

  // ── Long-press detection on a cart line ─────────────────────────────────
  // Touch/mouse hold for 500 ms opens the edit sheet for that line. We track
  // a "fired" flag so the synthetic click that follows the long-press doesn't
  // also trigger any other handler (e.g. the line's own onClick if added later).
  const startLongPress = (key: string) => {
    longPressFired.current = false;
    if (longPressTimer.current != null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      haptic.light();
      setEditKey(key);
    }, 500);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const editingLine = editKey ? cart.find(l => l.key === editKey) || null : null;

  return (
    <div className="h-full overflow-hidden flex flex-col" style={{ background: 'var(--app-bg)' }}>
      {showScanner && (
        <BarcodeScanner
          onScan={handleScanned}
          onClose={() => setShowScanner(false)}
          title="Scan Item"
          description="Point your camera at the item barcode"
        />
      )}

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 px-4 pb-3 flex-shrink-0"
        style={{
          paddingTop: '16px',
          background: 'rgba(var(--app-bg-rgb),0.93)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}>
        <div className="flex items-center gap-3">
          <button onClick={onBack}
            className="p-2 rounded-2xl active:scale-95 transition-all"
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(148,163,184,0.7)',
            }}>
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.2em]"
              style={{ color: 'rgba(167,139,250,0.7)' }}>Quick Bill</p>
            <p className="text-sm font-black text-white truncate">
              <Receipt size={12} className="inline -mt-0.5 mr-1" /> {displayInvoiceNo}
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-[8px] font-black uppercase tracking-wider"
              style={{ color: 'rgba(148,163,184,0.5)' }}>Items</p>
            <p className="text-base font-black text-white tabular-nums">{totals.itemCount}</p>
          </div>
        </div>
      </div>

      {/* ── SCROLLABLE BODY ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-3 space-y-3">

        {/* CUSTOMER PICKER */}
        <div ref={partyBoxRef} className="relative rounded-[16px] p-3 space-y-2"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}>
          <div className="flex items-center gap-2">
            <UserCircle2 size={14} style={{ color: 'rgba(167,139,250,0.7)' }} />
            <p className="text-[9px] font-black uppercase tracking-[0.15em]"
              style={{ color: 'rgba(148,163,184,0.5)' }}>Customer</p>
            {partyName && (
              <button
                onClick={() => {
                  setPartyName(''); setPartyAddress('');
                  setPartyPhone(''); setPartyGstin('');
                  setPartyId(null); setShowCustomerExtras(false);
                }}
                className="ml-auto text-[9px] font-bold flex items-center gap-1 px-2 py-0.5 rounded-full active:scale-95"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(148,163,184,0.7)' }}>
                <X size={10} /> Cash Sale
              </button>
            )}
          </div>
          <input
            value={partyName}
            placeholder="Cash Sale (tap to add customer)"
            onChange={e => { setPartyName(e.target.value); setPartyId(null); setShowPartyList(true); }}
            onFocus={() => setShowPartyList(true)}
            className="w-full px-3 py-2 rounded-xl text-[13px] font-bold text-white outline-none"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
          />

          {/* GSTIN field — only meaningful when there's a named customer.
              Shown collapsed by default to keep the screen clean for cash
              sales; tap "+ Add GSTIN / Phone" to reveal. */}
          {partyName && !showCustomerExtras && !partyGstin && !partyPhone && (
            <button
              type="button"
              onClick={() => setShowCustomerExtras(true)}
              className="text-[10px] font-bold tracking-wide active:scale-95"
              style={{ color: 'rgba(167,139,250,0.85)' }}>
              + Add GSTIN / Phone
            </button>
          )}
          {partyName && (showCustomerExtras || partyGstin || partyPhone) && (
            <div className="grid grid-cols-2 gap-2">
              <input
                value={partyGstin}
                placeholder="Customer GSTIN (optional)"
                maxLength={15}
                onChange={e => setPartyGstin(e.target.value.toUpperCase().replace(/\s/g, ''))}
                className="px-3 py-2 rounded-xl text-[12px] font-bold text-white outline-none tabular-nums tracking-wide"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
              />
              <input
                value={partyPhone}
                placeholder="Phone (optional)"
                inputMode="tel"
                onChange={e => setPartyPhone(e.target.value)}
                className="px-3 py-2 rounded-xl text-[12px] font-bold text-white outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
              />
              {/* Live "Inter-state — IGST applies" hint when both GSTINs are set
                  and they belong to different states. Helps the user catch a
                  typo in the GSTIN before they save the bill. */}
              {partyGstin.length === 15 && interstate && (
                <p className="col-span-2 text-[10px] font-bold flex items-center gap-1"
                  style={{ color: '#fbbf24' }}>
                  ⓘ Inter-state sale — IGST will be charged
                </p>
              )}
            </div>
          )}

          {showPartyList && partySuggestions.length > 0 && (
            <div className="pos-suggestion-list absolute left-3 right-3 top-full mt-1 z-20 rounded-xl overflow-hidden max-h-60 overflow-y-auto"
              style={{ background: '#141a30', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
              {partySuggestions.map((p: any) => (
                <button key={p.id || p.name}
                  onClick={() => {
                    setPartyName(p.name);
                    setPartyAddress(p.address || '');
                    // Pre-fill GSTIN + phone from saved customer record so
                    // the user doesn't have to retype them on repeat sales.
                    setPartyPhone(p.phone || p.contact || '');
                    setPartyGstin((p.gstin || '').toUpperCase());
                    setPartyId(p.id || null);
                    setShowPartyList(false);
                    if (p.gstin || p.phone) setShowCustomerExtras(true);
                  }}
                  className="w-full text-left px-3 py-2.5 active:scale-[0.99] transition-all hover:bg-white/05"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <p className="text-[12px] font-bold text-white truncate">{p.name}</p>
                  {(p.gstin || p.contact || p.phone) && (
                    <p className="text-[10px] tabular-nums" style={{ color: 'rgba(148,163,184,0.5)' }}>
                      {p.gstin ? p.gstin : (p.contact || p.phone)}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ITEM SEARCH + SCAN */}
        <div className="relative rounded-[16px] p-3 space-y-2"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}>
          <div className="flex items-center gap-2">
            <Search size={14} style={{ color: 'rgba(96,165,250,0.7)' }} />
            <p className="text-[9px] font-black uppercase tracking-[0.15em]"
              style={{ color: 'rgba(148,163,184,0.5)' }}>Add Item</p>
          </div>
          <div className="flex gap-2">
            <input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              onKeyDown={e => {
                // Enter on the search input adds the top suggestion and
                // refocuses — turns USB / Bluetooth HID barcode scanners
                // (which append a newline after the code) into instant
                // adders, and lets keyboard users add without a click.
                if (e.key === 'Enter' && itemSuggestions.length > 0) {
                  e.preventDefault();
                  addToCart(itemSuggestions[0]);
                }
              }}
              autoFocus
              placeholder="Search item by name / HSN…"
              className="flex-1 px-3 py-2.5 rounded-xl text-[13px] font-bold text-white outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
            />
            <button onClick={() => setShowScanner(true)}
              className="px-3 rounded-xl active:scale-95 transition-all flex items-center gap-1.5"
              style={{
                background: 'rgba(99,102,241,0.18)',
                border: '1px solid rgba(99,102,241,0.3)',
                color: '#a5b4fc',
              }}>
              <ScanLine size={14} />
              <span className="text-[10px] font-black uppercase tracking-wider">Scan</span>
            </button>
          </div>
          {itemSuggestions.length > 0 && (
            <div className="pos-suggestion-list rounded-xl max-h-[220px] overflow-y-auto"
              onMouseDown={e => e.preventDefault()}
              style={{ background: '#141a30', border: '1px solid rgba(255,255,255,0.1)' }}>
              {itemSuggestions.map((it: any) => (
                <button key={it.id || it.name}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { addToCart(it); setSearchFocused(false); }}
                  className="w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 active:scale-[0.99]"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-bold text-white truncate">{it.name}</p>
                    <div className="flex gap-2 text-[9px] font-bold mt-0.5">
                      <span style={{ color: 'rgba(148,163,184,0.5)' }}>{it.unit || 'Pcs'}</span>
                      <span style={{ color: Number(it.current_stock) <= Number(it.min_stock || 0) ? '#fbbf24' : 'rgba(148,163,184,0.5)' }}>
                        Stock: {Number(it.current_stock) || 0}
                      </span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[12px] font-black tabular-nums" style={{ color: '#34d399' }}>
                      {fmtINR(Number(it.sale_rate) || 0)}
                    </p>
                    <p className="text-[9px] font-bold" style={{ color: 'rgba(148,163,184,0.4)' }}>
                      Tap to add
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {search && itemSuggestions.length === 0 && (
            <p className="text-[11px] font-bold text-center py-2"
              style={{ color: 'rgba(148,163,184,0.4)' }}>
              No items match "{search}"
            </p>
          )}
        </div>

        {/* CART */}
        <div className="rounded-[16px] overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}>
          <div className="px-3 py-2.5 flex items-center justify-between"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2">
              <ShoppingCart size={12} style={{ color: 'rgba(167,139,250,0.7)' }} />
              <p className="text-[9px] font-black uppercase tracking-[0.15em]"
                style={{ color: 'rgba(148,163,184,0.5)' }}>Cart</p>
            </div>
            <p className="text-[10px] font-bold" style={{ color: 'rgba(148,163,184,0.5)' }}>
              {totals.qtyCount} {totals.qtyCount === 1 ? 'unit' : 'units'}
              {cart.length > 0 && (
                <span className="ml-2 hidden sm:inline" style={{ color: 'rgba(148,163,184,0.35)' }}>
                  · long-press a line to edit
                </span>
              )}
            </p>
          </div>
          {cart.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Package size={28} className="mx-auto mb-2" style={{ color: 'rgba(148,163,184,0.3)' }} />
              <p className="text-[11px] font-bold" style={{ color: 'rgba(148,163,184,0.4)' }}>
                Cart is empty — search or scan an item to start
              </p>
            </div>
          ) : (
            cart.map((l, idx) => {
              const lineTotal = l.quantity * l.rate;
              return (
                <div key={l.key} className="px-3 py-3 space-y-2"
                  style={{ borderBottom: idx < cart.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                  {/* line 1: name + edit + remove
                      Wrapped in touch/mouse-down handlers so a 500 ms hold on
                      the name area opens the big-input edit sheet (Module 1
                      "long-press → open edit"). */}
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className="min-w-0 flex-1 select-none"
                      style={{ touchAction: 'manipulation', WebkitUserSelect: 'none' }}
                      onTouchStart={() => startLongPress(l.key)}
                      onTouchEnd={cancelLongPress}
                      onTouchCancel={cancelLongPress}
                      onTouchMove={cancelLongPress}
                      onMouseDown={() => startLongPress(l.key)}
                      onMouseUp={cancelLongPress}
                      onMouseLeave={cancelLongPress}
                      onContextMenu={e => {
                        // Right-click / long-press context menu: also opens edit
                        // and suppresses the OS menu.
                        e.preventDefault();
                        setEditKey(l.key);
                      }}
                    >
                      <p className="text-[12px] font-bold text-white truncate">{l.item_name}</p>
                      <div className="flex items-center gap-2 mt-0.5 text-[9px] font-bold"
                        style={{ color: 'rgba(148,163,184,0.5)' }}>
                        <span>{l.unit}</span>
                        {l.hsn_code && <span>HSN {l.hsn_code}</span>}
                        {l.gst_percent > 0 && <span>{l.gst_percent}% GST</span>}
                        {typeof l.stockOnHand === 'number' && l.quantity > l.stockOnHand && (
                          <span style={{ color: '#fbbf24' }}>⚠ over stock</span>
                        )}
                      </div>
                    </div>
                    <button onClick={() => setEditKey(l.key)}
                      title="Edit line"
                      className="p-1.5 rounded-lg active:scale-95"
                      style={{ background: 'rgba(99,102,241,0.14)', color: '#a5b4fc' }}>
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => removeLine(l.key)}
                      className="p-1.5 rounded-lg active:scale-95"
                      style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                  {/* line 2: qty stepper row */}
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-bold w-8 flex-shrink-0"
                      style={{ color: 'rgba(148,163,184,0.5)' }}>Qty</span>
                    <div className="flex items-center rounded-xl overflow-hidden flex-1"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <button onClick={() => decQty(l.key)}
                        className="px-2.5 py-1.5 active:scale-90"
                        style={{ color: 'rgba(248,113,113,0.9)' }}>
                        <Minus size={12} />
                      </button>
                      <input
                        type="number"
                        value={l.quantity}
                        inputMode="decimal"
                        onChange={e => updateLine(l.key, { quantity: Math.max(0, Number(e.target.value) || 0) })}
                        className="flex-1 min-w-0 text-center text-[13px] font-black text-white bg-transparent outline-none tabular-nums"
                      />
                      <button onClick={() => incQty(l.key)}
                        className="px-2.5 py-1.5 active:scale-90"
                        style={{ color: 'rgba(52,211,153,0.9)' }}>
                        <Plus size={12} />
                      </button>
                    </div>
                  </div>
                  {/* line 3: rate input + line total — rate box is half the qty stepper width,
                      amount is right-aligned and ends flush with the + button edge */}
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-bold w-8 flex-shrink-0"
                      style={{ color: 'rgba(148,163,184,0.5)' }}>Rate</span>
                    <div className="flex items-center gap-1 px-2 py-1.5 rounded-xl"
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        width: '50%',
                        flexShrink: 0,
                      }}>
                      <span className="text-[10px] font-bold flex-shrink-0" style={{ color: 'rgba(148,163,184,0.5)' }}>₹</span>
                      <input
                        type="number"
                        value={l.rate}
                        onChange={e => updateLine(l.key, { rate: Math.max(0, Number(e.target.value) || 0) })}
                        className="flex-1 min-w-0 text-[12px] font-bold text-white bg-transparent outline-none tabular-nums"
                      />
                    </div>
                    <p className="flex-1 text-right text-[13px] font-black tabular-nums"
                      style={{ color: '#34d399' }}>
                      {fmtINR(lineTotal)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>

      {/* ── TOTALS + ACTIONS (inside scroll body, above keyboard-safe area) ── */}
      <div className="pt-2"
        style={{
          paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))',
        }}>

        {/* ── Grand Total bar (always visible) + expand toggle ── */}
        <button
          type="button"
          onClick={() => setTotalsExpanded(v => !v)}
          className="w-full flex items-center justify-between px-3 py-2 mb-2 rounded-[14px] active:scale-[0.99] transition-all"
          style={{
            background: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(16,185,129,0.05))',
            border: '1px solid rgba(16,185,129,0.3)',
          }}>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.12em]"
              style={{ color: 'rgba(110,231,183,0.8)' }}>Grand Total</span>
            {(totals.totalCgst > 0 || totals.totalIgst > 0) && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: 'rgba(16,185,129,0.18)', color: 'rgba(110,231,183,0.7)' }}>
                +GST
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-black tabular-nums" style={{ color: '#34d399' }}>
              {fmtINR(totals.grandTotal)}
            </span>
            {totalsExpanded
              ? <ChevronDown size={14} style={{ color: 'rgba(110,231,183,0.6)' }} />
              : <ChevronUp size={14} style={{ color: 'rgba(110,231,183,0.6)' }} />
            }
          </div>
        </button>

        {/* ── Expandable breakdown ── */}
        {totalsExpanded && (
          <div className="rounded-[14px] p-3 mb-2"
            style={{
              background: 'rgba(16,185,129,0.06)',
              border: '1px solid rgba(16,185,129,0.18)',
            }}>
            <div className="flex justify-between text-[11px] font-bold mb-1"
              style={{ color: 'rgba(148,163,184,0.7)' }}>
              <span>Subtotal</span>
              <span className="tabular-nums">{fmtINR(totals.subtotal)}</span>
            </div>

            {!interstate && totals.totalCgst > 0 && (
              <>
                <div className="flex justify-between text-[11px] font-bold mb-1"
                  style={{ color: 'rgba(148,163,184,0.7)' }}>
                  <span>CGST</span>
                  <span className="tabular-nums">{fmtINR(totals.totalCgst)}</span>
                </div>
                <div className="flex justify-between text-[11px] font-bold mb-1"
                  style={{ color: 'rgba(148,163,184,0.7)' }}>
                  <span>SGST</span>
                  <span className="tabular-nums">{fmtINR(totals.totalSgst)}</span>
                </div>
              </>
            )}
            {interstate && totals.totalIgst > 0 && (
              <div className="flex justify-between text-[11px] font-bold mb-1"
                style={{ color: '#fbbf24' }}>
                <span>IGST</span>
                <span className="tabular-nums">{fmtINR(totals.totalIgst)}</span>
              </div>
            )}
            {Math.abs(totals.roundOff) >= 0.01 && (
              <div className="flex justify-between text-[11px] font-bold mb-1"
                style={{ color: 'rgba(148,163,184,0.6)' }}>
                <span>Round Off</span>
                <span className="tabular-nums">
                  {totals.roundOff >= 0 ? '+' : ''}{fmtINR(totals.roundOff)}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => setRoundToRupee(v => !v)}
              className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider mt-1 active:scale-95"
              style={{ color: 'rgba(148,163,184,0.55)' }}>
              <span
                className="inline-block w-7 h-3.5 rounded-full transition-colors"
                style={{
                  background: roundToRupee ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.1)',
                  position: 'relative',
                }}>
                <span
                  className="absolute top-[1px] w-2.5 h-2.5 rounded-full bg-white transition-all"
                  style={{ left: roundToRupee ? '15px' : '2px' }}
                />
              </span>
              Round to nearest ₹1
            </button>
          </div>
        )}

        {/* Action buttons — Save (cheap), Save & Share (primary), Download + Print */}
        <div className="grid grid-cols-2 gap-2 mb-2">
          <button
            onClick={handleSave}
            disabled={saving || cart.length === 0}
            className="flex items-center justify-center gap-2 py-3 rounded-[16px] text-[12px] font-black active:scale-95 transition-all"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'rgba(226,232,240,0.85)',
              opacity: saving || cart.length === 0 ? 0.45 : 1,
            }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save
          </button>
          <button
            onClick={handleSaveAndShare}
            disabled={saving || cart.length === 0}
            className="flex items-center justify-center gap-2 py-3 rounded-[16px] text-[12px] font-black text-white active:scale-95 transition-all"
            style={{
              background: 'linear-gradient(135deg, #10b981, #059669)',
              boxShadow: '0 6px 20px rgba(16,185,129,0.35)',
              opacity: saving || cart.length === 0 ? 0.45 : 1,
            }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
            Save &amp; Share
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleSaveAndDownload}
            disabled={saving || cart.length === 0}
            className="flex items-center justify-center gap-1.5 py-2 rounded-[14px] text-[11px] font-black active:scale-95 transition-all"
            style={{
              background: 'rgba(99,102,241,0.12)',
              border: '1px solid rgba(99,102,241,0.25)',
              color: '#a5b4fc',
              opacity: saving || cart.length === 0 ? 0.45 : 1,
            }}>
            <Download size={12} /> Download PDF
          </button>
          <button
            onClick={handleSaveAndPrint}
            disabled={saving || cart.length === 0}
            className="flex items-center justify-center gap-1.5 py-2 rounded-[14px] text-[11px] font-black active:scale-95 transition-all"
            style={{
              background: 'rgba(167,139,250,0.12)',
              border: '1px solid rgba(167,139,250,0.25)',
              color: '#c4b5fd',
              opacity: saving || cart.length === 0 ? 0.45 : 1,
            }}>
            <Printer size={12} /> Print
          </button>
        </div>
      </div>
      </div>{/* end scrollable body */}

      {/* ── EDIT-LINE BOTTOM SHEET ──────────────────────────────────────
          Opened by long-press (or the pencil icon) on a cart line. Gives
          the shopkeeper big, thumb-friendly inputs for qty / rate / GST /
          HSN / unit instead of the tiny inline ones. */}
      {editingLine && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
          onClick={() => setEditKey(null)}
        >
          <div
            className="w-full sm:max-w-md rounded-t-[24px] sm:rounded-[24px] p-4 space-y-3"
            style={{
              background: '#141a30',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
              paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-[9px] font-black uppercase tracking-[0.2em]"
                  style={{ color: 'rgba(167,139,250,0.7)' }}>Edit line</p>
                <p className="text-sm font-black text-white truncate">{editingLine.item_name}</p>
              </div>
              <button onClick={() => setEditKey(null)}
                className="p-2 rounded-xl active:scale-95"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(148,163,184,0.7)' }}>
                <X size={16} />
              </button>
            </div>

            {/* Qty + Rate — biggest controls (most edited fields) */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl p-3 space-y-2"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <p className="text-[9px] font-black uppercase tracking-wider"
                  style={{ color: 'rgba(148,163,184,0.6)' }}>Quantity</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => updateLine(editingLine.key, { quantity: Math.max(0, editingLine.quantity - 1) })}
                    className="w-9 h-9 rounded-xl active:scale-90 flex items-center justify-center"
                    style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171' }}>
                    <Minus size={16} />
                  </button>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={editingLine.quantity}
                    onChange={e => updateLine(editingLine.key, { quantity: Math.max(0, Number(e.target.value) || 0) })}
                    className="flex-1 min-w-0 text-center text-lg font-black text-white bg-transparent outline-none tabular-nums"
                  />
                  <button onClick={() => updateLine(editingLine.key, { quantity: editingLine.quantity + 1 })}
                    className="w-9 h-9 rounded-xl active:scale-90 flex items-center justify-center"
                    style={{ background: 'rgba(52,211,153,0.15)', color: '#34d399' }}>
                    <Plus size={16} />
                  </button>
                </div>
              </div>
              <div className="rounded-2xl p-3 space-y-2"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <p className="text-[9px] font-black uppercase tracking-wider"
                  style={{ color: 'rgba(148,163,184,0.6)' }}>Rate (₹)</p>
                <input
                  type="number"
                  inputMode="decimal"
                  value={editingLine.rate}
                  onChange={e => updateLine(editingLine.key, { rate: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-full text-center text-lg font-black text-white bg-transparent outline-none tabular-nums py-1"
                />
              </div>
            </div>

            {/* GST + Unit + HSN — secondary fields */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-2xl p-2.5 space-y-1.5"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <p className="text-[9px] font-black uppercase tracking-wider"
                  style={{ color: 'rgba(148,163,184,0.6)' }}>GST %</p>
                <input
                  type="number"
                  inputMode="decimal"
                  value={editingLine.gst_percent}
                  onChange={e => updateLine(editingLine.key, { gst_percent: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-full text-center text-sm font-black text-white bg-transparent outline-none tabular-nums"
                />
              </div>
              <div className="rounded-2xl p-2.5 space-y-1.5"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <p className="text-[9px] font-black uppercase tracking-wider"
                  style={{ color: 'rgba(148,163,184,0.6)' }}>Unit</p>
                <input
                  value={editingLine.unit}
                  onChange={e => updateLine(editingLine.key, { unit: e.target.value })}
                  className="w-full text-center text-sm font-black text-white bg-transparent outline-none"
                />
              </div>
              <div className="rounded-2xl p-2.5 space-y-1.5"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <p className="text-[9px] font-black uppercase tracking-wider"
                  style={{ color: 'rgba(148,163,184,0.6)' }}>HSN</p>
                <input
                  value={editingLine.hsn_code}
                  onChange={e => updateLine(editingLine.key, { hsn_code: e.target.value })}
                  className="w-full text-center text-sm font-black text-white bg-transparent outline-none"
                />
              </div>
            </div>

            {/* Price-type toggle (incl. / excl.) */}
            <div className="flex items-center gap-2 rounded-2xl p-1"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              {(['exclusive', 'inclusive'] as const).map(pt => (
                <button key={pt}
                  onClick={() => updateLine(editingLine.key, { price_type: pt })}
                  className="flex-1 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all"
                  style={{
                    background: editingLine.price_type === pt
                      ? 'linear-gradient(135deg, rgba(99,102,241,0.3), rgba(139,92,246,0.25))'
                      : 'transparent',
                    color: editingLine.price_type === pt ? '#fff' : 'rgba(148,163,184,0.6)',
                    border: editingLine.price_type === pt
                      ? '1px solid rgba(139,92,246,0.4)' : '1px solid transparent',
                  }}>
                  {pt === 'exclusive' ? 'GST excl.' : 'GST incl.'}
                </button>
              ))}
            </div>

            {/* Live line total */}
            <div className="flex items-center justify-between px-2 py-2 rounded-xl"
              style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
              <span className="text-[10px] font-black uppercase tracking-wider"
                style={{ color: 'rgba(110,231,183,0.8)' }}>Line total</span>
              <span className="text-base font-black tabular-nums" style={{ color: '#34d399' }}>
                {fmtINR(editingLine.quantity * editingLine.rate)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => { removeLine(editingLine.key); setEditKey(null); }}
                className="flex items-center justify-center gap-2 py-3 rounded-2xl text-[12px] font-black active:scale-95"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
                <Trash2 size={14} /> Remove
              </button>
              <button
                onClick={() => { setEditKey(null); refocusSearch(); }}
                className="flex items-center justify-center gap-2 py-3 rounded-2xl text-[12px] font-black text-white active:scale-95"
                style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', boxShadow: '0 6px 20px rgba(99,102,241,0.35)' }}>
                <Check size={14} /> Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default POSBillingView;