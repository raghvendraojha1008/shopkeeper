/**
 * usePerformanceObserver — Lightweight long-task diagnostics
 *
 * Uses the W3C PerformanceObserver API to detect "long tasks" — JS blocks
 * that take >50 ms on the main thread and cause frame drops / jank.
 *
 * Behaviour:
 *  • Development-only: the observer is a no-op in production builds.
 *  • Logs a single console.warn per long task with duration + attribution.
 *  • Never throws — silently skips on browsers that don't support the API.
 *  • Call `initPerformanceObserver()` once at app startup (in main.tsx).
 *
 * The goal is visibility, not telemetry: there is no network call, no storage
 * write, and no React state. Pure side-effect diagnostic tool.
 */

const IS_DEV = import.meta.env.DEV;

// Threshold in ms above which we log a warning.
const LONG_TASK_THRESHOLD_MS = 50;

// Rate-limit consecutive warnings to avoid spamming the console when multiple
// long tasks occur in rapid succession (e.g., during hydration).
const LOG_COOLDOWN_MS = 2000;
let _lastLoggedAt = 0;

export function initPerformanceObserver(): void {
  if (!IS_DEV) return;
  if (typeof PerformanceObserver === 'undefined') return;

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < LONG_TASK_THRESHOLD_MS) continue;

        const now = Date.now();
        if (now - _lastLoggedAt < LOG_COOLDOWN_MS) continue;
        _lastLoggedAt = now;

        const attribution = (entry as any).attribution?.[0];
        const source = attribution?.name ?? 'unknown';
        const container = attribution?.containerType ?? '';

        console.warn(
          `[Perf] Long task detected: ${Math.round(entry.duration)}ms` +
          (source !== 'unknown' ? ` — ${source}` : '') +
          (container ? ` (${container})` : ''),
        );
      }
    });

    observer.observe({ type: 'longtask', buffered: true });
  } catch {
    // PerformanceObserver exists but 'longtask' is not supported — safe to ignore.
  }
}

/**
 * Lightweight utility for manually timing a synchronous block in dev builds.
 * Usage:
 *   const end = markPerfStart('MyComponent render');
 *   // ... expensive work ...
 *   end();  // logs if >50 ms
 */
export function markPerfStart(label: string): () => void {
  if (!IS_DEV) return () => {};
  const t0 = performance.now();
  return () => {
    const duration = performance.now() - t0;
    if (duration > LONG_TASK_THRESHOLD_MS) {
      console.warn(`[Perf] Slow block "${label}": ${Math.round(duration)}ms`);
    }
  };
}
