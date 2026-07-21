---
name: Bulk PDF blank page root cause
description: Why blank pages appeared between party ledger sections in the All Parties bulk PDF export.
---

## Rule
`drawPartyLedgerSection` in `pdfGenerator.ts` already calls `doc.addPage()` at its start for any `!isFirstSection`. The outer `handleBulkDownload` loop in `PartiesView.tsx` must NOT call `doc.addPage()` between parties.

## Why
The double page-break (one from `drawPartyLedgerSection` + one from the outer loop) inserted a blank page between every party's ledger section.

## How to apply
When adding page breaks to any PDF generation loop that delegates to a section-drawing function, check whether the function itself handles the break internally before adding one in the caller.
