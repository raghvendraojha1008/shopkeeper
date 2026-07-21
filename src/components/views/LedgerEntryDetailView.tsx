/**
 * LedgerEntryDetailView — Beautiful receipt-style detail card for orders
 * Full-width slide-up panel with:
 *  - Receipt design with firm header & colored top bar
 *  - All item rows, quantities, rates, GST
 *  - Vehicle/transport info
 *  - Download (PDF/Excel), Edit, Back actions
 *  - WhatsApp share
 */

import React, { useState, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import {
  ArrowLeft, Edit2, Download, Share2, MessageCircle,
  Package, Truck, Hash, Calendar, User, MapPin,
  FileText, Loader2, ChevronDown, ChevronUp, Printer,
  CheckCircle2, AlertCircle, IndianRupee, BadgePercent,
  Wallet, Building2,
} from 'lucide-react';
import { exportService } from '../../services/export';
import { nativePdfService } from '../../services/nativePdfService';
import { buildInvoiceSummary, amountInWords, fmtINR } from '../../utils/gstUtils';
import UpiQrInvoice from '../common/UpiQrInvoice';
import { useUI } from '../../context/UIContext';
import ExportFormatModal from '../common/ExportFormatModal';

interface LedgerEntryDetailViewProps {
  entry        : any;
  settings     : any;
  parties?     : any[];
  transactions?: any[];
  onBack       : () => void;
  onEdit       : (entry: any) => void;
}

const LedgerEntryDetailView: React.FC<LedgerEntryDetailViewProps> = ({
  entry, settings, parties = [], transactions = [], onBack, onEdit,
}) => {
  const { showToast } = useUI();
  const [loading, setLoading]           = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showItems, setShowItems]       = useState(true);

  const isSale      = entry.type === 'sell';
  const party       = parties.find(p => p.name === entry.party_name) || {
    address: entry.address || '',
    site:    entry.site    || '',
    gstin:   entry.gstin   || '',
    contact: entry.contact || '',
  };
  const gstEnabled  = settings?.automation?.auto_calculate_gst !== false;
  // Use String() coercion so a `null` GSTIN never reaches `.substring()` (which
  // would throw).  `(value || '')` only handles undefined/empty-string and would
  // crash on `null` if the field was explicitly nulled in Firestore.
  const sellerGstinPrefix = String(settings?.profile?.gstin ?? '').substring(0, 2);
  const buyerGstinPrefix  = String(party?.gstin ?? '').substring(0, 2);
  const isInterstate = !!party?.gstin && sellerGstinPrefix !== buyerGstinPrefix;

  const items  = entry.items || [];
  const rent   = Number(entry.vehicle_rent) || 0;
  const disc   = Number(entry.discount_amount) || 0;
  const total  = Number(entry.total_amount) || 0;
  const itemTotal = total - rent;

  // Payments already collected / made against this order
  const orderRef  = entry.invoice_no || entry.bill_no || '';
  const linkedTxns = orderRef
    ? transactions.filter((t: any) => String(t.bill_no || '').trim() === String(orderRef).trim())
    : [];
  const paidAmount    = linkedTxns.reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0);
  const pendingAmount = Math.max(0, total - paidAmount);

  const gstSummary = useMemo(() => {
    if (!gstEnabled || items.length === 0) return null;
    return buildInvoiceSummary(items.map((i: any) => ({
      itemName  : i.item_name,
      quantity  : Number(i.quantity) || 1,
      rate      : Number(i.rate) || 0,
      unit      : i.unit || 'Pcs',
      gstPercent: Number(i.gst_percent) || 0,
      // Honour each item's own GST price-type instead of always assuming
      // 'exclusive'.  Items configured as 'inclusive' (rate already includes
      // GST) were previously double-taxed on every printed invoice.
      priceType : (i.price_type === 'inclusive' ? 'inclusive' : 'exclusive') as 'inclusive' | 'exclusive',
    })), isInterstate);
  }, [items, gstEnabled, isInterstate]);

  const accentColor  = isSale ? "var(--col-success)" : "var(--col-danger)";
  const accentBg     = isSale ? 'var(--col-emerald-15)' : 'var(--col-danger-08)';
  const accentBorder = isSale ? 'var(--col-emerald-25)' : 'var(--col-danger-22)';

  const fmtDate = (d: any) => {
    try {
      const dt = d?.toDate ? d.toDate() : new Date(d || 0);
      return dt.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    } catch { return String(d || ''); }
  };

  // ── PDF generation ────────────────────────────────────────────────────────
  const generatePDF = async () => {
    // ── Read invoice template settings ──────────────────────────────────────
    const tpl = {
      id: 'classic',
      theme_color: "var(--col-blue-900)",
      show_logo: true,
      show_signature: true,
      show_bank_details: true,
      show_gstin: true,
      show_vehicle: false,
      show_terms: true,
      show_qr: false,
      terms_text: 'Goods once sold will not be taken back.',
      bank_details: '',
      authorized_signatory: 'Authorized Signatory',
      header_style: 'filled' as const,
      font_size: 'medium' as const,
      invoice_title: 'TAX INVOICE',
      logo_base64: '',
      ...(settings?.invoice_template || {}),
    };

    // Font sizes scaled from base_font_size (slider in Invoice Customisation settings)
    // Falls back to font_size enum for backward compatibility
    const base: number = tpl.base_font_size ??
      (tpl.font_size === 'small' ? 10 : tpl.font_size === 'large' ? 14 : 12);
    const FS = {
      h1:   Math.round(base * 1.17),  // ~14 at base 12
      h2:   Math.round(base * 0.92),  // ~11 at base 12
      body: Math.round(base * 0.75),  // ~9 at base 12
      tiny: Math.round(base * 0.58),  // ~7 at base 12
    };

    // Font family from template (jsPDF built-ins: 'helvetica', 'times', 'courier')
    const fontFamily: string = (tpl as any).font_family || 'helvetica';

    // Parse theme color to RGB
    const hexToRgb = (hex: string): [number, number, number] => {
      const h = hex.replace('#', '');
      return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
    };
    const themeRgb = hexToRgb(tpl.theme_color);

    // Currency formatter for PDF — use "Rs." instead of "₹" (jsPDF built-in fonts lack ₹ glyph)
    const pdfCurrency = (n: number): string => {
      const abs = Math.abs(n);
      const [intPart, decPart] = abs.toFixed(2).split('.');
      let formatted = '';
      if (intPart.length <= 3) {
        formatted = intPart;
      } else {
        formatted = intPart.slice(-3);
        let rest = intPart.slice(0, -3);
        while (rest.length > 2) {
          formatted = rest.slice(-2) + ',' + formatted;
          rest = rest.slice(0, -2);
        }
        if (rest.length > 0) formatted = rest + ',' + formatted;
      }
      return `${n < 0 ? '-' : ''}Rs.${formatted}.${decPart}`;
    };

    const { jsPDF } = await import('jspdf');
    const autoTableModule = await import('jspdf-autotable');
    const autoTable = (autoTableModule as any).default || autoTableModule;

    const firmName = settings?.profile?.firm_name || 'Business';
    const templateId: string = (tpl as any).id || 'classic';

    // ─── THERMAL 58mm RECEIPT — completely different paper size & layout ───
    if (templateId === 'thermal58') {
      const W = 58;                       // 58 mm paper roll
      const M = 3;                        // 3 mm side margin
      const cw = W - M * 2;               // content width

      // Estimate height so the page fits on one continuous receipt
      const itemLines = items.length * 7;
      const totalsLines = (gstSummary?.totalGst ? 4 : 1) + (rent > 0 ? 1 : 0) + (disc > 0 ? 1 : 0) + 2;
      const baseH = 80 + itemLines + totalsLines * 4
                  + (tpl.show_terms && tpl.terms_text ? 18 : 0)
                  + (tpl.show_bank_details && tpl.bank_details ? 16 : 0);
      const tDoc = new jsPDF({ unit: 'mm', format: [W, Math.max(140, baseH)] });

      let yy = 5;
      const center = (s: string) => tDoc.text(s, W / 2, yy, { align: 'center', maxWidth: cw });
      const left   = (s: string, x = M) => tDoc.text(s, x, yy, { maxWidth: cw });
      const right  = (s: string) => tDoc.text(s, W - M, yy, { align: 'right' });
      const sep    = (ch = '-') => {
        tDoc.setDrawColor(120, 120, 120);
        tDoc.setLineWidth(ch === '=' ? 0.4 : 0.2);
        tDoc.line(M, yy, W - M, yy);
        yy += 2.5;
      };

      // ── Firm header
      tDoc.setFont('courier', 'bold');
      tDoc.setFontSize(10);
      const firmLines = tDoc.splitTextToSize(firmName, cw);
      firmLines.forEach((l: string) => { center(l); yy += 4; });
      tDoc.setFont('courier', 'normal');
      tDoc.setFontSize(7);
      if (settings?.profile?.address) {
        tDoc.splitTextToSize(settings.profile.address, cw).forEach((l: string) => { center(l); yy += 3; });
      }
      if (settings?.profile?.contact) { center('Tel: ' + settings.profile.contact); yy += 3; }
      if (tpl.show_gstin && settings?.profile?.gstin) { center('GSTIN: ' + settings.profile.gstin); yy += 3; }
      yy += 1; sep('=');

      // ── Invoice meta
      tDoc.setFont('courier', 'bold'); tDoc.setFontSize(8);
      center(tpl.invoice_title || 'INVOICE'); yy += 4;
      tDoc.setFont('courier', 'normal'); tDoc.setFontSize(7);
      left('No   : ' + (entry.invoice_no || entry.prefixed_id || entry.bill_no || '-')); yy += 3;
      left('Date : ' + (entry.date || '-')); yy += 3;
      left('Type : ' + (isSale ? 'Sale' : 'Purchase')); yy += 3;
      const partyLine = (isSale ? 'Bill To: ' : 'From: ') + (entry.party_name || '-');
      tDoc.splitTextToSize(partyLine, cw).forEach((l: string) => { left(l); yy += 3; });
      // FIX: Always include address & site on the receipt for both GST & non-GST
      // customers — previously these were missing entirely.
      if (party?.address) {
        tDoc.splitTextToSize(party.address, cw).forEach((l: string) => { left(l); yy += 3; });
      }
      if (party?.contact) { left('Ph     : ' + party.contact); yy += 3; }
      if (tpl.show_gstin && party?.gstin) { left('GSTIN  : ' + party.gstin); yy += 3; }
      if (entry.site || party?.site) {
        tDoc.setFont('courier', 'bold');
        left('Site   : ' + (entry.site || party.site));
        tDoc.setFont('courier', 'normal');
        yy += 3;
      }
      if (tpl.show_vehicle && entry.vehicle) { left('Vehicle: ' + entry.vehicle); yy += 3; }
      sep('-');

      // ── Items
      tDoc.setFontSize(7);
      items.forEach((i: any) => {
        tDoc.setFont('courier', 'bold');
        tDoc.splitTextToSize(String(i.item_name), cw).forEach((l: string) => { left(l); yy += 3; });
        tDoc.setFont('courier', 'normal');
        const qtyLine = `${i.quantity} ${i.unit || 'Pcs'} x ${pdfCurrency(Number(i.rate))}`;
        const amt = pdfCurrency(Number(i.quantity) * Number(i.rate));
        left(qtyLine, M + 2);
        right(amt);
        yy += 4;
        if (gstEnabled && i.gst_percent) {
          tDoc.setTextColor(110, 110, 110);
          left(`  GST ${i.gst_percent}%`, M + 2);
          tDoc.setTextColor(0, 0, 0);
          yy += 3;
        }
      });
      sep('-');

      // ── Totals
      const tRow = (lbl: string, val: string, bold = false) => {
        tDoc.setFont('courier', bold ? 'bold' : 'normal');
        tDoc.setFontSize(bold ? 9 : 7);
        tDoc.text(lbl, M, yy);
        tDoc.text(val, W - M, yy, { align: 'right' });
        yy += bold ? 5 : 3.5;
      };
      tRow('Subtotal', pdfCurrency(gstSummary?.subtotal ?? itemTotal));
      if (gstSummary?.totalGst && gstSummary.totalGst > 0) {
        if (!isInterstate) {
          tRow('CGST', pdfCurrency(gstSummary.totalCgst));
          tRow('SGST', pdfCurrency(gstSummary.totalSgst));
        } else {
          tRow('IGST', pdfCurrency(gstSummary.totalIgst));
        }
      }
      if (rent > 0) tRow('Vehicle', pdfCurrency(rent));
      if (disc > 0) tRow('Discount', '-' + pdfCurrency(disc));
      yy += 1; sep('=');
      tRow('TOTAL', pdfCurrency(total), true);
      sep('=');

      // ── Bank / UPI
      if (tpl.show_bank_details && tpl.bank_details) {
        tDoc.setFont('courier', 'bold'); tDoc.setFontSize(7);
        left('PAYMENT'); yy += 3;
        tDoc.setFont('courier', 'normal');
        tDoc.splitTextToSize(tpl.bank_details, cw).forEach((l: string) => { left(l); yy += 3; });
        sep('-');
      }

      // ── Terms
      if (tpl.show_terms && tpl.terms_text) {
        tDoc.setFont('courier', 'normal'); tDoc.setFontSize(6);
        tDoc.splitTextToSize(tpl.terms_text, cw).forEach((l: string) => { left(l); yy += 2.5; });
        yy += 1;
      }

      // ── Thank you
      tDoc.setFont('courier', 'bold'); tDoc.setFontSize(8);
      center('Thank You!'); yy += 4;
      tDoc.setFont('courier', 'normal'); tDoc.setFontSize(6);
      center('Powered by Shopkeeper');

      const fallbackBlob = tDoc.output('blob');
      const nativeData = nativePdfService.entryToSections(entry, settings, {
        isSale, items, gstSummary, isInterstate, party, rent, disc, total, itemTotal,
      });
      const success = await nativePdfService.generateAndShare(nativeData, fallbackBlob);
      showToast(success ? 'Receipt shared!' : 'Failed to share receipt', success ? 'success' : 'error');
      return;
    }

    // ─── A4 LAYOUT (classic / modern / letterhead) ─────────────────────────
    const doc = new jsPDF();
    const PW = doc.internal.pageSize.width;
    const PH = doc.internal.pageSize.height;
    const margin = 14;
    const contentW = PW - margin * 2;
    let y = 0;

    // Template-specific BACKGROUND decoration drawn first so content layers
    // on top: modern gets a coloured side strip; letterhead gets a thin top
    // accent line and a faint diagonal watermark of the firm name.
    if (templateId === 'modern') {
      doc.setFillColor(...themeRgb);
      doc.rect(0, 0, 3, PH, 'F');                 // left vertical accent
      doc.setFillColor(themeRgb[0], themeRgb[1], themeRgb[2]);
      doc.rect(0, PH - 3, PW, 3, 'F');            // bottom thin accent
    } else if (templateId === 'letterhead') {
      doc.setFillColor(...themeRgb);
      doc.rect(0, 0, PW, 2, 'F');                 // top accent
      // Watermark — large light-tinted firm name rotated diagonally
      try {
        doc.setTextColor(235, 237, 244);
        doc.setFontSize(60);
        doc.setFont(fontFamily, 'bold');
        doc.text(firmName.toUpperCase(), PW / 2, PH / 2, { align: 'center', angle: 30 });
      } catch (_) { /* angle option may not be supported in older jsPDF */ }
    }

    // ── HEADER ──────────────────────────────────────────────────────────────
    if (tpl.header_style === 'filled') {
      doc.setFillColor(...themeRgb);
      doc.rect(0, 0, PW, 24, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(FS.h1);
      doc.setFont(fontFamily, 'bold');
      doc.text(tpl.invoice_title, PW / 2, 15, { align: 'center' });
      y = 30;
    } else if (tpl.header_style === 'outline') {
      doc.setDrawColor(...themeRgb);
      doc.setLineWidth(1);
      doc.rect(margin, 6, contentW, 18);
      doc.setTextColor(...themeRgb);
      doc.setFontSize(FS.h1);
      doc.setFont(fontFamily, 'bold');
      doc.text(tpl.invoice_title, PW / 2, 18, { align: 'center' });
      y = 30;
    } else {
      // minimal
      doc.setTextColor(...themeRgb);
      doc.setFontSize(FS.h1);
      doc.setFont(fontFamily, 'bold');
      doc.text(tpl.invoice_title, margin, 14);
      y = 20;
    }

    // ── LOGO ────────────────────────────────────────────────────────────────
    if (tpl.show_logo && tpl.logo_base64) {
      try {
        doc.addImage(tpl.logo_base64, 'PNG', margin, y, 20, 20);
        // Firm name next to logo
        doc.setTextColor(30, 40, 60);
        doc.setFontSize(FS.h2 + 2);
        doc.setFont(fontFamily, 'bold');
        doc.text(firmName, margin + 24, y + 8);
        doc.setFontSize(FS.tiny);
        doc.setFont(fontFamily, 'normal');
        doc.setTextColor(100, 100, 100);
        if (settings?.profile?.address) doc.text(settings.profile.address, margin + 24, y + 14);
        if (tpl.show_gstin && settings?.profile?.gstin) doc.text('GSTIN: ' + settings.profile.gstin, margin + 24, y + 19);
        y += 24;
      } catch (e) {
        console.error('Logo add failed:', e);
        // fallback: no logo
        doc.setTextColor(30, 40, 60);
        doc.setFontSize(FS.h2 + 2);
        doc.setFont(fontFamily, 'bold');
        doc.text(firmName, margin, y + 6);
        y += 10;
      }
    } else {
      doc.setTextColor(30, 40, 60);
      doc.setFontSize(FS.h2 + 2);
      doc.setFont(fontFamily, 'bold');
      doc.text(firmName, margin, y + 6);
      y += 8;
      doc.setFontSize(FS.tiny);
      doc.setFont(fontFamily, 'normal');
      doc.setTextColor(100, 100, 100);
      if (settings?.profile?.address) { doc.text(settings.profile.address, margin, y + 4); y += 4; }
      if (settings?.profile?.contact) { doc.text('Ph: ' + settings.profile.contact, margin, y + 4); y += 4; }
      if (tpl.show_gstin && settings?.profile?.gstin) { doc.text('GSTIN: ' + settings.profile.gstin, margin, y + 4); y += 4; }
      y += 2;
    }

    // Invoice meta (right side, at top)
    const metaY = tpl.header_style === 'minimal' ? 20 : 30;
    doc.setTextColor(30, 40, 60);
    doc.setFontSize(FS.body);
    doc.setFont(fontFamily, 'bold');
    const pdfInvoiceNo = entry.invoice_no || entry.prefixed_id || entry.bill_no || 'N/A';
    doc.text('Invoice: #' + pdfInvoiceNo, PW - margin, metaY, { align: 'right' });
    doc.text('Date: ' + (entry.date || ''), PW - margin, metaY + 5, { align: 'right' });
    doc.setFont(fontFamily, 'normal');
    doc.text('Type: ' + (isSale ? 'Sale' : 'Purchase'), PW - margin, metaY + 10, { align: 'right' });

    // ── DIVIDER ─────────────────────────────────────────────────────────────
    y += 4;
    doc.setDrawColor(200, 210, 220);
    doc.setLineWidth(0.3);
    doc.line(margin, y, PW - margin, y);
    y += 6;

    // ── PARTY BOX ───────────────────────────────────────────────────────────
    // FIX: Always render party address, phone (when present), GSTIN, and
    // site for both GST and non-GST customers. The box height is now
    // computed from the actual lines we will draw so nothing overflows.
    const billBoxX = margin;
    const billBoxW = contentW / 2 - 4;
    const innerW   = billBoxW - 6; // text inset on both sides
    const addrLines: string[] = party?.address
      ? doc.splitTextToSize(String(party.address), innerW)
      : [];
    const showPhone = !!party?.contact;
    const showGstin = tpl.show_gstin && !!party?.gstin;
    const siteText  = entry.site || party?.site || '';
    const showSite  = !!siteText;

    // 5mm label + 7mm name + 4mm per address line + 4mm phone + 4mm gstin + 4mm site + 3mm pad
    const billBoxH = 5 + 7
      + (addrLines.length * 4)
      + (showPhone ? 4 : 0)
      + (showGstin ? 4 : 0)
      + (showSite  ? 4 : 0)
      + 3;

    doc.setFillColor(248, 250, 252);
    doc.roundedRect(billBoxX, y, billBoxW, billBoxH, 2, 2, 'F');

    let bY = y + 5;
    doc.setFontSize(FS.tiny);
    doc.setFont(fontFamily, 'bold');
    doc.setTextColor(100, 100, 100);
    doc.text(isSale ? 'BILL TO' : 'FROM SUPPLIER', billBoxX + 3, bY);
    bY += 7;

    doc.setFontSize(FS.body + 1);
    doc.setFont(fontFamily, 'bold');
    doc.setTextColor(30, 40, 60);
    doc.text(entry.party_name || 'N/A', billBoxX + 3, bY);

    doc.setFontSize(FS.tiny);
    doc.setFont(fontFamily, 'normal');
    doc.setTextColor(80, 80, 80);

    if (addrLines.length) {
      bY += 4;
      doc.text(addrLines, billBoxX + 3, bY);
      bY += (addrLines.length - 1) * 4;
    }
    if (showPhone) {
      bY += 4;
      doc.text('Ph: ' + party.contact, billBoxX + 3, bY);
    }
    if (showGstin) {
      bY += 4;
      doc.setFont(fontFamily, 'bold');
      doc.text('GSTIN: ' + party.gstin, billBoxX + 3, bY);
      doc.setFont(fontFamily, 'normal');
    }
    if (showSite) {
      bY += 4;
      doc.setFont(fontFamily, 'bold');
      doc.setTextColor(...themeRgb);
      doc.text('Site: ' + siteText, billBoxX + 3, bY);
      doc.setTextColor(80, 80, 80);
      doc.setFont(fontFamily, 'normal');
    }

    // Vehicle info (right side, ALIGNED to the same top y as the BILL TO box)
    const vehicleBoxH = 22;
    if (tpl.show_vehicle && (entry.vehicle || entry.vehicle_rent)) {
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(PW / 2 + 2, y, contentW / 2 - 4, vehicleBoxH, 2, 2, 'F');
      doc.setFontSize(FS.tiny);
      doc.setFont(fontFamily, 'bold');
      doc.setTextColor(100, 100, 100);
      doc.text('VEHICLE INFO', PW / 2 + 5, y + 5);
      doc.setFontSize(FS.body);
      doc.setFont(fontFamily, 'normal');
      doc.setTextColor(30, 40, 60);
      if (entry.vehicle) doc.text('Vehicle: ' + entry.vehicle, PW / 2 + 5, y + 12);
      if (entry.vehicle_rent) doc.text('Rent: ' + pdfCurrency(Number(entry.vehicle_rent)), PW / 2 + 5, y + 18);
    }

    // Advance the outer cursor past whichever box is taller so the items
    // table doesn't overlap the BILL TO / VEHICLE area.
    const usedH = Math.max(billBoxH, tpl.show_vehicle && (entry.vehicle || entry.vehicle_rent) ? vehicleBoxH : 0);
    y += usedH + 6;

    // ── ITEMS TABLE ─────────────────────────────────────────────────────────
    const tableRows = items.map((i: any) => [
      i.item_name,
      String(i.quantity),
      i.unit || 'Pcs',
      pdfCurrency(Number(i.rate)),
      pdfCurrency(Number(i.quantity) * Number(i.rate)),
      i.gst_percent ? i.gst_percent + '%' : '-',
    ]);

    // FIX: Use a percentage-based layout for the items table so:
    //   • Item column is always ~30% of usable width and long names wrap
    //     onto multiple lines (overflow: 'linebreak') instead of pushing
    //     the numeric columns out of alignment.
    //   • Numeric columns get fixed shares of the remaining width so their
    //     headers always sit directly above the values beneath them,
    //     regardless of how short or long the item names are.
    const colPct = { item: 0.30, qty: 0.10, unit: 0.12, rate: 0.18, amount: 0.20, gst: 0.10 };

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      tableWidth: contentW,
      head: [['Item', 'Qty', 'Unit', 'Rate', 'Amount', 'GST%']],
      body: tableRows,
      headStyles: {
        fillColor: themeRgb,
        fontSize: FS.body - 1,
        fontStyle: 'bold',
        font: fontFamily,
        textColor: [255, 255, 255],
        valign: 'middle',
        halign: 'left',                       // header text starts at cell's left padding
        overflow: 'linebreak',
        cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 },
      },
      bodyStyles: {
        fontSize: FS.body - 1,
        font: fontFamily,
        valign: 'middle',
        halign: 'left',                       // value text starts at the same left padding
        overflow: 'linebreak',
        lineColor: [230, 232, 240],
        lineWidth: 0.1,
        cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 },
      },
      // FIX: every column is left-aligned with a uniform left padding so the
      // header label and the values beneath it always start at the SAME left
      // x-coordinate, regardless of how long either string is. Item still
      // gets `overflow: linebreak` so long names wrap to multiple lines
      // inside the 30 % width instead of pushing other columns out.
      columnStyles: {
        0: { cellWidth: contentW * colPct.item,   overflow: 'linebreak' }, // Item (wraps)
        1: { cellWidth: contentW * colPct.qty    },                         // Qty
        2: { cellWidth: contentW * colPct.unit   },                         // Unit
        3: { cellWidth: contentW * colPct.rate   },                         // Rate
        4: { cellWidth: contentW * colPct.amount, fontStyle: 'bold' },      // Amount
        5: { cellWidth: contentW * colPct.gst    },                         // GST%
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });

    y = (doc as any).lastAutoTable.finalY + Math.max(10, FS.body);

    // ── TOTALS ──────────────────────────────────────────────────────────────
    // Dynamic widths so labels and values never overlap when font scales up.
    // Row height scales with body font size.
    const rowH = Math.max(6, Math.round(FS.body * 0.75));
    const colGap = 8; // gap (mm) between label and value
    const totRow = (lbl: string, val: string, bold = false) => {
      if (y > PH - 50) { doc.addPage(); y = 20; }
      doc.setFontSize(FS.body);
      doc.setFont(fontFamily, bold ? 'bold' : 'normal');
      doc.setTextColor(bold ? 30 : 80, bold ? 40 : 80, bold ? 60 : 80);
      const valW = doc.getTextWidth(val);
      // Label is right-aligned, ending exactly `colGap` before the value
      doc.text(lbl, PW - margin - valW - colGap, y, { align: 'right' });
      doc.text(val, PW - margin, y, { align: 'right' });
      y += rowH;
    };

    totRow('Subtotal (excl. GST):', pdfCurrency(gstSummary?.subtotal ?? itemTotal));
    if (gstSummary?.totalGst && gstSummary.totalGst > 0) {
      if (!isInterstate) {
        totRow('CGST:', pdfCurrency(gstSummary.totalCgst));
        totRow('SGST:', pdfCurrency(gstSummary.totalSgst));
      } else {
        totRow('IGST:', pdfCurrency(gstSummary.totalIgst));
      }
    }
    if (rent > 0) totRow('Vehicle Rent:', pdfCurrency(rent));
    if (disc > 0) totRow('Discount:', '-' + pdfCurrency(disc));

    // Divider line above grand total — width adapts to grand-total contents.
    // Gap to the text scales with font size so the line never cuts through
    // the GRAND TOTAL when the user chooses a larger base font.
    doc.setFont(fontFamily, 'bold');
    doc.setFontSize(FS.body);
    const grandValW = doc.getTextWidth(pdfCurrency(total));
    const grandLblW = doc.getTextWidth('GRAND TOTAL:');
    const lineWidth = grandValW + grandLblW + colGap + 6;
    y += Math.max(2, Math.round(FS.body * 0.25)); // push line down from prev row
    doc.setDrawColor(200, 210, 220);
    doc.setLineWidth(0.4);
    doc.line(PW - margin - lineWidth, y, PW - margin, y);
    // Big gap between the divider line and the GRAND TOTAL baseline,
    // so even at a large base_font_size the text sits clearly below the line.
    y += Math.max(6, Math.round(FS.body * 0.85));
    totRow('GRAND TOTAL:', pdfCurrency(total), true);
    y += Math.max(4, Math.round(FS.body * 0.4)); // breathing room after totals

    // ── AMOUNT IN WORDS ─────────────────────────────────────────────────────
    y += 2;
    if (y > PH - 60) { doc.addPage(); y = 20; }
    doc.setFillColor(248, 250, 252);
    doc.rect(margin, y, contentW, 12, 'F');
    doc.setFontSize(FS.tiny);
    doc.setFont(fontFamily, 'bold');
    doc.setTextColor(100, 100, 100);
    doc.text('Amount in Words:', margin + 3, y + 5);
    doc.setFont(fontFamily, 'italic');
    doc.setTextColor(60, 60, 60);
    doc.text(amountInWords(total), margin + 32, y + 5, { maxWidth: contentW - 35 });
    y += 16;

    // ── BANK DETAILS ────────────────────────────────────────────────────────
    if (tpl.show_bank_details && tpl.bank_details) {
      if (y > PH - 40) { doc.addPage(); y = 20; }
      doc.setFontSize(FS.tiny);
      doc.setFont(fontFamily, 'bold');
      doc.setTextColor(...themeRgb);
      doc.text('BANK DETAILS', margin, y);
      y += 4;
      doc.setFont(fontFamily, 'normal');
      doc.setTextColor(60, 60, 60);
      const bankLines = doc.splitTextToSize(tpl.bank_details, contentW / 2);
      doc.text(bankLines, margin, y);
      y += bankLines.length * 4 + 4;
    }

    // ── TERMS & CONDITIONS ──────────────────────────────────────────────────
    if (tpl.show_terms && tpl.terms_text) {
      if (y > PH - 30) { doc.addPage(); y = 20; }
      doc.setDrawColor(220, 220, 220);
      doc.line(margin, y, PW - margin, y);
      y += 4;
      doc.setFontSize(FS.tiny);
      doc.setFont(fontFamily, 'bold');
      doc.setTextColor(100, 100, 100);
      doc.text('Terms & Conditions:', margin, y);
      y += 4;
      doc.setFont(fontFamily, 'normal');
      doc.setTextColor(120, 120, 120);
      const termLines = doc.splitTextToSize(tpl.terms_text, contentW);
      doc.text(termLines, margin, y);
      y += termLines.length * 3.5 + 4;
    }

    // ── SIGNATURE ───────────────────────────────────────────────────────────
    if (tpl.show_signature) {
      const sigY = Math.max(y + 10, PH - 30);
      if (sigY > PH - 10) { doc.addPage(); }
      const finalSigY = sigY > PH - 10 ? 40 : sigY;

      // The template field can hold either a person's name or just the role
      // label "Authorised/Authorized Signatory". If it's the default label,
      // we render only the role line below the signature so it doesn't
      // duplicate. Owner name (from profile) is preferred when available.
      const ownerName = (settings?.profile?.owner_name || '').trim();
      const tplName   = (tpl.authorized_signatory || '').trim();
      const isJustRoleLabel = !tplName ||
        /^authori[sz]ed\s+signatory$/i.test(tplName);

      const signerName = isJustRoleLabel ? ownerName : tplName;
      const roleLabel  = 'Authorised Signatory';

      doc.setDrawColor(180, 180, 180);
      doc.line(PW - margin - 50, finalSigY, PW - margin, finalSigY);
      doc.setFontSize(FS.tiny);
      doc.setFont(fontFamily, 'normal');
      doc.setTextColor(80, 80, 80);

      if (signerName) {
        // Name above the line, role label below — no duplication
        doc.text(signerName, PW - margin - 25, finalSigY + 5, { align: 'center' });
        doc.text(roleLabel,  PW - margin - 25, finalSigY + 10, { align: 'center' });
      } else {
        // No name available — single role label only
        doc.text(roleLabel, PW - margin - 25, finalSigY + 6, { align: 'center' });
      }
    }

    // ── FOOTER ──────────────────────────────────────────────────────────────
    if (templateId === 'letterhead') {
      // Letterhead bottom band — firm name + contact details on theme stripe
      const bandH = 12;
      doc.setFillColor(...themeRgb);
      doc.rect(0, PH - bandH, PW, bandH, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont(fontFamily, 'bold');
      doc.setFontSize(FS.tiny);
      doc.text(firmName, margin, PH - 7);
      doc.setFont(fontFamily, 'normal');
      doc.setFontSize(Math.max(6, FS.tiny - 1));
      const bottomBits = [
        settings?.profile?.address,
        settings?.profile?.contact ? 'Tel: ' + settings.profile.contact : '',
        tpl.show_gstin && settings?.profile?.gstin ? 'GSTIN: ' + settings.profile.gstin : '',
      ].filter(Boolean).join('  |  ');
      if (bottomBits) doc.text(bottomBits, PW - margin, PH - 7, { align: 'right' });
      doc.text('Thank you for your business!', PW / 2, PH - 3, { align: 'center' });
    } else {
      const footY = PH - 10;
      doc.setFontSize(FS.tiny);
      doc.setFont(fontFamily, 'normal');
      doc.setTextColor(150, 150, 150);
      doc.text('Thank you for your business!', PW / 2, footY, { align: 'center' });
    }

    // ── SAVE ────────────────────────────────────────────────────────────────
    const nativeData = nativePdfService.entryToSections(entry, settings, {
      isSale, items, gstSummary, isInterstate, party, rent, disc, total, itemTotal,
    });
    const fallbackBlob = doc.output('blob');
    const success = await nativePdfService.generateAndShare(nativeData, fallbackBlob);
    if (success) {
      showToast('PDF shared successfully!', 'success');
    } else {
      showToast('Failed to share PDF', 'error');
    }
  };

  // ── Excel/CSV generation ───────────────────────────────────────────────────
  const generateExcel = async () => {
    const rows: string[][] = [];
    const firm = settings?.profile?.firm_name || 'Business';
    rows.push([firm]);
    rows.push([isSale ? 'TAX INVOICE' : 'PURCHASE ORDER']);
    rows.push([]);
    rows.push(['Invoice No', entry.invoice_no || entry.prefixed_id || '-', 'Date', entry.date]);
    rows.push(['Party', entry.party_name || '-', 'Type', isSale?'Sale':'Purchase']);
    if (party?.gstin) rows.push(['Party GSTIN', party.gstin, 'Our GSTIN', settings?.profile?.gstin||'-']);
    rows.push([]);
    rows.push(['Item Name','Qty','Unit','Rate','Amount','GST%','GST Amount']);
    items.forEach((i: any) => {
      const amt = Number(i.quantity)*Number(i.rate);
      const gst = amt * (Number(i.gst_percent)||0) / 100;
      rows.push([i.item_name, i.quantity, i.unit||'Pcs', i.rate, amt.toFixed(2), `${i.gst_percent||0}%`, gst.toFixed(2)]);
    });
    rows.push([]);
    if (gstSummary) {
      rows.push(['Subtotal (Taxable)', gstSummary.subtotal.toFixed(2)]);
      if (!isInterstate) {
        rows.push(['CGST', gstSummary.totalCgst.toFixed(2)]);
        rows.push(['SGST', gstSummary.totalSgst.toFixed(2)]);
      } else {
        rows.push(['IGST', gstSummary.totalIgst.toFixed(2)]);
      }
    }
    if (rent > 0) rows.push(['Vehicle Rent', rent.toFixed(2)]);
    if (disc > 0) rows.push(['Discount', `-${disc.toFixed(2)}`]);
    rows.push(['GRAND TOTAL', total.toFixed(2)]);
    rows.push([]);
    rows.push(['Amount in Words', amountInWords(total)]);
    if (entry.notes) rows.push(['Notes', entry.notes]);

    const csv = rows.map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const invoiceNo = entry.invoice_no || entry.prefixed_id || 'entry';
    const csvBlob = new Blob([csv], { type: 'text/csv' });
    await exportService.sharePdfBlob(csvBlob, `${isSale?'Invoice':'Purchase'}_${invoiceNo}.csv`);
    showToast('Excel/CSV exported!', 'success');
  };

  const handleExport = async (format: 'pdf' | 'excel') => {
    setLoading(true);
    setShowExportModal(false);
    try { format === 'pdf' ? await generatePDF() : await generateExcel(); }
    catch (e: any) { console.error('Export error:', e); showToast('Export failed: ' + (e?.message || 'Unknown error'), 'error'); }
    finally { setLoading(false); }
  };

  const handleWhatsApp = async () => {
    const msg =
`*${isSale ? 'Invoice' : 'Purchase Order'}*
*${settings?.profile?.firm_name || 'Business'}*
Invoice: #${entry.invoice_no || entry.prefixed_id || '-'}
Date: ${entry.date}
Party: ${entry.party_name}
Items: ${items.map((i:any)=>`${i.item_name} ×${i.quantity}`).join(', ')}
*Total: ₹${Math.round(total).toLocaleString('en-IN')}*
${entry.notes ? `Notes: ${entry.notes}` : ''}`;
    if (Capacitor.isNativePlatform()) {
      // Android WebView blocks window.open for external URLs
      // Use Share plugin which routes through the OS share sheet
      try { await Share.share({ text: msg }); } catch (_) {}
    } else {
      window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
    }
  };

  return (
    <div className="h-full overflow-y-auto" style={{ background: 'var(--app-bg)' }}>
      {showExportModal && (
        <ExportFormatModal onSelect={handleExport} onClose={() => setShowExportModal(false)} />
      )}

      {/* ── Sticky header ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 px-4 pb-3"
        style={{paddingTop: '16px',  background: 'rgba(var(--app-bg-rgb),0.93)', backdropFilter: 'blur(20px)', borderBottom: '1px solid var(--glass-border)' }}>
        <div className="flex items-center justify-between">
          <button onClick={onBack}
            className="flex items-center gap-2 p-2 rounded-2xl active:scale-95 transition-all"
            style={{ background: 'var(--rgba-white-08)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
            <ArrowLeft size={18} />
          </button>
          <div className="text-center">
            <p className="text-app-sm font-black uppercase tracking-[0.15em]"
              style={{ color: accentColor }}>{isSale ? 'Sale Order' : 'Purchase Order'}</p>
            <p className="text-sm font-black text-white">
              #{entry.invoice_no || entry.prefixed_id || entry.id?.slice(-6)}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowExportModal(true)} disabled={loading}
              className="p-2 rounded-2xl active:scale-95 transition-all"
              style={{ background: 'var(--col-info-15)', border: '1px solid var(--col-info-25)', color: "var(--col-info)" }}>
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
            </button>
            <button onClick={() => onEdit(entry)}
              className="p-2 rounded-2xl active:scale-95 transition-all"
              style={{ background: 'var(--col-violet-15)', border: '1px solid var(--col-violet-25)', color: "var(--col-violet)" }}>
              <Edit2 size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 pt-3 pb-32 space-y-3">

        {/* ── Hero card ──────────────────────────────────────────────── */}
        <div className="rounded-[24px] overflow-hidden relative"
          style={{ background: accentBg, border: `1px solid ${accentBorder}`, backdropFilter: 'blur(20px)' }}>
          {/* Colored top band */}
          <div className="h-1.5 w-full" style={{ background: `linear-gradient(90deg, ${accentColor}, transparent)` }} />
          <div className="absolute top-0 left-0 right-0 h-px"
            style={{ background: `linear-gradient(90deg,transparent,${accentColor}44,transparent)` }} />

          <div className="p-4 space-y-3">
            {/* Type badge + date */}
            <div className="flex items-center justify-between">
              <span className="text-app-sm font-black uppercase px-3 py-1.5 rounded-xl"
                style={{ background: accentBg, color: accentColor, border: `1px solid ${accentBorder}` }}>
                {isSale ? '↑ Sale' : '↓ Purchase'}
              </span>
              <div className="flex items-center gap-1.5 text-app-sm" style={{ color: 'var(--text-muted)' }}>
                <Calendar size={11} />
                <span className="font-bold">{fmtDate(entry.date)}</span>
              </div>
            </div>

            {/* Amount hero */}
            <div>
              <p className="text-app-xs font-black uppercase tracking-[0.2em] mb-0.5" style={{ color: 'var(--text-muted)' }}>
                Grand Total
              </p>
              <p className="text-app-d5 font-black leading-none tabular-nums" style={{ color: accentColor, letterSpacing: '-0.03em' }}>
                <span style={{ fontSize: '55%', opacity: 0.55 }}>₹</span>
                {Math.round(total).toLocaleString('en-IN')}
              </p>
              {gstSummary && gstSummary.totalGst > 0 && (
                <p className="text-app-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  incl. GST ₹{Math.round(gstSummary.totalGst).toLocaleString('en-IN')}
                </p>
              )}
            </div>

            {/* Party info */}
            <div className="rounded-[16px] p-3.5"
              style={{ background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)' }}>
              <p className="text-app-2xs font-black uppercase tracking-[0.15em] mb-1.5" style={{ color: 'var(--text-muted)' }}>
                {isSale ? 'Customer' : 'Supplier'}
              </p>
              <div className="flex items-center justify-between gap-2">
                <p className="font-black text-white text-sm">{entry.party_name || 'Unknown'}</p>
                {party?.gstin && (
                  <span className="text-app-2xs font-mono px-2 py-0.5 rounded-lg"
                    style={{ background: 'var(--col-info-12)', color: "var(--col-info)", border: '1px solid var(--col-info-25)' }}>
                    {party.gstin}
                  </span>
                )}
              </div>
              {party?.contact && (
                <p className="text-app-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                  📞 {party.contact}
                </p>
              )}
              {party?.address && (
                <p className="text-app-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  📍 {party.address}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── Items table ─────────────────────────────────────────────── */}
        <div className="rounded-[20px] overflow-hidden"
          style={{ background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)' }}>
          <button className="w-full flex items-center justify-between px-4 py-3.5"
            onClick={() => setShowItems(!showItems)}
            style={{ borderBottom: showItems ? '1px solid var(--glass-border)' : 'none' }}>
            <div className="flex items-center gap-2.5">
              <Package size={14} style={{ color: "var(--col-violet)" }} />
              <span className="text-sm font-black text-white">{items.length} Item{items.length !== 1 ? 's' : ''}</span>
            </div>
            {showItems ? <ChevronUp size={14} style={{ color: 'var(--text-muted)' }} />
                       : <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />}
          </button>

          {showItems && (
            <div className="divide-y" style={{ borderColor: 'var(--rgba-white-05)' }}>
              {items.map((i: any, idx: number) => {
                const lineAmt = Number(i.quantity) * Number(i.rate);
                const gstAmt  = lineAmt * (Number(i.gst_percent)||0) / 100;
                return (
                  <div key={idx} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-white">{i.item_name}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-app-sm" style={{ color: 'var(--text-muted)' }}>
                            {i.quantity} {i.unit||'Pcs'} × ₹{Number(i.rate).toLocaleString('en-IN')}
                          </span>
                          {i.gst_percent > 0 && gstEnabled && (
                            <span className="text-app-xs px-1.5 py-0.5 rounded-md font-bold"
                              style={{ background: 'var(--col-info-12)', color: "var(--col-info)" }}>
                              GST {i.gst_percent}%
                            </span>
                          )}
                          {i.hsn_code && (
                            <span className="text-app-2xs font-mono" style={{ color: 'var(--text-muted)' }}>
                              HSN {i.hsn_code}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-black tabular-nums" style={{ color: "var(--col-slate-200)" }}>
                          ₹{Math.round(lineAmt).toLocaleString('en-IN')}
                        </p>
                        {gstAmt > 0 && (
                          <p className="text-app-xs" style={{ color: 'rgba(96,165,250,0.7)' }}>
                            +₹{gstAmt.toLocaleString('en-IN', {minimumFractionDigits:2,maximumFractionDigits:2})} GST
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Totals breakdown ─────────────────────────────────────────── */}
        <div className="rounded-[20px] p-4 space-y-2"
          style={{ background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)' }}>
          <p className="text-app-xs font-black uppercase tracking-[0.15em] mb-2.5" style={{ color: 'var(--text-muted)' }}>
            Summary
          </p>

          {[
            { label: 'Item Subtotal', value: fmtINR(itemTotal), show: true },
            { label: 'Vehicle Rent', value: `+${fmtINR(rent)}`, show: rent > 0, color: "var(--col-warning)" },
            { label: 'Discount', value: `-${fmtINR(disc)}`, show: disc > 0, color: "var(--col-success)" },
            ...(gstSummary && gstSummary.totalGst > 0
              ? isInterstate
                ? [{ label: 'IGST', value: fmtINR(gstSummary.totalIgst), show: true, color: "var(--col-info)" }]
                : [
                    { label: 'CGST', value: fmtINR(gstSummary.totalCgst), show: true, color: "var(--col-violet)" },
                    { label: 'SGST', value: fmtINR(gstSummary.totalSgst), show: true, color: "var(--col-success)" },
                  ]
              : []),
          ].filter(r => r.show).map((row, i) => (
            <div key={i} className="flex justify-between text-app-md">
              <span style={{ color: 'var(--text-muted)' }}>{row.label}</span>
              <span className="font-bold tabular-nums" style={{ color: row.color || 'var(--text-secondary)' }}>{row.value}</span>
            </div>
          ))}

          <div className="flex justify-between pt-2"
            style={{ borderTop: '1px solid var(--glass-border)' }}>
            <span className="text-sm font-black text-white">Grand Total</span>
            <span className="text-base font-black tabular-nums" style={{ color: accentColor }}>
              {fmtINR(total)}
            </span>
          </div>

          {/* Amount in words */}
          <div className="mt-2 px-3 py-2 rounded-[12px]"
            style={{ background: 'var(--rgba-white-03)', border: '1px solid var(--glass-border)' }}>
            <p className="text-app-2xs font-black uppercase tracking-wider mb-0.5"
              style={{ color: 'var(--text-muted)' }}>Amount in Words</p>
            <p className="text-app-sm italic font-medium" style={{ color: 'var(--text-secondary)' }}>
              {amountInWords(total)}
            </p>
          </div>
        </div>

        {/* ── Payment Status ────────────────────────────────────────── */}
        {linkedTxns.length > 0 && (
          <div className="rounded-[20px] overflow-hidden"
            style={{ background: 'var(--rgba-white-04)', border: '1px solid var(--glass-border)' }}>
            <div className="p-4 space-y-2.5">
              <p className="text-app-xs font-black uppercase tracking-[0.15em] mb-1"
                style={{ color: 'var(--text-muted)' }}>Payment Status</p>

              <div className="flex justify-between text-app-md">
                <span style={{ color: 'var(--text-muted)' }}>Grand Total</span>
                <span className="font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{fmtINR(total)}</span>
              </div>
              <div className="flex justify-between text-app-md">
                <span style={{ color: 'var(--text-muted)' }}>Paid</span>
                <span className="font-black tabular-nums" style={{ color: "var(--col-success)" }}>{fmtINR(paidAmount)}</span>
              </div>
              {pendingAmount > 0 && (
                <div className="flex justify-between text-app-md">
                  <span className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                    <span style={{ color: "var(--col-warning)", fontSize: 9 }}>⏳</span> Pending
                  </span>
                  <span className="font-black tabular-nums" style={{ color: "var(--col-warning)" }}>{fmtINR(pendingAmount)}</span>
                </div>
              )}
              {pendingAmount === 0 && paidAmount >= total && (
                <div className="flex items-center gap-1.5 text-app-sm font-black"
                  style={{ color: "var(--col-success)" }}>
                  <CheckCircle2 size={11} /> Fully Paid
                </div>
              )}
            </div>

            {/* Linked payment lines */}
            <div className="px-4 pb-4 space-y-1.5"
              style={{ borderTop: '1px solid var(--glass-border)' }}>
              <p className="text-app-2xs font-black uppercase tracking-wider mt-3 mb-2"
                style={{ color: 'var(--text-muted)' }}>Linked Payments</p>
              {linkedTxns.map((t: any, i: number) => (
                <div key={i}
                  className="flex items-center justify-between rounded-[10px] px-3 py-2.5"
                  style={{ background: 'var(--col-success-07)', border: '1px solid var(--col-success-14)' }}>
                  <div className="flex items-center gap-2">
                    <Wallet size={11} style={{ color: "var(--col-success)" }} />
                    <span className="text-app-sm font-bold" style={{ color: 'var(--text-muted)' }}>
                      {t.payment_mode || 'Cash'}
                    </span>
                    {t.date && (
                      <span className="text-app-xs" style={{ color: 'var(--text-muted)' }}>· {t.date}</span>
                    )}
                  </div>
                  <span className="text-app-lg font-black tabular-nums" style={{ color: "var(--col-success)" }}>
                    {fmtINR(Number(t.amount) || 0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* UPI QR — shown for Sales when firm has UPI ID */}
        {settings?.profile?.upi_id && entry.type === 'sell' && (
          <div className="px-1 mb-2">
            <UpiQrInvoice
              upiId={settings.profile.upi_id}
              payeeName={settings.profile?.firm_name || 'Business'}
              amount={total}
              invoiceRef={entry.invoice_no || entry.prefixed_id}
            />
          </div>
        )}

        {/* ── Meta info ────────────────────────────────────────────────── */}
        <div className="rounded-[20px] p-4 space-y-2"
          style={{ background: 'var(--rgba-white-03)', border: '1px solid var(--glass-border)' }}>
          {[
            { icon: Hash,      label: 'Invoice No',      value: entry.invoice_no || entry.prefixed_id || '-' },
            { icon: Calendar,  label: 'Date',             value: entry.date },
            { icon: Building2, label: 'Source Supplier',  value: entry.source_supplier, show: !!entry.source_supplier },
            { icon: Truck,     label: 'Vehicle',           value: entry.vehicle,         show: !!entry.vehicle },
            { icon: FileText,  label: 'Notes',             value: entry.notes,            show: !!entry.notes },
          ].filter(m => m.show !== false).map(({ icon: Icon, label, value }, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="p-1.5 rounded-xl flex-shrink-0"
                style={{ background: 'var(--rgba-white-06)' }}>
                <Icon size={11} style={{ color: 'var(--text-muted)' }} />
              </div>
              <p className="text-app-xs font-bold uppercase tracking-wider w-20 flex-shrink-0"
                style={{ color: 'var(--text-muted)' }}>{label}</p>
              <p className="text-app-md font-bold text-right flex-1" style={{ color: 'var(--text-secondary)' }}>
                {value}
              </p>
            </div>
          ))}
        </div>

        {/* ── Action buttons ───────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => setShowExportModal(true)} disabled={loading}
            className="flex items-center justify-center gap-2 py-3.5 rounded-[18px] font-black text-sm active:scale-95 transition-all"
            style={{ background: 'var(--col-info-14)', border: '1px solid var(--col-info-25)', color: "var(--col-info)" }}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            Export
          </button>
          <button onClick={handleWhatsApp}
            className="flex items-center justify-center gap-2 py-3.5 rounded-[18px] font-black text-sm active:scale-95 transition-all"
            style={{ background: 'rgba(37,211,102,0.12)', border: '1px solid rgba(37,211,102,0.25)', color: "var(--col-whatsapp)" }}>
            <MessageCircle size={15} /> WhatsApp
          </button>
          <button onClick={() => onEdit(entry)}
            className="col-span-2 flex items-center justify-center gap-2 py-3.5 rounded-[18px] font-black text-sm active:scale-95 transition-all"
            style={{ background: 'var(--col-violet-14)', border: '1px solid var(--col-violet-25)', color: "var(--col-violet)" }}>
            <Edit2 size={15} /> Edit Entry
          </button>
        </div>
      </div>
    </div>
  );
};

export default LedgerEntryDetailView;






