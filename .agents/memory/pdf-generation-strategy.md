---
name: PDF generation strategy
description: How PDF export works in this app; jsPDF is stubbed, native plugin crashes; purePdf is the working solution.
---

## Key Facts

**jsPDF is STUBBED**: `vite.config.ts` has an alias `jspdf → src/stubs/jspdf-stub.ts`. Any `import('jspdf')` or `import('jspdf-autotable')` is a no-op. Never use jsPDF anywhere.

**Native PdfGenerator plugin crashes**: The custom Capacitor plugin `PdfGenerator` (in `pdf-generator/`) causes GPU BAD ALLOC errors on the target Android device under memory pressure. Do NOT rely on it as the primary path.

## Working Solution: purePdf

`src/utils/purePdf.ts` — pure-JS PDF 1.4 binary generator.
- No dependencies, no native calls
- Uses standard Type1 fonts (Helvetica / Helvetica-Bold) — built into every PDF viewer, no embedding needed
- Exports: `buildPdf(title, sections) => Uint8Array` and `uint8ToBase64(bytes) => string`
- Section types: `text` (with word-wrap), `table` (header row + grid), `spacer`
- Auto page-break at bottom margin

## Fallback Chain in nativePdfService.generateAndShare()
1. Native PdfGenerator plugin (may crash)
2. Caller-provided blob (usually absent)
3. **purePdf** — writes real .pdf to Filesystem.Cache → shares via Share plugin ← THIS IS THE WORKING PATH
4. Last resort: plain .txt fallback

## Where it's used
- `src/services/nativePdfService.ts` — step 3 in fallback chain
- `src/services/exportServiceV2.ts` — `ledgerToPdf()` and `fullReportToPdf()` both use `buildPdf` directly
