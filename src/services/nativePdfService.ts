import { Capacitor } from '@capacitor/core';
import { exportService } from './export';

export interface NativePdfSection {
  type: 'text' | 'table';
  content?: string;          // for text
  rows?: string[][];         // for table (first row as header)
}

export interface NativePdfData {
  title: string;
  fileName: string;
  sections: NativePdfSection[];
}

export const nativePdfService = {
  /**
   * Generate and share PDF. Uses native Android PdfDocument if available,
   * then falls back to provided blob, then falls back to plain-text file share.
   * Always opens the native share sheet on Android — never silently fails.
   */
  async generateAndShare(data: NativePdfData, fallbackBlob?: Blob): Promise<boolean> {
    // ── 1. Try native PdfGenerator plugin ────────────────────────────────────
    try {
      if (Capacitor.getPlatform() === 'android') {
        const PdfGenerator = (window as any).Capacitor?.Plugins?.PdfGenerator;
        if (PdfGenerator?.generate) {
          const result = await PdfGenerator.generate({
            title: data.title,
            fileName: data.fileName,
            data: { sections: data.sections },
          });
          if (result?.uri) {
            const { Share } = await import('@capacitor/share');
            await Share.share({ title: data.title, dialogTitle: data.title, files: [result.uri] });
            return true;
          }
        }
      }
    } catch (e) {
      console.warn('[nativePdf] Native plugin failed, trying fallback:', e);
    }

    // ── 2. Try caller-provided blob (e.g. jsPDF on web) ──────────────────────
    if (fallbackBlob) {
      try {
        return await exportService.sharePdfBlob(fallbackBlob, data.fileName);
      } catch (e) {
        console.warn('[nativePdf] sharePdfBlob fallback failed, trying purePdf:', e);
      }
    }

    // ── 3. Pure-JS PDF binary generator ──────────────────────────────────────
    // No native plugin, no jsPDF. Builds a real .pdf file from scratch using
    // standard Helvetica (Type1) — works even under GPU memory pressure.
    try {
      if (Capacitor.isNativePlatform()) {
        const { buildPdf, uint8ToBase64 } = await import('../utils/purePdf');
        const pdfBytes = buildPdf(
          data.title,
          data.sections.map(s => ({
            type: s.type as 'text' | 'table',
            content: s.content,
            rows: s.rows,
          })),
        );
        const b64 = uint8ToBase64(pdfBytes);

        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        const { Share } = await import('@capacitor/share');

        const writeResult = await Filesystem.writeFile({
          path: data.fileName,
          data: b64,
          directory: Directory.Cache,
        });

        let fileUri = writeResult.uri;
        if (!fileUri) {
          const uriResult = await Filesystem.getUri({ path: data.fileName, directory: Directory.Cache });
          fileUri = uriResult.uri;
        }

        await Share.share({ title: data.title, dialogTitle: data.title, files: [fileUri] });
        return true;
      }
    } catch (e) {
      console.warn('[nativePdf] purePdf fallback failed, trying text:', e);
    }

    // ── 4. Last-resort text fallback (.txt) ───────────────────────────────────
    try {
      if (Capacitor.isNativePlatform()) {
        const lines: string[] = [data.title, '-'.repeat(44), ''];
        for (const section of data.sections) {
          if (section.type === 'text') {
            lines.push(section.content ?? '');
          } else if (section.type === 'table' && section.rows) {
            for (const row of section.rows) lines.push(row.join('  |  '));
            lines.push('');
          }
        }
        const content = lines.join('\n');
        // Use the filename but strip chars that can break Android file paths
        const safeBase = data.fileName
          .replace(/\.pdf$/i, '')
          .replace(/[^a-zA-Z0-9_\-]/g, '_');
        const txtFileName = `${safeBase}.txt`;

        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        const { Share } = await import('@capacitor/share');

        // Encode as UTF-8 bytes then base64 — avoids the Capacitor
        // `encoding: 'utf8'` quirk that fails on some Android WebView versions
        // when content contains non-ASCII characters (e.g. Indian names).
        const encoder = new TextEncoder();
        const bytes = encoder.encode(content);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const b64content = btoa(binary);

        const writeResult = await Filesystem.writeFile({
          path: txtFileName,
          data: b64content,
          directory: Directory.Cache,
          // No encoding param — data is already base64
        });
        let fileUri = writeResult.uri;
        if (!fileUri) {
          const r = await Filesystem.getUri({ path: txtFileName, directory: Directory.Cache });
          fileUri = r.uri;
        }
        await Share.share({ title: data.title, dialogTitle: data.title, files: [fileUri] });
        return true;
      }
    } catch (e) {
      console.error('[nativePdf] Text fallback share failed:', e);
    }

    return false;
  },

  /**
   * Convert an invoice object to NativePdfData sections.
   * Customize this based on your invoice structure.
   */
  invoiceToSections(invoice: any, settings: any): NativePdfData {
    const sections: NativePdfSection[] = [];

    // Firm header
    sections.push({ type: 'text', content: settings?.profile?.firm_name || 'Business' });
    if (settings?.profile?.address) {
      sections.push({ type: 'text', content: settings.profile.address });
    }
    if (settings?.profile?.gstin) {
      sections.push({ type: 'text', content: `GSTIN: ${settings.profile.gstin}` });
    }
    sections.push({ type: 'text', content: '' }); // spacer

    // Invoice meta
    sections.push({ type: 'text', content: `INVOICE #${invoice.invoice_no || 'N/A'}` });
    sections.push({ type: 'text', content: `Date: ${invoice.date}` });
    sections.push({ type: 'text', content: '' });

    // Party details
    sections.push({ type: 'text', content: `Bill To: ${invoice.party_name}` });
    sections.push({ type: 'text', content: '' });

    // Items table
    const tableRows: string[][] = [
      ['Item', 'Qty', 'Rate', 'Total'], // header
    ];
    (invoice.items || []).forEach((item: any) => {
      tableRows.push([
        item.item_name,
        String(item.quantity || ''),
        `Rs.${Number(item.rate || 0).toLocaleString('en-IN')}`,
        `Rs.${Number(item.total || 0).toLocaleString('en-IN')}`,
      ]);
    });
    sections.push({ type: 'table', rows: tableRows });
    sections.push({ type: 'text', content: '' });

    // Totals
    sections.push({ type: 'text', content: `Subtotal: Rs.${Number(invoice.total_amount || 0).toLocaleString('en-IN')}` });
    if (invoice.vehicle_rent) {
      sections.push({ type: 'text', content: `Transport: Rs.${Number(invoice.vehicle_rent).toLocaleString('en-IN')}` });
    }
    sections.push({ type: 'text', content: `GRAND TOTAL: Rs.${Number(invoice.total_amount || 0).toLocaleString('en-IN')}` });

    return {
      title: 'TAX INVOICE',
      fileName: `Invoice_${invoice.invoice_no || 'draft'}.pdf`,
      sections,
  };
},

/**
 * Convert ledger entry to PDF sections
 */
entryToSections(entry: any, settings: any, computed: {
  isSale: boolean;
  items: any[];
  gstSummary: any;
  isInterstate: boolean;
  party: any;
  rent: number;
  disc: number;
  total: number;
  itemTotal: number;
}): NativePdfData {
  const sections: NativePdfSection[] = [];
  const { isSale, items, gstSummary, isInterstate, party, rent, disc, total, itemTotal } = computed;
  const firmName = settings?.profile?.firm_name || 'Business';

  // Header
  sections.push({ type: 'text', content: firmName });
  if (settings?.profile?.address) {
    sections.push({ type: 'text', content: settings.profile.address });
  }
  if (settings?.profile?.gstin) {
    sections.push({ type: 'text', content: `GSTIN: ${settings.profile.gstin}` });
  }
  sections.push({ type: 'text', content: '' });

  // Title
  sections.push({ type: 'text', content: isSale ? 'TAX INVOICE' : 'PURCHASE ORDER' });
  sections.push({ type: 'text', content: `Invoice #: ${entry.invoice_no || entry.prefixed_id || 'N/A'}` });
  sections.push({ type: 'text', content: `Date: ${entry.date}` });
  sections.push({ type: 'text', content: '' });

  // Party
  sections.push({ type: 'text', content: `${isSale ? 'Bill To' : 'Supplier'}: ${entry.party_name || 'N/A'}` });
  // FIX: Always include party address, phone, GSTIN, site for both GST &
  // non-GST customers — previously only GSTIN was shown.
  if (party?.address) {
    sections.push({ type: 'text', content: party.address });
  }
  if (party?.contact) {
    sections.push({ type: 'text', content: `Ph: ${party.contact}` });
  }
  if (party?.gstin) {
    sections.push({ type: 'text', content: `GSTIN: ${party.gstin}` });
  }
  if (entry.site || party?.site) {
    sections.push({ type: 'text', content: `Site: ${entry.site || party.site}` });
  }
  sections.push({ type: 'text', content: '' });

  // Items table
  const tableRows: string[][] = [['Item', 'Qty', 'Rate', 'Amount']];
  items.forEach((i: any) => {
    tableRows.push([
      i.item_name,
      `${i.quantity} ${i.unit || ''}`,
      fmtINR(i.rate),
      fmtINR(i.quantity * i.rate),
    ]);
  });
  sections.push({ type: 'table', rows: tableRows });
  sections.push({ type: 'text', content: '' });

  // Totals
  sections.push({ type: 'text', content: `Subtotal: ${fmtINR(itemTotal)}` });
  if (gstSummary?.totalGst) {
    if (isInterstate) {
      sections.push({ type: 'text', content: `IGST: ${fmtINR(gstSummary.totalIgst)}` });
    } else {
      sections.push({ type: 'text', content: `CGST: ${fmtINR(gstSummary.totalCgst)}` });
      sections.push({ type: 'text', content: `SGST: ${fmtINR(gstSummary.totalSgst)}` });
    }
  }
  if (rent > 0) sections.push({ type: 'text', content: `Vehicle Rent: ${fmtINR(rent)}` });
  if (disc > 0) sections.push({ type: 'text', content: `Discount: -${fmtINR(disc)}` });
  sections.push({ type: 'text', content: `GRAND TOTAL: ${fmtINR(total)}` });

  return {
    title: isSale ? 'TAX INVOICE' : 'PURCHASE ORDER',
    fileName: `${isSale ? 'Invoice' : 'Purchase'}_${entry.invoice_no || entry.prefixed_id || 'entry'}.pdf`,
    sections,
  };
},

/**
 * Convert expense to PDF sections
 */
expenseToSections(expense: any, settings: any, computed: { amount: number }): NativePdfData {
  const sections: NativePdfSection[] = [];
  const { amount } = computed;
  const firmName = settings?.profile?.firm_name || 'Business';

  sections.push({ type: 'text', content: firmName });
  sections.push({ type: 'text', content: 'EXPENSE VOUCHER' });
  sections.push({ type: 'text', content: '' });
  sections.push({ type: 'text', content: `Date: ${expense.date}` });
  sections.push({ type: 'text', content: `Voucher: ${expense.prefixed_id || expense.id?.slice(-6) || 'N/A'}` });
  sections.push({ type: 'text', content: '' });
  sections.push({ type: 'text', content: `Category: ${expense.category || '-'}` });
  sections.push({ type: 'text', content: `Description: ${expense.description || '-'}` });
  sections.push({ type: 'text', content: `Amount: ${fmtINR(amount)}` });
  if (expense.paid_by) sections.push({ type: 'text', content: `Paid By: ${expense.paid_by}` });
  if (expense.payment_mode) sections.push({ type: 'text', content: `Mode: ${expense.payment_mode}` });
  if (expense.notes) sections.push({ type: 'text', content: `Notes: ${expense.notes}` });
  sections.push({ type: 'text', content: '' });
  sections.push({ type: 'text', content: amountInWords(amount) });

  return {
    title: 'EXPENSE VOUCHER',
    fileName: `Expense_${expense.category}_${expense.date}.pdf`,
    sections,
  };
},

/**
 * Convert transaction to PDF sections
 */
transactionToSections(txn: any, settings: any, computed: {
  isReceived: boolean;
  amount: number;
  typeLabel: string;
}): NativePdfData {
  const sections: NativePdfSection[] = [];
  const { isReceived, amount, typeLabel } = computed;
  const firmName = settings?.profile?.firm_name || 'Business';

  sections.push({ type: 'text', content: firmName });
  sections.push({ type: 'text', content: typeLabel });
  sections.push({ type: 'text', content: '' });
  sections.push({ type: 'text', content: `Receipt #: ${txn.prefixed_id || txn.id?.slice(-8) || 'N/A'}` });
  sections.push({ type: 'text', content: `Date: ${txn.date}` });
  sections.push({ type: 'text', content: '' });
  sections.push({ type: 'text', content: `Amount: ${fmtINR(amount)}` });
  sections.push({ type: 'text', content: '' });
  sections.push({ type: 'text', content: `${isReceived ? 'Received From' : 'Paid To'}: ${txn.party_name || 'N/A'}` });
  sections.push({ type: 'text', content: `Mode: ${txn.payment_mode || 'Cash'}` });
  if (txn.payment_purpose) sections.push({ type: 'text', content: `Purpose: ${txn.payment_purpose}` });
  if (txn.bill_no) sections.push({ type: 'text', content: `Bill Ref: ${txn.bill_no}` });
  if (txn.notes) sections.push({ type: 'text', content: `Notes: ${txn.notes}` });
  sections.push({ type: 'text', content: '' });
  sections.push({ type: 'text', content: amountInWords(amount) });

  return {
    title: typeLabel,
    fileName: `${isReceived ? 'Receipt' : 'Payment'}_${txn.date}.pdf`,
    sections,
  };
  },
};

/**
 * Format number as INR currency
 */
function fmtINR(amount: number): string {
  const abs = Math.abs(Number(amount || 0));
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
  return `Rs.${formatted}.${decPart}`;
}

/**
 * Convert amount to words — Indian number system (crore/lakh/thousand)
 */
function amountInWords(amount: number): string {
  if (!isFinite(amount) || isNaN(amount)) return 'Amount in words: N/A';

  const ONES = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen',
  ];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function twoDigits(n: number): string {
    if (n === 0) return '';
    if (n < 20) return ONES[n];
    return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  }

  function threeDigits(n: number): string {
    if (n === 0) return '';
    if (n < 100) return twoDigits(n);
    return ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + twoDigits(n % 100) : '');
  }

  const absAmt = Math.abs(amount);
  const rupees = Math.floor(absAmt);
  const paise  = Math.round((absAmt - rupees) * 100);

  if (rupees === 0 && paise === 0) return 'Zero Rupees Only';

  const crore   = Math.floor(rupees / 10_000_000);
  const lakh    = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1_000);
  const rem     = rupees % 1_000;

  const parts: string[] = [];
  if (crore   > 0) parts.push(threeDigits(crore)   + ' Crore');
  if (lakh    > 0) parts.push(twoDigits(lakh)       + ' Lakh');
  if (thousand > 0) parts.push(twoDigits(thousand)  + ' Thousand');
  if (rem     > 0) parts.push(threeDigits(rem));

  const prefix = amount < 0 ? 'Minus ' : '';
  let result = prefix + 'Rupees ' + parts.join(' ') + ' Only';
  if (paise > 0) result += ` and ${twoDigits(paise)} Paise`;
  return result;
}