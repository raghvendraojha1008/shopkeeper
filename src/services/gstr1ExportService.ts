/**
 * GSTR-1 EXPORT SERVICE
 * ─────────────────────────────────────────────────────────────
 * Generates month-wise GSTR-1 compatible exports:
 *   1. JSON  — matches GST Offline Tool upload schema (gst.gov.in)
 *   2. Excel — structured worksheet matching GSTR-1 table layout
 *   3. CSV   — quick reference summary
 *
 * GSTR-1 Tables covered:
 *   B2B  (Table 4)  — Invoices to registered businesses (GSTIN parties)
 *   B2C Large (Table 5) — Inter-state invoices > ₹2.5L to unregistered
 *   B2C Small (Table 7) — All other invoices to unregistered buyers
 *   HSN  (Table 12) — HSN-wise summary of outward supplies
 *   Docs (Table 13) — Document summary (invoice count)
 *
 * HOW TO USE GENERATED FILE:
 *   1. Download the JSON file
 *   2. Go to gst.gov.in → Returns → GSTR-1 → Upload JSON
 *   3. Review, validate, then submit
 *
 * NOTE: The RapidAPI GST endpoint (gst-return-status.p.rapidapi.com)
 *       only supports GSTIN lookup — it cannot generate or file returns.
 *       There is no public API for GSTR filing; the official route is
 *       the GST Offline Tool JSON format used here.
 */

import { calculateGst, GST_STATE_CODES } from '../utils/gstUtils';
import { exportService } from './export';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GSTR1ExportOptions {
  /** Ledger entries from Firestore */
  ledgerEntries : any[];
  /** Parties (used to look up GSTIN by party_name when entry lacks one) */
  parties?      : any[];
  /** App settings (profile.gstin, profile.firm_name, etc.) */
  settings      : any;
  /** YYYY-MM e.g. "2024-11" */
  month         : string;
  /** "json" | "excel" | "csv" — defaults to "json" */
  format?       : 'json' | 'excel' | 'csv';
}

interface InvoiceLine {
  itemName   : string;
  hsnCode    : string;
  quantity   : number;
  unit       : string;
  rate       : number;
  gstPercent : number;
  taxableVal : number;
  cgst       : number;
  sgst       : number;
  igst       : number;
  total      : number;
}

interface ProcessedInvoice {
  invNo      : string;
  invDate    : string;          // DD-MM-YYYY
  invType    : 'R' | 'SEWP' | 'DE'; // Regular / SEZ with payment / Deemed export
  partyName  : string;
  partyGstin : string;
  partyState : string;
  partyStateCode: string;
  isInterstate: boolean;
  lines      : InvoiceLine[];
  taxableVal : number;
  totalCgst  : number;
  totalSgst  : number;
  totalIgst  : number;
  totalGst   : number;
  grandTotal : number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toYYYYMMDD(raw: any): string {
  if (!raw) return '';
  if (raw?.toDate) {
    const dt = raw.toDate();
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }
  return String(raw).substring(0, 10);
}

function toDDMMYYYY(raw: any): string {
  const s = toYYYYMMDD(raw);
  try {
    const [y, m, d] = s.split('-');
    return `${d}-${m}-${y}`;
  } catch { return s; }
}

function r2(n: number) { return Math.round(n * 100) / 100; }

function getStateFromGstin(gstin: string): { code: string; name: string } {
  if (!gstin || gstin.length < 2) return { code: '00', name: 'Unknown' };
  const code = parseInt(gstin.substring(0, 2), 10);
  return { code: String(code).padStart(2, '0'), name: GST_STATE_CODES[code] || 'Unknown' };
}

function isInterstate(sellerGstin: string, buyerGstin: string): boolean {
  if (!sellerGstin || !buyerGstin || buyerGstin.length < 2) return false;
  return sellerGstin.substring(0, 2) !== buyerGstin.substring(0, 2);
}

function financialYear(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const startYear = m >= 4 ? y : y - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const names = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[m]} ${y}`;
}

// ─── Core Processor ──────────────────────────────────────────────────────────

function processLedgerEntries(
  entries  : any[],
  month    : string,
  sellerGstin: string,
  parties  : any[] = [],
): ProcessedInvoice[] {
  const [y, m] = month.split('-').map(Number);

  // Build a case-insensitive lookup: party_name → gstin (only parties that have a GSTIN)
  const partyGstinByName = new Map<string, string>();
  for (const p of parties) {
    const name = (p?.name || '').trim().toLowerCase();
    const g    = (p?.gstin || '').trim().toUpperCase();
    if (name && g.length === 15) partyGstinByName.set(name, g);
  }

  return entries
    .filter(e => {
      // Only SELL invoices in the selected month
      if (e.type !== 'sell') return false;
      if (!e.date) return false;
      const dateStr = toYYYYMMDD(e.date);
      const [ey, em] = dateStr.split('-').map(Number);
      return ey === y && em === m;
    })
    .map(e => {
      // GSTIN may be on the ledger entry directly, or fetched from the linked party
      let partyGstin = (e.gstin || '').trim().toUpperCase();
      if (partyGstin.length !== 15) {
        const lookupKey = (e.party_name || '').trim().toLowerCase();
        const fromParty = lookupKey ? partyGstinByName.get(lookupKey) : '';
        if (fromParty) partyGstin = fromParty;
      }
      const interstate = isInterstate(sellerGstin, partyGstin);
      const partyStateInfo = getStateFromGstin(partyGstin);

      // For B2C (no buyer GSTIN), use seller's state as the place of supply (intra-state default)
      // or the entry's explicit place_of_supply field if present
      const posGstin = partyGstin.length >= 15
        ? partyGstin
        : ((e.place_of_supply || '').trim() || sellerGstin);
      const partyStateInfoResolved = partyGstin.length >= 15
        ? partyStateInfo
        : getStateFromGstin(posGstin);

      const lines: InvoiceLine[] = (e.items || []).map((item: any) => {
        const qty      = Number(item.quantity) || 1;
        const rate     = Number(item.rate)     || 0;
        const gstPct   = Number(item.gst_percent) || 0;
        const lineAmt  = r2(qty * rate);
        const gst      = calculateGst(lineAmt, gstPct, 'exclusive', interstate);

        return {
          itemName  : item.item_name || '',
          hsnCode   : (item.hsn_code || '').trim(),
          quantity  : qty,
          unit      : item.unit || 'NOS',
          rate,
          gstPercent: gstPct,
          taxableVal: gst.baseAmount,
          cgst      : gst.cgst,
          sgst      : gst.sgst,
          igst      : gst.igst,
          total     : gst.grandTotal,
        } as InvoiceLine;
      });

      const taxableVal = r2(lines.reduce((s, l) => s + l.taxableVal, 0));
      const totalCgst  = r2(lines.reduce((s, l) => s + l.cgst, 0));
      const totalSgst  = r2(lines.reduce((s, l) => s + l.sgst, 0));
      const totalIgst  = r2(lines.reduce((s, l) => s + l.igst, 0));
      const totalGst   = r2(totalCgst + totalSgst + totalIgst);
      const grandTotal = r2(taxableVal + totalGst);

      return {
        invNo    : e.invoice_no || e.prefixed_id || `INV-${e.id?.slice(-6)}`,
        invDate  : toDDMMYYYY(e.date),
        invType  : 'R' as const,
        partyName: e.party_name || '',
        partyGstin,
        partyState    : partyStateInfoResolved.name,
        partyStateCode: partyStateInfoResolved.code,
        isInterstate  : interstate,
        lines,
        taxableVal,
        totalCgst,
        totalSgst,
        totalIgst,
        totalGst,
        grandTotal,
      } as ProcessedInvoice;
    });
}

// ─── JSON Builder (GST Offline Tool format) ───────────────────────────────────

function buildGSTR1Json(invoices: ProcessedInvoice[], sellerGstin: string, month: string): object {
  const [y, m] = month.split('-').map(Number);
  const retPeriod = `${String(m).padStart(2, '0')}${y}`; // MMYYYY

  // ── Table 4: B2B (Registered buyer) ──
  const b2bMap = new Map<string, any>();
  for (const inv of invoices.filter(i => i.partyGstin.length === 15)) {
    if (!b2bMap.has(inv.partyGstin)) {
      b2bMap.set(inv.partyGstin, { ctin: inv.partyGstin, inv: [] });
    }
    const taxRates: any[] = [];
    const rateMap = new Map<number, { txval: number; iamt: number; camt: number; samt: number; csamt: number }>();
    for (const l of inv.lines) {
      const ex = rateMap.get(l.gstPercent) || { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
      rateMap.set(l.gstPercent, {
        txval : r2(ex.txval + l.taxableVal),
        iamt  : r2(ex.iamt  + l.igst),
        camt  : r2(ex.camt  + l.cgst),
        samt  : r2(ex.samt  + l.sgst),
        csamt : 0,
      });
    }
    rateMap.forEach((vals, rt) => taxRates.push({ rt, ...vals }));

    b2bMap.get(inv.partyGstin)!.inv.push({
      inum : inv.invNo,
      idt  : inv.invDate,
      val  : inv.grandTotal,
      pos  : inv.partyStateCode,
      rchrg: 'N',
      inv_typ: inv.invType,
      itms : taxRates.map(tr => ({
        num  : 1,
        itm_det: {
          rt   : tr.rt,
          txval: tr.txval,
          iamt : tr.iamt,
          camt : tr.camt,
          samt : tr.samt,
          csamt: tr.csamt,
        }
      })),
    });
  }
  const b2b = Array.from(b2bMap.values());

  // ── Table 5 & 7: B2C (Unregistered buyers) ──
  const b2cs: any[] = [];  // inter-state > 2.5L (Table 5)
  const b2csm = new Map<string, any>();
  for (const inv of invoices.filter(i => i.partyGstin.length !== 15 && i.isInterstate && i.grandTotal > 250000)) {
    const key = `${inv.partyStateCode}`;
    const rateMap = new Map<number, { txval: number; iamt: number; csamt: number }>();
    for (const l of inv.lines) {
      const ex = rateMap.get(l.gstPercent) || { txval: 0, iamt: 0, csamt: 0 };
      rateMap.set(l.gstPercent, { txval: r2(ex.txval + l.taxableVal), iamt: r2(ex.iamt + l.igst), csamt: 0 });
    }
    rateMap.forEach((vals, rt) => {
      const k = `${key}_${rt}`;
      if (!b2csm.has(k)) b2csm.set(k, { sply_ty: 'INTER', pos: key, rt, txval: 0, iamt: 0, csamt: 0 });
      const ex = b2csm.get(k)!;
      ex.txval = r2(ex.txval + vals.txval);
      ex.iamt  = r2(ex.iamt  + vals.iamt);
    });
  }
  b2csm.forEach(v => b2cs.push(v));

  // B2C Small (Table 7) — all other unregistered
  const b2cl: any[] = [];
  const b2clm = new Map<string, any>();
  for (const inv of invoices.filter(i => i.partyGstin.length !== 15 && !(i.isInterstate && i.grandTotal > 250000))) {
    const sply_ty = inv.isInterstate ? 'INTER' : 'INTRA';
    for (const l of inv.lines) {
      const k = `${sply_ty}_${l.gstPercent}`;
      if (!b2clm.has(k)) b2clm.set(k, { sply_ty, rt: l.gstPercent, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
      const ex = b2clm.get(k)!;
      ex.txval = r2(ex.txval + l.taxableVal);
      ex.iamt  = r2(ex.iamt  + l.igst);
      ex.camt  = r2(ex.camt  + l.cgst);
      ex.samt  = r2(ex.samt  + l.sgst);
    }
  }
  b2clm.forEach(v => b2cl.push(v));

  // ── Table 12: HSN Summary ──
  const hsnMap = new Map<string, any>();
  for (const inv of invoices) {
    for (const l of inv.lines) {
      const hsnKey = l.hsnCode || 'MISC';
      if (!hsnMap.has(hsnKey)) hsnMap.set(hsnKey, { num: hsnMap.size + 1, hsn_sc: hsnKey, desc: l.itemName, uqc: l.unit, qty: 0, val: 0, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0, rt: l.gstPercent });
      const ex = hsnMap.get(hsnKey)!;
      ex.qty   = r2(ex.qty   + l.quantity);
      ex.val   = r2(ex.val   + l.total);
      ex.txval = r2(ex.txval + l.taxableVal);
      ex.iamt  = r2(ex.iamt  + l.igst);
      ex.camt  = r2(ex.camt  + l.cgst);
      ex.samt  = r2(ex.samt  + l.sgst);
    }
  }
  const hsn = { data: Array.from(hsnMap.values()) };

  // ── Table 13: Document Summary ──
  const docSum = {
    doc_det: [{
      doc_num : 1,
      doc_typ : 'Invoices for outward supply',
      docs    : [{ num: invoices.length, from: invoices[0]?.invNo || '', to: invoices[invoices.length - 1]?.invNo || '', totnum: invoices.length, cancel: 0, net_issue: invoices.length }],
    }],
  };

  return {
    gstin   : sellerGstin,
    fp      : retPeriod,
    version : 'GST3.0.4',
    hash    : 'hash',
    b2b,
    b2cl    : b2cs,   // Table 5 — B2C Large (inter-state > ₹2.5L)
    b2cs    : b2cl,   // Table 7 — B2C Small (all other unregistered)
    hsn,
    doc_issue: docSum,
  };
}

// ─── CSV Builder ─────────────────────────────────────────────────────────────

function buildGSTR1Csv(invoices: ProcessedInvoice[], month: string): string {
  const rows: string[][] = [];

  // ── B2B Section ──
  rows.push(['=== TABLE 4: B2B INVOICES (Registered Buyers) ===']);
  rows.push(['GSTIN of Recipient', 'Receiver Name', 'Invoice No', 'Invoice Date', 'Invoice Value',
             'Place of Supply', 'Reverse Charge', 'Applicable Tax Rate', 'Invoice Type',
             'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess']);
  for (const inv of invoices.filter(i => i.partyGstin.length === 15)) {
    for (const l of inv.lines) {
      rows.push([
        inv.partyGstin, inv.partyName, inv.invNo, inv.invDate,
        String(inv.grandTotal), `${inv.partyStateCode}-${inv.partyState}`,
        'N', String(l.gstPercent), inv.invType,
        String(l.taxableVal), String(l.igst), String(l.cgst), String(l.sgst), '0',
      ]);
    }
  }

  rows.push([]);
  rows.push(['=== TABLE 7: B2C INVOICES (Unregistered Buyers) ===']);
  rows.push(['Type', 'Applicable Tax Rate', 'Place of Supply', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess']);
  const b2clm = new Map<string, any>();
  for (const inv of invoices.filter(i => i.partyGstin.length !== 15)) {
    for (const l of inv.lines) {
      const k = `${inv.isInterstate ? 'INTER' : 'INTRA'}_${l.gstPercent}_${inv.partyStateCode}`;
      if (!b2clm.has(k)) b2clm.set(k, { type: inv.isInterstate ? 'Inter-State' : 'Intra-State', rt: l.gstPercent, pos: `${inv.partyStateCode}-${inv.partyState}`, txval: 0, igst: 0, cgst: 0, sgst: 0 });
      const ex = b2clm.get(k)!;
      ex.txval = r2(ex.txval + l.taxableVal);
      ex.igst  = r2(ex.igst  + l.igst);
      ex.cgst  = r2(ex.cgst  + l.cgst);
      ex.sgst  = r2(ex.sgst  + l.sgst);
    }
  }
  b2clm.forEach(v => rows.push([v.type, String(v.rt), v.pos, String(v.txval), String(v.igst), String(v.cgst), String(v.sgst), '0']));

  rows.push([]);
  rows.push(['=== TABLE 12: HSN-WISE SUMMARY ===']);
  rows.push(['HSN', 'Description', 'UQC', 'Total Quantity', 'Total Value', 'Taxable Value', 'IGST', 'CGST', 'SGST', 'Cess']);
  const hsnMap = new Map<string, any>();
  for (const inv of invoices) {
    for (const l of inv.lines) {
      const k = l.hsnCode || 'MISC';
      if (!hsnMap.has(k)) hsnMap.set(k, { hsn: k, desc: l.itemName, uqc: l.unit, qty: 0, val: 0, txval: 0, igst: 0, cgst: 0, sgst: 0 });
      const ex = hsnMap.get(k)!;
      ex.qty   = r2(ex.qty   + l.quantity);
      ex.val   = r2(ex.val   + l.total);
      ex.txval = r2(ex.txval + l.taxableVal);
      ex.igst  = r2(ex.igst  + l.igst);
      ex.cgst  = r2(ex.cgst  + l.cgst);
      ex.sgst  = r2(ex.sgst  + l.sgst);
    }
  }
  hsnMap.forEach(v => rows.push([v.hsn, v.desc, v.uqc, String(v.qty), String(v.val), String(v.txval), String(v.igst), String(v.cgst), String(v.sgst), '0']));

  rows.push([]);
  // Grand totals
  const total = invoices.reduce((acc, inv) => ({
    taxable: r2(acc.taxable + inv.taxableVal),
    igst   : r2(acc.igst    + inv.totalIgst),
    cgst   : r2(acc.cgst    + inv.totalCgst),
    sgst   : r2(acc.sgst    + inv.totalSgst),
    grand  : r2(acc.grand   + inv.grandTotal),
  }), { taxable: 0, igst: 0, cgst: 0, sgst: 0, grand: 0 });

  rows.push([`GSTR-1 Summary for ${monthLabel(month)}`]);
  rows.push(['Total Invoices', String(invoices.length)]);
  rows.push(['Total Taxable Value', String(total.taxable)]);
  rows.push(['Total IGST', String(total.igst)]);
  rows.push(['Total CGST', String(total.cgst)]);
  rows.push(['Total SGST', String(total.sgst)]);
  rows.push(['Total GST', String(r2(total.igst + total.cgst + total.sgst))]);
  rows.push(['Grand Total', String(total.grand)]);

  return rows.map(r => r.map(v => {
    const s = String(v ?? '');
    return (s.includes(',') || s.includes('"')) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
}

// ─── Excel (XLSX) Builder ─────────────────────────────────────────────────────

async function buildGSTR1Excel(invoices: ProcessedInvoice[], sellerGstin: string, month: string): Promise<Blob> {
  // Build a real multi-sheet .xlsx using SheetJS. We dynamic-import the
  // ~600 KB `xlsx` package so it's only fetched when the user actually
  // requests an Excel export — keeps the main bundle small.
  //
  // BUG FIX (2026-04): previously this checked `window.XLSX`, which is
  // never set in this app, so every "Excel" export silently fell through
  // to the CSV branch below — but the file was still named `.xlsx`, so
  // Excel would refuse to open it with a "file is corrupted" error.

  let XLSX: any = null;
  try {
    XLSX = await import('xlsx');
  } catch (err) {
    console.error('[gstr1Export] Failed to load xlsx library:', err);
  }

  if (XLSX) {
    const wb = XLSX.utils.book_new();

    // ── B2B Sheet ──
    const b2bRows: any[][] = [
      ['GSTIN of Recipient', 'Receiver Name', 'Invoice No.', 'Invoice Date', 'Invoice Value (₹)',
       'Place of Supply', 'Reverse Charge (Y/N)', 'Invoice Type', 'Rate (%)',
       'Taxable Value (₹)', 'IGST (₹)', 'CGST (₹)', 'SGST (₹)', 'Cess (₹)'],
    ];
    for (const inv of invoices.filter(i => i.partyGstin.length === 15)) {
      let firstLine = true;
      for (const l of inv.lines) {
        b2bRows.push([
          firstLine ? inv.partyGstin : '',
          firstLine ? inv.partyName  : '',
          firstLine ? inv.invNo      : '',
          firstLine ? inv.invDate    : '',
          firstLine ? inv.grandTotal : '',
          firstLine ? `${inv.partyStateCode}-${inv.partyState}` : '',
          firstLine ? 'N' : '',
          firstLine ? inv.invType : '',
          l.gstPercent,
          l.taxableVal, l.igst, l.cgst, l.sgst, 0,
        ]);
        firstLine = false;
      }
    }
    const wsB2B = XLSX.utils.aoa_to_sheet(b2bRows);
    XLSX.utils.book_append_sheet(wb, wsB2B, '4-B2B');

    // ── B2C Sheet ──
    const b2clm = new Map<string, any>();
    for (const inv of invoices.filter(i => i.partyGstin.length !== 15)) {
      for (const l of inv.lines) {
        const k = `${inv.isInterstate ? 'INTER' : 'INTRA'}_${l.gstPercent}_${inv.partyStateCode}`;
        if (!b2clm.has(k)) b2clm.set(k, { type: inv.isInterstate ? 'Inter-State' : 'Intra-State', rt: l.gstPercent, pos: `${inv.partyStateCode}-${inv.partyState}`, txval: 0, igst: 0, cgst: 0, sgst: 0 });
        const ex = b2clm.get(k)!;
        ex.txval = r2(ex.txval + l.taxableVal);
        ex.igst  = r2(ex.igst  + l.igst);
        ex.cgst  = r2(ex.cgst  + l.cgst);
        ex.sgst  = r2(ex.sgst  + l.sgst);
      }
    }
    const b2cRows: any[][] = [
      ['Type', 'Place of Supply', 'Rate (%)', 'Taxable Value (₹)', 'IGST (₹)', 'CGST (₹)', 'SGST (₹)', 'Cess (₹)'],
    ];
    b2clm.forEach(v => b2cRows.push([v.type, v.pos, v.rt, v.txval, v.igst, v.cgst, v.sgst, 0]));
    const wsB2C = XLSX.utils.aoa_to_sheet(b2cRows);
    XLSX.utils.book_append_sheet(wb, wsB2C, '7-B2C Small');

    // ── HSN Sheet ──
    const hsnMap = new Map<string, any>();
    for (const inv of invoices) {
      for (const l of inv.lines) {
        const k = l.hsnCode || 'MISC';
        if (!hsnMap.has(k)) hsnMap.set(k, { hsn: k, desc: l.itemName, uqc: l.unit.toUpperCase(), qty: 0, val: 0, txval: 0, rt: l.gstPercent, igst: 0, cgst: 0, sgst: 0, cess: 0 });
        const ex = hsnMap.get(k)!;
        ex.qty   = r2(ex.qty   + l.quantity);
        ex.val   = r2(ex.val   + l.total);
        ex.txval = r2(ex.txval + l.taxableVal);
        ex.igst  = r2(ex.igst  + l.igst);
        ex.cgst  = r2(ex.cgst  + l.cgst);
        ex.sgst  = r2(ex.sgst  + l.sgst);
      }
    }
    const hsnRows: any[][] = [
      ['HSN/SAC', 'Description', 'UQC', 'Total Quantity', 'Total Value (₹)', 'Taxable Value (₹)',
       'Rate (%)', 'IGST (₹)', 'CGST (₹)', 'SGST (₹)', 'Cess (₹)'],
    ];
    hsnMap.forEach(v => hsnRows.push([v.hsn, v.desc, v.uqc, v.qty, v.val, v.txval, v.rt, v.igst, v.cgst, v.sgst, v.cess]));
    const wsHSN = XLSX.utils.aoa_to_sheet(hsnRows);
    XLSX.utils.book_append_sheet(wb, wsHSN, '12-HSN Summary');

    // ── Summary Sheet ──
    const totals = invoices.reduce((acc, inv) => ({
      count  : acc.count   + 1,
      taxable: r2(acc.taxable + inv.taxableVal),
      igst   : r2(acc.igst   + inv.totalIgst),
      cgst   : r2(acc.cgst   + inv.totalCgst),
      sgst   : r2(acc.sgst   + inv.totalSgst),
      grand  : r2(acc.grand  + inv.grandTotal),
    }), { count: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, grand: 0 });

    const sumRows: any[][] = [
      [`GSTR-1 Report — ${monthLabel(month)}`],
      ['GSTIN', sellerGstin],
      ['Financial Year', financialYear(month)],
      [],
      ['Table', 'Description', 'Count / Value (₹)'],
      ['Table 4', 'B2B Invoices (Registered)', invoices.filter(i => i.partyGstin.length === 15).length],
      ['Table 7', 'B2C Invoices (Unregistered)', invoices.filter(i => i.partyGstin.length !== 15).length],
      ['Table 12', 'HSN Entries', hsnMap.size],
      [],
      ['Metric', 'Amount (₹)'],
      ['Total Invoices', totals.count],
      ['Total Taxable Value', totals.taxable],
      ['Total IGST', totals.igst],
      ['Total CGST', totals.cgst],
      ['Total SGST', totals.sgst],
      ['Total Tax', r2(totals.igst + totals.cgst + totals.sgst)],
      ['Grand Total (incl. GST)', totals.grand],
    ];
    const wsSum = XLSX.utils.aoa_to_sheet(sumRows);
    XLSX.utils.book_append_sheet(wb, wsSum, 'Summary');

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // Fallback: return CSV as blob if XLSX not available
  const csv = buildGSTR1Csv(invoices, month);
  return new Blob([csv], { type: 'text/csv;charset=utf-8;' });
}

// ─── Main Export Function ─────────────────────────────────────────────────────

export async function exportGSTR1(options: GSTR1ExportOptions): Promise<void> {
  const { ledgerEntries, parties = [], settings, month, format = 'json' } = options;
  const sellerGstin = (settings?.profile?.gstin || '').trim().toUpperCase();
  const firmName    = settings?.profile?.firm_name || 'My Business';

  if (!sellerGstin || sellerGstin.length !== 15) {
    throw new Error('Valid GSTIN not configured. Please update your firm profile in Settings → Firm Profile.');
  }

  const invoices = processLedgerEntries(ledgerEntries, month, sellerGstin, parties);

  if (invoices.length === 0) {
    throw new Error(`No sales invoices found for ${monthLabel(month)}.`);
  }

  const [y, m] = month.split('-').map(Number);
  const retPeriod = `${String(m).padStart(2, '0')}${y}`;
  const fileBase  = `GSTR1_${firmName.replace(/\s+/g, '_')}_${retPeriod}`;

  if (format === 'json') {
    const jsonStr = JSON.stringify(buildGSTR1Json(invoices, sellerGstin, month), null, 2);
    await exportService.shareOrDownload(jsonStr, `${fileBase}.json`, 'application/json');
  } else if (format === 'excel') {
    const blob = await buildGSTR1Excel(invoices, sellerGstin, month);
    // sharePdfBlob handles both web (download) and native (Capacitor share sheet) correctly
    await exportService.sharePdfBlob(blob, `${fileBase}.xlsx`);
  } else {
    const csv = buildGSTR1Csv(invoices, month);
    await exportService.shareOrDownload(csv, `${fileBase}.csv`, 'text/csv');
  }
}

// ─── Convenience summary (for UI preview before export) ───────────────────────

export function getGSTR1Summary(ledgerEntries: any[], settings: any, month: string, parties: any[] = []) {
  const sellerGstin = (settings?.profile?.gstin || '').trim().toUpperCase();
  if (!sellerGstin) return null;

  const invoices = processLedgerEntries(ledgerEntries, month, sellerGstin, parties);
  if (invoices.length === 0) return null;

  const b2bCount = invoices.filter(i => i.partyGstin.length === 15).length;
  const b2cCount = invoices.filter(i => i.partyGstin.length !== 15).length;

  const totals = invoices.reduce((acc, inv) => ({
    taxable: r2(acc.taxable + inv.taxableVal),
    igst   : r2(acc.igst   + inv.totalIgst),
    cgst   : r2(acc.cgst   + inv.totalCgst),
    sgst   : r2(acc.sgst   + inv.totalSgst),
    grand  : r2(acc.grand  + inv.grandTotal),
  }), { taxable: 0, igst: 0, cgst: 0, sgst: 0, grand: 0 });

  return {
    month,
    monthLabel: monthLabel(month),
    totalInvoices: invoices.length,
    b2bCount,
    b2cCount,
    totalTaxable: totals.taxable,
    totalIgst   : totals.igst,
    totalCgst   : totals.cgst,
    totalSgst   : totals.sgst,
    totalGst    : r2(totals.igst + totals.cgst + totals.sgst),
    grandTotal  : totals.grand,
    financialYear: financialYear(month),
  };
}
