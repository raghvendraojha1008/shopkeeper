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
    const { buildPdf, uint8ToBase64 } = await import('../utils/purePdf');
    const firm  = profile?.firm_name || 'Business';
    const addr  = profile?.address   || '';
    const gstin = profile?.gstin     || '';
    const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const sales     = entries.filter(e => e.type === 'sell').reduce((s, e) => s + (Number(e.total_amount) || 0), 0);
    const purchases = entries.filter(e => e.type === 'purchase').reduce((s, e) => s + (Number(e.total_amount) || 0), 0);

    const sections: import('../utils/purePdf').PdfSection[] = [
      { type: 'text', content: addr,           fontSize: 9 },
      ...(gstin ? [{ type: 'text' as const, content: `GSTIN: ${gstin}`, fontSize: 9 }] : []),
      { type: 'text', content: `Generated: ${today}  |  Total entries: ${entries.length}`, fontSize: 9 },
      { type: 'spacer', height: 4 },
      { type: 'text', content: `Total Sales: ${fmtRupee(sales)}   |   Total Purchases: ${fmtRupee(purchases)}`, fontSize: 9, bold: true },
      { type: 'spacer', height: 6 },
      {
        type: 'table',
        rows: [
          ['Date', 'Type', 'Party', 'Invoice', 'Items', 'Grand Total'],
          ...entries.map(e => [
            fmtDate(e.date),
            e.type === 'sell' ? 'Sale' : 'Purchase',
            e.party_name || '-',
            e.invoice_no || e.bill_no || '-',
            (e.items || []).map((i: any) => `${i.item_name} x${i.quantity}`).join(', ') || '-',
            fmtRupee(e.total_amount || 0),
          ]),
        ],
      },
      { type: 'spacer', height: 6 },
      { type: 'text', content: `Net (Sales - Purchases): ${fmtRupee(sales - purchases)}`, fontSize: 10, bold: true },
    ];

    const bytes    = buildPdf(`${firm} — Ledger Report`, sections);
    const b64      = uint8ToBase64(bytes);
    const filename = `Ledger_${firm.replace(/\s/g, '_')}_${Date.now()}.pdf`;
    await exportService.saveBase64File(b64, filename);
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
    const { buildPdf, uint8ToBase64 } = await import('../utils/purePdf');
    const firm    = data.profile?.firm_name || 'Business';
    const period  = data.dateRange ? `${data.dateRange.start} to ${data.dateRange.end}` : 'All time';
    const today   = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    const sales    = data.ledger.filter(l => l.type === 'sell').reduce((s,l) => s + (Number(l.total_amount)||0), 0);
    const purchase = data.ledger.filter(l => l.type === 'purchase').reduce((s,l) => s + (Number(l.total_amount)||0), 0);
    const totalExp = data.expenses.reduce((s,e) => s + (Number(e.amount)||0), 0);
    const received = data.transactions.filter(t => t.type === 'received').reduce((s,t) => s + (Number(t.amount)||0), 0);
    const paid     = data.transactions.filter(t => t.type === 'paid').reduce((s,t) => s + (Number(t.amount)||0), 0);
    const profit   = sales - purchase - totalExp;
    const margin   = sales > 0 ? ((profit / sales) * 100).toFixed(1) : '0.0';

    // Expenses by category
    const expByCat: Record<string, number> = {};
    data.expenses.forEach(e => {
      const cat = e.category || 'Other';
      expByCat[cat] = (expByCat[cat] || 0) + (Number(e.amount) || 0);
    });

    // Low stock items
    const lowStock = data.inventory.filter(i => (Number(i.current_stock)||0) <= (Number(i.min_stock)||0));

    // Recent ledger (sorted newest first, top 30)
    const recentLedger = data.ledger
      .slice()
      .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 30);

    const sections: import('../utils/purePdf').PdfSection[] = [
      // Header info
      { type: 'text', content: firm,                              fontSize: 12, bold: true },
      { type: 'text', content: `Period: ${period}`,              fontSize: 9 },
      { type: 'text', content: `Generated: ${today}`,            fontSize: 9 },
      { type: 'spacer', height: 8 },

      // ── Summary metrics ──────────────────────────────────────────────────
      { type: 'text', content: 'BUSINESS SUMMARY',               fontSize: 11, bold: true },
      { type: 'spacer', height: 4 },
      {
        type: 'table',
        rows: [
          ['Metric', 'Value'],
          ['Total Sales',        fmtRupee(sales)],
          ['Total Purchases',    fmtRupee(purchase)],
          ['Total Expenses',     fmtRupee(totalExp)],
          ['Net Profit',         fmtRupee(profit)],
          ['Profit Margin',      `${margin}%`],
          ['Cash Received',      fmtRupee(received)],
          ['Cash Paid',          fmtRupee(paid)],
          ['Net Cash Flow',      fmtRupee(received - paid)],
          ['Ledger Entries',     String(data.ledger.length)],
          ['Inventory Items',    String(data.inventory.length)],
          ['Low / Out of Stock', String(lowStock.length)],
        ],
      },
      { type: 'spacer', height: 10 },

      // ── Recent ledger ────────────────────────────────────────────────────
      { type: 'text', content: `RECENT LEDGER (Latest ${recentLedger.length})`, fontSize: 11, bold: true },
      { type: 'spacer', height: 4 },
      {
        type: 'table',
        rows: [
          ['Date', 'Type', 'Party', 'Invoice', 'Total'],
          ...recentLedger.map((l: any) => [
            fmtDate(l.date),
            l.type === 'sell' ? 'Sale' : 'Purchase',
            l.party_name || '-',
            l.invoice_no || l.bill_no || '-',
            fmtRupee(l.total_amount || 0),
          ]),
        ],
      },
      { type: 'spacer', height: 10 },

      // ── Expenses by category ─────────────────────────────────────────────
      ...(data.expenses.length > 0 ? [
        { type: 'text' as const, content: 'EXPENSE BREAKDOWN BY CATEGORY', fontSize: 11, bold: true },
        { type: 'spacer' as const, height: 4 },
        {
          type: 'table' as const,
          rows: [
            ['Category', 'Total', 'Count', '% of Total'],
            ...Object.entries(expByCat)
              .sort(([, a], [, b]) => (b as number) - (a as number))
              .map(([cat, amt]) => [
                cat,
                fmtRupee(amt),
                String(data.expenses.filter(e => (e.category || 'Other') === cat).length),
                totalExp > 0 ? `${(((amt as number) / totalExp) * 100).toFixed(1)}%` : '0%',
              ]),
          ],
        },
        { type: 'spacer' as const, height: 10 },
      ] : []),

      // ── Low stock ────────────────────────────────────────────────────────
      ...(lowStock.length > 0 ? [
        { type: 'text' as const, content: `LOW / OUT OF STOCK ITEMS (${lowStock.length})`, fontSize: 11, bold: true },
        { type: 'spacer' as const, height: 4 },
        {
          type: 'table' as const,
          rows: [
            ['Item', 'Unit', 'Current Stock', 'Min Stock', 'Purchase Rate'],
            ...lowStock.map(i => [
              i.name, i.unit || '',
              String(i.current_stock || 0),
              String(i.min_stock || 0),
              fmtRupee(i.purchase_rate || 0),
            ]),
          ],
        },
      ] : []),
    ];

    const bytes    = buildPdf(`${firm} — Business Report`, sections);
    const b64      = uint8ToBase64(bytes);
    const filename = `FullReport_${firm.replace(/\s/g, '_')}_${Date.now()}.pdf`;
    await exportService.saveBase64File(b64, filename);
  },
};







