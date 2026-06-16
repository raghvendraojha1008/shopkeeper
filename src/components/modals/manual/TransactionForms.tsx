import React, { useState, useMemo } from 'react';
import { getIDForEntry, peekNextID } from '../../../utils/idGenerator';
import { InputField, AutoComplete, PrefixedInputField } from './FormUI';
import {
  Hash, User as UserIcon, Truck, IndianRupee,
  FileText, Plus, Trash2, MapPin, Wallet, AlertTriangle, UserPlus, BadgePercent, Camera,
  CheckCircle2, Clock, AlertCircle, Package, Link, UserCheck
} from 'lucide-react';
import { SubPaymentModal } from './SubPaymentModal';
import BarcodeScanner from '../../common/BarcodeScanner';

export const OrderForm = ({
  type, formData, handleChange, items, setItems, itemNames,
  handleItemChange, customers, suppliers, vehicleList, staffList, calculateTotal,
  linkedPayments, setLinkedPayments, appSettings, onRemoveLinkedPayment,
  autoAddParty, setAutoAddParty,
}: any) => {

  const isSale = type === 'sales';
  const [showPaymentWidget, setShowPaymentWidget] = useState(false);
  const [deleteConfirmIndex, setDeleteConfirmIndex] = useState<number | null>(null);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [scannerItemIndex, setScannerItemIndex] = useState<number | null>(null);

  const grandTotal    = calculateTotal();
  const totalPaid     = (linkedPayments || []).reduce((acc: number, p: any) => acc + (Number(p.amount) || 0), 0);
  const balance       = totalPaid - grandTotal;
  const isPending     = balance < 0;
  const pendingAmount = Math.abs(balance);

  const handleAddPayment = (paymentData: any) => {
    setLinkedPayments([...(linkedPayments || []), { ...paymentData, _isNew: true }]);
  };

  const handleDeleteClick = (index: number) => {
    setDeleteConfirmIndex(index);
  };

  const confirmDelete = () => {
    if (deleteConfirmIndex !== null) {
      const payment = (linkedPayments || [])[deleteConfirmIndex];
      onRemoveLinkedPayment(deleteConfirmIndex, payment);
      setDeleteConfirmIndex(null);
    }
  };

  const handleBarcodeScanned = (barcode: string) => {
    if (scannerItemIndex !== null) {
      const matchedItem = itemNames.find((name: string) =>
        name.toLowerCase() === barcode.toLowerCase()
      );
      if (matchedItem) {
        handleItemChange(scannerItemIndex, 'item_name', matchedItem);
      } else {
        const partialMatch = itemNames.find((name: string) =>
          name.toLowerCase().includes(barcode.toLowerCase()) ||
          barcode.toLowerCase().includes(name.toLowerCase())
        );
        if (partialMatch) {
          handleItemChange(scannerItemIndex, 'item_name', partialMatch);
        }
      }
      setScannerItemIndex(null);
    }
    setShowBarcodeScanner(false);
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <InputField label="Date" field="date" type="date" value={formData.date} onChange={handleChange} />
        <PrefixedInputField
          label={isSale ? 'Invoice No' : 'Bill No'}
          field={isSale ? 'invoice_no' : 'bill_no'}
          icon={Hash}
          prefix={isSale ? 'S-' : 'P-'}
          value={isSale ? formData.invoice_no : formData.bill_no}
          onChange={handleChange}
          placeholder="Auto"
        />
      </div>

      <div className="space-y-3 mb-3">
        <div>
          <AutoComplete
            label={isSale ? 'Customer' : 'Supplier'}
            value={formData.party_name || ''}
            onChange={(v: string) => handleChange('party_name', v)}
            options={isSale ? customers : suppliers}
            icon={UserIcon}
          />
          <label className="flex items-center gap-2 mt-1 px-1 cursor-pointer w-fit">
            <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${autoAddParty ? 'bg-blue-600 border-blue-600' : 'border-[rgba(255,255,255,0.2)] bg-[rgba(255,255,255,0.06)]'}`}>
              <input type="checkbox" checked={autoAddParty} onChange={e => setAutoAddParty(e.target.checked)} className="hidden" />
              {autoAddParty && <UserPlus size={10} className="text-white" />}
            </div>
            <span className="text-[10px] font-bold text-[rgba(148,163,184,0.45)] select-none">Auto-save to Parties list if new</span>
          </label>
        </div>

        <InputField label="Address" field="address" icon={MapPin} value={formData.address || ''} onChange={handleChange} placeholder="Auto-filled if available" />

        {/* Different Site checkbox */}
        <label className="flex items-center gap-2 px-1 cursor-pointer w-fit">
          <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${formData.different_site ? 'bg-violet-600 border-violet-600' : 'border-[rgba(255,255,255,0.2)] bg-[rgba(255,255,255,0.06)]'}`}>
            <input type="checkbox" checked={!!formData.different_site} onChange={e => { handleChange('different_site', e.target.checked); if (!e.target.checked) handleChange('site', ''); }} className="hidden" />
            {formData.different_site && <MapPin size={9} className="text-white" />}
          </div>
          <span className="text-[10px] font-bold text-[rgba(148,163,184,0.5)] select-none">Deliver to a different site</span>
        </label>
        {formData.different_site && (
          <InputField label="Site / Delivery Location" field="site" icon={MapPin} value={formData.site || ''} onChange={handleChange} placeholder="Site name or address" />
        )}

        {!isSale && (
          <InputField
            label="SELLER INVOICE NUMBER"
            field="seller_invoice_no"
            icon={Hash}
            value={formData.seller_invoice_no || ''}
            onChange={(f: string, v: any) => handleChange(f, typeof v === 'string' ? v.toUpperCase() : v)}
            placeholder="Seller's original invoice no."
          />
        )}
      </div>

      {isSale ? (
        <AutoComplete label="Source Supplier (Optional)" value={formData.source_supplier || ''} onChange={(v: string) => handleChange('source_supplier', v)} options={suppliers} icon={Truck} placeholder="Who supplied this?" />
      ) : (
        <AutoComplete label="Destination Customer (Optional)" value={formData.delivery_customer || ''} onChange={(v: string) => handleChange('delivery_customer', v)} options={customers} icon={UserIcon} placeholder="Who is this for?" />
      )}

      {/* Transport & Discount Section */}
      <div className="p-3 rounded-xl border border-[rgba(245,158,11,0.2)] bg-[rgba(245,158,11,0.07)]">
        <label className="text-xs font-bold text-orange-400 uppercase mb-2 block flex items-center gap-1"><Truck size={12} /> Transport & Discount</label>
        <div className="grid grid-cols-2 gap-3">
          <AutoComplete label="Vehicle No" value={formData.vehicle || ''} onChange={(v: string) => handleChange('vehicle', v)} options={vehicleList} icon={Truck} className="mb-0" />
          <InputField label="Rent / Cartage" field="vehicle_rent" type="number" icon={IndianRupee} value={formData.vehicle_rent} onChange={handleChange} />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <AutoComplete
            label="Handling Type"
            value={formData.handling_type || ''}
            onChange={(v: string) => handleChange('handling_type', v)}
            options={appSettings?.custom_lists?.charge_types || ['Loading', 'Unloading', 'Loading & Unloading', 'Handling', 'Packing']}
            icon={MapPin}
            placeholder="Loading / Unloading..."
            className="mb-0"
          />
          <InputField
            label="Handling Charges"
            field="handling_charges"
            type="number"
            icon={IndianRupee}
            value={formData.handling_charges || ''}
            onChange={handleChange}
            placeholder="0"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <InputField
              label="Discount / Waiver"
              field="discount_amount"
              type="number"
              icon={BadgePercent}
              value={formData.discount_amount}
              onChange={(field: string, val: any) => {
                handleChange(field, val);
                if (Number(val) > 0) {
                  handleChange('discount_updated_at', new Date().toISOString());
                }
              }}
              placeholder="0"
            />
            {formData.discount_updated_at && (
              <p className="text-[9px] text-slate-400 font-bold mt-1 flex items-center gap-1">
                🕐 Last updated: {new Date(formData.discount_updated_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
          <div className="flex items-end pb-3">
            {Number(formData.discount_amount) > 0 && (
              <span className="text-[10px] font-bold text-orange-400 bg-[rgba(245,158,11,0.12)] px-2 py-1 rounded-lg flex items-center gap-1">
                <BadgePercent size={10} /> -₹{Number(formData.discount_amount).toLocaleString('en-IN')} off
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Items Section */}
      <div className="bg-[rgba(255,255,255,0.06)]/50 p-3 rounded-xl border border-white/12">
        <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Items</label>
        {items.map((it: any, idx: number) => (
          <div key={idx} className="p-3 rounded-xl border border-white/10 mb-4 relative" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <div className="flex justify-between items-center mb-2">
              <span className="text-[9px] font-black uppercase tracking-wider text-[rgba(148,163,184,0.4)]">Item {idx + 1}</span>
              <div className="flex items-center gap-2">
                {/* Per-item: auto-add to stock — only show for items NOT already in inventory */}
                {it.item_name && !itemNames.some((n: string) => n.toLowerCase() === it.item_name?.toLowerCase()) && (
                  <label className="flex items-center gap-1 cursor-pointer select-none" title="Automatically add this item to your inventory">
                    <div
                      className="flex items-center justify-center rounded transition-colors"
                      style={{
                        width: 14, height: 14,
                        background: it._auto_add_to_stock !== false ? 'rgba(16,185,129,0.8)' : 'rgba(255,255,255,0.06)',
                        border: `1px solid ${it._auto_add_to_stock !== false ? 'rgba(16,185,129,0.9)' : 'rgba(255,255,255,0.2)'}`,
                      }}>
                      <input
                        type="checkbox"
                        checked={it._auto_add_to_stock !== false}
                        onChange={e => handleItemChange(idx, '_auto_add_to_stock', e.target.checked)}
                        className="hidden"
                      />
                      {it._auto_add_to_stock !== false && <Package size={8} className="text-white" />}
                    </div>
                    <span className="text-[9px] font-bold" style={{ color: 'rgba(148,163,184,0.5)' }}>Add to stock</span>
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => setItems(items.filter((_: any, i: number) => i !== idx))}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black active:scale-90 transition-all"
                  style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}
                >
                  <Trash2 size={10} /> Remove
                </button>
              </div>
            </div>

            <div className="flex gap-2 mb-2 items-start">
              <div className="flex-1">
                <AutoComplete
                  label="Item Name"
                  value={it.item_name || ''}
                  onChange={(v: string) => handleItemChange(idx, 'item_name', v)}
                  options={itemNames}
                  icon={FileText}
                />
              </div>
              <button
                type="button"
                onClick={() => { setScannerItemIndex(idx); setShowBarcodeScanner(true); }}
                className="mt-5 p-2 rounded-xl transition-all active:scale-95"
                style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.2)' }}
              >
                <Camera size={16} />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <InputField label="Qty" field="quantity" type="number" value={it.quantity} onChange={(f: string, v: any) => handleItemChange(idx, f, v)} />
              <InputField label="Unit" field="unit" type="text" value={it.unit} onChange={(f: string, v: any) => handleItemChange(idx, f, v)} />
              <InputField label="Rate" field="rate" type="number" value={it.rate} onChange={(f: string, v: any) => handleItemChange(idx, f, v)} />
            </div>

            {appSettings?.automation?.auto_calculate_gst && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <InputField label="GST %" field="gst_percent" type="number" value={it.gst_percent} onChange={(f: string, v: any) => handleItemChange(idx, f, v)} placeholder="0" />
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">GST Type</label>
                  <select
                    value={it.price_type || 'exclusive'}
                    onChange={(e) => handleItemChange(idx, 'price_type', e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl text-xs font-bold transition-all outline-none appearance-none"
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      color: 'rgba(226,232,240,0.9)',
                    }}
                  >
                    <option value="exclusive" style={{ background: '#1a1f2e' }}>Exclusive</option>
                    <option value="inclusive" style={{ background: '#1a1f2e' }}>Inclusive</option>
                  </select>
                </div>
              </div>
            )}

            <div className="mt-2 text-right text-[11px] font-bold text-[rgba(148,163,184,0.55)]">
              {(() => {
                const qty = Number(it.quantity) || 0;
                const rate = Number(it.rate) || 0;
                const gst = Number(it.gst_percent) || 0;
                const preTax = qty * rate;
                const isExclusiveWithGST = (it.price_type || 'exclusive') === 'exclusive' && gst > 0;
                return isExclusiveWithGST ? (
                  <span>
                    Pre-tax: ₹{preTax.toLocaleString('en-IN')}{' '}
                    <span className="text-amber-400">+GST {gst}%</span>
                  </span>
                ) : (
                  <span>Subtotal: ₹{preTax.toLocaleString('en-IN')}</span>
                );
              })()}
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={() => setItems([...items, { item_name: '', quantity: '', unit: appSettings?.automation?.default_unit || 'Pcs', rate: '', gst_percent: '', price_type: 'exclusive', _auto_add_to_stock: true }])}
          className="w-full py-2.5 rounded-xl flex items-center justify-center gap-2 text-xs font-bold transition-all active:scale-95"
          style={{ background: 'rgba(59,130,246,0.1)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.2)' }}
        >
          <Plus size={14} /> Add Item
        </button>
      </div>

      {/* Grand Total */}
      <div className="p-4 rounded-xl border border-[rgba(16,185,129,0.25)] bg-[rgba(16,185,129,0.08)]">
        <div className="flex justify-between items-center">
          <span className="text-sm font-black text-emerald-400">Grand Total</span>
          <span className="text-2xl font-black text-emerald-300 tabular-nums">
            ₹{grandTotal.toLocaleString('en-IN')}
          </span>
        </div>
        {linkedPayments && linkedPayments.length > 0 && (
          <div className="mt-2 pt-2 border-t border-[rgba(16,185,129,0.2)]">
            <div className="flex justify-between text-xs font-bold text-emerald-500/70">
              <span>Paid</span><span>₹{totalPaid.toLocaleString('en-IN')}</span>
            </div>
            {isPending ? (
              <div className="flex justify-between text-xs font-bold mt-0.5" style={{ color: '#fbbf24' }}>
                <span className="flex items-center gap-1"><AlertCircle size={11} />Pending</span>
                <span>₹{pendingAmount.toLocaleString('en-IN')}</span>
              </div>
            ) : (
              <div className="flex justify-between text-xs font-bold mt-0.5" style={{ color: '#34d399' }}>
                <span className="flex items-center gap-1"><CheckCircle2 size={11} />Balance</span>
                <span>₹{pendingAmount.toLocaleString('en-IN')}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Linked Payments */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="text-xs font-bold text-slate-400 uppercase">Linked Payments</label>
          <button
            type="button"
            onClick={() => setShowPaymentWidget(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-black transition-all active:scale-95"
            style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.2)' }}
          >
            <Plus size={12} /> Add Payment
          </button>
        </div>

        {linkedPayments && linkedPayments.length > 0 && (
          <div className="space-y-2">
            {linkedPayments.map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-2.5 rounded-xl border border-white/10" style={{ background: 'rgba(255,255,255,0.04)' }}>
                <div>
                  <p className="text-xs font-bold text-[rgba(226,232,240,0.9)]">
                    ₹{Number(p.amount).toLocaleString('en-IN')} · {p.payment_mode || 'Cash'}
                  </p>
                  {p.notes && <p className="text-[10px] text-[rgba(148,163,184,0.5)]">{p.notes}</p>}
                </div>
                {deleteConfirmIndex === i ? (
                  <div className="flex gap-1">
                    <button type="button" onClick={confirmDelete} className="px-2 py-1 rounded-lg text-[9px] font-black bg-red-500/20 text-red-400">Confirm</button>
                    <button type="button" onClick={() => setDeleteConfirmIndex(null)} className="px-2 py-1 rounded-lg text-[9px] font-black bg-white/10 text-slate-400">Cancel</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => handleDeleteClick(i)} className="p-1.5 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}>
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showPaymentWidget && (
        <SubPaymentModal
          isOpen={showPaymentWidget}
          onClose={() => setShowPaymentWidget(false)}
          onAdd={handleAddPayment}
          pendingAmount={isPending ? pendingAmount : 0}
          paymentModes={appSettings?.custom_lists?.payment_modes || ['Cash', 'UPI', 'Bank Transfer', 'Cheque']}
          purposes={appSettings?.custom_lists?.purposes || ['Advance', 'Bill Payment', 'Loan', 'Other']}
          isSale={isSale}
          receivedByNames={appSettings?.custom_lists?.staff_members || appSettings?.custom_lists?.received_by_names || staffList || ['Owner', 'Staff']}
          paidByNames={appSettings?.custom_lists?.staff_members || appSettings?.custom_lists?.paid_by_names || staffList || ['Owner', 'Staff']}
          defaultData={{
            party_name: formData.party_name,
            address: formData.address,
            bill_no: isSale ? formData.invoice_no : formData.bill_no,
            amount: isPending ? pendingAmount : '',
          }}
        />
      )}

      {showBarcodeScanner && (
        <BarcodeScanner
          onClose={() => { setShowBarcodeScanner(false); setScannerItemIndex(null); }}
          onScan={handleBarcodeScanned}
        />
      )}
    </>
  );
};

export const TransactionForm = ({
  formData, handleChange, activePartyList, filteredOrders, availableOrders, appSettings, autoAddParty, setAutoAddParty, staffList,
}: any) => {
  const isReceived = formData.type === 'received';

  // Find the linked order object when a linked_invoice is selected
  const linkedOrder = useMemo(() => {
    if (!formData.linked_invoice || !availableOrders?.length) return null;
    const invoiceNo = formData.linked_invoice.split(' | ')[0]?.trim();
    if (!invoiceNo || invoiceNo === 'No Inv') return null;
    return availableOrders.find((o: any) =>
      String(o.invoice_no || o.bill_no || '').trim() === invoiceNo
    ) || null;
  }, [formData.linked_invoice, availableOrders]);

  return (
    <>
       <div className="grid grid-cols-2 gap-3">
        <InputField label="Date" field="date" type="date" value={formData.date} onChange={handleChange} />
        <PrefixedInputField
          label="Transaction ID"
          field="transaction_id"
          icon={Hash}
          prefix={isReceived ? 'REC-' : 'PAY-'}
          value={formData.transaction_id || ''}
          onChange={handleChange}
          placeholder="Auto"
        />
      </div>

      {/* Type toggle: Received / Paid */}
      <div>
        <label className="text-xs font-bold text-slate-400 uppercase mb-1.5 block">Type</label>
        <div className="grid grid-cols-2 gap-2">
          {(['received', 'paid'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => {
                handleChange('type', t);
                handleChange('transaction_id', peekNextID(t === 'received' ? 'receipts' : 'payments'));
              }}
              className={`py-2.5 rounded-xl text-xs font-black transition-all ${
                formData.type === t
                  ? t === 'received'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                    : 'bg-red-500/20 text-red-400 border border-red-500/40'
                  : 'text-slate-400 border border-white/10'
              }`}
              style={formData.type !== t ? { background: 'rgba(255,255,255,0.06)' } : {}}
            >
              {t === 'received' ? '⬇ Received' : '⬆ Paid'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <AutoComplete
          label={isReceived ? 'Customer' : 'Supplier'}
          value={formData.party_name || ''}
          onChange={(v: string) => handleChange('party_name', v)}
          options={activePartyList}
          icon={UserIcon}
        />
        <label className="flex items-center gap-2 mt-1 px-1 cursor-pointer w-fit">
          <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${autoAddParty ? 'bg-blue-600 border-blue-600' : 'border-[rgba(255,255,255,0.2)] bg-[rgba(255,255,255,0.06)]'}`}>
            <input type="checkbox" checked={autoAddParty} onChange={e => setAutoAddParty(e.target.checked)} className="hidden" />
            {autoAddParty && <UserPlus size={10} className="text-white" />}
          </div>
          <span className="text-[10px] font-bold text-[rgba(148,163,184,0.45)] select-none">Auto-save to Parties list if new</span>
        </label>
      </div>

      <InputField
        label="Amount"
        field="amount"
        type="number"
        icon={IndianRupee}
        value={formData.amount || ''}
        onChange={handleChange}
        placeholder="0"
      />

      <AutoComplete
        label="Linked Invoice / Bill (Optional)"
        value={formData.linked_invoice || ''}
        onChange={(v: string) => handleChange('linked_invoice', v)}
        options={filteredOrders}
        icon={FileText}
        placeholder="Select order to link..."
      />

      {/* Linked Order Preview Card */}
      {linkedOrder && (
        <div className="rounded-xl border p-3 space-y-1.5" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)' }}>
          <div className="flex items-center gap-1.5 mb-2">
            <Link size={12} className="text-indigo-400" />
            <span className="text-[10px] font-black uppercase tracking-wider text-indigo-400">Attached Order</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold text-slate-400">
                #{linkedOrder.invoice_no || linkedOrder.bill_no}
              </span>
              <span className="text-[9px] font-bold text-slate-400">·</span>
              <span className="text-[9px] font-bold text-slate-400">
                {String(linkedOrder.date || '').split('T')[0]}
              </span>
            </div>
            <span
              className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full"
              style={linkedOrder.type === 'sell'
                ? { background: 'rgba(16,185,129,0.15)', color: '#34d399' }
                : { background: 'rgba(239,68,68,0.12)', color: '#f87171' }
              }
            >
              {linkedOrder.type === 'sell' ? 'Sale' : 'Purchase'}
            </span>
          </div>
          <div className="font-bold text-sm text-[rgba(240,244,255,0.9)]">{linkedOrder.party_name}</div>
          {linkedOrder.items?.length > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <Package size={10} className="opacity-60" />
              <span className="truncate">
                {linkedOrder.items[0].item_name}
                {linkedOrder.items.length > 1 ? ` + ${linkedOrder.items.length - 1} more` : ''}
              </span>
            </div>
          )}
          <div className="flex justify-between items-center pt-1 border-t border-white/10">
            <span className="text-[10px] font-bold text-slate-400">Order Total</span>
            <span className="text-sm font-black tabular-nums" style={{ color: linkedOrder.type === 'sell' ? '#34d399' : '#f87171' }}>
              ₹{Number(linkedOrder.total_amount || 0).toLocaleString('en-IN')}
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <AutoComplete
          label="Payment Mode"
          value={formData.payment_mode || ''}
          onChange={(v: string) => handleChange('payment_mode', v)}
          options={appSettings?.custom_lists?.payment_modes || ['Cash', 'UPI', 'Bank Transfer', 'Cheque']}
          icon={Wallet}
          placeholder="Cash / UPI..."
        />
        <AutoComplete
          label="Payment Purpose"
          value={formData.payment_purpose || ''}
          onChange={(v: string) => handleChange('payment_purpose', v)}
          options={appSettings?.custom_lists?.purposes || ['Advance', 'Bill Payment', 'Loan', 'Other']}
          icon={FileText}
          placeholder="Advance / Bill..."
        />
      </div>

      <InputField
        label="Transaction / Bank Reference No."
        field="transaction_reference"
        icon={Hash}
        value={formData.transaction_reference || ''}
        onChange={(f: string, v: any) => handleChange(f, typeof v === 'string' ? v.toUpperCase() : v)}
        placeholder="UTR / CHEQUE NO / REF ID"
      />

      <InputField
        label="Note"
        field="notes"
        icon={FileText}
        value={formData.notes || ''}
        onChange={handleChange}
        placeholder="Description (Optional)..."
      />

      <AutoComplete
        label={isReceived ? 'Received By' : 'Paid By'}
        value={formData.received_by || ''}
        onChange={(v: string) => handleChange('received_by', v)}
        options={
          appSettings?.custom_lists?.staff_members ||
            (isReceived
              ? (appSettings?.custom_lists?.received_by_names || staffList || ['Owner', 'Staff'])
              : (appSettings?.custom_lists?.paid_by_names || staffList || ['Owner', 'Staff']))
        }
        icon={UserCheck}
        placeholder={isReceived ? 'Who collected payment?' : 'Who made payment?'}
      />
    </>
  );
};
