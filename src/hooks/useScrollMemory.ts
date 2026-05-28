/**
 * useScrollMemory(key)
 *
 * Attach to any scrollable element to automatically save and restore
 * its scroll position when the screen is left and returned to.
 *
 * Usage:
 *   const scrollRef = useScrollMemory('inventory');
 *   return <div ref={scrollRef} className="flex-1 overflow-y-auto">...</div>;
 *
 * Restoration strategy — invisible by design:
 *   useLayoutEffect runs synchronously after DOM mutations but BEFORE the
 *   browser paints, so scrollTop is set to the saved value before the user
 *   ever sees the page rendered at position 0.  A requestAnimationFrame
 *   fallback re-applies the value on the next frame in case the layout was
 *   not fully resolved (e.g. images still loading heights).
 *
 * Module 9
 */

import { useRef, useEffect, useLayoutEffect, MutableRefObject } from 'react';
import { saveScrollPosition, getScrollPosition } from '../utils/scrollMemory';

const THROTTLE_MS = 400;

export function useScrollMemory(key: string): MutableRefObject<HTMLDivElement | null> {
  const ref           = useRef<HTMLDivElement | null>(null);
  const throttleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef        = useRef<number | null>(null);
  const prevKey       = useRef(key);

  // ── Restore before first paint ────────────────────────────────────────────
  // useLayoutEffect fires synchronously after the DOM is updated but before
  // the browser has had a chance to paint.  Setting scrollTop here means the
  // user never sees the page at position 0 — there is no visible jump.
  useLayoutEffect(() => {
    // Save position for the previous key if it changed
    if (prevKey.current !== key) {
      if (ref.current) saveScrollPosition(prevKey.current, ref.current.scrollTop);
      prevKey.current = key;
    }

    const saved = getScrollPosition(key);
    if (saved > 0 && ref.current) {
      ref.current.scrollTop = saved;

      // RAF fallback: re-apply on the next frame in case layout heights were
      // not yet finalised when useLayoutEffect ran (e.g. dynamic content).
      rafRef.current = requestAnimationFrame(() => {
        if (ref.current && ref.current.scrollTop !== saved) {
          ref.current.scrollTop = saved;
        }
        rafRef.current = null;
      });
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [key]);

  // ── Throttled live-save + final save on unmount ───────────────────────────
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onScroll = () => {
      if (throttleTimer.current) return;
      throttleTimer.current = setTimeout(() => {
        if (ref.current) saveScrollPosition(key, ref.current.scrollTop);
        throttleTimer.current = null;
      }, THROTTLE_MS);
    };

    el.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      el.removeEventListener('scroll', onScroll);
      if (throttleTimer.current) {
        clearTimeout(throttleTimer.current);
        throttleTimer.current = null;
      }
      // Persist final position on unmount
      if (ref.current) saveScrollPosition(key, ref.current.scrollTop);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return ref;
}
