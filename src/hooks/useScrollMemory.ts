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
 *   An additional 120 ms retry covers async-data views where content height
 *   is shorter than the saved offset at the time of the first RAF.
 *
 * Save strategy:
 *   • A local `capturedScrollTop` variable (inside the useEffect closure) is
 *     updated on EVERY scroll event — no throttle delay, no DOM read on
 *     cleanup.  This solves the detached-element problem: reading
 *     `el.scrollTop` after React removes the element from the DOM returns 0
 *     in Chrome/WebView, silently wiping the saved position.
 *   • A throttled write to sessionStorage every 400 ms keeps the stored value
 *     fresh in case of a crash before unmount.
 *   • Final write on unmount uses the captured variable (not el.scrollTop).
 *
 * Key-change behaviour:
 *   When the key prop changes (e.g. BulkImport wizard steps) the
 *   useLayoutEffect saves the previous key's position via ref.current
 *   (element still attached at layout-effect time), then immediately restores
 *   the new key's saved position.
 */

import { useRef, useEffect, useLayoutEffect, MutableRefObject } from 'react';
import { saveScrollPosition, getScrollPosition } from '../utils/scrollMemory';

const THROTTLE_MS = 400;
const RETRY_DELAY = 120;

export function useScrollMemory(key: string): MutableRefObject<HTMLDivElement | null> {
  const ref           = useRef<HTMLDivElement | null>(null);
  const throttleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef        = useRef<number | null>(null);
  const retryRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevKey       = useRef(key);

  // ── Restore before first paint ────────────────────────────────────────────
  useLayoutEffect(() => {
    // When the key changes mid-lifecycle (e.g. wizard step), save the OLD
    // position while the element is still attached (layout-effect timing).
    if (prevKey.current !== key) {
      if (ref.current) saveScrollPosition(prevKey.current, ref.current.scrollTop);
      prevKey.current = key;
    }

    const saved = getScrollPosition(key);
    if (saved <= 0) return;

    const applyScroll = () => {
      if (ref.current) ref.current.scrollTop = saved;
    };

    applyScroll();

    rafRef.current = requestAnimationFrame(() => {
      applyScroll();
      rafRef.current = null;
    });

    retryRef.current = setTimeout(() => {
      applyScroll();
      retryRef.current = null;
    }, RETRY_DELAY);

    return () => {
      if (rafRef.current)   { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      if (retryRef.current) { clearTimeout(retryRef.current);       retryRef.current = null; }
    };
  }, [key]);

  // ── Live-save + final save on unmount ─────────────────────────────────────
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Track position in a closure variable updated on every scroll event.
    // CRITICAL: do NOT read el.scrollTop inside the cleanup — Chrome/WebView
    // returns 0 once the element is detached from the DOM, silently wiping
    // the saved value and breaking scroll restoration on remount.
    let capturedScrollTop = el.scrollTop;

    const onScroll = () => {
      capturedScrollTop = el.scrollTop; // always up-to-date, no DOM read at cleanup

      // Throttled write so sessionStorage stays current even before unmount
      if (throttleTimer.current) return;
      throttleTimer.current = setTimeout(() => {
        saveScrollPosition(key, capturedScrollTop);
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
      // Final save — use captured variable, NOT el.scrollTop (may be 0 if detached)
      saveScrollPosition(key, capturedScrollTop);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return ref;
}
