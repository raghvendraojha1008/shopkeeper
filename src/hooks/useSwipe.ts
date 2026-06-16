import { useRef, TouchEvent } from 'react';

/**
 * Swipe gesture hook — uses refs (not state) for touch coordinates so a
 * fast-moving finger doesn't trigger 60–120 React re-renders per second on
 * the consuming component (a major source of jank on lower-end Android).
 */
export const useSwipe = (
  onSwipeLeft: () => void,
  onSwipeRight: () => void,
  minSwipeDistance = 50,
) => {
  const startX = useRef<number | null>(null);
  const endX   = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const endY   = useRef<number | null>(null);

  const onTouchStart = (e: TouchEvent) => {
    endX.current   = null;
    endY.current   = null;
    startX.current = e.targetTouches[0].clientX;
    startY.current = e.targetTouches[0].clientY;
  };

  const onTouchMove = (e: TouchEvent) => {
    endX.current = e.targetTouches[0].clientX;
    endY.current = e.targetTouches[0].clientY;
  };

  const onTouchEnd = () => {
    if (startX.current == null || endX.current == null ||
        startY.current == null || endY.current == null) return;

    const distanceX = startX.current - endX.current;
    const distanceY = startY.current - endY.current;

    // Only treat as horizontal swipe when X movement dominates Y (so vertical
    // scrolling isn't accidentally captured as a swipe).
    if (Math.abs(distanceX) > Math.abs(distanceY)) {
      if (distanceX >  minSwipeDistance) onSwipeLeft();
      if (distanceX < -minSwipeDistance) onSwipeRight();
    }
  };

  return { onTouchStart, onTouchMove, onTouchEnd };
};
