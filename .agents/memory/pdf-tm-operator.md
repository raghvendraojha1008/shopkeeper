---
name: PDF Tm operator syntax
description: The PDF Tm text-matrix operator requires exactly 6 arguments; passing 2 silently discards ALL text while path ops still draw.
---

## The Rule
`Tm` in PDF content streams sets the text matrix using **6 arguments**: `a b c d e f Tm`.
For simple translation (no rotation, no scaling), the correct form is:
```
1 0 0 1 tx ty Tm
```
where `(tx, ty)` is the desired position in page units.

Using only `tx ty Tm` (2 args) is **invalid**. PDF renderers (Acrobat, Android PdfRenderer, iOS CGPDFDocument) silently drop the malformed operator and render NO text at all. Path operators (`m l S`, `re f`) are unaffected — so table borders still draw, giving the visual of a "blank table skeleton with no text".

## Concrete case in purePdf.ts
`src/utils/purePdf.ts` initially generated:
```
BT /F1 12 Tf 40 800 Tm (Hello) Tj ET
```
This rendered a blank PDF with visible table borders only.

Fixed to:
```
BT /F1 12 Tf 1 0 0 1 40 800 Tm (Hello) Tj ET
```
Both the `text()` method and the `table()` cell-text method were affected.

**Why:** PDF spec ISO 32000, section 9.4.4 — Tm is not a positional shorthand; it always requires the full 6-element text-matrix.

**How to apply:** Any time you write a PDF content stream that positions text, always use `1 0 0 1 x y Tm`, or use `x y Td` (2-arg move relative to current text position, which starts at 0,0 after BT).
