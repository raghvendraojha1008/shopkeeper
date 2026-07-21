import React, { createContext, useContext, ReactNode, useMemo, useEffect } from 'react';
import { QueryClient, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { ApiService } from '../services/api';
import { Party, InventoryItem, WasteEntry, ServiceItem } from '../types/models';
import { buildPartyMap, PartyMap } from '../utils/partyUtils';
import { indexedDBStorage } from '../services/queryPersistStorage';
import { useUI } from './UIContext';
import { parseDateSafe, compareByDateThenCreated } from '../utils/dateUtils';

// Per-collection stale windows (ms).
// High-churn data (ledger, transactions, waste) use a short window.
// Low-churn reference data (parties, inventory) can be cached longer.
const STALE = {
  SHORT:  1000 * 60 * 15,  // 15 min — transactions, ledger, waste
  MEDIUM: 1000 * 60 * 45,  // 45 min — inventory
  LONG:   1000 * 60 * 120, // 2 hr   — parties (rarely change)
} as const;

// Persist the cache for 7 days so a shopkeeper who's been offline for a few
// days still cold-starts with their full inventory/ledger/parties on screen.
// gcTime MUST be ≥ persister.maxAge or React Query will gc data before the
// persister gets to write it.
const CACHE_MAX_AGE = 1000 * 60 * 60 * 24 * 7; // 7 days

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE.SHORT,
      gcTime: CACHE_MAX_AGE,
      retry: 2,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true, // re-sync when network comes back
      // When offline, NEVER mark a query as failed just because the network is
      // down — keep serving the persisted IndexedDB data and let the React
      // Query 'online' listener auto-refetch when we're back up. Without this
      // an offline cold-start would put queries in error state immediately.
      networkMode: 'offlineFirst',
    },
    mutations: {
      networkMode: 'offlineFirst',
    },
  },
});

// IndexedDB-backed persister. Reads + writes the entire (dehydrated) query
// cache as a single JSON blob. With idb-keyval this is async and out-of-thread
// so it never blocks the UI.
const queryPersister = createAsyncStoragePersister({
  storage: indexedDBStorage,
  // Only persist real string payloads (the persister sometimes asks us to
  // store undefined for empty caches — skipping is harmless and faster).
  throttleTime: 0, // write immediately — ensures offline-created entries survive process death before the 1-second window
  key: 'rq-cache-v1',
});

interface DataContextType {
  useParties: (userId: string) => {
    data: Party[];
    isLoading: boolean;
    isFetching: boolean;
    refetch: () => void;
    setData: (updater: (old: Party[]) => Party[]) => void;
  };
  useInventory: (userId: string) => {
    data: InventoryItem[];
    isLoading: boolean;
    isFetching: boolean;
    refetch: () => void;
    setData: (updater: (old: InventoryItem[]) => InventoryItem[]) => void;
  };
  useLowStockItems: (userId: string) => {
    data: InventoryItem[];
    isLoading: boolean;
  };
  useTransactions: (userId: string) => {
    data: any[];
    isLoading: boolean;
    refetch: () => void;
    setData: (updater: (old: any[]) => any[]) => void;
  };
  useLedger: (userId: string) => {
    data: any[];
    isLoading: boolean;
    refetch: () => void;
    setData: (updater: (old: any[]) => any[]) => void;
  };
  useExpenses: (userId: string) => {
    data: any[];
    isLoading: boolean;
    refetch: () => void;
    setData: (updater: (old: any[]) => any[]) => void;
  };
  useWaste: (userId: string) => {
    data: WasteEntry[];
    isLoading: boolean;
    refetch: () => void;
    setData: (updater: (old: WasteEntry[]) => WasteEntry[]) => void;
  };
  useServices: (userId: string) => {
    data: ServiceItem[];
    isLoading: boolean;
    refetch: () => void;
    setData: (updater: (old: ServiceItem[]) => ServiceItem[]) => void;
  };
  useMiscCharges: (userId: string) => {
    data: any[];
    isLoading: boolean;
    refetch: () => void;
  };
  invalidateAll: (userId: string) => void;
}

const DataContext = createContext<DataContextType | null>(null);

// Hooks for cached data access
const usePartiesQuery = (userId: string) => {
  return useQuery({
    queryKey: ['parties', userId],
    queryFn: async () => {
      if (!userId) return [];
      const snap = await ApiService.getAll(userId, 'parties');
      return snap.docs.map(d => ({ id: d.id, ...d.data() })) as Party[];
    },
    enabled: !!userId,
    staleTime: STALE.LONG,
  });
};

const useInventoryQuery = (userId: string) => {
  return useQuery({
    queryKey: ['inventory', userId],
    queryFn: async () => {
      if (!userId) return [];
      const snap = await ApiService.getAll(userId, 'inventory');
      return snap.docs.map(d => ({ id: d.id, ...d.data() })) as InventoryItem[];
    },
    enabled: !!userId,
    staleTime: STALE.MEDIUM,
  });
};

// Descending comparator (newest first) with created_at tiebreaker for same-date records.
// This ensures the order records were entered is preserved when multiple records share the same date.
const descByDateThenCreated = (a: any, b: any) => compareByDateThenCreated(b, a);

const useTransactionsQuery = (userId: string) => {
  return useQuery({
    queryKey: ['transactions', userId],
    queryFn: async () => {
      if (!userId) return [];
      const snap = await ApiService.getAll(userId, 'transactions');
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      data.sort(descByDateThenCreated);
      return data;
    },
    enabled: !!userId,
    staleTime: STALE.SHORT,
  });
};

const useLedgerQuery = (userId: string) => {
  return useQuery({
    queryKey: ['ledger', userId],
    queryFn: async () => {
      if (!userId) return [];
      const snap = await ApiService.getAll(userId, 'ledger_entries');
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      data.sort(descByDateThenCreated);
      return data;
    },
    enabled: !!userId,
    staleTime: STALE.SHORT,
  });
};

const useExpensesQuery = (userId: string) => {
  return useQuery({
    queryKey: ['expenses', userId],
    queryFn: async () => {
      if (!userId) return [];
      const snap = await ApiService.getAll(userId, 'expenses');
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      data.sort(descByDateThenCreated);
      return data;
    },
    enabled: !!userId,
    staleTime: STALE.SHORT,
  });
};

const useWasteQuery = (userId: string) => {
  return useQuery({
    queryKey: ['waste', userId],
    queryFn: async () => {
      if (!userId) return [];
      const snap = await ApiService.getAll(userId, 'waste_entries');
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as WasteEntry[];
      data.sort(descByDateThenCreated);
      return data;
    },
    enabled: !!userId,
    staleTime: STALE.SHORT,
  });
};

const useServicesQuery = (userId: string) => {
  return useQuery({
    queryKey: ['services', userId],
    queryFn: async () => {
      if (!userId) return [];
      const snap = await ApiService.getAll(userId, 'services');
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as ServiceItem[];
      data.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      return data;
    },
    enabled: !!userId,
    staleTime: STALE.MEDIUM,
  });
};

const useMiscChargesQuery = (userId: string) => {
  return useQuery({
    queryKey: ['misc_charges', userId],
    queryFn: async () => {
      if (!userId) return [];
      const snap = await ApiService.getAll(userId, 'misc_charges');
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      data.sort(descByDateThenCreated);
      return data;
    },
    enabled: !!userId,
    staleTime: STALE.SHORT,
  });
};

// FIX 4: Rules of Hooks — hooks cannot be called inside object method bodies.
// Pattern: expose stable hook functions via context; consumers call them at top level.
// The context now holds the hook functions themselves (references), not their results.
// Each consumer calls e.g. const { data } = useParties(uid) at the TOP of their component.

// Top-level custom hooks (safe — called at top of component, not inside object methods)
export const useParties = (userId: string) => {
  const { data, isLoading, isFetching, refetch } = usePartiesQuery(userId);
  return {
    data: data || [],
    isLoading,
    isFetching,
    refetch,
    // Optimistic local-cache mutator: lets callers update the parties cache
    // instantly (e.g. after add/edit/delete) without a network round-trip.
    // The next background refetch will reconcile with Firestore.
    setData: (updater: (old: Party[]) => Party[]) => {
      queryClient.setQueryData(['parties', userId], (old: Party[] = []) => updater(old));
    },
  };
};

/**
 * Returns a Map<partyId, Party> derived from the cached parties query.
 * Uses the same TanStack Query cache as useParties → zero extra Firestore reads.
 * Persisted to IndexedDB, so partyMap lookups work fully offline.
 * Use this to resolve party names in display layers instead of denormalized
 * party_name strings, so renames are reflected without cascade writes.
 */
export const usePartyMap = (userId: string): PartyMap => {
  const { data } = usePartiesQuery(userId);
  return useMemo(() => buildPartyMap(data || []), [data]);
};

export const useInventory = (userId: string) => {
  const { data, isLoading, isFetching, refetch } = useInventoryQuery(userId);
  return {
    data: data || [],
    isLoading,
    isFetching,
    refetch,
    setData: (updater: (old: InventoryItem[]) => InventoryItem[]) => {
      queryClient.setQueryData(['inventory', userId], (old: InventoryItem[] = []) => updater(old));
    },
  };
};

export const useLowStockItems = (userId: string) => {
  const { data, isLoading } = useInventoryQuery(userId);
  const lowStock = (data || []).filter(
    (item) => Number(item.current_stock) <= Number(item.min_stock || 0) && Number(item.min_stock) > 0
  );
  return { data: lowStock, isLoading };
};

export const useTransactions = (userId: string) => {
  const { data, isLoading, refetch } = useTransactionsQuery(userId);
  return {
    data: data || [],
    isLoading,
    refetch,
    setData: (updater: (old: any[]) => any[]) => {
      queryClient.setQueryData(['transactions', userId], (old: any[] = []) => updater(old));
    },
  };
};

export const useLedger = (userId: string) => {
  const { data, isLoading, refetch } = useLedgerQuery(userId);
  return {
    data: data || [],
    isLoading,
    refetch,
    setData: (updater: (old: any[]) => any[]) => {
      queryClient.setQueryData(['ledger', userId], (old: any[] = []) => updater(old));
    },
  };
};

export const useExpenses = (userId: string) => {
  const { data, isLoading, refetch } = useExpensesQuery(userId);
  return {
    data: data || [],
    isLoading,
    refetch,
    setData: (updater: (old: any[]) => any[]) => {
      queryClient.setQueryData(['expenses', userId], (old: any[] = []) => updater(old));
    },
  };
};

export const useWaste = (userId: string) => {
  const { data, isLoading, refetch } = useWasteQuery(userId);
  return {
    data: data || [],
    isLoading,
    refetch,
    setData: (updater: (old: WasteEntry[]) => WasteEntry[]) => {
      queryClient.setQueryData(['waste', userId], (old: WasteEntry[] = []) => updater(old));
    },
  };
};

export const useServices = (userId: string) => {
  const { data, isLoading, refetch } = useServicesQuery(userId);
  return {
    data: data || [],
    isLoading,
    refetch,
    setData: (updater: (old: ServiceItem[]) => ServiceItem[]) => {
      queryClient.setQueryData(['services', userId], (old: ServiceItem[] = []) => updater(old));
    },
  };
};

export const useMiscCharges = (userId: string) => {
  const { data, isLoading, refetch } = useMiscChargesQuery(userId);
  return {
    data: data || [],
    isLoading,
    refetch,
  };
};

export const invalidateAll = (userId: string) => {
  const collections = ['parties', 'inventory', 'ledger', 'transactions', 'expenses', 'waste', 'services'] as const;
  collections.forEach(col =>
    queryClient.invalidateQueries({ queryKey: [col, userId], exact: true }),
  );
};

// MODULE 4 — Bridge between React Query's QueryCache events and the UI
// toast system. When a background refetch fails on a query that ALREADY has
// cached data, we surface a calm "Using last saved data" toast instead of
// silently leaving the user staring at potentially stale rows. Hard failures
// on first-load (no cached data) are left alone — the empty/skeleton UI in
// the consuming view is a clearer signal than a toast in that case.
const DataErrorToastBridge: React.FC = () => {
  const { showToast } = useUI();
  useEffect(() => {
    let lastShownAt = 0;
    const COOLDOWN_MS = 30_000; // never spam — at most once every 30s
    const unsub = queryClient.getQueryCache().subscribe(event => {
      // We only care about the moment a query transitions into an error state.
      if (event.type !== 'updated') return;
      const q = event.query;
      if (q.state.status !== 'error') return;
      // Has cached data we can fall back on?
      const hasCachedData = Array.isArray(q.state.data)
        ? q.state.data.length > 0
        : q.state.data != null;
      if (!hasCachedData) return;
      const now = Date.now();
      if (now - lastShownAt < COOLDOWN_MS) return;
      lastShownAt = now;
      showToast('Using last saved data — check your connection', 'info');
    });
    return () => unsub();
  }, [showToast]);
  return null;
};

export const DataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Stable object reference — hooks are module-level functions so this never changes.
  // useMemo avoids re-creating the object on every DataProvider render.
  const value = useMemo<DataContextType>(() => ({
    useParties,
    useInventory,
    useLowStockItems,
    useTransactions,
    useLedger,
    useExpenses,
    useWaste,
    useServices,
    useMiscCharges,
    invalidateAll,
  }), []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: CACHE_MAX_AGE,
        // Bump this when you change a query's shape so old cached payloads
        // from the previous version are dropped on cold start instead of
        // being rehydrated into incompatible components.
        buster: 'shopkeeper-v1',
        dehydrateOptions: {
          // Don't persist failed/loading queries — only successful ones.
          // (Persisting an error state would replay it on cold start.)
          shouldDehydrateQuery: q => q.state.status === 'success',
        },
      }}
    >
      <DataContext.Provider value={value}>
        <DataErrorToastBridge />
        {children}
      </DataContext.Provider>
    </PersistQueryClientProvider>
  );
};

export const useData = () => {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData must be used within DataProvider');
  return context;
};

// Export query client for manual invalidation
export { queryClient };







