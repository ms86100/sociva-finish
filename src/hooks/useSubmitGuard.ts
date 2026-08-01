// @ts-nocheck
import { useRef, useCallback } from 'react';

/**
 * Hook that prevents duplicate form submissions.
 * Uses both a cooldown timer AND an in-flight lock.
 * The lock stays active until the wrapped function resolves,
 * plus an optional extended hold period (useful for order flows
 * where navigation happens after the async work).
 *
 * @param fn - The async function to guard
 * @param cooldownMs - Minimum gap between calls (default: 1000)
 * @param holdMs - Extra lock time after fn resolves (default: 0)
 */
export function useSubmitGuard<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  cooldownMs = 1000,
  holdMs = 0
): (...args: Parameters<T>) => Promise<void> {
  const lastCallRef = useRef<number>(0);
  const pendingRef = useRef(false);

  return useCallback(
    async (...args: Parameters<T>) => {
      const now = Date.now();
      if (pendingRef.current || now - lastCallRef.current < cooldownMs) {
        return;
      }

      pendingRef.current = true;
      lastCallRef.current = now;

      try {
        await fn(...args);
      } finally {
        if (holdMs > 0) {
          // Keep the lock for an extra period (e.g. during navigation)
          setTimeout(() => { pendingRef.current = false; }, holdMs);
        } else {
          pendingRef.current = false;
        }
      }
    },
    [fn, cooldownMs, holdMs]
  );
}
