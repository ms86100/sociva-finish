// @ts-nocheck
/**
 * Lightweight performance telemetry for critical paths.
 * Uses `performance.mark` / `performance.measure` — zero overhead when
 * Performance API is unavailable (SSR, older browsers).
 */

const HAS_PERF = typeof performance !== 'undefined' && typeof performance.mark === 'function';

/** Threshold in ms — anything above this gets a console.warn */
const SLOW_THRESHOLD = 500;

/**
 * Start a named performance measurement.
 */
export function markStart(label: string): void {
  if (!HAS_PERF) return;
  try {
    performance.mark(`${label}:start`);
  } catch {
    // ignore
  }
}

/**
 * End a named performance measurement and log the duration.
 * Returns duration in ms, or -1 if measurement failed.
 */
export function markEnd(label: string): number {
  if (!HAS_PERF) return -1;
  try {
    performance.mark(`${label}:end`);
    const measure = performance.measure(label, `${label}:start`, `${label}:end`);
    const duration = measure.duration;

    if (duration > SLOW_THRESHOLD) {
      console.warn(`[Perf] ${label}: ${duration.toFixed(0)}ms (slow)`);
    } else if (import.meta.env.DEV) {
      console.debug(`[Perf] ${label}: ${duration.toFixed(0)}ms`);
    }

    // Cleanup marks
    performance.clearMarks(`${label}:start`);
    performance.clearMarks(`${label}:end`);
    performance.clearMeasures(label);

    return duration;
  } catch {
    return -1;
  }
}

/**
 * Wraps an async function with automatic start/end marks.
 */
export async function withTelemetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  markStart(label);
  try {
    return await fn();
  } finally {
    markEnd(label);
  }
}

/**
 * Performance guardrail: warns when a query takes too long.
 * Wrap around any supabase query to get automatic slow-query alerts.
 */
export async function guardedQuery<T>(label: string, fn: () => Promise<T>, threshold = SLOW_THRESHOLD): Promise<T> {
  const t0 = HAS_PERF ? performance.now() : Date.now();
  const result = await fn();
  const elapsed = (HAS_PERF ? performance.now() : Date.now()) - t0;
  if (elapsed > threshold) {
    console.warn(`[Perf:Query] ${label}: ${elapsed.toFixed(0)}ms — consider caching or indexing`);
  }
  return result;
}

/**
 * Track route mount time. Call at the top of a page component's useEffect.
 * Usage:
 *   useEffect(() => { trackRouteMount('SellerDashboard'); }, []);
 */
export function trackRouteMount(routeName: string): void {
  if (!HAS_PERF) return;
  // Skip telemetry when the tab is backgrounded — the timestamps are meaningless
  // (a tab resumed after 40 minutes will look like a 2.4M ms "slow mount").
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  try {
    const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (navEntry) {
      const mountTime = performance.now() - navEntry.responseEnd;
      if (mountTime > 1000) {
        console.warn(`[Perf:Route] ${routeName} mounted ${mountTime.toFixed(0)}ms after page response — check data dependencies`);
      } else if (import.meta.env.DEV) {
        console.debug(`[Perf:Route] ${routeName} mounted in ${mountTime.toFixed(0)}ms`);
      }
    }
  } catch {
    // ignore
  }
}