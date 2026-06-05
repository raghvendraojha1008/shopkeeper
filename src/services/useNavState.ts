import { useState, useEffect, useRef, useCallback } from 'react';
import { NavStateCache } from './navStateCache';

/**
 * useNavState — drop-in replacement for useState that persists its value
 * in NavStateCache under `key`.
 *
 * When the component remounts after tab navigation the cached value is
 * restored, so the user sees the same search term / filter they left.
 *
 * Usage:
 *   const [search, setSearch] = useNavState('inventory_search', '');
 *   const [filter, setFilter] = useNavState('ledger_filter', 'all');
 */
export function useNavState<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setRaw] = useState<T>(() =>
    NavStateCache.get<T>(key, initialValue),
  );

  const set = useCallback(
    (value: T | ((prev: T) => T)) => {
      setRaw(prev => {
        const next =
          typeof value === 'function'
            ? (value as (prev: T) => T)(prev)
            : value;
        NavStateCache.save(key, next);
        return next;
      });
    },
    [key],
  );

  return [state, set];
}

/**
 * useScrollRestore — attaches to any scrollable container via a ref,
 * saves the scroll offset on every scroll event, and restores it on mount.
 *
 * Works with any element that has a `scrollTop` property.
 * For Virtuoso components use their own `initialTopMostItemIndex` prop instead.
 *
 * Usage:
 *   const listRef = useRef<HTMLDivElement>(null);
 *   useScrollRestore('transactions_scroll', listRef);
 *   return <div ref={listRef} className="overflow-y-auto flex-1"> ... </div>
 */
export function useScrollRestore(
  key: string,
  ref: React.RefObject<HTMLElement | null>,
): void {
  const restored = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (!restored.current) {
      restored.current = true;
      const saved = NavStateCache.getScroll(key);
      if (saved > 0) {
        // rAF ensures content has rendered before we scroll
        requestAnimationFrame(() => {
          if (el) el.scrollTop = saved;
        });
      }
    }

    const onScroll = () => NavStateCache.saveScroll(key, el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
