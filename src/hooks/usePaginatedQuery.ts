import { useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiService } from '../services/api';
import { QueryConfig } from '../types/models';
import { orderBy, where } from 'firebase/firestore';

// Single source of truth for page size — `hasMore` derives from this so
// changing the value here can never silently break infinite scroll.
const PAGE_SIZE = 20;

interface PaginatedResult<T> {
  data: T[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
  error: Error | null;
}

export function usePaginatedQuery<T>(
  userId: string,
  collection: string,
  config: QueryConfig,
): PaginatedResult<T> {
  const [allData, setAllData]     = useState<T[]>([]);
  const [lastDoc, setLastDoc]     = useState<any>(null);
  const [hasMore, setHasMore]     = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // FIX: Build Firestore-level constraints that include date/search server-side.
  // The old implementation applied date and search filters in JavaScript on the
  // first 20 docs returned by Firestore, so any record beyond page 1 was silently
  // excluded.  Now date bounds are pushed into the Firestore query so pagination
  // returns the correct page of already-filtered results.
  //
  // Note: free-text search still happens client-side (Firestore doesn't support
  // full-text search natively).  For large datasets the caller should use a
  // dedicated search index or Algolia; this at least fixes the date filtering.
  const getConstraints = useCallback(() => {
    const constraints: any[] = [];

    if (config.sortField) {
      constraints.push(orderBy(config.sortField, config.sortDirection || 'desc'));
    }

    // Push date bounds into Firestore so results are filtered before pagination.
    if (config.dateFilter?.start) {
      constraints.push(where('date', '>=', config.dateFilter.start));
    }
    if (config.dateFilter?.end) {
      constraints.push(where('date', '<=', config.dateFilter.end));
    }

    // Push type filter into Firestore when possible.
    if (config.typeFilter) {
      constraints.push(where('type', '==', config.typeFilter));
    }

    return constraints;
  }, [
    config.sortField,
    config.sortDirection,
    config.dateFilter?.start,
    config.dateFilter?.end,
    config.typeFilter,
  ]);

  const { data: initialData, isLoading, error, refetch } = useQuery({
    queryKey: [
      collection,
      userId,
      config.sortField,
      config.sortDirection,
      config.dateFilter?.start,
      config.dateFilter?.end,
      config.typeFilter,
    ],
    queryFn: async () => {
      if (!userId) return [];
      const constraints = getConstraints();
      const snap = await ApiService.query(userId, collection, constraints, null);
      const docs = snap.docs.map((d: any) => ({ id: d.id, ...d.data() })) as T[];
      setLastDoc(snap.docs[snap.docs.length - 1] || null);
      setHasMore(snap.docs.length >= PAGE_SIZE);
      return docs;
    },
    enabled: !!userId,
    staleTime: 1000 * 60 * 2,
  });

  useEffect(() => {
    if (initialData) {
      setAllData(initialData);
    }
  }, [initialData]);

  const loadMore = useCallback(async () => {
    if (!userId || !hasMore || isLoadingMore || !lastDoc) return;

    setIsLoadingMore(true);
    try {
      const constraints = getConstraints();
      const snap = await ApiService.query(userId, collection, constraints, lastDoc);
      const newDocs = snap.docs.map((d: any) => ({ id: d.id, ...d.data() })) as T[];

      setAllData(prev => [...prev, ...newDocs]);
      setLastDoc(snap.docs[snap.docs.length - 1] || null);
      setHasMore(snap.docs.length >= PAGE_SIZE);
    } catch (e) {
      console.error('Load more error:', e);
    } finally {
      setIsLoadingMore(false);
    }
  }, [userId, collection, hasMore, isLoadingMore, lastDoc, getConstraints]);

  const refresh = useCallback(() => {
    setAllData([]);
    setLastDoc(null);
    setHasMore(true);
    refetch();
  }, [refetch]);

  // Client-side search (only free-text, not date/type which are now server-side).
  const filteredData = allData.filter((item: any) => {
    if (config.searchTerm) {
      const term = config.searchTerm.toLowerCase();
      const searchFields = ['party_name', 'name', 'invoice_no', 'category', 'vehicle_number'];
      const matches = searchFields.some(field =>
        item[field]?.toLowerCase?.()?.includes?.(term),
      );
      if (!matches) return false;
    }
    return true;
  });

  return {
    data: filteredData,
    loading: isLoading || isLoadingMore,
    hasMore,
    loadMore,
    refresh,
    error: error as Error | null,
  };
}

