import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavState } from '../../services/useNavState';
import { useBackHandler } from '../../services/useBackHandler';
import { User } from 'firebase/auth';
import {
  Search, Package, AlertTriangle, Edit2, Trash2, Download, Plus,
  Tag, TrendingUp, TrendingDown, ShieldCheck, AlertCircle, ArrowLeft,
  Boxes, ArrowDownRight, ArrowUpRight, Camera, Upload, RefreshCw
} from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import BarcodeScanner from '../common/BarcodeScanner';
import BulkImportModal from '../modals/BulkImportModal';
import { TrashService } from '../../services/trash';
import { exportService } from '../../services/export';
import { useUI } from '../../context/UIContext';
import { useData } from '../../context/DataContext';
import { useRole } from '../../context/RoleContext';
import { WasteEntry } from '../../types/models';
import { useSoftDelete } from '../common/UndoSnackbar';
import ExportFormatModal from '../common/ExportFormatModal';
import InventoryItemDetailView from './InventoryItemDetailView';
import { TelemetryService } from '../../services/telemetryService';
import { formatINR } from '../../utils/helpers';

interface InventoryViewProps { 
    user: User; 
    settings?: any;
    onAdd: () => void; 
    onEdit: (item: any) => void;
    onBack?: () => void;
    onViewItem?: (item: any) => void;
    onOpenWaste?: () => void;
    onOpenStockValuation?: () => void;
    onSubPageChange?: (isOnSubPage: boolean) => void;
}

const InventoryView: React.FC<InventoryViewProps> = ({ user, settings, onAdd, onEdit, onBack, onViewItem, onOpenWaste, onOpenStockValuation, onSubPageChange }) => {
  const { confirm, showToast } = useUI();
  const { useLedger, useWaste, useInventory } = useData();
  const { isAdmin, isStaff } = useRole();
  const { data: ledgerRawInv } = useLedger(user.uid);
  const { data: wasteRaw }    = useWaste(user.uid);

  // MODULE 4 — Inventory now reads from the shared React Query cache (the
  // same one POSBillingView already uses). Cold-starts render instantly from
  // the IndexedDB-persisted cache (Module 2), navigating back from POS shows
  // zero spinner, and offline cold-starts still display the last-known list.
  // `setData` lets us mutate the cache locally for optimistic delete/restore.
  const { data: itemsRaw, isLoading: loading, isFetching, setData: setItemsCache, refetch: refetchInventory } = useInventory(user.uid);

  // Null-safe derived arrays — hooks return undefined before first resolve
  const ledgerData = useMemo(() => ledgerRawInv || [], [ledgerRawInv]);
  const wasteData  = useMemo(() => wasteRaw     || [], [wasteRaw]);
  const items      = useMemo(() => itemsRaw     || [], [itemsRaw]);

  // FINAL MODULE — feature usage telemetry. Service dedups same-day repeats.
  useEffect(() => { TelemetryService.trackScreen(user.uid, 'inventory'); }, [user.uid]);

  const [searchTerm, setSearchTerm] = useNavState<string>('inventory_search', '');
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedInvItem, setSelectedInvItem] = useState<any | null>(null);
  useBackHandler(() => setSelectedInvItem(null), !!selectedInvItem, 5);
  useEffect(() => { onSubPageChange?.(!!selectedInvItem); }, [selectedInvItem, onSubPageChange]);

  const virtuosoRef = useRef<any>(null);
  const virtuosoStateRef = useRef<any>(null);
  const [initialVirtuosoState] = useState<any>(() => {
    try {
      const s = sessionStorage.getItem('scroll_inv_v2');
      if (!s) return undefined;
      const p = JSON.parse(s);
      return Array.isArray(p?.ranges) ? p : undefined;
    } catch { return undefined; }
  });
  useEffect(() => {
    return () => { virtuosoRef.current?.getState((state: any) => { try { sessionStorage.setItem('scroll_inv_v2', JSON.stringify(state)); } catch {} }); };
  }, []);
  const handleSelectInvItem = useCallback((item: any) => {
    virtuosoRef.current?.getState((state: any) => { virtuosoStateRef.current = state; });
    setSelectedInvItem(item);
  }, []);

  // O(N) Pre-index: Build waste-by-item and ledger stock maps ONCE
  const { purchaseIndex, saleIndex, wasteIndex } = useMemo(() => {
    const purchaseIndex: Record<string, number> = {};
    const saleIndex: Record<string, number> = {};
    const wasteIndex: Record<string, number> = {};

    // Index ledger entries
    for (const entry of ledgerData) {
      if (Array.isArray(entry.items)) {
        for (const li of entry.items) {
          const key = li.item_name?.toLowerCase();
          if (!key) continue;
          const qty = Number(li.quantity) || 0;
          if (entry.type === 'purchase') {
            purchaseIndex[key] = (purchaseIndex[key] || 0) + qty;
          } else if (entry.type === 'sell') {
            saleIndex[key] = (saleIndex[key] || 0) + qty;
          }
        }
      }
    }

    // Index waste entries  
    for (const w of wasteData) {
      const key = w.item_name?.toLowerCase();
      if (!key) continue;
      wasteIndex[key] = (wasteIndex[key] || 0) + (Number(w.quantity) || 0);
    }

    return { purchaseIndex, saleIndex, wasteIndex };
  }, [ledgerData, wasteData]);

  const { scheduleDelete } = useSoftDelete();

  const handleDelete = useCallback((id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const item = items.find(i => i.id === id);
      if (!item) return;
      scheduleDelete({
          id,
          collection : 'inventory',
          itemName   : item.name || 'Inventory Item',
          // Optimistic local mutation against the React Query cache — instant UI.
          onOptimistic: () => setItemsCache(p => p.filter(i => i.id !== id)),
          onRestore   : () => setItemsCache(p => [...p, item].sort((a,b) => (a.name||'').localeCompare(b.name||''))),
          onCommit    : async () => { await TrashService.moveToTrash(user.uid, 'inventory', id); },
      });
  }, [items, scheduleDelete, setItemsCache, user.uid]);

  const handleBarcodeScan = (barcode: string) => {
      // Search for product by barcode or name
      const product = items.find(item => 
          item.barcode?.toLowerCase() === barcode.toLowerCase() ||
          item.sku?.toLowerCase() === barcode.toLowerCase() ||
          item.name?.toLowerCase() === barcode.toLowerCase() ||
          item.id === barcode
      );

      if (product) {
          setSearchTerm('');
          onViewItem?.(product);
          showToast(`Found: ${product.name}`, "success");
      } else {
          showToast(`Product with barcode "${barcode}" not found`, "error");
      }
      setShowBarcodeScanner(false);
  };

  const filtered = useMemo(() => 
      items.filter(i => i.name?.toLowerCase().includes(searchTerm.toLowerCase())),
  [items, searchTerm]);

  // Compute net stock for each item using pre-indexed data (O(1) per item)
  const enrichedItems = useMemo(() => {
    return filtered.map(item => {
      const key = item.name?.toLowerCase();
      const purchased = purchaseIndex[key] || 0;
      const sold = saleIndex[key] || 0;
      const wasted = wasteIndex[key] || 0;
      const netStock = item.current_stock; // Use Firebase stock (already managed)
      const stockIn = purchased;
      const stockOut = sold;
      const stockWaste = wasted;
      return { ...item, stockIn, stockOut, stockWaste, netStock };
    });
  }, [filtered, purchaseIndex, saleIndex, wasteIndex]);

  // Totals for header
  const totals = useMemo(() => {
    return enrichedItems.reduce((acc, item) => ({
      stockIn: acc.stockIn + item.stockIn,
      stockOut: acc.stockOut + item.stockOut,
      stockWaste: acc.stockWaste + item.stockWaste,
    }), { stockIn: 0, stockOut: 0, stockWaste: 0 });
  }, [enrichedItems]);

  const handleExportFormat = async (format: 'pdf' | 'excel') => {
      setShowExportModal(false);
      if (enrichedItems.length === 0) return showToast("No items to export", "error");
      if (format === 'excel') {
          const data = enrichedItems.map(i => ({
              Name: i.name, Stock: i.current_stock, Unit: i.unit || 'Pcs',
              'Sale Rate': i.sale_rate || 0, 'Buy Rate': i.purchase_rate || 0,
              'HSN': i.hsn_code || '-', 'GST %': i.gst_percent || 0,
              'Min Stock': i.min_stock || 0, 'Stock In': i.stockIn,
              'Stock Out': i.stockOut, 'Waste': i.stockWaste,
          }));
          await exportService.exportToCSV(data, Object.keys(data[0]), 'Inventory_List.csv');
          showToast("Excel Downloaded", "success");
      } else {
          try {
              const { jsPDF } = await import('jspdf');
              const atMod = await import('jspdf-autotable');
              const autoTable = (atMod as any).default || atMod;
              const doc = new jsPDF();
              const PW = doc.internal.pageSize.width; const m = 14;
              doc.setFillColor(99,102,241); doc.rect(0,0,PW,22,'F');
              doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
              doc.text('INVENTORY REPORT', PW/2, 14, {align:'center'});
              autoTable(doc, {
                  startY: 26, margin:{left:m,right:m},
                  head:[['Item','Stock','Unit','Sale Rate','Buy Rate','HSN','GST%']],
                  body: enrichedItems.map((i:any)=>[
                      i.name, i.current_stock, i.unit||'Pcs',
                      i.sale_rate||0, i.purchase_rate||0,
                      i.hsn_code||'-', (i.gst_percent||0)+'%'
                  ]),
                  headStyles:{fillColor:[99,102,241],fontSize:7.5,fontStyle:'bold'},
                  bodyStyles:{fontSize:7.5},
                  alternateRowStyles:{fillColor:[248,250,252]},
              });
              const b64 = doc.output('datauristring').split(',')[1];
              await exportService.saveBase64File(b64, 'Inventory_Report.pdf');
              showToast("PDF Downloaded","success");
          } catch { showToast("Export failed","error"); }
      }
  };
  const handleExport = () => setShowExportModal(true);

  // Hoisted BEFORE the early return so this hook is always called in the same
  // order regardless of whether selectedInvItem is set.  Previously this was
  // inlined inside the Virtuoso itemContent JSX prop (after the early return),
  // which violated the Rules of Hooks and caused React error #300 in production.
  const renderInventoryRow = useCallback((_idx: number, item: any) => (
    <div className="pb-2.5">
      <InventoryRow
        item={item}
        isAdmin={isAdmin}
        onSelect={handleSelectInvItem}
        onEdit={onEdit}
        onDelete={handleDelete}
      />
    </div>
  ), [isAdmin, handleSelectInvItem, onEdit, handleDelete]);

  if (selectedInvItem) {
      return (
          <InventoryItemDetailView
              item={selectedInvItem}
              ledgerData={ledgerData}
              settings={settings || {}}
              onBack={() => setSelectedInvItem(null)}
              onEdit={(item) => { setSelectedInvItem(null); onEdit(item); }}
          />
      );
  }

  return (
    // MODULE 4 — flex-col + h-full so the Virtuoso list below can measure
    // its own height. Previously the outer div was overflow-y-auto, which
    // fights with Virtuoso's internal scroller.
    <div className="h-full flex flex-col" style={{background: 'var(--app-bg)'}}>
       {showExportModal && (
           <ExportFormatModal onSelect={handleExportFormat} onClose={() => setShowExportModal(false)} />
       )}

       {/* STICKY HEADER */}
       <div className="flex-shrink-0 z-30 px-4 pb-3" style={{background:'rgba(var(--app-bg-rgb),0.92)', paddingTop: '16px' }}>
        <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-3">
                {onBack && (
                    <button onClick={onBack} className="p-2 rounded-full transition-all active:scale-90"
                      style={{background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(148,163,184,0.7)'}}>
                        <ArrowLeft size={18} />
                    </button>
                )}
                <div>
                    <h1 className="text-xl font-black tracking-tight flex items-center gap-2" style={{letterSpacing:'-0.02em'}}>
                      Inventory
                      {/* MODULE 4 — subtle background-refresh pill, only shown when
                          we're refetching but already have cached rows on screen. */}
                      {isFetching && !loading && enrichedItems.length > 0 && (
                        <RefreshCw size={11} className="animate-spin text-[rgba(148,163,184,0.55)]" />
                      )}
                    </h1>
                    <p className="text-[10px] font-bold text-[rgba(148,163,184,0.45)]">{enrichedItems.length} Items</p>
                </div>
            </div>
            <div className="flex gap-2">
                {onOpenWaste && (
                  <button onClick={onOpenWaste} className="p-2.5 rounded-[14px] transition-all active:scale-90"
                    style={{background:'rgba(245,158,11,0.12)', color:'#d97706', border:'1.5px solid rgba(245,158,11,0.2)'}}>
                    <AlertTriangle size={16}/>
                  </button>
                )}
                {onOpenStockValuation && (
                  <button onClick={onOpenStockValuation} className="p-2.5 rounded-[14px] transition-all active:scale-90"
                    style={{background:'rgba(16,185,129,0.12)', color:'#34d399', border:'1.5px solid rgba(16,185,129,0.2)'}}>
                    <TrendingUp size={16}/>
                  </button>
                )}
                <button onClick={handleExport} className="p-2.5 rounded-[14px] transition-all active:scale-90"
                  style={{background:'rgba(59,130,246,0.1)', color:'#3b82f6', border:'1.5px solid rgba(59,130,246,0.15)'}}>
                  <Download size={16}/>
                </button>
                {isAdmin && (
                  <button onClick={onAdd} className="text-white p-2.5 rounded-[14px] transition-all active:scale-90"
                    style={{background:'linear-gradient(135deg,#4f46e5,#7c3aed)', boxShadow:'0 4px 12px rgba(79,70,229,0.3)'}}>
                    <Plus size={16}/>
                  </button>
                )}
             </div>
        </div>
       </div>

       {/* HEADER EXTRAS (summary + search bar) — fixed, above the virtual list */}
       <div className="flex-shrink-0 px-4">

       {/* CONSOLIDATED STOCK SUMMARY ROW */}
       <div className="rounded-2xl border border-white/10 p-3 mb-3 flex items-center justify-between gap-2 overflow-hidden" style={{background:'rgba(255,255,255,0.05)'}}>
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="p-1.5 rounded-lg flex-shrink-0 bg-[rgba(16,185,129,0.15)] border border-[rgba(16,185,129,0.2)]">
              <ArrowDownRight size={14} style={{color:'#34d399'}} />
            </div>
            <div className="min-w-0">
              <div className="text-[8px] font-bold uppercase text-[rgba(148,163,184,0.45)]">In</div>
              <div className="font-black text-sm tabular-nums whitespace-nowrap text-[#6ee7b7]">{totals.stockIn}</div>
            </div>
          </div>
          <div className="w-px h-8 flex-shrink-0 bg-white/10" />
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="p-1.5 rounded-lg flex-shrink-0 bg-[rgba(59,130,246,0.15)] border border-[rgba(59,130,246,0.2)]">
              <ArrowUpRight size={14} style={{color:'#60a5fa'}} />
            </div>
            <div className="min-w-0">
              <div className="text-[8px] font-bold uppercase text-[rgba(148,163,184,0.45)]">Out</div>
              <div className="font-black text-sm tabular-nums whitespace-nowrap text-[#93c5fd]">{totals.stockOut}</div>
            </div>
          </div>
          <div className="w-px h-8 flex-shrink-0 bg-white/10" />
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="p-1.5 rounded-lg flex-shrink-0 bg-[rgba(245,158,11,0.15)] border border-[rgba(245,158,11,0.2)]">
              <AlertTriangle size={14} style={{color:'#fbbf24'}} />
            </div>
            <div className="min-w-0">
              <div className="text-[8px] font-bold uppercase text-[rgba(148,163,184,0.45)]">Waste</div>
              <div className="font-black text-sm tabular-nums whitespace-nowrap text-[#fcd34d]">{totals.stockWaste}</div>
            </div>
          </div>
       </div>
       <div className="relative mb-3 flex gap-2">
           <div className="relative flex-1">
               <Search className="absolute left-3.5 top-3 text-slate-400" size={15}/>
               <input 
                   className="w-full pl-10 pr-4 py-3 text-sm font-bold outline-none text-[rgba(226,232,240,0.88)] text-[rgba(240,244,255,0.95)] placeholder-slate-400" 
                   placeholder="Search items..."
                   style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:'16px'}}
                   value={searchTerm} 
                   onChange={e => setSearchTerm(e.target.value)} 
               />
           </div>
           <button onClick={() => setShowBarcodeScanner(true)}
               className="p-3 text-white rounded-[14px] transition-all active:scale-90"
               style={{background:'linear-gradient(135deg,#3b82f6,#2563eb)', boxShadow:'0 4px 12px rgba(59,130,246,0.3)'}}>
               <Camera size={16} />
           </button>
           <button onClick={() => setShowBulkImport(true)}
               className="p-3 text-white rounded-[14px] transition-all active:scale-90"
               style={{background:'linear-gradient(135deg,#10b981,#059669)', boxShadow:'0 4px 12px rgba(16,185,129,0.3)'}}>
               <Upload size={16} />
           </button>
       </div>

       </div>
       {/* MODULE 4 — Virtualized list. With Virtuoso only the rows in the
           viewport (+ a small overscan) are mounted, so 1000+ inventory items
           scroll smoothly even on low-end Android. The row renderer is
           memoized below as <InventoryRow/> so unrelated parent re-renders
           (e.g. typing in the search box) skip the off-screen rows. */}
<div className="flex-1 min-h-0 px-4" style={{minHeight: 'calc(100vh - 280px)', paddingBottom: 'calc(96px + env(safe-area-inset-bottom, 0px))'}}>
           {loading && enrichedItems.length === 0 ? (
               <div className="space-y-2.5">
                 {Array.from({length: 6}).map((_, i) => (
                   <div key={i} className="rounded-[20px] p-3 animate-pulse" style={{background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.08)'}}>
                     <div className="flex justify-between items-start mb-3">
                       <div className="flex-1 mr-3 space-y-2">
                         <div className="h-4 rounded-lg w-2/3" style={{background:'rgba(255,255,255,0.1)'}}/>
                         <div className="h-3 rounded w-1/3" style={{background:'rgba(255,255,255,0.06)'}}/>
                       </div>
                       <div className="w-16 h-10 rounded-2xl" style={{background:'rgba(255,255,255,0.07)'}}/>
                     </div>
                     <div className="h-px w-full mb-2" style={{background:'rgba(255,255,255,0.06)'}}/>
                     <div className="flex gap-3">
                       <div className="h-3 rounded w-16" style={{background:'rgba(255,255,255,0.06)'}}/>
                       <div className="h-3 rounded w-16" style={{background:'rgba(255,255,255,0.06)'}}/>
                     </div>
                   </div>
                 ))}
               </div>
           ) : enrichedItems.length === 0 ? (
               <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                 <div className="w-16 h-16 rounded-[20px] flex items-center justify-center mb-4"
                   style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)' }}>
                   <Package size={28} style={{ color: 'rgba(52,211,153,0.6)' }} />
                 </div>
                 {searchTerm ? (
                   <>
                     <p className="text-sm font-black text-white mb-1">No items match your search</p>
                     <p className="text-[11px]" style={{ color: 'rgba(148,163,184,0.5)' }}>Try a different name, HSN code or barcode</p>
                   </>
                 ) : (
                   <>
                     <p className="text-sm font-black text-white mb-1">No items yet</p>
                     <p className="text-[11px] mb-5" style={{ color: 'rgba(148,163,184,0.55)' }}>
                       Add products to track stock, prices & GST
                     </p>
                     <button onClick={onAdd}
                       className="flex items-center gap-2 px-5 py-2.5 rounded-[14px] text-[12px] font-black text-white active:scale-95 transition-all"
                       style={{ background: 'linear-gradient(135deg,#10b981,#059669)', boxShadow: '0 6px 20px rgba(16,185,129,0.3)' }}>
                       <Plus size={14} /> Add First Product
                     </button>
                   </>
                 )}
               </div>
           ) : (
               <Virtuoso
                 ref={virtuosoRef}
                 restoreStateFrom={virtuosoStateRef.current ?? initialVirtuosoState}
                 style={{ height: '100%' }}
                 data={enrichedItems}
                 overscan={400}
                 computeItemKey={(_idx, item) => item.id || `inv-${_idx}`}
                 itemContent={renderInventoryRow}
               />
           )}
       </div>

       {/* Barcode Scanner Modal */}
       {showBarcodeScanner && (
           <BarcodeScanner
               onScan={handleBarcodeScan}
               onClose={() => setShowBarcodeScanner(false)}
               title="Search Product"
               description="Scan a product barcode or enter it manually"
           />
       )}

       {/* Bulk Import Modal */}
       {showBulkImport && (
           <BulkImportModal
               isOpen={showBulkImport}
               onClose={() => setShowBulkImport(false)}
               entityType="inventory"
               userId={user.uid}
               onImportComplete={() => {
                   // MODULE 4 — let React Query refetch from Firestore and
                   // repopulate the shared inventory cache. POS picks up the
                   // new items automatically because it reads the same cache.
                   refetchInventory();
               }}
           />
       )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// MODULE 4 — Memoized inventory row.
// React.memo skips re-rendering rows whose `item` reference hasn't changed.
// Combined with Virtuoso, this means typing a search keystroke only
// re-renders the search input and the matched-row visibility — every
// individual row that survives the filter is reused as-is.
// The handler props are stable refs from the parent (useCallback / set state
// fns), so the default shallow equality is sufficient.
// ─────────────────────────────────────────────────────────────────────────
interface InventoryRowProps {
  item: any;
  isAdmin: boolean;
  onSelect: (item: any) => void;
  onEdit: (item: any) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
}

const InventoryRowImpl: React.FC<InventoryRowProps> = ({ item, isAdmin, onSelect, onEdit, onDelete }) => {
  const isLowStock = Number(item.current_stock) < Number(item.min_stock || 0);
  return (
    <div
      onClick={() => onSelect(item)}
      className="rounded-[20px] relative overflow-hidden cursor-pointer transition-all active:scale-[0.97]"
      style={{
        background: isLowStock ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.05)',
        border: isLowStock ? '1px solid rgba(239,68,68,0.25)' : '1px solid rgba(255,255,255,0.1)',
        boxShadow: isLowStock ? '0 4px 16px rgba(239,68,68,0.1)' : '0 2px 10px rgba(0,0,0,0.2)',
      }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-0.5 rounded-r-full"
        style={{ background: isLowStock ? '#ef4444' : '#6366f1' }} />
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: isLowStock ? 'linear-gradient(90deg,transparent,rgba(248,113,113,0.4),transparent)' : 'linear-gradient(90deg,transparent,rgba(99,102,241,0.25),transparent)' }} />

      <div className="p-3 pl-4">
        <div className="flex justify-between items-start mb-2">
          <div className="flex-1 min-w-0 overflow-hidden mr-2">
            <div className="flex items-center gap-1.5 mb-0.5">
              <div className="font-bold text-sm leading-tight truncate text-[rgba(240,244,255,0.92)]">{item.name}</div>
              {isLowStock && (
                <span className="text-[8px] font-black px-1.5 py-0.5 rounded-lg flex items-center gap-0.5 flex-shrink-0"
                  style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>
                  <AlertCircle size={8} /> Low
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {item.prefixed_id && <span className="text-[8px] font-mono text-[rgba(148,163,184,0.4)]">{item.prefixed_id}</span>}
              {item.hsn_code && <span className="text-[8px] font-medium px-1.5 py-0.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(148,163,184,0.6)' }}>HSN {item.hsn_code}</span>}
            </div>
          </div>

          <div className="text-right px-2.5 py-1.5 rounded-2xl flex-shrink-0"
            style={{ background: isLowStock ? 'rgba(239,68,68,0.12)' : 'rgba(99,102,241,0.12)', border: isLowStock ? '1px solid rgba(239,68,68,0.2)' : '1px solid rgba(99,102,241,0.2)' }}>
            <div className="font-black text-base tabular-nums whitespace-nowrap"
              style={{ color: isLowStock ? '#f87171' : '#a5b4fc' }}>
              {item.current_stock} <span className="text-[9px] font-bold" style={{ color: 'rgba(148,163,184,0.45)' }}>{item.unit}</span>
            </div>
            <div className="text-[8px] font-bold text-[rgba(148,163,184,0.4)]">Min: {item.min_stock || 0}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex-1 min-w-0">
            <div className="text-[8px] font-bold uppercase mb-0.5 flex items-center gap-1" style={{ color: 'rgba(148,163,184,0.45)' }}>
              <TrendingDown size={8} style={{ color: '#34d399' }} /> Buy
            </div>
            <div className="font-bold text-xs tabular-nums text-[rgba(203,213,225,0.7)]">₹{formatINR(item.purchase_rate || 0)}</div>
          </div>
          <div className="flex-1 pl-3 min-w-0" style={{ borderLeft: '1px solid rgba(255,255,255,0.08)' }}>
            <div className="text-[8px] font-bold uppercase mb-0.5 flex items-center gap-1" style={{ color: 'rgba(148,163,184,0.45)' }}>
              <TrendingUp size={8} style={{ color: '#818cf8' }} /> Sell
            </div>
            <div className="font-bold text-xs tabular-nums text-[rgba(203,213,225,0.8)]">₹{formatINR(item.sale_rate || 0)}</div>
          </div>

          {isAdmin && (
            <div className="flex gap-1.5 flex-shrink-0">
              <button onClick={(e) => { e.stopPropagation(); onEdit(item); }}
                className="w-10 h-10 rounded-xl transition-all active:scale-90 flex items-center justify-center"
                style={{ background: 'rgba(59,130,246,0.13)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.2)' }}>
                <Edit2 size={14} />
              </button>
              <button onClick={(e) => onDelete(item.id, e)}
                className="w-10 h-10 rounded-xl transition-all active:scale-90 flex items-center justify-center"
                style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.18)' }}>
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const InventoryRow = React.memo(InventoryRowImpl, (prev, next) =>
  // Most fields a user actually sees on the card. Cheap shallow equality
  // — the row re-renders only when the item itself materially changes.
  prev.isAdmin === next.isAdmin &&
  prev.onSelect === next.onSelect &&
  prev.onEdit === next.onEdit &&
  prev.onDelete === next.onDelete &&
  prev.item === next.item // reference equality — items are recomputed in `enrichedItems` only when source data changes
);

export default InventoryView;







