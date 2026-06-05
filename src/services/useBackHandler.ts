import { useEffect, useId } from 'react';
import { BackStack } from './backStack';

/**
 * useBackHandler — register a dismiss callback with the centralised BackStack.
 *
 * @param dismiss   Function called when Android back is pressed and this
 *                  handler is the topmost active one.
 * @param enabled   Register only while this is true (e.g. `isOpen`).
 *                  Automatically unregisters when it turns false or on unmount.
 * @param priority  Higher = dismissed before lower-priority handlers.
 *                  0 is the default; use 100 for critical dialogs.
 *
 * Usage (inside a modal component):
 *   useBackHandler(onClose, isOpen);
 */
export function useBackHandler(
  dismiss: () => void,
  enabled: boolean,
  priority = 0,
): void {
  const id = useId();

  useEffect(() => {
    if (!enabled) {
      BackStack.unregister(id);
      return;
    }
    BackStack.register(id, dismiss, priority);
    return () => BackStack.unregister(id);
    // dismiss may be a new function reference each render but priority and id
    // are stable — only re-register when enabled or priority changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, enabled, priority, dismiss]);
}
