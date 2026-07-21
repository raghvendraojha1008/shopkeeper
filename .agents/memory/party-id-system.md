---
name: Party ID system
description: How the party rename problem is solved — records store party_id as stable join key, display/filter layers use partyMap lookup.
---

## The problem
Records stored `party_name` as their only join key. Renaming a party required cascade-writing every related record — expensive (300-write budget cap), quota-consuming, and fragile offline. Without the cascade, records "disappeared" from PartyDetailView/PartyStatementView after a rename.

## The solution
Records now store BOTH `party_id` (stable Firestore doc ID, never changes) AND `party_name` (kept for backward compat with legacy records that have no party_id).

Display and filter layers derive the current name from a `PartyMap` (Map<partyId, Party>) that is built from the TanStack Query parties cache — which is persisted to IndexedDB, so lookups work fully offline.

**Why:** ID-based join means the "rename" operation is a single write (the party doc). No cascade needed. Legacy records without party_id continue working via the name-fallback path everywhere.

## Files involved
- `src/utils/partyUtils.ts` — new foundation: `buildPartyMap`, `resolvePartyName`, `resolveParty`, `recordBelongsToParty`
- `src/context/DataContext.tsx` — exports `usePartyMap(uid)` hook (zero extra Firestore reads; same cache as `useParties`)
- `src/components/modals/ManualEntryModal.tsx` — stamps `party_id` in `handleChange` when party matched from list; clears stale `party_id` when name is typed manually; also stamps party_id on linked payment transactions
- `src/components/views/PartyDetailView.tsx` — filter uses `recordBelongsToParty(record, party)` (ID match → name fallback)
- `src/components/views/PartyStatementView.tsx` — same filter fix
- `src/components/views/PartiesView.tsx` — `partyAccounting` merges ID-indexed + name-indexed records (dedup by record.id) so balance cards survive renames
- `src/components/views/TransactionsView.tsx` — `TransactionRow` receives `resolvedPartyName` prop (resolved from partyMap in `renderTransactionRow`); `resolvePartyName` shows current name
- `src/components/views/LedgerView.tsx` — `partyMatch` tries `partyMap.get(item.party_id)` first, falls back to name search

## How to apply
- Any new view that filters by party → use `recordBelongsToParty(record, party)` instead of `record.party_name === party.name`
- Any new form that collects a party → stamp `party_id` from the matched party object (same pattern as ManualEntryModal handleChange)
- Any display of party name → use `resolvePartyName(record, partyMap)` not `record.party_name`
- `usePartyMap(uid)` is the correct hook for getting a Map<partyId, Party> in any component
