---
name: Nested scroll containers block touch scroll
description: Why a page appeared frozen on Android WebView when dragging inside a table, and the fix pattern.
---

If a view has its own `overflow-y-auto` root but is rendered inside an ancestor that is
*already* the app's single scroll owner (e.g. `<main className="overflow-y-auto">` in
`App.tsx`), you get two competing vertical scroll regions. On Android WebView this reliably
breaks touch scrolling for drags that start inside a nested `overflow-x-auto` (e.g. a wide
statement/ledger table) — the horizontal container doesn't hand the vertical gesture up to
the correct scroller.

**Why:** Capacitor/Android WebView touch-scroll chaining between nested scrollers with
orthogonal overflow axes is unreliable, especially with 3+ levels of nesting.

**How to apply:** When a screen is rendered as a child of an already-scrolling ancestor,
make the screen's root a plain block (no `h-full`/`overflow-y-auto`) and let the ancestor be
the only scroll owner. Keep `overflow-x-auto` only on the specific wide-content wrapper, and
add `WebkitOverflowScrolling: 'touch'` there for smoother native feel. Example fixed in
`src/components/views/PartyStatementView.tsx` (mounted inside `<main>` in `src/App.tsx`).
