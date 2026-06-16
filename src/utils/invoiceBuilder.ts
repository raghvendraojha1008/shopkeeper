/**
 * invoiceBuilder.ts — single source of truth for turning a saved ledger
 * payload (or an in-progress POS cart) into a fully-shaped InvoiceData
 * object that the PDF renderer can consume directly.
 *
 * Responsibilities:
 *   1. Determine intra-state vs inter-state from firm GSTIN ↔ party GSTIN
 *   2. Per-line GST split (CGST + SGST or IGST) using calculateGst()
 *   3. Subtotal / total tax / grand total roll-up
 *   4. Optional rounding adjustment to the nearest ₹1
 *   5. Format the invoice number using profile.invoice_prefix (e.g. INV-0001)
 *
 * The output of this module is the ONLY input ProfessionalInvoiceService
 * needs to render any layout (A4, thermal58, thermal80) — keeping the
 * ledger payload, the POS UI, and the PDF renderer cleanly decoupled.
 */

import { calculateGst, GstBreakdown } from './gstUtils';
import type { UserProfile } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────

export interface InvoiceLineInput {
  item_name   : string;
  hsn_code?   : string;
  quantity    : number;
  unit        : string;
  rate        : number;
  gst_percent : number;
  price_type  : 'inclusive' | 'exclusive';
  discount?   : number;     // percent
}

export interface InvoiceLineOutput extends InvoiceLineInput, GstBreakdown {
  lineTotal: number;        // quantity * rate (pre-discount, pre-tax-display)
  amount   : number;        // line grand total (taxable + tax)
}

export interface InvoiceTotals {
  subtotal      : number;   // sum of taxable amounts
  totalCgst     : number;
  totalSgst     : number;
  totalIgst     : number;
  totalGst      : number;
  preRound      : number;   // grand total before rounding
  roundOff      : number;   // adjustment applied (can be negative)
  grandTotal    : number;   // final amount the customer pays
  isInterstate  : boolean;
}

export interface InvoiceData {
  // ── Document ─────────────────────────
  invoice_no   : string;
  invoice_title: string;        // "TAX INVOICE" | "INVOICE" | "BILL" …
  date         : string;        // YYYY-MM-DD
  time?        : string;        // HH:MM display string
  type         : 'sales' | 'purchase';

  // ── Firm (seller) ────────────────────
  firm_name    : string;
  firm_address : string;
  firm_phone   : string;
  firm_email   : string;
  firm_gstin   : string;
  firm_state   : string;
  logo_base64  : string;

  // ── Party (buyer) ────────────────────
  party_name   : string;
  party_phone  : string;
  party_address: string;
  party_gstin  : string;

  // ── Items + totals ───────────────────
  items        : InvoiceLineOutput[];
  totals       : InvoiceTotals;
  amountInWords?: string;

  // ── Other ────────────────────────────
  payment_mode?: string;
  notes?       : string;
  reference_no?: string;

  // ── Branding / footer (from invoice_template settings) ──
  theme_color  : string;
  terms_text   : string;
  authorized_signatory: string;
  show_signature: boolean;
  show_terms    : boolean;
  show_logo     : boolean;
  footer_message: string;
  currency_symbol: string;
}

// ─── State-code helpers ───────────────────────────────────────────────────

/**
 * Extract the 2-digit state code from a GSTIN (first 2 characters).
 * Returns null when the GSTIN is missing or too short to be meaningful.
 */
export function stateCodeFromGstin(gstin?: string | null): string | null {
  if (!gstin) return null;
  const g = String(gstin).trim().toUpperCase();
  if (g.length < 2) return null;
  const code = g.substring(0, 2);
  if (!/^\d{2}$/.test(code)) return null;
  return code;
}

/**
 * Determine if a transaction is inter-state (IGST applies) vs
 * intra-state (CGST + SGST applies). When either GSTIN is missing
 * we fall back to intra-state — most cash sales are local and
 * showing CGST+SGST is the safer default for a small shopkeeper.
 */
export function isInterstateSale(
  firmGstin?: string | null,
  partyGstin?: string | null,
): boolean {
  const fs = stateCodeFromGstin(firmGstin);
  const ps = stateCodeFromGstin(partyGstin);
  if (!fs || !ps) return false;
  return fs !== ps;
}

// ─── Core builders ────────────────────────────────────────────────────────

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Compute totals for a list of lines, honouring inter-state logic and
 * an optional "round to nearest ₹1" adjustment.
 */
export function computeInvoiceTotals(
  lines: InvoiceLineInput[],
  isInterstate: boolean,
  roundToRupee = true,
): { lines: InvoiceLineOutput[]; totals: InvoiceTotals } {
  let subtotal = 0, totalCgst = 0, totalSgst = 0, totalIgst = 0;

  const out: InvoiceLineOutput[] = lines.map(l => {
    const qty   = Number(l.quantity) || 0;
    const rate  = Number(l.rate) || 0;
    const disc  = Number(l.discount) || 0;
    const line  = r2(qty * rate * (1 - disc / 100));
    const gst   = calculateGst(line, Number(l.gst_percent) || 0, l.price_type, isInterstate);

    subtotal  += gst.baseAmount;
    totalCgst += gst.cgst;
    totalSgst += gst.sgst;
    totalIgst += gst.igst;

    return {
      ...l,
      ...gst,
      lineTotal: line,
      amount   : r2(gst.baseAmount + gst.totalGst),
    };
  });

  const totalGst = r2(totalCgst + totalSgst + totalIgst);
  const preRound = r2(subtotal + totalGst);
  const grand    = roundToRupee ? Math.round(preRound) : preRound;
  const roundOff = r2(grand - preRound);

  return {
    lines: out,
    totals: {
      subtotal    : r2(subtotal),
      totalCgst   : r2(totalCgst),
      totalSgst   : r2(totalSgst),
      totalIgst   : r2(totalIgst),
      totalGst,
      preRound,
      roundOff,
      grandTotal  : grand,
      isInterstate,
    },
  };
}

/**
 * Format the invoice display number using the firm's preferred prefix.
 *   profile.invoice_prefix = "INV"      → "INV-0001"
 *   profile.invoice_prefix = "BILL"     → "BILL-0001"
 *   profile.invoice_prefix = ""         → fall back to the raw counter id
 *
 * The numeric counter that drives this comes from idGenerator's
 * `getIDForEntry('sell')` — that already handles offline-safe sequencing
 * and Firestore-derived seeding to prevent multi-device collisions.
 */
export function formatInvoiceNumber(
  rawCounterId: string,            // e.g. "S-101" from getIDForEntry('sell')
  prefix: string | undefined,      // profile.invoice_prefix
  pad = 4,
): string {
  const cleanPrefix = String(prefix || '').trim() || 'INV';
  // Pull the trailing digits out of the raw id ("S-101" → 101)
  const m = rawCounterId.match(/(\d+)\s*$/);
  if (!m) return rawCounterId;     // fail-safe: keep whatever we got
  const num = parseInt(m[1], 10);
  return `${cleanPrefix}-${String(num).padStart(pad, '0')}`;
}

/**
 * Build the full InvoiceData payload from a saved (or about-to-save)
 * ledger entry plus the firm profile and the invoice template settings.
 *
 * @param entry  ledger_entry shape (party_name, items[], invoice_no, …)
 * @param profile UserProfile (firm_name, gstin, state, invoice_prefix, …)
 * @param template settings.invoice_template (theme color, terms, signatory, …)
 * @param opts   { roundToRupee, partyGstin } — overrides for live POS
 */
export function buildInvoiceData(
  entry: any,
  profile: UserProfile,
  template: any = {},
  opts: { roundToRupee?: boolean; partyGstin?: string } = {},
): InvoiceData {
  const partyGstin = (opts.partyGstin ?? entry.party_gstin ?? '').toUpperCase();
  const interstate = isInterstateSale(profile.gstin, partyGstin);
  const roundToRupee = opts.roundToRupee !== false;

  // Normalise items — ledger entries store qty/rate as strings; we
  // coerce them once here so downstream code can trust the shape.
  const inputLines: InvoiceLineInput[] = (entry.items || []).map((i: any) => ({
    item_name  : i.item_name || '',
    hsn_code   : i.hsn_code || '',
    quantity   : Number(i.quantity) || 0,
    unit       : i.unit || 'Pcs',
    rate       : Number(i.rate) || 0,
    gst_percent: Number(i.gst_percent) || 0,
    price_type : (i.price_type as 'inclusive' | 'exclusive') || 'exclusive',
    discount   : Number(i.discount) || 0,
  }));

  const { lines, totals } = computeInvoiceTotals(inputLines, interstate, roundToRupee);

  // Build the friendly invoice display number (INV-0001 style).
  const displayInvoiceNo = formatInvoiceNumber(
    String(entry.invoice_no || entry.prefixed_id || ''),
    profile.invoice_prefix,
  );

  return {
    invoice_no   : displayInvoiceNo,
    invoice_title: template.invoice_title || (entry.type === 'sell' || entry.type === 'sales' ? 'TAX INVOICE' : 'PURCHASE ORDER'),
    date         : entry.date || new Date().toISOString().split('T')[0],
    time         : entry.time,
    type         : (entry.type === 'purchase' ? 'purchase' : 'sales'),

    firm_name    : profile.firm_name || 'My Business',
    firm_address : profile.address || '',
    firm_phone   : profile.contact || '',
    firm_email   : (profile as any).business_email || (template as any).business_email || '',
    firm_gstin   : profile.gstin || '',
    firm_state   : (profile as any).state || '',
    logo_base64  : profile.logo_base64 || template.logo_base64 || '',

    party_name   : entry.party_name || 'Cash Sale',
    party_phone  : entry.party_phone || '',
    party_address: entry.address || entry.party_address || '',
    party_gstin  : partyGstin,

    items        : lines,
    totals,

    payment_mode : entry.payment_mode,
    notes        : entry.notes,
    reference_no : entry.reference_no,

    theme_color         : template.theme_color || '#1e3a8a',
    terms_text          : template.show_terms !== false ? (template.terms_text || '') : '',
    authorized_signatory: (profile as any).authorized_signatory || template.authorized_signatory || 'Authorized Signatory',
    show_signature      : template.show_signature !== false,
    show_terms          : template.show_terms !== false,
    show_logo           : template.show_logo !== false,
    footer_message      : template.footer_message || 'Thank you for your business',
    currency_symbol     : profile.currency_symbol || '₹',
  };
}
