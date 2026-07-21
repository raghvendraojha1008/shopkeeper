import React, { useState } from 'react';
import { X, RotateCcw, Check } from 'lucide-react';
import { ApiService } from '../../services/api';
import { useUI } from '../../context/UIContext';

interface ReturnOrderModalProps {
  order: any;
  existingReturn?: any;
  user: any;
  party: any;
  onClose: () => void;
  onSuccess: () => void;
}

const ReturnOrderModal: React.FC<ReturnOrderModalProps> = ({
  order, existingReturn, user, party, onClose, onSuccess
}) => {
  const { showToast } = useUI();
  const returnType = order.type === 'sell' ? 'sell_return' : 'purchase_return';
  const items = order.items || [];

  const [returnDate, setReturnDate] = useState(
    existingReturn?.date || new Date().toISOString().split('T')[0]
  );
  const [note, setNote] = useState(existingReturn?.notes || '');
  const [saving, setSaving] = useState(false);

  // Match existing return items by item_name (stable identity), NOT by array index.
  // Saved return items only contain non-zero-qty entries (filtered on save), so
  // index-based lookup silently shifts slots when only some items were returned.
  const findExistingItem = (itemName: string): any =>
    existingReturn?.items?.find((ri: any) => ri.item_name === itemName) ?? null;

  const [quantities, setQuantities] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    items.forEach((item: any, i: number) => {
      const ex = findExistingItem(item.item_name);
      init[i] = ex ? String(ex.quantity || '') : '';
    });
    return init;
  });

  // Rates default to the existing return's rate (if editing) then the original order rate.
  // Users can override per-item to reflect the agreed return price.
  const [rates, setRates] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    items.forEach((item: any, i: number) => {
      const ex = findExistingItem(item.item_name);
      const existingRate = ex?.rate;
      init[i] = existingRate != null ? String(existingRate) : String(item.rate ?? '');
    });
    return init;
  });

  const totalReturn = items.reduce((sum: number, _item: any, i: number) => {
    return sum + (Number(quantities[i]) || 0) * (Number(rates[i]) || 0);
  }, 0);

  const hasAnyQty = Object.values(quantities).some(q => Number(q) > 0);

  const handleSave = async () => {
    if (!hasAnyQty) { showToast('Enter at least one return quantity', 'error'); return; }
    setSaving(true);
    try {
      const returnItems = items
        .map((item: any, i: number) => {
          const qty = Number(quantities[i]) || 0;
          if (!qty) return null;
          const returnRate = Number(rates[i]) || Number(item.rate) || 0;
          return { ...item, quantity: qty, rate: returnRate, total: qty * returnRate };
        })
        .filter(Boolean);

      // Compute total_amount from finalized returnItems (single source of truth).
      // Do NOT use the totalReturn display state — rates[i] can differ from
      // what was baked into totalReturn if the user modified a field after preview.
      const finalTotal = returnItems.reduce((sum: number, it: any) => sum + (Number(it.total) || 0), 0);

      const payload: any = {
        type: returnType,
        is_return: true,
        return_of_id: order.id,
        return_of_invoice: order.invoice_no || order.bill_no || order.prefixed_id || '',
        date: returnDate,
        party_id: party.id,
        party_name: party.name,
        items: returnItems,
        total_amount: finalTotal,
        notes: note,
      };

      if (existingReturn?.id) {
        await ApiService.update(user.uid, 'ledger_entries', existingReturn.id, payload);
        showToast('Return record updated', 'success');
      } else {
        await ApiService.add(user.uid, 'ledger_entries', payload);
        showToast('Return recorded', 'success');
      }
      onSuccess();
      onClose();
    } catch (e: any) {
      showToast('Failed to save return: ' + (e?.message || ''), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden"
        style={{ background: 'var(--modal-bg)', border: '1px solid var(--glass-border)' }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--glass-border)' }}>
          <div>
            <h3 className="font-black text-base text-[var(--text-primary)] flex items-center gap-2">
              <RotateCcw size={16} style={{ color: "var(--col-danger)" }} />
              {existingReturn ? 'Edit Return' : 'Record Return'}
            </h3>
            <p className="text-app-sm text-[var(--text-muted)] mt-0.5">
              {order.invoice_no || order.bill_no || order.prefixed_id || 'Order'} — {party.name}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl" style={{ background: 'var(--rgba-white-06)' }}>
            <X size={16} style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto space-y-3">
          <div>
            <label className="text-app-sm font-bold text-[var(--text-muted)] uppercase tracking-wide mb-1 block">Return Date</label>
            <input
              type="date"
              value={returnDate}
              onChange={e => setReturnDate(e.target.value)}
              className="w-full px-3 py-2 rounded-xl text-sm font-semibold text-[var(--text-primary)] outline-none"
              style={{ background: 'var(--rgba-white-07)', border: '1px solid var(--glass-border)' }}
            />
          </div>

          {items.length > 0 ? (
            <div>
              <label className="text-app-sm font-bold text-[var(--text-muted)] uppercase tracking-wide mb-2 block">Return Quantities</label>
              <div className="space-y-2">
                {items.map((item: any, i: number) => (
                  <div key={i} className="px-3 py-2.5 rounded-xl space-y-2"
                    style={{ background: 'var(--rgba-white-05)', border: '1px solid var(--glass-border)' }}>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-[var(--text-primary)] truncate">{item.item_name}</p>
                        <p className="text-app-xs text-[var(--text-muted)]">
                          Ordered: {item.quantity} {item.unit || ''}  •  Original Rate: ₹{item.rate}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-app-xs text-[var(--text-muted)]">Return Qty:</span>
                        <input
                          type="number"
                          min="0"
                          max={item.quantity}
                          step="1"
                          value={quantities[i] || ''}
                          onChange={e => {
                            const v = e.target.value;
                            const num = Number(v);
                            if (v === '' || (num >= 0 && num <= Number(item.quantity))) {
                              setQuantities(q => ({ ...q, [i]: v }));
                            }
                          }}
                          placeholder="0"
                          className="w-16 px-2 py-1.5 rounded-lg text-sm font-bold text-center text-[var(--text-primary)] outline-none"
                          style={{ background: 'var(--col-danger-15)', border: '1px solid var(--col-danger-25)' }}
                        />
                        <button
                          onClick={() => setQuantities(q => ({ ...q, [i]: String(item.quantity) }))}
                          className="px-2 py-1 rounded-lg text-app-xs font-black"
                          style={{ background: 'var(--col-danger-08)', color: 'rgba(248,113,113,0.7)', border: '1px solid var(--col-danger-15)' }}
                        >
                          Full
                        </button>
                      </div>
                    </div>
                    {/* Editable return rate — may differ from original order rate */}
                    <div className="flex items-center gap-2">
                      <span className="text-app-xs text-[var(--text-muted)] whitespace-nowrap">Return Rate (₹):</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={rates[i] ?? ''}
                        onChange={e => setRates(r => ({ ...r, [i]: e.target.value }))}
                        placeholder={String(item.rate ?? 0)}
                        className="flex-1 px-2 py-1.5 rounded-lg text-sm font-bold text-[var(--text-primary)] outline-none"
                        style={{ background: 'var(--rgba-white-06)', border: '1px solid var(--glass-border)' }}
                      />
                      {Number(rates[i]) !== Number(item.rate) && (
                        <button
                          onClick={() => setRates(r => ({ ...r, [i]: String(item.rate ?? '') }))}
                          className="px-2 py-1 rounded-lg text-app-xs font-black whitespace-nowrap"
                          style={{ background: 'var(--surface-1)', color: 'var(--text-muted)', border: '1px solid var(--glass-border)' }}
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center text-[var(--text-muted)] text-xs py-4">No item details on this order.</div>
          )}

          {totalReturn > 0 && (
            <div className="flex items-center justify-between px-3 py-2 rounded-xl"
              style={{ background: 'var(--col-danger-15)', border: '1px solid var(--col-danger-25)' }}>
              <span className="text-xs font-bold text-[var(--col-danger-85)]">Return Value</span>
              <span className="text-sm font-black" style={{ color: "var(--col-danger)" }}>
                ₹{Math.round(totalReturn).toLocaleString('en-IN')}
              </span>
            </div>
          )}

          <div>
            <label className="text-app-sm font-bold text-[var(--text-muted)] uppercase tracking-wide mb-1 block">Note (optional)</label>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Reason for return..."
              className="w-full px-3 py-2 rounded-xl text-sm font-semibold text-[var(--text-primary)] outline-none"
              style={{ background: 'var(--rgba-white-07)', border: '1px solid var(--glass-border)' }}
            />
          </div>
        </div>

        <div className="px-5 py-4 flex gap-3" style={{ borderTop: '1px solid var(--glass-border)' }}>
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-2xl text-sm font-black"
            style={{ background: 'var(--rgba-white-06)', color: 'var(--text-muted)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !hasAnyQty}
            className="flex-1 py-3 rounded-2xl text-sm font-black flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50"
            style={{ background: 'var(--col-danger-15)', color: "var(--col-danger)", border: '1px solid var(--col-danger-35)' }}
          >
            {saving ? 'Saving…' : <><Check size={15} /> {existingReturn ? 'Update Return' : 'Record Return'}</>}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReturnOrderModal;
