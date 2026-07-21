---
name: useMiscCharges hook shape
description: The standalone useMiscCharges hook returns an object, not an array — a common mistake.
---

## Rule
`useMiscCharges(userId)` (standalone export from `DataContext.tsx`) returns:
```ts
{ data: any[], isLoading: boolean, refetch: () => void }
```
NOT a plain array.

**Wrong:**
```ts
const miscChargesAll = useMiscCharges(user.uid);
miscChargesAll.forEach(...)   // TypeError at runtime
```

**Correct:**
```ts
const { data: miscChargesAll = [] } = useMiscCharges(user.uid);
miscChargesAll.forEach(...)   // works
```

**Why:** The hook wraps a TanStack Query result. The `data` property can technically be `undefined` on the first render before the query resolves, so always add `= []` as a default in the destructure.
