/**
 * lifecycleManager — Centralized app lifecycle event bus
 *
 * Provides a single pub/sub surface for foreground/background transitions so
 * new features (nav persistence, draft recovery, resume refresh) can subscribe
 * without adding more raw visibilitychange / appStateChange listeners to the DOM.
 *
 * Existing listeners in SubscriptionContext and LockScreen are unaffected — they
 * continue to fire independently.  This manager adds ONE additional pair of
 * listeners and re-broadcasts them to all subscribers.
 *
 * Modules: 1, 8, 10, 12, 15
 *
 * Usage:
 *   lifecycleManager.init();              // once at app boot (main.tsx)
 *   const unsub = lifecycleManager.onForeground(() => { ... });
 *   return unsub; // in useEffect cleanup
 */

import { Capacitor } from '@capacitor/core';
import { errorLogger } from '../utils/errorLogger';

type Handler = () => void;

// ── Internal state ────────────────────────────────────────────────────────────

const fgHandlers  = new Set<Handler>();
const bgHandlers  = new Set<Handler>();
let _active       = true;
let _bgAt         : number | null = null;
let _initialized  = false;
let _capHandle    : { remove(): Promise<void> } | null = null;
let _visHandler   : (() => void) | null = null;

function safeFire(handlers: Set<Handler>, label: string) {
  handlers.forEach(fn => {
    try { fn(); }
    catch (e) { errorLogger.log('render', e, { event: label }, 'lifecycleManager'); }
  });
}

function onGoForeground() {
  if (_active) return;          // already active — deduplicate
  _active = true;
  _bgAt   = null;
  safeFire(fgHandlers, 'foreground');
}

function onGoBackground() {
  if (!_active) return;         // already backgrounded — deduplicate
  _active = false;
  _bgAt   = Date.now();
  safeFire(bgHandlers, 'background');
}

// ── Public API ────────────────────────────────────────────────────────────────

export const lifecycleManager = {

  /** Whether the app is currently in the foreground */
  get isActive(): boolean { return _active; },

  /**
   * Milliseconds spent in background since last background event.
   * Returns 0 if the app is currently active.
   */
  get backgroundedMs(): number {
    return (!_active && _bgAt) ? Date.now() - _bgAt : 0;
  },

  /** Register a handler called when app returns to foreground. Returns cleanup fn. */
  onForeground(fn: Handler): () => void {
    fgHandlers.add(fn);
    return () => fgHandlers.delete(fn);
  },

  /** Register a handler called when app goes to background. Returns cleanup fn. */
  onBackground(fn: Handler): () => void {
    bgHandlers.add(fn);
    return () => bgHandlers.delete(fn);
  },

  /**
   * Initialize native listeners.
   * Safe to call multiple times — idempotent after first call.
   * Call once from main.tsx before ReactDOM.createRoot().
   */
  init(): void {
    if (_initialized) return;
    _initialized = true;

    // Web / PWA: document visibilitychange
    _visHandler = () => {
      if (document.visibilityState === 'visible') onGoForeground();
      else onGoBackground();
    };
    document.addEventListener('visibilitychange', _visHandler);

    // Native Capacitor (Android / iOS): appStateChange
    if (Capacitor.isNativePlatform()) {
      import('@capacitor/app')
        .then(({ App }) =>
          App.addListener('appStateChange', s => {
            s.isActive ? onGoForeground() : onGoBackground();
          })
          .then(h  => { _capHandle = h; })
          .catch(() => {}),
        )
        .catch(() => {});
    }
  },

  /** Tear down all listeners + handlers (useful for testing). */
  destroy(): void {
    if (_visHandler) {
      document.removeEventListener('visibilitychange', _visHandler);
      _visHandler = null;
    }
    _capHandle?.remove().catch(() => {});
    _capHandle  = null;
    fgHandlers.clear();
    bgHandlers.clear();
    _initialized = false;
    _active      = true;
    _bgAt        = null;
  },
};
