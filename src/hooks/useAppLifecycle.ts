// @ts-nocheck
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';
import { cleanupStaleDeliveryNotifications, type UserNotification } from '@/hooks/queries/useNotifications';

/**
 * Listens for Capacitor appStateChange events and invalidates critical
 * queries when the app returns to the foreground. This ensures fresh data
 * on mobile resume without relying on refetchOnWindowFocus (which fires
 * too frequently on Capacitor).
 */
export function useAppLifecycle() {
  const queryClient = useQueryClient();
  const autoCancelFiredRef = useRef(false);
  const staleCleanupFiredRef = useRef(false);

  // Trigger auto-cancel on cold start to sweep stale payment_pending orders.
  // Perf: defer 10s after first paint so it doesn't compete with critical
  // boot data fetches.
  useEffect(() => {
    if (autoCancelFiredRef.current) return;
    autoCancelFiredRef.current = true;

    const timer = setTimeout(() => {
      // auto-cancel-orders runs on a 2-minute pg_cron schedule and only accepts
      // service-role / cron-secret auth. Client invocations always 401, so we
      // skip them here to avoid useless network traffic & "Failed to fetch" noise.

      // One-time stale notification cleanup on cold start (also deferred)
      if (!staleCleanupFiredRef.current) {
        staleCleanupFiredRef.current = true;
        supabase.auth.getUser().then(({ data: { user } }) => {
          if (!user) return;
          supabase
            .from('user_notifications')
            .select('id, title, body, type, action_url, is_read, created_at, data')
            .eq('user_id', user.id)
            .eq('is_read', false)
            .limit(100)
            .then(({ data }) => {
              if (data && data.length > 0) {
                cleanupStaleDeliveryNotifications(data as UserNotification[]).then(() => {
                  queryClient.invalidateQueries({ queryKey: ['unread-notifications'] });
                  queryClient.invalidateQueries({ queryKey: ['notifications'] });
                  queryClient.invalidateQueries({ queryKey: ['latest-action-notification'] });
                });
              }
            });
        });
      }
    }, 10_000);

    return () => clearTimeout(timer);
  }, []);

  // Push-driven sync: invalidate all critical queries on terminal order push
  useEffect(() => {
    const onTerminalPush = () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['active-orders-strip'] });
      queryClient.invalidateQueries({ queryKey: ['unread-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['latest-action-notification'] });
      queryClient.invalidateQueries({ queryKey: ['seller-orders'] });
      queryClient.invalidateQueries({ queryKey: ['seller-dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['seller-order-filter-counts'] });
      queryClient.invalidateQueries({ queryKey: ['seller-analytics-charts'] });
      queryClient.invalidateQueries({ queryKey: ['seller-refund-requests'] });
      queryClient.invalidateQueries({ queryKey: ['seller-reliability'] });
      queryClient.invalidateQueries({ queryKey: ['seller-customers'] });
      queryClient.invalidateQueries({ queryKey: ['cart-items'] });
      queryClient.invalidateQueries({ queryKey: ['cart-count'] });
      window.dispatchEvent(new Event('order-detail-refetch'));
    };
    window.addEventListener('order-terminal-push', onTerminalPush);
    return () => window.removeEventListener('order-terminal-push', onTerminalPush);
  }, [queryClient]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const listener = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) {
            void (async () => {
              try {
                const { data, error } = await supabase.auth.refreshSession();
                if (error || !data.session) {
                  console.warn('[Auth] Resume refreshSession failed:', error?.message);
                  // Do not clear auth here — health check / 401 path handles confirmed expiry
                }
              } catch (e) {
                console.warn('[Auth] Resume refresh threw:', e);
              }
            })();

            // Badge/count queries always; seller order lists too so SLA timers
            // cannot stay stale after a cancel that arrived while backgrounded.
            const resumeKeys = new Set([
              'cart-count', 'unread-notifications',
              'latest-action-notification',
              'seller-orders', 'seller-dashboard-stats', 'seller-order-filter-counts',
              'seller-analytics-charts', 'seller-refund-requests',
              'seller-reliability', 'seller-customers',
              'orders', 'active-orders-strip',
              'seller-chat', 'unread-chat-counts', 'chat-unread-count',
            ]);
            queryClient.invalidateQueries({
              predicate: (query) => {
                const key = query.queryKey[0];
                return typeof key === 'string' && resumeKeys.has(key);
              },
            });
          }
        });
        cleanup = () => listener.remove();
      } catch (err) {
        console.error('Failed to register appStateChange listener:', err);
      }
    })();

    return () => cleanup?.();
  }, [queryClient]);
}
