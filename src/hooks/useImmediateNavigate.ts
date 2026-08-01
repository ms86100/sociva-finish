// @ts-nocheck
import { startTransition, useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const NAV_STALL_MS = 1200;

/**
 * Navigate without blocking the main thread.
 * Previously used flushSync which forced a full sync render on every tap —
 * catastrophic on Capacitor WebViews. Prefer startTransition so paint stays responsive.
 */
export function useImmediateNavigate(source: string) {
  const navigate = useNavigate();
  const location = useLocation();
  const pendingPathRef = useRef<string | null>(null);
  const startedAtRef = useRef<number>(0);
  const stallTimerRef = useRef<number | null>(null);

  const clearPending = useCallback(() => {
    if (stallTimerRef.current) {
      window.clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
    pendingPathRef.current = null;
    startedAtRef.current = 0;
  }, []);

  useEffect(() => {
    if (!pendingPathRef.current) return;
    if (location.pathname !== pendingPathRef.current) return;

    const elapsed = startedAtRef.current
      ? Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAtRef.current)
      : 0;

    if (elapsed > NAV_STALL_MS) {
      console.info(`[Nav][${source}] Route settled after ${elapsed}ms`, {
        to: location.pathname,
      });
    }

    clearPending();
  }, [clearPending, location.pathname, source]);

  useEffect(() => () => clearPending(), [clearPending]);

  return useCallback((to: string, options?: { replace?: boolean; state?: unknown }) => {
    if (!to || location.pathname === to) return;

    clearPending();
    pendingPathRef.current = to;
    startedAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();

    stallTimerRef.current = window.setTimeout(() => {
      if (pendingPathRef.current !== to) return;
      console.warn(`[Nav][${source}] Route transition is taking longer than expected`, {
        from: location.pathname,
        to,
      });
    }, NAV_STALL_MS);

    startTransition(() => {
      navigate(to, options);
    });
  }, [clearPending, location.pathname, navigate, source]);
}