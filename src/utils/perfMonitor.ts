/**
 * perfMonitor — tiny in-process performance instrumentation.
 *
 * Goal (from FINAL MODULE spec):
 *   Billing      < 5000 ms
 *   Search       <   50 ms
 *   Screen load  <  200 ms
 *
 * Designed to be near-zero overhead so it can stay on in production:
 *   - Uses performance.now() (sub-millisecond, monotonic).
 *   - No network, no localStorage writes on the hot path.
 *   - Keeps the last N samples per label in a ring buffer for stats.
 *   - In dev, warns once per slow operation; in prod, stays silent
 *     (the samples are still available via getStats() for diagnostics).
 *
 * Usage:
 *
 *   const end = perfMonitor.start('pos.bill.save');
 *   await doTheWork();
 *   end();                                // records duration
 *
 *   perfMonitor.getStats('pos.bill.save'); // → { count, avgMs, p95Ms, maxMs }
 *
 * Thresholds are declared upfront in PERF_THRESHOLDS so call sites stay
 * uncluttered and so we have a single place to tune them.
 */

const RING_SIZE = 50;            // samples retained per label
const isDev = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV === true;

// Spec thresholds. Anything above these in dev triggers a one-time console
// warning so we can spot regressions while developing without spamming logs.
const PERF_THRESHOLDS: Record<string, number> = {
  'pos.bill.save'   : 5000,      // POS billing flow end-to-end
  'pos.item.search' :   50,      // item suggestion filter (in-memory)
  'sync.run'        : 30000,     // full queue drain (per attempt)
  'sync.item'       : 2000,      // single Firestore write inside the queue
};

interface Sample {
  ms        : number;
  at        : number;            // epoch ms
  overshot  : boolean;
}

const buffers = new Map<string, Sample[]>();
const warned  = new Set<string>();   // labels we've warned about this session

const push = (label: string, sample: Sample) => {
  let buf = buffers.get(label);
  if (!buf) { buf = []; buffers.set(label, buf); }
  buf.push(sample);
  if (buf.length > RING_SIZE) buf.shift();
};

const now = (): number => {
  // performance.now() is the right call, but guard for very old runtimes.
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
};

export interface PerfStats {
  label   : string;
  count   : number;
  avgMs   : number;
  p95Ms   : number;
  maxMs   : number;
  lastMs  : number;
  threshold: number | null;
  overshootCount: number;
}

const computeStats = (label: string): PerfStats | null => {
  const buf = buffers.get(label);
  if (!buf || buf.length === 0) return null;
  const sorted = buf.map(s => s.ms).slice().sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return {
    label,
    count          : buf.length,
    avgMs          : Math.round((sum / buf.length) * 100) / 100,
    p95Ms          : Math.round(sorted[p95Index] * 100) / 100,
    maxMs          : Math.round(sorted[sorted.length - 1] * 100) / 100,
    lastMs         : Math.round(buf[buf.length - 1].ms * 100) / 100,
    threshold      : PERF_THRESHOLDS[label] ?? null,
    overshootCount : buf.filter(s => s.overshot).length,
  };
};

export const perfMonitor = {
  /**
   * Start a measurement. Returns an end() function — call it when the
   * operation finishes. The pattern (vs explicit pairs) makes it impossible
   * to forget the close, and keeps the call site to one line either side.
   */
  start(label: string): () => number {
    const t0 = now();
    return () => {
      const ms = now() - t0;
      const threshold = PERF_THRESHOLDS[label];
      const overshot = threshold !== undefined && ms > threshold;
      push(label, { ms, at: Date.now(), overshot });

      // Dev-only warning. We warn once per label per session to surface
      // regressions without burying the console. Tooling / debug panel can
      // always read getStats() for the full picture.
      if (isDev && overshot && !warned.has(label)) {
        warned.add(label);
        // eslint-disable-next-line no-console
        console.warn(
          `[perf] ${label} took ${ms.toFixed(1)}ms ` +
          `(threshold ${threshold}ms). Further overshoots in this session ` +
          `are recorded silently; call perfMonitor.getStats('${label}') to inspect.`,
        );
      }
      return ms;
    };
  },

  /** Stats for a single label, or null if no samples yet. */
  getStats(label: string): PerfStats | null {
    return computeStats(label);
  },

  /** Snapshot of every label currently being tracked. */
  getAllStats(): PerfStats[] {
    const out: PerfStats[] = [];
    for (const label of buffers.keys()) {
      const s = computeStats(label);
      if (s) out.push(s);
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  },

  /** Clear samples for one label, or all labels if no arg. */
  reset(label?: string) {
    if (label) buffers.delete(label);
    else buffers.clear();
    warned.clear();
  },
};

// Expose on window in dev so we can poke at it from DevTools without
// importing anything: `window.__perf__.getAllStats()`.
if (isDev && typeof window !== 'undefined') {
  (window as any).__perf__ = perfMonitor;
}
