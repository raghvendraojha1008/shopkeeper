/**
 * Shared landscape PDF generator for party ledger statements.
 * Matches the BALANCE LEDGER STATEMENT format (sample PDF).
 * Used by both PartyDetailView (single party) and PartiesView (bulk all-parties).
 */

function fmtPdfDate(raw: any): string {
  if (!raw) return '-';
  let d: Date;
  if (typeof raw?.toDate === 'function') d = raw.toDate();
  else if (typeof raw === 'object' && typeof raw.seconds === 'number')
    d = new Date(raw.seconds * 1000 + Math.floor((raw.nanoseconds || 0) / 1e6));
  else if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, day] = raw.split('-').map(Number);
    d = new Date(y, m - 1, day);
  } else d = new Date(raw);
  if (isNaN(d.getTime())) return '-';
  try { return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return raw; }
}

function fmtNum(n: any): string {
  const num = Math.abs(Number(n || 0));
  if (isNaN(num)) return '0.00';
  try { return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  catch { return num.toFixed(2); }
}

function parseRecordDate(raw: any): Date {
  if (typeof raw?.toDate === 'function') return raw.toDate();
  if (typeof raw === 'object' && typeof raw.seconds === 'number')
    return new Date(raw.seconds * 1000);
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(raw || 0);
}

import { ExportOptions, DEFAULT_EXPORT_OPTIONS } from '../types/exportOptions';

export type { ExportOptions };

export interface PartyLedgerPdfOptions {
  party: any;
  filteredList: any[];
  miscCharges: any[];
  stats: { totalBilled: number; totalPaid: number; balance: number; miscNet: number };
  dateRange: { start: string; end: string };
  /** If true, don't add a new page before drawing (first party in bulk PDF) */
  isFirstSection?: boolean;
  /** Fine-grained export customisation from the two-step export modal */
  exportOptions?: ExportOptions;
}

/**
 * Draws one party's ledger statement section onto the given jsPDF document.
 * Adds a new page first unless isFirstSection = true.
 * Returns the jsPDF doc (for chaining).
 */
export async function drawPartyLedgerSection(
  doc: any,
  autoTable: any,
  opts: PartyLedgerPdfOptions
): Promise<void> {
  const { party, filteredList, miscCharges, stats, dateRange, isFirstSection } = opts;
  const eo: ExportOptions = opts.exportOptions ?? DEFAULT_EXPORT_OPTIONS;

  // Helper: creates a muted italic annotation row below a main transaction row.
  // Spans the description column; all other cells are blank.
  const detailRow = (label: string, value: string, color: [number, number, number] = [120, 130, 155]): any[] => [
    '', '', '',
    {
      content: `  ↳ ${label}: ${value}`,
      styles: { fontSize: 5.8, fontStyle: 'italic', textColor: color, cellPadding: { top: 0.8, bottom: 0.8, left: 6, right: 2 } },
    },
    '', '', '', '', '',
  ];

  if (!isFirstSection) doc.addPage();

  const pageW = doc.internal.pageSize.getWidth();  // 297mm (landscape A4)
  const pageH = doc.internal.pageSize.getHeight(); // 210mm
  const margin = 12;

  const isCustomer = party.role === 'customer';

  // ── HEADER BAR ─────────────────────────────────────────────────────────────
  // Customer: deep teal/green  |  Supplier: deep amber/brown
  if (isCustomer) {
    doc.setFillColor(8, 55, 40);   // deep teal
  } else {
    doc.setFillColor(55, 35, 5);   // deep amber
  }
  doc.rect(0, 0, pageW, 42, 'F');

  // Title
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('BALANCE LEDGER STATEMENT', margin, 13);

  // Statement period (right-aligned)
  const ps = dateRange.start ? dateRange.start : '—';
  const pe = dateRange.end ? dateRange.end : new Date().toLocaleDateString('en-IN');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 200, 220);
  doc.text('Statement Period', pageW - margin, 9, { align: 'right' });
  doc.setFontSize(8.5);
  doc.setTextColor(220, 235, 255);
  doc.text(`${ps}  –  ${pe}`, pageW - margin, 15, { align: 'right' });

  // Party name (bold, large)
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(`${party.name}`, margin, 24);

  // [CUSTOMER] / [SUPPLIER] tag — placed on a new sub-line (y=31 area but above contact row)
  // Draw it as a small badge on the same line but safely after party name using measured width
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  const nameWidth = doc.getStringUnitWidth(party.name) * 11 / doc.internal.scaleFactor;
  const roleText = `[${(party.role || '').toUpperCase()}]`;
  const roleColor: [number, number, number] = isCustomer ? [100, 230, 180] : [255, 200, 100];
  doc.setTextColor(...roleColor);
  // Place tag to the right of name with a small gap, or below if name is very long
  const tagX = margin + nameWidth + 3;
  if (tagX + 25 < pageW - margin - 60) {
    // Enough room on same line
    doc.text(roleText, tagX, 24);
  } else {
    // Put on next line
    doc.text(roleText, margin, 29);
  }

  // Party contact details row
  const details: string[] = [];
  if (party.contact)    details.push(`Tel: ${party.contact}`);
  if (party.gstin)      details.push(`GSTIN: ${party.gstin}`);
  if (party.legal_name) details.push(party.legal_name);
  if (party.address)    details.push(party.address);
  if (party.state)      details.push(party.state);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(160, 200, 190);
  if (details.length) doc.text(details.join('   |   '), margin, 31);

  doc.setFontSize(7);
  doc.setTextColor(120, 160, 150);
  doc.text('Account statement generated from transaction ledger records', margin, 38);

  let y = 50;

  // ── SUMMARY BOXES ──────────────────────────────────────────────────────────
  const ob = Number(party.opening_balance) || 0;
  const openingEffect = ob > 0
    ? (party.opening_balance_type === 'we_owe' ? -ob : ob)
    : 0;

  let totalOrdered = 0;
  filteredList.forEach(t => {
    if (t.docType === 'invoice') {
      if (t.type === 'sell' || t.type === 'purchase')
        totalOrdered += Number(t.total_amount) || 0;
      if (t.type === 'sell_return' || t.type === 'purchase_return')
        totalOrdered -= Number(t.total_amount) || 0;
    }
  });

  // Separate normal and reverse payments
  let totalReceived = 0;
  let totalReverse = 0;
  filteredList.forEach(t => {
    if (t.docType === 'payment') {
      const amount = Number(t.amount) || 0;
      const isNormal =
        (party.role === 'customer' && t.type === 'received') ||
        (party.role === 'supplier' && t.type === 'paid');
      const isReverse =
        (party.role === 'customer' && t.type === 'paid') ||
        (party.role === 'supplier' && t.type === 'received');
      if (isNormal) totalReceived += amount;
      if (isReverse) totalReverse += amount;
    }
  });

  // Reverse payment sign:
  // Customer: paid to customer increases outstanding (+ reverseSign)
  // Supplier: received from supplier decreases outstanding (- reverseSign)
  const reverseSign = isCustomer ? 1 : -1;
  const closingBalance = openingEffect + totalOrdered - totalReceived + reverseSign * totalReverse + (stats.miscNet || 0);

  const paidColLabel = isCustomer ? 'TOTAL RECEIVED' : 'TOTAL PAID';

  const boxW  = (pageW - 2 * margin - 9) / 4;
  const boxH  = 16;
  const boxes = [
    { label: 'OPENING BALANCE',  value: ob > 0 ? `Rs. ${fmtNum(ob)}` : 'Rs. 0.00' },
    { label: 'TOTAL ORDERED',    value: `Rs. ${fmtNum(totalOrdered)}` },
    { label: paidColLabel,       value: `Rs. ${fmtNum(totalReceived)}` },
    { label: 'CLOSING BALANCE',  value: `Rs. ${fmtNum(Math.abs(closingBalance))}` },
  ];

  boxes.forEach((b, i) => {
    const bx = margin + i * (boxW + 3);
    doc.setFillColor(235, 235, 250);
    doc.roundedRect(bx, y, boxW, boxH, 2, 2, 'F');
    doc.setTextColor(100, 100, 150);
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'bold');
    doc.text(b.label, bx + boxW / 2, y + 5.5, { align: 'center' });
    doc.setTextColor(20, 20, 70);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(b.value, bx + boxW / 2, y + 12.5, { align: 'center' });
  });

  y += boxH + 4;

  // Net balance line
  const balColor: [number, number, number] = closingBalance >= 0 ? [15, 120, 60] : [180, 30, 30];
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...balColor);
  const balLabel = closingBalance >= 0 ? 'Net balance outstanding' : 'Net credit balance';
  doc.text(
    `${balLabel} as of ${new Date().toLocaleDateString('en-IN')}: Rs. ${fmtNum(Math.abs(closingBalance))}`,
    margin, y
  );
  y += 6;

  // ── TRANSACTION DETAIL ────────────────────────────────────────────────────
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(40, 40, 80);
  doc.text('TRANSACTION DETAIL', margin, y);
  y += 3;

  // Sort chronologically (ascending — oldest first).
  // Secondary sort by created_at so same-date records preserve entry order.
  const sortChron = (a: any, b: any) => {
    const dA = (a.date || '').slice(0, 10), dB = (b.date || '').slice(0, 10);
    if (dA !== dB) return dA < dB ? -1 : 1;
    const cA = a.created_at ? parseRecordDate(a.created_at).getTime() : 0;
    const cB = b.created_at ? parseRecordDate(b.created_at).getTime() : 0;
    return cA - cB;
  };

  const sorted = [...filteredList].sort(sortChron);

  // Include misc charges sorted in.
  // IMPORTANT: filteredList (sorted) already contains misc items with docType:'misc'
  // because PartyDetailView's timeline combines ledger + payments + miscCharges.
  // We must exclude them from `sorted` before merging with the explicit miscCharges
  // array to avoid each service record appearing twice in the table and in the
  // running balance accumulation.
  const allSorted = [
    ...sorted.filter((r: any) => r.docType !== 'misc'),
    ...miscCharges.map(c => ({ ...c, docType: 'misc' })),
  ].sort(sortChron);

  // Column header labels — role-specific for paid/received column
  const amtPaidColHeader = isCustomer ? 'Amount (Received)' : 'Amount (Paid)';

  // Build rows
  const tableRows: any[] = [];
  let runBalance = openingEffect;

  // Opening balance row
  if (eo.includeOpeningBalance && ob > 0) {
    const obDateStr = party.opening_balance_date
      ? fmtPdfDate(party.opening_balance_date)
      : fmtPdfDate(new Date().toISOString().split('T')[0]);
    tableRows.push([
      obDateStr, 'Opening', '-', 'Opening Balance',
      '-', '-',
      { content: fmtNum(ob), styles: { fontStyle: 'bold', textColor: [20, 80, 140] } },
      '',
      { content: fmtNum(runBalance), styles: { fontStyle: 'bold' } },
    ]);
  }

  allSorted.forEach(record => {
    if (record.docType === 'invoice') {
      const isReturn = record.type === 'sell_return' || record.type === 'purchase_return';
      const typeLabel = isReturn ? 'Return' : 'Order';
      const refNo = record.invoice_no || record.bill_no || record.prefixed_id || '-';
      const orderTotal = Number(record.total_amount) || 0;

      if (record.items && record.items.length > 0) {
        runBalance += isReturn ? -orderTotal : orderTotal;
        record.items.forEach((item: any, idx: number) => {
          const itemTotal = Number(item.total) || (Number(item.quantity) * Number(item.rate)) || 0;
          tableRows.push([
            idx === 0 ? fmtPdfDate(record.date) : '',
            idx === 0 ? typeLabel : '',
            idx === 0 ? refNo : '',
            item.item_name || '-',
            item.quantity != null ? String(item.quantity) : '-',
            item.rate != null ? fmtNum(item.rate) : '-',
            isReturn
              ? { content: `(${fmtNum(itemTotal)})`, styles: { textColor: [180, 40, 40] } }
              : fmtNum(itemTotal),
            '',
            idx === 0
              ? { content: fmtNum(runBalance), styles: { fontStyle: 'bold' } }
              : '',
          ]);
          // Per-item GST annotation
          if (eo.includeGst && item.gst_percent > 0) {
            tableRows.push(detailRow(
              'GST',
              `${item.gst_percent}% (${item.price_type || 'exclusive'})`,
              [100, 100, 200],
            ));
          }
        });
      } else {
        runBalance += isReturn ? -orderTotal : orderTotal;
        tableRows.push([
          fmtPdfDate(record.date),
          typeLabel,
          refNo,
          isReturn ? 'Return' : '-',
          '-', '-',
          isReturn
            ? { content: `(${fmtNum(orderTotal)})`, styles: { textColor: [180, 40, 40] } }
            : fmtNum(orderTotal),
          '',
          { content: fmtNum(runBalance), styles: { fontStyle: 'bold' } },
        ]);
      }

      // Invoice-level annotation detail rows (appear after all item rows)
      if (eo.includeTransport && record.vehicle) {
        const transportStr = `${record.vehicle}${Number(record.vehicle_rent) > 0 ? ` (₹${Number(record.vehicle_rent).toLocaleString('en-IN')})` : ''}`;
        tableRows.push(detailRow('Transport', transportStr, [80, 110, 160]));
      }
      if (eo.includeDiscount && Number(record.discount_amount) > 0) {
        tableRows.push(detailRow('Discount', `-₹${Number(record.discount_amount).toLocaleString('en-IN')}`, [160, 120, 30]));
      }
      if (eo.includeSellerInvoiceNo && record.seller_invoice_no) {
        tableRows.push(detailRow('Seller Invoice', `#${record.seller_invoice_no}`, [120, 110, 160]));
      }
      // Reference price fields — role-specific and off by default
      if (eo.includePurchaseRateRef && isCustomer && Number(record.purchase_rate_ref) > 0) {
        tableRows.push(detailRow('Our Cost (Purchase Rate)', `₹${Number(record.purchase_rate_ref).toLocaleString('en-IN')}`, [180, 80, 80]));
      }
      if (eo.includeSalePriceRef && !isCustomer && Number(record.sale_price_ref) > 0) {
        tableRows.push(detailRow('Sale Price (Market Rate)', `₹${Number(record.sale_price_ref).toLocaleString('en-IN')}`, [180, 80, 80]));
      }
      if (eo.includeNotes && record.notes) {
        tableRows.push(detailRow('Note', record.notes, [110, 120, 140]));
      }

    } else if (record.docType === 'payment') {
      const amount = Number(record.amount) || 0;
      const isNormal =
        (party.role === 'customer' && record.type === 'received') ||
        (party.role === 'supplier' && record.type === 'paid');
      const isRevPayment =
        (party.role === 'customer' && record.type === 'paid') ||
        (party.role === 'supplier' && record.type === 'received');

      // Update running balance
      if (isNormal) {
        runBalance -= amount;
      } else if (isRevPayment) {
        // Customer: paid to customer increases outstanding
        // Supplier: received from supplier decreases outstanding
        runBalance += isCustomer ? amount : -amount;
      }

      const typeLabel = record.type === 'received' ? 'Received' : 'Paid';

      if (isNormal) {
        // Normal payment goes in col 7 (received/paid col)
        tableRows.push([
          fmtPdfDate(record.date),
          typeLabel,
          '-',
          record.payment_purpose || 'Payment',
          '-', '-',
          '',
          { content: fmtNum(amount), styles: { textColor: [15, 120, 60], fontStyle: 'bold' } },
          { content: fmtNum(runBalance), styles: { fontStyle: 'bold' } },
        ]);
      } else {
        // Reverse payment — goes in col 6 (Order/Amount col) with special label
        const reverseLabel = isCustomer ? 'Paid to Party' : 'Rec. from Party';
        tableRows.push([
          fmtPdfDate(record.date),
          { content: reverseLabel, styles: { textColor: [180, 100, 0], fontStyle: 'bold' } },
          '-',
          record.payment_purpose || 'Reverse Payment',
          '-', '-',
          { content: `(${fmtNum(amount)})`, styles: { textColor: [180, 100, 0], fontStyle: 'bold' } },
          '',
          { content: fmtNum(runBalance), styles: { fontStyle: 'bold' } },
        ]);
      }

      // Payment annotation detail rows
      if (eo.includePaymentMode && record.payment_mode) {
        tableRows.push(detailRow('Mode', record.payment_mode, [80, 140, 110]));
      }
      if (eo.includeReceivedBy && record.received_by) {
        const rcvLabel = record.type === 'received' ? 'Collected By' : 'Paid By';
        tableRows.push(detailRow(rcvLabel, record.received_by, [100, 110, 180]));
      }
      if (record.transaction_reference) {
        tableRows.push(detailRow('Bank Ref', record.transaction_reference, [110, 120, 140]));
      }
      if (eo.includeNotes && record.notes) {
        tableRows.push(detailRow('Note', record.notes, [110, 120, 140]));
      }

    } else if (record.docType === 'misc') {
      if (!eo.includeMiscCharges) return;
      const amt = Number(record.amount) || 0;
      if (record.direction === 'charge_to_party') runBalance += amt;
      else runBalance -= amt;
      tableRows.push([
        fmtPdfDate(record.date),
        'Service',
        '-',
        record.category || record.service_name || 'Misc Charge',
        record.quantity || '-',
        record.rate_per_unit || '-',
        record.direction === 'charge_to_party' ? fmtNum(amt) : '',
        record.direction === 'charge_from_party' ? fmtNum(amt) : '',
        { content: fmtNum(runBalance), styles: { fontStyle: 'bold' } },
      ]);
      if (eo.includeNotes && record.notes) {
        tableRows.push(detailRow('Note', record.notes, [110, 120, 140]));
      }
    }
  });

  // Footer totals row
  const headFill: [number, number, number] = isCustomer ? [8, 55, 40] : [55, 35, 5];

  autoTable(doc, {
    startY: y,
    head: [['Date', 'Type', 'Invoice', 'Description', 'Qty', 'Rate', 'Amount (Order)', amtPaidColHeader, 'Running Balance']],
    body: tableRows,
    foot: [['TOTALS', '', '', '', '', '', `Rs. ${fmtNum(totalOrdered)}`, `Rs. ${fmtNum(totalReceived)}`, `Rs. ${fmtNum(Math.abs(closingBalance))}`]],
    theme: 'grid',
    headStyles: {
      fillColor: headFill,
      textColor: [255, 255, 255],
      fontSize: 7,
      fontStyle: 'bold',
      cellPadding: 2.5,
    },
    footStyles: {
      fillColor: [225, 225, 245],
      textColor: [30, 30, 80],
      fontStyle: 'bold',
      fontSize: 7,
    },
    styles: { fontSize: 6.8, cellPadding: 1.8, overflow: 'linebreak', font: 'helvetica' },
    columnStyles: {
      0: { cellWidth: 22, halign: 'center' },
      1: { cellWidth: 20 },
      2: { cellWidth: 18 },
      3: { cellWidth: 'auto' as any },
      4: { cellWidth: 12, halign: 'right' },
      5: { cellWidth: 18, halign: 'right' },
      6: { cellWidth: 28, halign: 'right' },
      7: { cellWidth: 28, halign: 'right' },
      8: { cellWidth: 30, halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: margin, right: margin },
  });

  const finalY: number = (doc as any).lastAutoTable.finalY + 5;

  // Disclaimer
  if (finalY + 8 < pageH) {
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(140, 140, 160);
    doc.text(
      'This statement is system-generated from ledger transaction records and reflects the account position as of the statement end date. Please report any discrepancies within 7 days of receipt.',
      margin, finalY, { maxWidth: pageW - 2 * margin }
    );
  }
}

/**
 * Add page numbers to all pages of the document.
 */
export function addPageNumbers(doc: any): void {
  const total = (doc.internal as any).getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(6.5);
    doc.setTextColor(150, 150, 170);
    doc.text(
      `Generated on ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`,
      margin, pageH - 5
    );
    doc.text(`Page ${i} of ${total}`, pageW - margin, pageH - 5, { align: 'right' });
  }
}
