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
 * The hook:
 * • Throttles saves to once per 400 ms (no keystroke-per-frame writes)
 * • Restores scroll after an 80 ms delay so content has time to render
 * • Saves final position on unmount
 * • Handles key changes cleanly (saves old, restores new)
 *
 * Module 9
 */

import { useRef, useEffect, MutableRefObject } from 'react';
import { saveScrollPosition, getScrollPosition } from '../utils/scrollMemory';

const THROTTLE_MS = 400;
const RESTORE_DELAY_MS = 80;

export function useScrollMemory(key: string): MutableRefObject<HTMLDivElement | null> {
  const ref           = useRef<HTMLDivElement | null>(null);
  const throttleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevKey       = useRef(key);

  // Restore on mount (and on key change)
  useEffect(() => {
    // If key changed, save old position first
    if (prevKey.current !== key) {
      if (ref.current) saveScrollPosition(prevKey.current, ref.current.scrollTop);
      prevKey.current = key;
    }

    const saved = getScrollPosition(key);
    if (saved > 0) {
      restoreTimer.current = setTimeout(() => {
        if (ref.current) ref.current.scrollTop = saved;
      }, RESTORE_DELAY_MS);
    }

    return () => {
      if (restoreTimer.current) clearTimeout(restoreTimer.current);
    };
  }, [key]);

  // Throttled scroll save + final-position save on unmount
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
      // Cancel pending throttle
      if (throttleTimer.current) {
        clearTimeout(throttleTimer.current);
        throttleTimer.current = null;
      }
      // Persist final position on unmount
      if (ref.current) saveScrollPosition(key, ref.current.scrollTop);
    };
  // Key is stable for the lifetime of this effect — ref.current changes are fine
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return ref;
}
