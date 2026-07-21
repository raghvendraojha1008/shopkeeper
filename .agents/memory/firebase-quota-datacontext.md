---
name: Firebase quota — DataContext-first pattern
description: Pattern for eliminating redundant Firestore reads in view components by using cached DataContext hooks instead of direct ApiService.getAll() calls.
---

## Rule
Every collection in DataContext (parties, inventory, transactions, ledger_entries, expenses, waste_entries, services, misc_charges) must be accessed through its DataContext hook, never through direct ApiService.getAll() or getDocs() calls in view components.

**Why:** Each direct call fetches the entire collection from Firestore on every component mount, burning free-tier quota (50k reads/day). DataContext hooks use React Query with IndexedDB persistence (7-day gcTime, 15–120 min staleTime), so after the first fetch the data is served from cache with zero Firestore reads.

**How to apply:**
- Replace `ApiService.getAll(uid, 'collection_name')` useEffect patterns with `const { useXxx } = useData(); const { data, isLoading } = useXxx(uid)`.
- Filter/sort the cached data in `useMemo` instead of `useState` + `useEffect`.
- Use `.slice().sort(...)` — never mutate the context array directly.
- After mutations (add/update/delete via ApiService), call `refetch()` from the hook to invalidate the cache entry for that collection.

## Migrations done
- **ServiceDetailView** — removed loadData() fetching ledger_entries + parties + misc_charges. Now uses `useLedger` + `useMiscCharges` with useMemo filtering.
- **ItemDetailView** — removed loadData() fetching ledger_entries + parties. Now uses `useLedger` + `useParties` with useMemo filtering.
- **VehicleDetailView** — removed getDocs(query(ledger_entries, where vehicle==...)) useEffect. Now uses `useLedger` + useMemo filter by vehicle_number.
- **StaffDetailView** (linked payments) — removed ApiService.getAll('transactions') useEffect. Now uses `useData().useTransactions` aliased as `useAllTx` to avoid naming collision with local `useStaffTransactions` hook.
- **PartyDetailView** (misc_charges) — removed loadMiscCharges useCallback+useEffect. Now uses `useMiscCharges` with useMemo filter; mutation handlers call `refetchMiscCharges()`.

## Remaining direct callers (acceptable — less frequent)
- `StatementService` — targeted queries by party_name index, not collection-wide
- `ReportsView`, `AdvancedAnalyticsDashboard` — could be migrated but less urgent
