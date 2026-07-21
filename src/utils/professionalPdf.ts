/**
 * Professional Landscape A4 PDF utilities
 * ─────────────────────────────────────────
 * Shared across all export views. Produces documents that match the
 * dark-navy / light-blue corporate aesthetic from pdfGenerator.ts.
 *
 * Usage:
 *   const { doc, PW, PH, m, autoTable, addPageFooters } = await buildPdf();
 *   drawPdfHeader(doc, PW, { firm, title, subtitle });
 *   const afterHeader = drawSummaryBoxes(doc, 34, PW, m, boxes);
 *   autoTable(doc, { startY: afterHeader + 4, head, body, ... });
 *   addPageFooters(doc, firm);
 *   const blob = doc.output('blob');
 */

/** Navy blue used for all header bars and table headers */
export const PDF_NAV: [number, number, number] = [18, 24, 56];
/** Softer tint for alternating rows */
export const PDF_ALT: [number, number, number] = [247, 248, 255];
/** Warning / danger red */
export const PDF_RED: [number, number, number] = [160, 28, 28];
/** Accent green */
export const PDF_GRN: [number, number, number] = [5, 120, 80];

/** Standard landscape A4 margins */
export const PDF_M = 12;

export interface PdfBox { label: string; value: string; warn?: boolean }

export async function loadPdfLibs() {
  const { jsPDF } = await import('jspdf');
  const atMod = await import('jspdf-autotable');
  const autoTable = (atMod as any).default ?? atMod;
  if (typeof (jsPDF as any).prototype?.autoTable !== 'function') {
    if (typeof (atMod as any).applyPlugin === 'function') {
      (atMod as any).applyPlugin(jsPDF);
    }
  }
  return { jsPDF, autoTable };
}

export async function buildPdf(orientation: 'landscape' | 'portrait' = 'landscape') {
  const { jsPDF, autoTable } = await loadPdfLibs();
  const doc: any = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  return { doc, PW, PH, m: PDF_M, autoTable };
}

/**
 * Draws the full-width dark-navy page header.
 * Height: 30 mm. Returns 32 (next safe Y to draw below header).
 */
export function drawPdfHeader(
  doc: any,
  PW: number,
  opts: {
    firm: string;
    title: string;
    subtitle?: string;
    dateLabel?: string;
  }
): number {
  const H = 30;
  doc.setFillColor(...PDF_NAV);
  doc.rect(0, 0, PW, H, 'F');

  // Firm name — white bold
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14); doc.setFont('helvetica', 'bold');
  doc.text(opts.firm || 'Business', PDF_M, 12);

  // Report title — light blue below firm name
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.setTextColor(160, 185, 235);
  doc.text(opts.title, PDF_M, 21);

  // Subtitle (center) — optional
  if (opts.subtitle) {
    doc.setTextColor(190, 210, 245);
    doc.setFontSize(8);
    doc.text(opts.subtitle, PW / 2, 21, { align: 'center' });
  }

  // Date label (right) — generation date
  const dateStr = opts.dateLabel ?? new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
  doc.setTextColor(190, 210, 245);
  doc.setFontSize(8); doc.setFont('helvetica', 'italic');
  doc.text(dateStr, PW - PDF_M, 21, { align: 'right' });

  doc.setTextColor(0, 0, 0);
  return H + 4;
}

/**
 * Draws a row of rounded metric boxes between the header and the data table.
 * Each box: label (small gray) + value (bold). Returns finalY.
 */
export function drawSummaryBoxes(
  doc: any,
  startY: number,
  PW: number,
  m: number,
  boxes: PdfBox[]
): number {
  const count = boxes.length;
  const gap = 3;
  const totalGap = gap * (count - 1);
  const bw = (PW - m * 2 - totalGap) / count;
  const bh = 14;

  boxes.forEach((box, i) => {
    const x = m + i * (bw + gap);
    doc.setFillColor(box.warn ? 255 : 245, box.warn ? 240 : 248, box.warn ? 240 : 255);
    doc.setDrawColor(box.warn ? 200 : 220, box.warn ? 190 : 225, box.warn ? 190 : 240);
    doc.roundedRect(x, startY, bw, bh, 2, 2, 'FD');

    doc.setFontSize(6.5); doc.setFont('helvetica', 'bold');
    doc.setTextColor(box.warn ? 140 : 100, box.warn ? 40 : 100, box.warn ? 40 : 130);
    doc.text(box.label.toUpperCase(), x + bw / 2, startY + 4.5, { align: 'center' });

    doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.setTextColor(box.warn ? 160 : 20, box.warn ? 28 : 28, box.warn ? 28 : 58);
    doc.text(box.value, x + bw / 2, startY + 10.5, { align: 'center' });
  });

  doc.setTextColor(0, 0, 0);
  return startY + bh + 4;
}

/**
 * Standard table styles — navy header, alternating rows, bold amounts.
 */
export function tableStyles(amountCols: number[] = []): any {
  const columnStyles: Record<number, any> = {};
  amountCols.forEach(c => { columnStyles[c] = { halign: 'right', fontStyle: 'bold' }; });
  return {
    headStyles: { fillColor: PDF_NAV, textColor: 255, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 8, halign: 'left' },
    alternateRowStyles: { fillColor: PDF_ALT },
    styles: { cellPadding: 2.5, overflow: 'linebreak' },
    columnStyles,
  };
}

/**
 * Adds page number footer on every page of the doc.
 * Must be called AFTER all content is written.
 */
export function addPageFooters(doc: any, firmName: string) {
  const total = doc.internal.getNumberOfPages();
  const PW    = doc.internal.pageSize.getWidth();
  const PH    = doc.internal.pageSize.getHeight();
  const generated = new Date().toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });

  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    doc.setTextColor(150, 150, 170);
    doc.setDrawColor(200, 200, 220);
    doc.line(PDF_M, PH - 10, PW - PDF_M, PH - 10);
    doc.text(`${firmName} | Generated: ${generated}`, PDF_M, PH - 5.5);
    doc.text(`Page ${p} / ${total}`, PW - PDF_M, PH - 5.5, { align: 'right' });
  }
  doc.setTextColor(0, 0, 0);
}

/** Format a rupee amount for PDF (e.g. "₹1,23,456") */
export function pdfRupee(n: number | string | undefined): string {
  const v = Math.round(Number(n ?? 0));
  return '₹' + Math.abs(v).toLocaleString('en-IN');
}
