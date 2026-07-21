---
name: parseDateSafe vs new Date for created_at
description: Why parseDateSafe must be used instead of new Date() for created_at fields in sort comparators.
---

## Rule
Always use `parseDateSafe(created_at)` in sort comparators. Never use `new Date(created_at)`.

**Why:** Firestore Timestamp objects serialize to `{seconds: number, nanoseconds: number}` plain objects after React Query's IndexedDB cache rehydration (via PersistQueryClientProvider). `new Date({seconds, nanoseconds})` returns `Invalid Date` (NaN), which breaks comparators and causes records to sort randomly. `parseDateSafe` handles this by checking for `.toDate()` (Firestore Timestamp), `{seconds}` plain object, ISO strings, and YYYY-MM-DD strings.

**How to apply:**
- In any `.sort((a,b) => ...)` that touches `a.created_at` or `b.created_at`, import `parseDateSafe` from `'../utils/dateUtils'` and use: `parseDateSafe(a.created_at).getTime()`.
- The two-level sort pattern: primary by `(a.date||'').slice(0,10)` string compare, tiebreaker by `parseDateSafe(a.created_at).getTime()`.
- Descending: `(b,a)` order. Ascending (PDF/statement): `(a,b)` order.

## Files fixed (same-date sort pass)
PartiesView, PartyDetailView, StaffDetailView, ServiceDetailView, ItemDetailView, VehicleDetailView, ExpensesView (onRestore), InventoryItemDetailView, statement.ts, exportServiceV2.ts, DataContext.tsx (all 5 main collection queries), useStaff.ts, pdfGenerator.ts.
