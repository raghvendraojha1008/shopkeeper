import { useState, useEffect, useCallback, useRef } from 'react';
import { ApiService } from '../services/api';
import { getQueryConstraints } from '../utils/helpers';

export const usePaginatedData = (userId: string, col: string, config: any) => {
  const [data, setData] = useState<any[]>([]);
  const [last, setLast] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [idxErr, setIdxErr] = useState(false);

  // FIX: Keep a ref to the latest cursor so fetchMore doesn't need `last` in its
  // dependency array.  Including an object reference like `last` (a Firestore
  // DocumentSnapshot) in deps caused fetchMore to be recreated on every render
  // which, combined with the useEffect below, could trigger an infinite fetch loop.
  const lastRef = useRef<any>(null);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);

  const fetchMore = useCallback(async (isInit = false) => {
    if (!userId) return;
    if (!isInit && (!hasMoreRef.current || loadingRef.current)) return;

    loadingRef.current = true;
    setLoading(true);
    setIdxErr(false);

    try {
      const constraints = getQueryConstraints(config);
      const snap = await ApiService.query(
        userId,
        col,
        constraints,
        isInit ? null : lastRef.current,
      );

      const res = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      const newLast = snap.docs[snap.docs.length - 1] ?? null;
      const more = snap.docs.length === 20;

      setData(prev => (isInit ? res : [...prev, ...res]));
      setLast(newLast);
      setHasMore(more);
      lastRef.current = newLast;
      hasMoreRef.current = more;
    } catch (e: any) {
      if (e?.message?.toLowerCase().includes('index')) setIdxErr(true);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  // FIX: Only primitive / stable values in deps — col and userId are strings;
  // config fields are primitives extracted explicitly to avoid object-reference
  // churn.  `last` is intentionally excluded (accessed via ref).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, col, config.sortField, config.searchTerm, config.dateFilter?.start, config.dateFilter?.end]);

  useEffect(() => {
    lastRef.current = null;
    hasMoreRef.current = true;
    setData([]);
    setLast(null);
    setHasMore(true);
    setIdxErr(false);
    fetchMore(true);
  // fetchMore itself already encodes the config deps, so this is safe.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, col, config.sortField, config.searchTerm, config.dateFilter?.start, config.dateFilter?.end]);

  const loadMore = useCallback(() => fetchMore(false), [fetchMore]);
  const refresh  = useCallback(() => {
    lastRef.current = null;
    hasMoreRef.current = true;
    fetchMore(true);
  }, [fetchMore]);

  return { data, loading, hasMore, idxErr, loadMore, refresh, setData };
};

// Also export useDebounce here as it's a related utility hook
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  return debouncedValue;
}

