/**
 * GSTBreakdownCard  — Full-Fledge
 * ─────────────────────────────────────────────────────────────
 * Drops into InvoicePreviewModal just above the Grand Total row.
 * Shows:
 *  • Rate-wise tax table (CGST+SGST or IGST based on interstate)
 *  • Taxable subtotal, total tax, grand total
 *  • Amount in words (Indian number system)
 *  • Auto-detects interstate from seller vs buyer GSTIN state codes
 */

import React, { useMemo } from 'react';
import { buildInvoiceSummary, amountInWords, validateGstin } from '../../utils/gstUtils';

interface GSTBreakdownCardProps {
  items       : any[];
  settings?   : any;          // appSettings — for profile.gstin
  partyGstin? : string;       // buyer GSTIN
}

function isInterstateTx(sellerGstin?: string, buyerGstin?: string): boolean {
  if (!sellerGstin || !buyerGstin) return false;
  const s = String(sellerGstin).toUpperCase().trim();
  const b = String(buyerGstin).toUpperCase().trim();
  if (s.length < 2 || b.length < 2) return false;
  return s.substring(0, 2) !== b.substring(0, 2);
}

const GSTBreakdownCard: React.FC<GSTBreakdownCardProps> = ({ items, settings, partyGstin }) => {
  const sellerGstin = settings?.profile?.gstin;

  // Memoise so unrelated parent re-renders don't re-derive the boolean (and
  // thereby don't bust the summary memo below).  Depends only on the raw
  // GSTIN strings — not on any object reference.
  const isInterstate = useMemo(
    () => isInterstateTx(sellerGstin, partyGstin),
    [sellerGstin, partyGstin],
  );

  const summary = useMemo(() => {
    const mapped = (items || []).map((i: any) => ({
      itemName   : i.item_name || i.name || '',
      quantity   : Number(i.quantity) || 1,
      rate       : Number(i.rate) || 0,
      unit       : i.unit || 'Pcs',
      hsnCode    : i.hsn_code || '',
      gstPercent : Number(i.gst_percent) || 0,
      priceType  : (i.price_type as 'inclusive' | 'exclusive') || 'exclusive',
    }));
    return buildInvoiceSummary(mapped, isInterstate);
  }, [items, isInterstate]);

  // Group by GST rate
  const taxRows = useMemo(() => {
    const map = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number; count: number }>();
    summary.items.forEach(it => {
      const r = it.gstPercent;
      const ex = map.get(r) || { taxable: 0, cgst: 0, sgst: 0, igst: 0, count: 0 };
      map.set(r, { taxable: ex.taxable + it.baseAmount, cgst: ex.cgst + it.cgst, sgst: ex.sgst + it.sgst, igst: ex.igst + it.igst, count: ex.count + 1 });
    });
    return Array.from(map.entries()).filter(([r]) => r > 0).sort((a, b) => a[0] - b[0]);
  }, [summary]);

  if (taxRows.length === 0 && summary.totalGst === 0) return null;

  const words = amountInWords(summary.grandTotal);
  const R = (n: number) => `₹${n.toFixed(2)}`;

  return (
    <div className="rounded-[18px] overflow-hidden"
      style={{ background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)' }}>

      {/* Header */}
      <div className="px-4 py-2.5 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--glass-border)', background: 'var(--rgba-white-03)' }}>
        <p className="text-app-sm font-black uppercase tracking-[0.15em]" style={{ color: 'var(--text-muted)' }}>
          GST Breakdown
        </p>
        <span className="text-app-xs font-black px-2.5 py-0.5 rounded-lg"
          style={{
            background: isInterstate ? 'var(--col-info-14)' : 'var(--col-emerald-12)',
            color     : isInterstate ? "var(--col-info)"               : "var(--col-success)",
            border    : `1px solid ${isInterstate ? 'var(--col-info-22)' : 'var(--col-emerald-25)'}`,
          }}>
          {isInterstate ? 'IGST — Inter-state' : 'CGST + SGST — Intra-state'}
        </span>
      </div>

      <div className="px-4 pt-3 pb-2">
        {taxRows.length > 0 && (
          <>
            {/* Column headers */}
            <div className="grid mb-1.5 text-app-2xs font-black uppercase tracking-wider"
              style={{ color: 'var(--text-muted)', gridTemplateColumns: isInterstate ? '80px 1fr 1fr' : '80px 1fr 1fr 1fr' }}>
              <span>GST %</span>
              <span className="text-right">Taxable</span>
              {isInterstate
                ? <span className="text-right">IGST</span>
                : <><span className="text-right">CGST</span><span className="text-right">SGST</span></>}
            </div>

            {/* Rows */}
            {taxRows.map(([rate, vals]) => (
              <div key={rate} className="grid py-1.5 text-app-sm"
                style={{ color: 'var(--text-secondary)', gridTemplateColumns: isInterstate ? '80px 1fr 1fr' : '80px 1fr 1fr 1fr', borderBottom: '1px solid var(--glass-border)' }}>
                <span className="font-black" style={{ color: "var(--col-warning)" }}>{rate}%</span>
                <span className="text-right tabular-nums font-bold">{R(vals.taxable)}</span>
                {isInterstate
                  ? <span className="text-right tabular-nums font-bold" style={{ color: "var(--col-info)" }}>{R(vals.igst)}</span>
                  : <>
                      <span className="text-right tabular-nums font-bold" style={{ color: "var(--col-violet)" }}>{R(vals.cgst)}</span>
                      <span className="text-right tabular-nums font-bold" style={{ color: "var(--col-success)" }}>{R(vals.sgst)}</span>
                    </>}
              </div>
            ))}
          </>
        )}

        {/* Totals */}
        <div className="space-y-1.5 mt-2.5">
          <div className="flex justify-between text-app-sm" style={{ color: 'var(--text-secondary)' }}>
            <span>Taxable Amount</span>
            <span className="font-bold tabular-nums">{R(summary.subtotal)}</span>
          </div>
          {!isInterstate && summary.totalCgst > 0 && (
            <>
              <div className="flex justify-between text-app-sm" style={{ color: 'rgba(167,139,250,0.8)' }}>
                <span>CGST</span><span className="font-bold tabular-nums">{R(summary.totalCgst)}</span>
              </div>
              <div className="flex justify-between text-app-sm" style={{ color: 'var(--col-success-85)' }}>
                <span>SGST</span><span className="font-bold tabular-nums">{R(summary.totalSgst)}</span>
              </div>
            </>
          )}
          {isInterstate && summary.totalIgst > 0 && (
            <div className="flex justify-between text-app-sm" style={{ color: 'rgba(96,165,250,0.8)' }}>
              <span>IGST</span><span className="font-bold tabular-nums">{R(summary.totalIgst)}</span>
            </div>
          )}
          <div className="flex justify-between text-app-lg pt-2"
            style={{ borderTop: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}>
            <span className="font-black">Grand Total (incl. GST)</span>
            <span className="font-black tabular-nums" style={{ color: "var(--col-warning)" }}>{R(summary.grandTotal)}</span>
          </div>
        </div>
      </div>

      {/* Amount in words */}
      <div className="px-4 py-2.5" style={{ background: 'var(--rgba-white-025)', borderTop: '1px solid var(--glass-border)' }}>
        <p className="text-app-2xs font-bold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-muted)' }}>
          Amount in Words
        </p>
        <p className="text-app-sm font-semibold italic" style={{ color: 'var(--text-secondary)' }}>
          {words}
        </p>
      </div>
    </div>
  );
};

export default GSTBreakdownCard;







