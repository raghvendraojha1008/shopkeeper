/**
 * BackStack — centralised overlay/modal back-navigation stack.
 *
 * Any component that creates a dismissible overlay (modal, dialog, bottom-sheet,
 * dropdown, filter-panel, etc.) should call BackStack.register() when it opens
 * and BackStack.unregister() when it closes.
 *
 * The Android back-button handler in App.tsx calls BackStack.dismissTop() first.
 * If something is dismissed, it returns `true` and the back handler stops — no tab
 * switch or app exit happens accidentally.
 *
 * Priority: higher number → dismissed before lower-priority handlers.
 * Default priority is 0.  ConfirmDialog uses 100 so it always wins.
 *
 * This is a plain module-level singleton — no React context, no re-renders.
 */

export interface BackHandler {
  id: string;
  dismiss: () => void;
  priority?: number;
}

const handlers = new Map<string, BackHandler>();

export const BackStack = {
  /**
   * Register (or update) a dismiss callback.
   * Calling register() with the same id replaces the previous entry.
   */
  register(id: string, dismiss: () => void, priority = 0): void {
    handlers.set(id, { id, dismiss, priority });
  },

  /**
   * Remove a handler.  Call this in cleanup effects and when an overlay closes.
   */
  unregister(id: string): void {
    handlers.delete(id);
  },

  /**
   * Dismiss the highest-priority registered handler.
   * Returns true if something was dismissed; false if the stack is empty.
   */
  dismissTop(): boolean {
    if (handlers.size === 0) return false;
    const top = [...handlers.values()].reduce((best, h) =>
      (h.priority ?? 0) > (best.priority ?? 0) ? h : best,
    );
    top.dismiss();
    return true;
  },

  /** True when at least one handler is active. */
  get hasHandlers(): boolean {
    return handlers.size > 0;
  },

  /** Number of active handlers (useful for debugging). */
  get size(): number {
    return handlers.size;
  },
};
