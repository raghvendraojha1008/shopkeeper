---
name: Anonymous block let scope bug
description: let variables declared inside a bare { } block in an async function are not accessible outside the block at runtime, even if TypeScript compiles without error.
---

## The Rule
`let` and `const` are block-scoped. A bare `{ }` statement inside an `async` function body creates a new scope — variables declared inside are NOT accessible outside.

TypeScript may fail to flag this if there is no outer-scope variable with the same name to conflict with (no redeclaration error, just a missing-var that TypeScript's flow analysis doesn't catch as an error in all configurations).

At **runtime**, the browser/V8 DOES enforce block scoping and throws `ReferenceError: <var> is not defined`, which is then caught by an outer try-catch.

## Concrete case
`ManualEntryModal.tsx` — `inventoryAddedCount` and `inventoryUpdatedCount` were declared with `let` inside the anonymous write-path block at line 524. They were referenced after the block closed (for success toasts and cache refresh). This caused a `ReferenceError` on every sale/purchase save → caught by outer catch → "Save failed" toast even though the data was actually saved to Firestore.

**Fix:** Declare the variables in the outer try scope BEFORE the anonymous block.

**Why TypeScript didn't catch it:** No strict block-scope lint rule triggered because there was no name conflict; TypeScript only errors on redeclaration, not on "use before/outside block".
