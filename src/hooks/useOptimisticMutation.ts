import { useMutation, useQueryClient, QueryKey } from '@tanstack/react-query';
import { ApiService } from '../services/api';
import { SyncQueueService } from '../services/syncQueue';
import { haptic } from '../utils/haptics';

interface OptimisticMutationOptions<T> {
  userId: string;
  collection: string;
  queryKey: QueryKey;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

// Generic optimistic add mutation
export function useOptimisticAdd<T extends { id?: string }>({
  userId,
  collection,
  queryKey,
  onSuccess,
  onError
}: OptimisticMutationOptions<T>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (newItem: Omit<T, 'id'>) => {
      const payload = { ...newItem, created_at: new Date().toISOString() } as Record<string, any>;
      if (!navigator.onLine) {
        // Route through the durable sync queue so the entry survives reconnect.
        // Return a stable offline ID so the optimistic cache entry persists
        // through app restarts (no rollback — onError is never reached).
        const offlineId = `offline_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        SyncQueueService.addToQueue(userId, 'create', collection, payload);
        return { id: offlineId, ...payload } as unknown as T;
      }
      const docRef = await ApiService.add(userId, collection, payload);
      return { id: docRef.id, ...newItem } as unknown as T;
    },
    // Optimistic update
    onMutate: async (newItem) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey });

      // Snapshot previous value
      const previousData = queryClient.getQueryData<T[]>(queryKey);

      // Optimistically update with temp ID
      const tempId = `temp_${Date.now()}`;
      queryClient.setQueryData<T[]>(queryKey, (old = []) => [
        { id: tempId, ...newItem, created_at: new Date().toISOString() } as unknown as T,
        ...old
      ]);

      haptic.light();

      return { previousData, tempId };
    },
    // On error, rollback
    onError: (err, _newItem, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
      haptic.error();
      onError?.(err as Error);
    },
    // On success, replace temp with real ID
    onSuccess: (data, _variables, context) => {
      queryClient.setQueryData<T[]>(queryKey, (old = []) =>
        old.map(item => (item.id === context?.tempId ? data : item))
      );
      haptic.success();
      onSuccess?.();
    },
    onSettled: () => {
      // Refetch to ensure sync
      queryClient.invalidateQueries({ queryKey });
    }
  });
}

// Generic optimistic update mutation
export function useOptimisticUpdate<T extends { id?: string }>({
  userId,
  collection,
  queryKey,
  onSuccess,
  onError
}: OptimisticMutationOptions<T>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: T) => {
      if (!id) throw new Error('ID required for update');
      if (!navigator.onLine) {
        SyncQueueService.addToQueue(userId, 'update', collection, data, id as string);
        return { id, ...data } as T;
      }
      await ApiService.update(userId, collection, id, data);
      return { id, ...data } as T;
    },
    onMutate: async (updatedItem) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<T[]>(queryKey);

      // Optimistically update the item
      queryClient.setQueryData<T[]>(queryKey, (old = []) =>
        old.map(item => (item.id === updatedItem.id ? updatedItem : item))
      );

      haptic.light();
      return { previousData };
    },
    onError: (err, _updatedItem, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
      haptic.error();
      onError?.(err as Error);
    },
    onSuccess: () => {
      haptic.success();
      onSuccess?.();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    }
  });
}

// Generic optimistic delete mutation
export function useOptimisticDelete<T extends { id?: string }>({
  userId,
  collection,
  queryKey,
  onSuccess,
  onError
}: OptimisticMutationOptions<T>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!navigator.onLine) {
        SyncQueueService.addToQueue(userId, 'delete', collection, {}, id);
        return id;
      }
      await ApiService.delete(userId, collection, id);
      return id;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<T[]>(queryKey);

      // Optimistically remove the item
      queryClient.setQueryData<T[]>(queryKey, (old = []) =>
        old.filter(item => item.id !== id)
      );

      haptic.light();
      return { previousData };
    },
    onError: (err, _id, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
      haptic.error();
      onError?.(err as Error);
    },
    onSuccess: () => {
      haptic.success();
      onSuccess?.();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    }
  });
}







