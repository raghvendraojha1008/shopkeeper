/**
 * professionalInvoice.ts — print-ready, GST-compliant invoice renderer.
 *
 * Public surface:
 *   ProfessionalInvoiceService.generateInvoice(invoice, opts) → share native
 *   ProfessionalInvoiceService.downloadInvoice(invoice, opts) → save / download
 *   ProfessionalInvoiceService.printInvoice(invoice, opts)    → open print dlg
 *   ProfessionalInvoiceService.legacyGenerate(entry, profile) → back-compat wrapper
 *
 * Two layouts ship today:
 *   • standard  — A4 portrait, full GST breakup, theme-coloured header band
 *   • thermal58 / thermal80 — narrow receipt for thermal printers
 *
 * The renderer takes a fully-shaped `InvoiceData` (built by invoiceBuilder)
 * so it never has to re-derive totals or guess at intra/inter-state.
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { UserProfile } from '../types';
import { exportService } from './export';
import { fmtINR, amountInWords } from '../utils/gstUtils';
import {
  buildInvoiceData,
  type InvoiceData,
} from '../utils/invoiceBuilder';

// ── Currency formatter for PDFs (jsPDF built-ins lack ₹ glyph) ─────────────
const fmtMoney = (amount: number, sym: string = '₹'): string => {
  // Always use Rs. inside PDFs to avoid the missing-glyph tofu box.
  return fmtINR(amount, 'Rs.').replace('Rs.', 'Rs.');
};

// ── Hex → RGB tuple (theme colour) ─────────────────────────────────────────
const hexToRgb = (hex: string): [number, number, number] => {
  const h = (hex || "var(--col-blue-900)").replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16) || 30,
    parseInt(h.substring(2, 4), 16) || 58,
    parseInt(h.substring(4, 6), 16) || 138,
  ];
};

export type PrintMode = 'standard' | 'thermal58' | 'thermal80';

export interface RenderOptions {
  printMode? : PrintMode;
  fontFamily?: 'helvetica' | 'times' | 'courier';
  baseFontSize?: number;     // 8–16, default 12
}

// ──────────────────────────────────────────────────────────────────────────
//  PAGE GEOMETRY
// ──────────────────────────────────────────────────────────────────────────

interface PageConfig {
  format     : string | [number, number];
  orientation: 'portrait' | 'landscape';
  width      : number;
  height     : number;
  marginLeft : number;
  marginRight: number;
  contentWidth: number;
  isThermal  : boolean;
}

function getPageConfig(mode: PrintMode): PageConfig {
  if (mode === 'thermal58') {
    return {
      format: [58, 200], orientation: 'portrait',
      width: 58, height: 200,
      marginLeft: 2, marginRight: 2, contentWidth: 54,
      isThermal: true,
    };
  }
  if (mode === 'thermal80') {
    return {
      format: [80, 200], orientation: 'portrait',
      width: 80, height: 200,
      marginLeft: 3, marginRight: 3, contentWidth: 74,
      isThermal: true,
    };
  }
  return {
    format: 'a4', orientation: 'portrait',
    width: 210, height: 297,
    marginLeft: 12, marginRight: 12, contentWidth: 186,
    isThermal: false,
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  STANDARD A4 RENDERER
// ──────────────────────────────────────────────────────────────────────────

function renderStandard(
  invoice: InvoiceData,
  doc: jsPDF,
  cfg: PageConfig,
  opts: RenderOptions,
): void {
  const fontFamily = opts.fontFamily || 'helvetica';
  const fontScale  = (opts.baseFontSize || 12) / 12;
  const setFs = (n: number) => doc.setFontSize(Math.round(n * fontScale * 10) / 10);
  const setFnt = (style: 'normal' | 'bold' | 'italic') => doc.setFont(fontFamily, style);

  const themeRgb = hexToRgb(invoice.theme_color);
  // jsPDF cannot render the ₹ Unicode glyph — normalise to ASCII-safe "Rs."
  const sym = (invoice.currency_symbol === '₹' || !invoice.currency_symbol)
    ? 'Rs.' : invoice.currency_symbol;
  let y = 0;

  // ── 1. THEME HEADER BAND with firm name + invoice title ─────────────────
  doc.setFillColor(themeRgb[0], themeRgb[1], themeRgb[2]);
  doc.rect(0, 0, cfg.width, 22, 'F');

  // Logo (if present)
  let nameX = cfg.marginLeft;
  if (invoice.show_logo && invoice.logo_base64) {
    try {
      doc.addImage(invoice.logo_base64, 'PNG', cfg.marginLeft, 4, 14, 14);
      nameX = cfg.marginLeft + 17;
    } catch { /* invalid base64 — skip silently */ }
  }

  doc.setTextColor(255, 255, 255);
  setFs(18); setFnt('bold');
  doc.text(invoice.firm_name || 'My Business', nameX, 11);

  setFs(8); setFnt('normal');
  const headerLines: string[] = [];
  if (invoice.firm_address) headerLines.push(invoice.firm_address);
  const ln2 = [
    invoice.firm_phone && `Ph: ${invoice.firm_phone}`,
    invoice.firm_email && invoice.firm_email,
    invoice.firm_gstin && `GSTIN: ${invoice.firm_gstin}`,
  ].filter(Boolean).join('  •  ');
  if (ln2) headerLines.push(ln2);
  headerLines.forEach((line, i) => doc.text(line, nameX, 16 + i * 4));

  // Invoice title (right side)
  setFs(14); setFnt('bold');
  doc.text(invoice.invoice_title, cfg.width - cfg.marginRight, 13, { align: 'right' });

  // ── 2. INVOICE META BAR (number + date + bill-to) ───────────────────────
  y = 30;
  doc.setTextColor(15, 23, 42);
  setFnt('normal'); setFs(9);

  const metaLeft = cfg.marginLeft;
  const metaRight = cfg.width - cfg.marginRight;

  // Bill-to block (left)
  setFnt('bold'); setFs(8);
  doc.setTextColor(80, 90, 100);
  doc.text(invoice.type === 'sales' ? 'BILL TO' : 'FROM', metaLeft, y);
  doc.setTextColor(15, 23, 42);
  setFs(11);
  doc.text(invoice.party_name || 'Cash Sale', metaLeft, y + 5);
  setFnt('normal'); setFs(8);
  doc.setTextColor(80, 90, 100);
  let billY = y + 10;
  if (invoice.party_address) {
    const addrLines = doc.splitTextToSize(invoice.party_address, 90);
    doc.text(addrLines, metaLeft, billY);
    billY += addrLines.length * 4;
  }
  if (invoice.party_phone) { doc.text(`Phone: ${invoice.party_phone}`, metaLeft, billY); billY += 4; }
  if (invoice.party_gstin) {
    setFnt('bold'); doc.setTextColor(themeRgb[0], themeRgb[1], themeRgb[2]);
    doc.text(`GSTIN: ${invoice.party_gstin}`, metaLeft, billY);
    setFnt('normal'); doc.setTextColor(80, 90, 100);
    billY += 4;
  }

  // Invoice meta block (right)
  setFnt('bold'); setFs(8);
  doc.setTextColor(80, 90, 100);
  doc.text('INVOICE NO', metaRight, y, { align: 'right' });
  setFnt('bold'); setFs(11); doc.setTextColor(15, 23, 42);
  doc.text(invoice.invoice_no, metaRight, y + 5, { align: 'right' });

  setFnt('normal'); setFs(8); doc.setTextColor(80, 90, 100);
  doc.text(`Date: ${invoice.date}`, metaRight, y + 11, { align: 'right' });
  if (invoice.time) doc.text(`Time: ${invoice.time}`, metaRight, y + 15, { align: 'right' });

  y = Math.max(billY, y + 18) + 4;

  // ── 3. ITEMS TABLE ──────────────────────────────────────────────────────
  const showHsn = invoice.items.some(i => i.hsn_code && i.hsn_code.trim());
  const showGst = invoice.items.some(i => i.gst_percent > 0);

  const head = [
    ['#', 'Item', ...(showHsn ? ['HSN'] : []), 'Qty', 'Rate',
      ...(showGst ? ['GST'] : []), 'Amount'],
  ];

  const body = invoice.items.map((it, idx) => [
    String(idx + 1),
    it.item_name,
    ...(showHsn ? [it.hsn_code || '-'] : []),
    `${it.quantity} ${it.unit}`,
    fmtMoney(it.rate, sym),
    ...(showGst ? [it.gst_percent ? `${it.gst_percent}%` : '-'] : []),
    fmtMoney(it.amount, sym),
  ]);

  autoTable(doc, {
    startY: y,
    head, body,
    theme: 'grid',
    headStyles: {
      fillColor: themeRgb, textColor: [255, 255, 255],
      fontStyle: 'bold', fontSize: Math.round(9 * fontScale * 10) / 10,
      font: fontFamily, halign: 'left',
    },
    bodyStyles: {
      fontSize: Math.round(9 * fontScale * 10) / 10,
      cellPadding: 2.5, font: fontFamily, halign: 'left',
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 8 },
      1: { halign: 'left', cellWidth: 'auto' },
    },
    margin: { left: cfg.marginLeft, right: cfg.marginRight },
  });

  y = (doc as any).previousAutoTable?.finalY ?? y + 30;

  // ── 4. TOTALS SUMMARY (right column) ────────────────────────────────────
  const totalsX = cfg.width - cfg.marginRight;
  const totalsLabelX = totalsX - 60;
  y += 4;

  const printRow = (label: string, value: string, opts2: { bold?: boolean; size?: number; bg?: [number, number, number] } = {}) => {
    if (opts2.bg) {
      doc.setFillColor(opts2.bg[0], opts2.bg[1], opts2.bg[2]);
      doc.rect(totalsLabelX - 2, y - 4, 62, 7, 'F');
    }
    setFnt(opts2.bold ? 'bold' : 'normal');
    setFs(opts2.size ?? 9);
    doc.setTextColor(opts2.bold ? 15 : 80, opts2.bold ? 23 : 90, opts2.bold ? 42 : 100);
    doc.text(label, totalsLabelX, y);
    doc.text(value, totalsX, y, { align: 'right' });
    y += 5.5;
  };

  printRow('Sub-Total', fmtMoney(invoice.totals.subtotal, sym));
  if (invoice.totals.isInterstate) {
    if (invoice.totals.totalIgst > 0) printRow('IGST', fmtMoney(invoice.totals.totalIgst, sym));
  } else {
    if (invoice.totals.totalCgst > 0) printRow('CGST', fmtMoney(invoice.totals.totalCgst, sym));
    if (invoice.totals.totalSgst > 0) printRow('SGST', fmtMoney(invoice.totals.totalSgst, sym));
  }
  if (Math.abs(invoice.totals.roundOff) >= 0.01) {
    printRow('Round Off', `${invoice.totals.roundOff >= 0 ? '+' : ''}${fmtMoney(invoice.totals.roundOff, sym)}`);
  }

  // Grand total — highlighted with the theme colour
  y += 1;
  printRow('GRAND TOTAL', fmtMoney(invoice.totals.grandTotal, sym), {
    bold: true, size: 12,
    bg: [themeRgb[0], themeRgb[1], themeRgb[2]],
  });
  // Re-paint the grand total in white because the bg covers the previous text
  doc.setFillColor(themeRgb[0], themeRgb[1], themeRgb[2]);
  doc.rect(totalsLabelX - 2, y - 9.5, 62, 7, 'F');
  setFnt('bold'); setFs(12); doc.setTextColor(255, 255, 255);
  doc.text('GRAND TOTAL', totalsLabelX, y - 5);
  doc.text(fmtMoney(invoice.totals.grandTotal, sym), totalsX, y - 5, { align: 'right' });
  y += 2;

  // Amount in words
  setFnt('italic'); setFs(8); doc.setTextColor(80, 90, 100);
  const words = amountInWords(invoice.totals.grandTotal);
  const wordLines = doc.splitTextToSize(words.replace('Rupees', sym === '₹' ? 'Rupees' : sym + ' '), cfg.contentWidth);
  doc.text(wordLines, cfg.marginLeft, y);
  y += wordLines.length * 4 + 2;

  // ── 5. NOTES + PAYMENT INFO ─────────────────────────────────────────────
  if (invoice.notes || invoice.payment_mode || invoice.reference_no) {
    setFnt('normal'); setFs(8); doc.setTextColor(80, 90, 100);
    if (invoice.payment_mode) { doc.text(`Payment Mode: ${invoice.payment_mode}`, cfg.marginLeft, y); y += 4; }
    if (invoice.reference_no) { doc.text(`Reference: ${invoice.reference_no}`, cfg.marginLeft, y); y += 4; }
    if (invoice.notes) {
      const noteLines = doc.splitTextToSize(`Notes: ${invoice.notes}`, cfg.contentWidth);
      doc.text(noteLines, cfg.marginLeft, y);
      y += noteLines.length * 4;
    }
    y += 2;
  }

  // ── 6. TERMS + SIGNATURE FOOTER ─────────────────────────────────────────
  // Pin the footer near the bottom of the page so the layout stays
  // professional even when the items table is short.
  const footerTop = Math.max(y, cfg.height - 35);
  doc.setDrawColor(220, 226, 234);
  doc.line(cfg.marginLeft, footerTop, cfg.width - cfg.marginRight, footerTop);

  let fy = footerTop + 5;
  if (invoice.show_terms && invoice.terms_text) {
    setFnt('normal'); setFs(7); doc.setTextColor(110, 120, 130);
    doc.text('TERMS & CONDITIONS', cfg.marginLeft, fy);
    fy += 3.5;
    // Strip leading "Terms & Conditions:" prefix — we already printed the label above
    const termsBody = invoice.terms_text.replace(/^Terms\s*&\s*Conditions\s*:?\s*\n?/i, '').trim();
    const termLines = doc.splitTextToSize(termsBody || invoice.terms_text, cfg.contentWidth - 60);
    doc.text(termLines, cfg.marginLeft, fy);
  }

  // Signature block (right) ──────────────────────────────────────────────
  if (invoice.show_signature && invoice.authorized_signatory) {
    const sigX = cfg.width - cfg.marginRight - 40;
    setFnt('normal'); setFs(8); doc.setTextColor(80, 90, 100);
    doc.text(`For ${invoice.firm_name}`, sigX, footerTop + 5);
    doc.line(sigX, footerTop + 18, cfg.width - cfg.marginRight, footerTop + 18);
    setFs(7);
    doc.text(invoice.authorized_signatory, sigX, footerTop + 22);
  }

  // Friendly footer message (bottom-centre)
  setFnt('italic'); setFs(7); doc.setTextColor(150, 160, 170);
  doc.text(invoice.footer_message, cfg.width / 2, cfg.height - 7, { align: 'center' });
}

// ──────────────────────────────────────────────────────────────────────────
//  THERMAL RECEIPT RENDERER (58mm / 80mm)
// ──────────────────────────────────────────────────────────────────────────

function renderThermal(
  invoice: InvoiceData,
  doc: jsPDF,
  cfg: PageConfig,
  opts: RenderOptions,
): void {
  const fontFamily = opts.fontFamily || 'helvetica';
  const fontScale  = (opts.baseFontSize || 9) / 9;
  const setFs = (n: number) => doc.setFontSize(Math.round(n * fontScale * 10) / 10);
  const setFnt = (style: 'normal' | 'bold' | 'italic') => doc.setFont(fontFamily, style);
  // jsPDF cannot render the ₹ Unicode glyph — normalise to ASCII-safe "Rs."
  const sym = (invoice.currency_symbol === '₹' || !invoice.currency_symbol)
    ? 'Rs.' : invoice.currency_symbol;
  const cx = cfg.width / 2;
  let y = 4;

  setFnt('bold'); setFs(11);
  doc.text(invoice.firm_name || 'My Business', cx, y, { align: 'center' });
  y += 4;

  setFnt('normal'); setFs(7);
  if (invoice.firm_address) {
    const addrLines = doc.splitTextToSize(invoice.firm_address, cfg.contentWidth);
    addrLines.forEach((l: string) => { doc.text(l, cx, y, { align: 'center' }); y += 3; });
  }
  if (invoice.firm_phone) { doc.text(`Ph: ${invoice.firm_phone}`, cx, y, { align: 'center' }); y += 3; }
  if (invoice.firm_gstin) { doc.text(`GSTIN: ${invoice.firm_gstin}`, cx, y, { align: 'center' }); y += 3; }

  // Divider
  doc.setLineDashPattern([0.5, 0.5], 0);
  doc.line(cfg.marginLeft, y, cfg.width - cfg.marginRight, y); y += 3;
  doc.setLineDashPattern([], 0);

  setFnt('bold'); setFs(8);
  doc.text(invoice.invoice_title, cx, y, { align: 'center' }); y += 3.5;
  setFnt('normal'); setFs(7);
  doc.text(`No: ${invoice.invoice_no}`, cfg.marginLeft, y);
  doc.text(invoice.date, cfg.width - cfg.marginRight, y, { align: 'right' }); y += 3;
  if (invoice.party_name && invoice.party_name !== 'Cash Sale') {
    doc.text(`To: ${invoice.party_name}`, cfg.marginLeft, y); y += 3;
  }
  if (invoice.party_gstin) {
    doc.text(`GSTIN: ${invoice.party_gstin}`, cfg.marginLeft, y); y += 3;
  }

  doc.setLineDashPattern([0.5, 0.5], 0);
  doc.line(cfg.marginLeft, y, cfg.width - cfg.marginRight, y); y += 3;
  doc.setLineDashPattern([], 0);

  // Items — name on one line, qty x rate = total on the next
  invoice.items.forEach(it => {
    setFnt('bold'); setFs(7.5);
    doc.text(it.item_name.substring(0, 28), cfg.marginLeft, y); y += 3;
    setFnt('normal'); setFs(7);
    doc.text(`${it.quantity} ${it.unit} x ${fmtMoney(it.rate, sym)}`, cfg.marginLeft, y);
    doc.text(fmtMoney(it.amount, sym), cfg.width - cfg.marginRight, y, { align: 'right' });
    y += 3.5;
  });

  doc.setLineDashPattern([0.5, 0.5], 0);
  doc.line(cfg.marginLeft, y, cfg.width - cfg.marginRight, y); y += 3;
  doc.setLineDashPattern([], 0);

  // Totals
  const printRow = (label: string, value: string, bold = false) => {
    setFnt(bold ? 'bold' : 'normal');
    setFs(bold ? 9 : 7);
    doc.text(label, cfg.marginLeft, y);
    doc.text(value, cfg.width - cfg.marginRight, y, { align: 'right' });
    y += bold ? 4.5 : 3.5;
  };

  printRow('Subtotal', fmtMoney(invoice.totals.subtotal, sym));
  if (invoice.totals.isInterstate) {
    if (invoice.totals.totalIgst > 0) printRow('IGST', fmtMoney(invoice.totals.totalIgst, sym));
  } else {
    if (invoice.totals.totalCgst > 0) printRow('CGST', fmtMoney(invoice.totals.totalCgst, sym));
    if (invoice.totals.totalSgst > 0) printRow('SGST', fmtMoney(invoice.totals.totalSgst, sym));
  }
  if (Math.abs(invoice.totals.roundOff) >= 0.01) {
    printRow('Round Off', `${invoice.totals.roundOff >= 0 ? '+' : ''}${fmtMoney(invoice.totals.roundOff, sym)}`);
  }
  printRow('TOTAL', fmtMoney(invoice.totals.grandTotal, sym), true);

  doc.setLineDashPattern([0.5, 0.5], 0);
  doc.line(cfg.marginLeft, y, cfg.width - cfg.marginRight, y); y += 3;
  doc.setLineDashPattern([], 0);

  setFnt('italic'); setFs(6.5);
  doc.text(invoice.footer_message, cx, y, { align: 'center' });
}

// ──────────────────────────────────────────────────────────────────────────
//  PUBLIC API
// ──────────────────────────────────────────────────────────────────────────

function makeDoc(invoice: InvoiceData, opts: RenderOptions): jsPDF {
  const cfg = getPageConfig(opts.printMode || 'standard');
  const doc = new jsPDF({
    orientation: cfg.orientation,
    unit: 'mm',
    format: cfg.format as any,
  });
  if (cfg.isThermal) renderThermal(invoice, doc, cfg, opts);
  else renderStandard(invoice, doc, cfg, opts);
  return doc;
}

function fileNameFor(invoice: InvoiceData): string {
  const safeNo = invoice.invoice_no.replace(/[^A-Za-z0-9_-]+/g, '_');
  const safeParty = (invoice.party_name || 'Customer').replace(/[^A-Za-z0-9_-]+/g, '_');
  return `Invoice_${safeNo}_${safeParty}.pdf`;
}

export const ProfessionalInvoiceService = {
  /** Build → render → open native share sheet (WhatsApp, Gmail, Drive, …). */
  generateInvoice: async (invoice: InvoiceData, opts: RenderOptions = {}): Promise<void> => {
    const doc = makeDoc(invoice, opts);
    const blob = doc.output('blob');
    await exportService.sharePdfBlob(blob, fileNameFor(invoice));
  },

  /**
   * Same as generateInvoice today — exportService.sharePdfBlob already does
   * the right thing on web (download) vs native (share sheet). Kept as a
   * named alias so the POS UI can present a separate "Download" button.
   */
  downloadInvoice: async (invoice: InvoiceData, opts: RenderOptions = {}): Promise<void> => {
    const doc = makeDoc(invoice, opts);
    const blob = doc.output('blob');
    await exportService.sharePdfBlob(blob, fileNameFor(invoice));
  },

  /** Open the browser print dialog with the rendered PDF. */
  printInvoice: async (invoice: InvoiceData, opts: RenderOptions = {}): Promise<void> => {
    const doc = makeDoc(invoice, opts);
    const url = doc.output('bloburl') as unknown as string;
    const w = window.open(url);
    if (w) {
      // Some browsers need the blob to be loaded before print fires.
      w.addEventListener('load', () => w.print(), { once: true });
    }
  },

  /**
   * BACK-COMPAT: legacy callers passed (entry, profile) directly with no
   * pre-built InvoiceData. Wrap them through invoiceBuilder so they still
   * work without a refactor.
   */
  legacyGenerate: async (
    entry: any,
    profile: UserProfile,
    template: any = {},
    opts: RenderOptions = {},
  ): Promise<void> => {
    const invoice = buildInvoiceData(entry, profile, template, {
      partyGstin: entry.party_gstin,
    });
    return ProfessionalInvoiceService.generateInvoice(invoice, opts);
  },

  /** Expose the underlying jsPDF doc for callers that want a Blob/datauri. */
  buildPdfDoc: (invoice: InvoiceData, opts: RenderOptions = {}): jsPDF => {
    return makeDoc(invoice, opts);
  },
};
