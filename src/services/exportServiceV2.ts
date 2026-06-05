/**
 * EXPORT SERVICE V2  — Full-Fledge PDF + CSV
 * ─────────────────────────────────────────────────────────────
 * Builds on existing exportService (Capacitor Share + browser download)
 *
 * Functions:
 *   ledgerToCsv()        — Ledger entries CSV with item breakdown
 *   ledgerToPdf()        — Landscape PDF with autotable
 *   transactionsToCsv()  — Transactions CSV
 *   expensesToCsv()      — Expenses CSV
 *   inventoryToCsv()     — Inventory CSV with HSN/GST columns
 *   fullReportToPdf()    — Multi-page PDF: summary + ledger + expenses + low-stock
 */

import { exportService } from './export';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function csvEscape(v: any): string {
  const s = String(v ?? '');
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(rows: any[][]): string {
  return rows.map(r => r.map(csvEscape).join(',')).join('\n');
}

function fmtDate(d: any): string {
  try {
    let dt: Date;
    if (d?.toDate) {
      dt = d.toDate();
    } else if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const [y, mo, day] = d.split('-').map(Number);
      dt = new Date(y, mo - 1, day);
    } else {
      dt = new Date(d || 0);
    }
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return String(d || ''); }
}

function fmtRupee(n: any): string {
  const num = Math.abs(Number(n || 0));
  const [intPart, decPart] = num.toFixed(2).split('.');
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

const DARK_HEADER: [number, number, number] = [22, 28, 58];
const ALT_ROW    : [number, number, number] = [247, 248, 255];
const RED_HEADER : [number, number, number] = [160, 28, 28];

async function getPDFWithAutoTable() {
  const { jsPDF } = await import('jspdf');
  const atMod = await import('jspdf-autotable');
  const autoTable = (atMod as any).default || atMod;
  // Ensure plugin is registered on prototype
  if (typeof (jsPDF as any).prototype?.autoTable !== 'function') {
    if (typeof (atMod as any).applyPlugin === 'function') {
      (atMod as any).applyPlugin(jsPDF);
    }
  }
  return jsPDF;
}

function pageHeader(doc: any, title: string, firm: string, subtitle = '') {
  doc.setFillColor(...DARK_HEADER);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 24, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14); doc.setFont('helvetica', 'bold');
  doc.text(firm || 'Business', 13, 10);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text(title, 13, 18);
  if (subtitle) doc.text(subtitle, doc.internal.pageSize.getWidth() / 2, 18, { align: 'center' });
  doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, doc.internal.pageSize.getWidth() - 13, 18, { align: 'right' });
  doc.setTextColor(0, 0, 0);
}

// ─── Main service ─────────────────────────────────────────────────────────────

// Build a friendly header block that explains the report at a glance.
function reportHeaderRows(opts: {
  firm: string;
  reportTitle: string;
  totalRecords: number;
  extra?: Array<[string, string]>;
}): any[][] {
  const today = new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const rows: any[][] = [
    [opts.firm || 'Business'],
    [opts.reportTitle],
    [`Generated on: ${today}`],
    [`Total records: ${opts.totalRecords}`],
  ];
  if (opts.extra) {
    for (const [k, v] of opts.extra) rows.push([`${k}: ${v}`]);
  }
  rows.push([]); // blank separator before column headers
  return rows;
}

export const exportServiceV2 = {

  // ── Ledger → CSV ────────────────────────────────────────────────────────────
  async ledgerToCsv(entries: any[], firmName = 'Shop') {
    const sales = entries.filter(e => e.type === 'sell')
                         .reduce((s, e) => s + (Number(e.total_amount) || 0), 0);
    const purchases = entries.filter(e => e.type === 'purchase')
                             .reduce((s, e) => s + (Number(e.total_amount) || 0), 0);

    const dataRows = entries.map(e => [
      fmtDate(e.date),
      e.type === 'sell' ? 'Sale' : 'Purchase',
      e.party_name || '',
      e.invoice_no || e.bill_no || '',
      e.site || '',
      (e.items || []).map((i: any) => `${i.item_name} x${i.quantity} @ ${Number(i.rate || 0).toFixed(2)}`).join('; '),
      (Number(e.total_amount || 0) - Number(e.vehicle_rent || 0) - Number(e.handling_charges || 0) + Number(e.discount_amount || 0)).toFixed(2),
      e.vehicle || '',
      Number(e.vehicle_rent || 0).toFixed(2),
      Number(e.handling_charges || 0).toFixed(2),
      Number(e.discount_amount || 0).toFixed(2),
      e.payment_mode || '',
      e.source_supplier || '',
      Number(e.total_amount || 0).toFixed(2),
      e.notes || '',
    ]);

    const rows: any[][] = [
      ...reportHeaderRows({
        firm: firmName,
        reportTitle: 'LEDGER REPORT (Sales & Purchases)',
        totalRecords: entries.length,
        extra: [
          ['Total Sales', fmtRupee(sales)],
          ['Total Purchases', fmtRupee(purchases)],
        ],
      }),
      ['Date', 'Type', 'Party Name', 'Invoice/Bill No', 'Site', 'Items (name x qty @ rate)', 'Item Total (Rs.)', 'Vehicle', 'Vehicle Rent (Rs.)', 'Handling (Rs.)', 'Discount (Rs.)', 'Payment Mode', 'Source Supplier', 'Grand Total (Rs.)', 'Notes'],
      ...dataRows,
      [],
      ['', '', '', '', '', 'TOTAL', '', '', '', '', '', '', '', entries.reduce((s, e) => s + (Number(e.total_amount) || 0), 0).toFixed(2), ''],
    ];
    const filename = `Ledger_${firmName.replace(/\s/g, '_')}_${Date.now()}.csv`;
    await exportService.shareOrDownload(buildCsv(rows), filename, 'text/csv');
  },

  // ── Ledger → PDF ────────────────────────────────────────────────────────────
  async ledgerToPdf(entries: any[], profile: any) {
    const jsPDF  = await getPDFWithAutoTable();
    const doc    = new jsPDF({ orientation: 'landscape' });
    const firm   = profile?.firm_name || 'Business';
    pageHeader(doc, 'Ledger Report', firm, `${entries.length} entries`);

    (doc as any).autoTable({
      startY: 26,
      head  : [['Date', 'Type', 'Party', 'Invoice', 'Items', 'Item Total', 'Rent', 'Grand Total']],
      body  : entries.map(e => [
        fmtDate(e.date),
        e.type === 'sell' ? 'Sale' : 'Purchase',
        e.party_name || '-',
        e.invoice_no || e.bill_no || '-',
        (e.items || []).map((i: any) => `${i.item_name} ×${i.quantity}`).join(', ') || '-',
        fmtRupee(Number(e.total_amount || 0) - Number(e.vehicle_rent || 0)),
        e.vehicle_rent ? fmtRupee(e.vehicle_rent) : '-',
        fmtRupee(e.total_amount || 0),
      ]),
      headStyles         : { fillColor: DARK_HEADER, fontStyle: 'bold', fontSize: 9, halign: 'left' },
      alternateRowStyles : { fillColor: ALT_ROW },
      bodyStyles         : { fontSize: 9, halign: 'left' },
      styles             : { cellPadding: 3 },
      columnStyles       : { 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right', fontStyle: 'bold' } },
    });

    const b64 = doc.output('datauristring').split(',')[1];
    await exportService.saveBase64File(b64, `Ledger_${firm.replace(/\s/g,'_')}_${Date.now()}.pdf`);
  },

  // ── Transactions → CSV ────────────────────────────────────────────────────
  async transactionsToCsv(transactions: any[], firmName = 'Shop') {
    const received = transactions.filter(t => t.type === 'received')
                                 .reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const paid     = transactions.filter(t => t.type === 'paid')
                                 .reduce((s, t) => s + (Number(t.amount) || 0), 0);

    const dataRows = transactions.map(t => [
      fmtDate(t.date),
      t.type === 'received' ? 'Received' : 'Paid',
      t.party_name || '',
      Number(t.amount || 0).toFixed(2),
      t.payment_mode || 'Cash',
      t.payment_purpose || '',
      t.bill_no || t.transaction_id || '',
      t.notes || '',
    ]);

    const rows: any[][] = [
      ...reportHeaderRows({
        firm: firmName,
        reportTitle: 'PAYMENTS REPORT (Money Received & Paid)',
        totalRecords: transactions.length,
        extra: [
          ['Total Money Received', fmtRupee(received)],
          ['Total Money Paid',     fmtRupee(paid)],
          ['Net Cash Flow',        fmtRupee(received - paid)],
        ],
      }),
      ['Date', 'Type', 'Party Name', 'Amount (Rs.)', 'Payment Mode', 'Purpose', 'Reference No', 'Notes'],
      ...dataRows,
      [],
      ['', '', 'TOTAL', (received + paid).toFixed(2), '', '', '', ''],
    ];
    await exportService.shareOrDownload(buildCsv(rows), `Payments_${firmName.replace(/\s/g,'_')}_${Date.now()}.csv`, 'text/csv');
  },

  // ── Expenses → CSV ────────────────────────────────────────────────────────
  async expensesToCsv(expenses: any[], firmName = 'Shop') {
    const total = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

    const dataRows = expenses.map(e => [
      fmtDate(e.date),
      e.category || 'Other',
      Number(e.amount || 0).toFixed(2),
      e.notes || '',
    ]);

    const rows: any[][] = [
      ...reportHeaderRows({
        firm: firmName,
        reportTitle: 'EXPENSES REPORT',
        totalRecords: expenses.length,
        extra: [['Total Expenses', fmtRupee(total)]],
      }),
      ['Date', 'Category', 'Amount (Rs.)', 'Notes'],
      ...dataRows,
      [],
      ['', 'TOTAL', total.toFixed(2), ''],
    ];
    await exportService.shareOrDownload(buildCsv(rows), `Expenses_${firmName.replace(/\s/g,'_')}_${Date.now()}.csv`, 'text/csv');
  },

  // ── Inventory → CSV ──────────────────────────────────────────────────────
  async inventoryToCsv(items: any[], firmName = 'Shop') {
    const lowStock = items.filter(i => (Number(i.current_stock) || 0) <= (Number(i.min_stock) || 0)).length;
    const stockValue = items.reduce((s, i) => s + (Number(i.current_stock || 0) * Number(i.purchase_rate || 0)), 0);

    const dataRows = items.map(i => [
      i.name,
      i.unit || '',
      Number(i.sale_rate || 0).toFixed(2),
      Number(i.purchase_rate || 0).toFixed(2),
      i.current_stock || 0,
      i.min_stock || 0,
      ((Number(i.current_stock) || 0) <= (Number(i.min_stock) || 0)) ? 'LOW' : 'OK',
      i.hsn_code || '',
      i.gst_percent || 0,
      i.category || '',
      i.primary_supplier || '',
    ]);

    const rows: any[][] = [
      ...reportHeaderRows({
        firm: firmName,
        reportTitle: 'INVENTORY / STOCK REPORT',
        totalRecords: items.length,
        extra: [
          ['Total Stock Value (at cost)', fmtRupee(stockValue)],
          ['Items Low / Out of Stock', String(lowStock)],
        ],
      }),
      ['Item Name', 'Unit', 'Sale Rate (Rs.)', 'Purchase Rate (Rs.)', 'Current Stock', 'Min Stock', 'Stock Status', 'HSN Code', 'GST %', 'Category', 'Supplier'],
      ...dataRows,
    ];
    await exportService.shareOrDownload(buildCsv(rows), `Inventory_${firmName.replace(/\s/g,'_')}_${Date.now()}.csv`, 'text/csv');
  },

  // ── Full Report → PDF ────────────────────────────────────────────────────
  async fullReportToPdf(data: {
    ledger      : any[];
    transactions: any[];
    expenses    : any[];
    inventory   : any[];
    profile     : any;
    dateRange?  : { start: string; end: string };
  }) {
    const jsPDF  = await getPDFWithAutoTable();
    const doc    = new jsPDF();
    const firm   = data.profile?.firm_name || 'Business';
    const period = data.dateRange ? `${data.dateRange.start} → ${data.dateRange.end}` : 'All time';

    // ── Page 1: Summary ────────────────────────────────────────────────────
    pageHeader(doc, 'Business Report', firm, period);

    const sales    = data.ledger.filter(l => l.type === 'sell')    .reduce((s,l) => s + (Number(l.total_amount)||0), 0);
    const purchase = data.ledger.filter(l => l.type === 'purchase').reduce((s,l) => s + (Number(l.total_amount)||0), 0);
    const expenses = data.expenses.reduce((s,e) => s + (Number(e.amount)||0), 0);
    const received = data.transactions.filter(t => t.type === 'received').reduce((s,t) => s + (Number(t.amount)||0), 0);
    const paid     = data.transactions.filter(t => t.type === 'paid')    .reduce((s,t) => s + (Number(t.amount)||0), 0);
    const profit   = sales - purchase - expenses;
    const margin   = sales > 0 ? ((profit / sales) * 100).toFixed(1) : '0.0';

    (doc as any).autoTable({
      startY         : 28,
      margin         : { left: 13, right: 13 },
      head           : [['Metric', 'Value', 'Metric', 'Value']],
      body           : [
        ['Total Sales',     fmtRupee(sales),    'Cash Received',  fmtRupee(received)],
        ['Total Purchases', fmtRupee(purchase), 'Cash Paid',      fmtRupee(paid)],
        ['Total Expenses',  fmtRupee(expenses), 'Net Cash Flow',  fmtRupee(received - paid)],
        ['Net Profit',      fmtRupee(profit),   'Profit Margin',  `${margin}%`],
        ['Ledger Entries',  `${data.ledger.length}`, 'Inventory Items', `${data.inventory.length}`],
      ],
      headStyles     : { fillColor: DARK_HEADER, fontSize: 10, fontStyle: 'bold', halign: 'left' },
      bodyStyles     : { fontSize: 10, halign: 'left' },
      columnStyles   : { 1: { fontStyle: 'bold', halign: 'right' }, 3: { fontStyle: 'bold', halign: 'right' } },
    });

    // ── Page 1 cont: Recent Ledger ─────────────────────────────────────────
    let y = (doc as any).lastAutoTable.finalY + 8;
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.text('Recent Ledger (top 20)', 13, y);

    (doc as any).autoTable({
      startY     : y + 2,
      margin     : { left: 13, right: 13 },
      head       : [['Date', 'Type', 'Party', 'Invoice', 'Total']],
      body       : data.ledger.slice().sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 20).map((l: any) => [
        fmtDate(l.date), l.type === 'sell' ? 'Sale' : 'Purchase',
        l.party_name || '-', l.invoice_no || l.bill_no || '-', fmtRupee(l.total_amount || 0),
      ]),
      headStyles         : { fillColor: DARK_HEADER, fontSize: 9, halign: 'left' },
      bodyStyles         : { fontSize: 9, halign: 'left' },
      alternateRowStyles : { fillColor: ALT_ROW },
      columnStyles       : { 4: { halign: 'right', fontStyle: 'bold' } },
    });

    // ── Page 2: Expenses by category ──────────────────────────────────────
    doc.addPage();
    pageHeader(doc, 'Expense Breakdown', firm, period);

    const expByCat: Record<string, number> = {};
    data.expenses.forEach(e => {
      const cat = e.category || 'Other';
      expByCat[cat] = (expByCat[cat] || 0) + (Number(e.amount) || 0);
    });

    (doc as any).autoTable({
      startY     : 28,
      margin     : { left: 13, right: 13 },
      head       : [['Category', 'Total', 'Count', '% of Total']],
      body       : Object.entries(expByCat)
        .sort(([, a], [, b]) => b - a)
        .map(([cat, amt]) => [
          cat, fmtRupee(amt),
          data.expenses.filter(e => (e.category || 'Other') === cat).length,
          expenses > 0 ? `${((amt / expenses) * 100).toFixed(1)}%` : '0%',
        ]),
      headStyles         : { fillColor: DARK_HEADER, fontSize: 10, halign: 'left' },
      bodyStyles         : { fontSize: 10, halign: 'left' },
      alternateRowStyles : { fillColor: ALT_ROW },
      columnStyles       : { 1: { halign: 'right' }, 2: { halign: 'center' }, 3: { halign: 'right' } },
    });

    // ── Page 2 cont: Low stock ─────────────────────────────────────────────
    const lowStock = data.inventory.filter(i => (Number(i.current_stock)||0) <= (Number(i.min_stock)||0));
    if (lowStock.length > 0) {
      y = (doc as any).lastAutoTable.finalY + 10;
      if (y > 240) { doc.addPage(); pageHeader(doc, 'Low Stock Items', firm, ''); y = 28; }
      doc.setFontSize(9); doc.setFont('helvetica', 'bold');
      doc.setTextColor(160, 28, 28);
      doc.text(`⚠ Low / Out of Stock Items (${lowStock.length})`, 13, y);
      doc.setTextColor(0, 0, 0);

      (doc as any).autoTable({
        startY     : y + 2,
        margin     : { left: 13, right: 13 },
        head       : [['Item', 'Unit', 'Current Stock', 'Min Stock', 'Purchase Rate']],
        body       : lowStock.map(i => [
          i.name, i.unit || '', i.current_stock || 0, i.min_stock || 0, fmtRupee(i.purchase_rate || 0),
        ]),
        headStyles         : { fillColor: RED_HEADER, fontSize: 9, halign: 'left' },
        bodyStyles         : { fontSize: 9, textColor: [140, 30, 30], halign: 'left' },
        alternateRowStyles : { fillColor: [255, 245, 245] },
      });
    }

    const b64 = doc.output('datauristring').split(',')[1];
    await exportService.saveBase64File(b64, `FullReport_${firm.replace(/\s/g,'_')}_${Date.now()}.pdf`);
  },
};







