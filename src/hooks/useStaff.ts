/**
 * useStaff.ts
 *
 * TanStack Query hooks for Staff Management.
 * Follows the same pattern as DataContext query hooks — stale-while-revalidate,
 * IndexedDB-persisted, networkMode: 'offlineFirst'.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { StaffMember, StaffTransaction } from '../types/models';
import { StaffService, calculateBalance, getSalarySummary } from '../services/staffService';
import { parseDateSafe } from '../utils/dateUtils';

const STALE_STAFF     = 1000 * 60 * 10; // 10 min — staff master rarely changes
const STALE_STAFF_TX  = 1000 * 60 * 2;  // 2 min — transactions change frequently

/* ─── Staff list ───────────────────────────────────────────────────────────── */

export const useStaffList = (uid: string) => {
  return useQuery<StaffMember[]>({
    queryKey: ['staff', uid],
    queryFn: async () => {
      if (!uid) return [];
      const list = await StaffService.getAll(uid);
      StaffService.seedCounter(list);
      return list.sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: !!uid,
    staleTime: STALE_STAFF,
  });
};

/* ─── All staff transactions (cached; filtered per-staff in memory) ─────────── */

export const useAllStaffTransactions = (uid: string) => {
  return useQuery<StaffTransaction[]>({
    queryKey: ['staff_transactions', uid],
    queryFn: async () => {
      if (!uid) return [];
      const txs = await StaffService.getAllTransactions(uid);
      // Descending by date; same-date records ordered by created_at (entry order).
      return txs.sort((a, b) => {
        const dA = (a.date || '').slice(0, 10), dB = (b.date || '').slice(0, 10);
        if (dA !== dB) return dA < dB ? 1 : -1;
        const cA = a.created_at ? parseDateSafe(a.created_at).getTime() : 0;
        const cB = b.created_at ? parseDateSafe(b.created_at).getTime() : 0;
        return cB - cA; // descending created_at (most recently entered first within same day)
      });
    },
    enabled: !!uid,
    staleTime: STALE_STAFF_TX,
  });
};

/** Transactions for a single staff member (derived from the all-transactions cache). */
export const useStaffTransactions = (uid: string, staffId: string) => {
  const { data: all = [], isLoading, refetch } = useAllStaffTransactions(uid);
  const data = all.filter(t => t.staff_id === staffId && !t.deleted);
  return { data, isLoading, refetch };
};

/* ─── Mutations ────────────────────────────────────────────────────────────── */

export const useCreateStaff = (uid: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ data, createdBy }: { data: Omit<StaffMember, 'id' | 'staff_code'>; createdBy: string }) =>
      StaffService.create(uid, data, createdBy),
    onSuccess: (newStaff) => {
      qc.setQueryData<StaffMember[]>(['staff', uid], old =>
        [...(old || []), newStaff].sort((a, b) => a.name.localeCompare(b.name))
      );
    },
  });
};

export const useUpdateStaff = (uid: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ staffId, data, updatedBy }: { staffId: string; data: Partial<StaffMember>; updatedBy: string }) =>
      StaffService.update(uid, staffId, data, updatedBy),
    onSuccess: (_v, { staffId, data }) => {
      qc.setQueryData<StaffMember[]>(['staff', uid], old =>
        (old || []).map(s => s.id === staffId ? { ...s, ...data } : s)
      );
    },
  });
};

export const useDeactivateStaff = (uid: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (staffId: string) => StaffService.deactivate(uid, staffId),
    onSuccess: (_v, staffId) => {
      qc.setQueryData<StaffMember[]>(['staff', uid], old =>
        (old || []).map(s => s.id === staffId ? { ...s, status: 'inactive' } : s)
      );
    },
  });
};

export const useAddStaffTransaction = (uid: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tx, createdBy }: {
      tx: Omit<StaffTransaction, 'id' | 'created_at' | 'updated_at'>;
      createdBy: string;
    }) => StaffService.addTransaction(uid, tx, createdBy),
    onSuccess: (newTx) => {
      qc.setQueryData<StaffTransaction[]>(['staff_transactions', uid], old =>
        [newTx, ...(old || [])].sort((a, b) =>
          parseDateSafe(b.date).getTime() - parseDateSafe(a.date).getTime()
        )
      );
    },
  });
};

export const useUpdateStaffTransaction = (uid: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ txId, data }: { txId: string; data: Partial<StaffTransaction> }) =>
      StaffService.updateTransaction(uid, txId, data),
    onSuccess: (_v, { txId, data }) => {
      qc.setQueryData<StaffTransaction[]>(['staff_transactions', uid], old =>
        (old || []).map(t => t.id === txId ? { ...t, ...data } : t)
      );
    },
  });
};

export const useDeleteStaffTransaction = (uid: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (txId: string) => StaffService.deleteTransaction(uid, txId),
    onSuccess: (_v, txId) => {
      qc.setQueryData<StaffTransaction[]>(['staff_transactions', uid], old =>
        (old || []).map(t => t.id === txId ? { ...t, deleted: true } : t)
      );
    },
  });
};

/* ─── Re-export helpers so views import from one place ─────────────────────── */
export { calculateBalance, getSalarySummary };
