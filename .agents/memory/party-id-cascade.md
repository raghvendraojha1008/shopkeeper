---
name: Party cascade party_id
description: How party_id is stamped on entries and used for reliable cascade when party name/fields are edited.
---

## Strategy
Party records use their Firestore document ID as the stable `party_id`. All related records (ledger_entries, transactions, misc_charges, recurring_templates) store `party_id` alongside `party_name`. On party edit, the cascade queries by BOTH `party_id` AND `party_name`, then stamps `party_id` on every updated record — making each subsequent cascade cheaper and more reliable.

## Where party_id is stamped on creation (ManualEntryModal)
For types `sales`, `purchases`, `transactions`: after payload normalization, before batchSave:
```typescript
const linked = safeParties.find(p => p.name?.toLowerCase() === payload.party_name?.toLowerCase());
if (linked?.id) payload.party_id = linked.id;
```
For auto-added parties (new party created alongside the entry): after batchSave returns, look up the auto-added party's batchResult, set `payload.party_id`, and fire a follow-up `ApiService.update` on the main entry (fire-and-forget).

## partySync.ts cascade logic
For `ledger_entries`, `transactions`, `recurring_templates`: run two concurrent getDocs (by party_name AND by party_id), merge with a Set-based dedup, then flush updates that include BOTH `party_name: newName` AND `party_id: partyId`.

For `misc_charges`: fetch-all + JS filter by `party_id === partyId || party_name === oldName` (no composite index available).

**Why:** Name-only cascade fails for records created under an old name if the name then changes — the old name is gone from the party doc. ID-based lookup is stable across renames. Legacy records without party_id are still found by name and get party_id stamped, so they join the ID path after the first cascade.

**How to apply:** Any new collection that denormalizes party data should store `party_id` and be added to `partySync.ts`.
