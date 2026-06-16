/**
 * purePdf — Pure-JavaScript PDF 1.4 binary generator
 *
 * No third-party dependencies. Generates a valid .pdf file from structured
 * content sections. Uses standard Type1 fonts (Helvetica / Helvetica-Bold)
 * which are built into every PDF viewer — no font embedding required.
 *
 * Output: Uint8Array (raw PDF bytes), which can be base64-encoded and written
 * to disk via Capacitor Filesystem, then shared with Share plugin.
 */

export interface PdfSection {
  type: 'text' | 'table' | 'spacer';
  content?: string;   // for type='text'
  bold?: boolean;     // for type='text'
  fontSize?: number;  // for type='text', default 10
  rows?: string[][];  // for type='table' (first row = header)
  height?: number;    // for type='spacer' (points)
}

// A4 page dimensions (points, 1pt = 1/72 inch)
const PW = 595;
const PH = 842;
const ML = 40;   // left margin
const MT = 40;   // top margin
const CW = PW - ML - ML;  // content width = 515pt

// ── Text-width estimation (Helvetica approximate metrics) ────────────────────
const NARROW = new Set([...'iI1l|!.,;: ']);
const WIDE   = new Set([...'mwWM']);
function charW(c: string, sz: number): number {
  if (NARROW.has(c)) return sz * 0.30;
  if (WIDE.has(c))   return sz * 0.68;
  return sz * 0.55;
}
function strW(s: string, sz: number): number {
  let w = 0; for (const c of s) w += charW(c, sz); return w;
}

// ── PDF string escaping (ASCII-safe, non-ASCII → '?') ───────────────────────
function pdfEsc(s: string): string {
  let out = '';
  for (const c of s) {
    const cp = c.charCodeAt(0);
    if (cp >= 32 && cp <= 126) {
      if      (c === '\\') out += '\\\\';
      else if (c === '(')  out += '\\(';
      else if (c === ')')  out += '\\)';
      else                 out += c;
    } else {
      out += '?';
    }
  }
  return out;
}

// ── Truncate string to fit maxW with '…' suffix ─────────────────────────────
function trunc(s: string, maxW: number, sz: number): string {
  if (strW(s, sz) <= maxW) return s;
  const sfx = '...';
  const sw = strW(sfx, sz);
  let r = '';
  for (const c of s) {
    if (strW(r + c, sz) + sw > maxW) break;
    r += c;
  }
  return r + sfx;
}

// ── Word-wrap text into lines that fit within maxW ───────────────────────────
function wrap(text: string, maxW: number, sz: number): string[] {
  if (!text.trim()) return [''];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (strW(test, sz) <= maxW) { cur = test; }
    else {
      if (cur) lines.push(cur);
      cur = strW(w, sz) > maxW ? trunc(w, maxW, sz) : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

// ── PDF generator ────────────────────────────────────────────────────────────
class Gen {
  private pages: string[] = [];   // finished page content streams
  private ops: string[] = [];     // current page ops
  private y = PH - MT;            // current Y (PDF coords: origin at bottom-left)

  private flush() {
    this.pages.push(this.ops.join('\n'));
    this.ops = [];
    this.y = PH - MT;
  }

  private need(h: number) {
    if (this.y - h < MT + 15) this.flush();
  }

  text(content: string, sz: number, bold: boolean) {
    const lh = sz * 1.38;
    const font = bold ? 'F2' : 'F1';
    for (const line of wrap(content, CW, sz)) {
      this.need(lh);
      this.y -= sz;
      // Tm requires 6 args: a b c d e f — identity matrix + translation
      this.ops.push(`BT /${font} ${sz} Tf 1 0 0 1 ${ML} ${this.y.toFixed(1)} Tm (${pdfEsc(line)}) Tj ET`);
      this.y -= (lh - sz);
    }
  }

  spacer(h: number) { this.y -= h; }

  table(rows: string[][]) {
    if (!rows?.length) return;
    const ncols = rows[0].length || 1;
    const colW  = CW / ncols;
    const rh    = 14;
    const fsz   = 8;
    const padX  = 3;

    for (let ri = 0; ri < rows.length; ri++) {
      this.need(rh + 2);
      const row    = rows[ri];
      const isHdr  = ri === 0;
      const top    = this.y;
      const bot    = top - rh;

      // Header background
      if (isHdr) {
        this.ops.push(`0.12 0.14 0.32 rg ${ML} ${bot.toFixed(1)} ${CW} ${rh} re f`);
        this.ops.push('0 0 0 rg');
      }

      // Top border of row
      this.ops.push(`0.35 w 0.55 0.55 0.55 RG ${ML} ${top.toFixed(1)} m ${(ML + CW).toFixed(1)} ${top.toFixed(1)} l S`);

      // Cells
      for (let ci = 0; ci < ncols; ci++) {
        const cx   = ML + ci * colW;
        const tx   = cx + padX;
        const ty   = bot + (rh - fsz) * 0.45;
        const cell = trunc(String(row[ci] ?? ''), colW - padX * 2, fsz);
        const fc   = isHdr ? '0.92 0.93 1 rg' : '0.05 0.05 0.05 rg';
        const font = isHdr ? 'F2' : 'F1';
        // Tm requires 6 args: a b c d e f — identity matrix + translation
        this.ops.push(`${fc} BT /${font} ${fsz} Tf 1 0 0 1 ${tx.toFixed(1)} ${ty.toFixed(1)} Tm (${pdfEsc(cell)}) Tj ET`);
        // Vertical separator
        if (ci > 0) {
          this.ops.push(`0.3 w 0.65 0.65 0.65 RG ${cx.toFixed(1)} ${bot.toFixed(1)} m ${cx.toFixed(1)} ${top.toFixed(1)} l S`);
        }
      }

      this.y = bot;
    }
    // Bottom border
    this.ops.push(`0.35 w 0.55 0.55 0.55 RG ${ML} ${this.y.toFixed(1)} m ${(ML + CW).toFixed(1)} ${this.y.toFixed(1)} l S`);
    this.ops.push('0 0 0 rg 0 0 0 RG');  // reset colors
    this.y -= 4;
  }

  build(title: string, sections: PdfSection[]): Uint8Array {
    // Title + underline
    this.text(title, 14, true);
    this.spacer(2);
    // Horizontal rule under title
    this.ops.push(`0.5 w 0.4 0.4 0.4 RG ${ML} ${this.y.toFixed(1)} m ${(ML + CW).toFixed(1)} ${this.y.toFixed(1)} l S`);
    this.spacer(6);

    for (const sec of sections) {
      if (sec.type === 'text') {
        const content = sec.content ?? '';
        if (!content.trim()) this.spacer(5);
        else this.text(content, sec.fontSize ?? 10, sec.bold ?? false);
      } else if (sec.type === 'table' && sec.rows?.length) {
        this.table(sec.rows);
        this.spacer(4);
      } else if (sec.type === 'spacer') {
        this.spacer(sec.height ?? 10);
      }
    }

    // Commit last page
    if (this.ops.length > 0) this.flush();
    if (!this.pages.length) this.flush(); // ensure at least 1 page

    // ── Assemble PDF objects ─────────────────────────────────────────────────
    // Fixed IDs:
    //   1 = Catalog
    //   2 = Pages
    //   3 = Font F1 (Helvetica)
    //   4 = Font F2 (Helvetica-Bold)
    //   5,6 = content stream + page for page 1
    //   7,8 = content stream + page for page 2
    //   ...
    const N       = this.pages.length;
    const pageIds = Array.from({ length: N }, (_, i) => 5 + i * 2 + 1);  // 6,8,10,...
    const ctIds   = Array.from({ length: N }, (_, i) => 5 + i * 2);      // 5,7,9,...

    const xrefMap: Record<number, number> = {};
    let pdf = '%PDF-1.4\n';

    function obj(id: number, body: string) {
      xrefMap[id] = pdf.length;
      pdf += `${id} 0 obj\n${body}\nendobj\n`;
    }
    function streamObj(id: number, stream: string) {
      xrefMap[id] = pdf.length;
      pdf += `${id} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`;
    }

    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${N} >>`);
    obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

    for (let i = 0; i < N; i++) {
      streamObj(ctIds[i], this.pages[i]);
      obj(pageIds[i],
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}]` +
        ` /Contents ${ctIds[i]} 0 R` +
        ` /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`
      );
    }

    // xref
    const maxId    = Math.max(...Object.keys(xrefMap).map(Number));
    const xrefStart = pdf.length;
    pdf += `xref\n0 ${maxId + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i <= maxId; i++) {
      if (xrefMap[i] !== undefined)
        pdf += `${String(xrefMap[i]).padStart(10, '0')} 00000 n \n`;
      else
        pdf += '0000000000 65535 f \n';
    }
    pdf += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\n`;
    pdf += `startxref\n${xrefStart}\n%%EOF\n`;

    return new TextEncoder().encode(pdf);
  }
}

/**
 * Build a PDF document.
 * @param title  Document title (shown as large header on first page)
 * @param sections  Array of content sections
 * @returns  Raw PDF bytes as Uint8Array
 */
export function buildPdf(title: string, sections: PdfSection[]): Uint8Array {
  return new Gen().build(title, sections);
}

/**
 * Convert Uint8Array to base64 string (for Capacitor Filesystem).
 */
export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
