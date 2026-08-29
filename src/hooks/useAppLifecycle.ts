// @ts-nocheck
import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';
import { cleanupStaleDeliveryNotifications, type UserNotification } from '@/hooks/queries/useNotifications';

const RESUME_QUERY_PREFIXES = new Set([
  // Badges & notifications
  'unread-notifications',
  'notifications',
  'latest-action-notification',
  'cart-count',
  'cart-items',

  // Seller lifecycle, applications, stores & finances
  'seller-profile',
  'seller-profiles',
  'seller-application',
  'seller-approval',
  'seller-orders',
  'seller-dashboard-stats',
  'seller-order-filter-counts',
  'seller-analytics-charts',
  'seller-refund-requests',
  'seller-reliability',
  'seller-customers',
  'seller-payouts',
  'seller-credits',
  'seller-credit-summary',
  'seller-credit-activity',
  'seller-credit-can-accept',
  'seller-credit-activated',
  'seller-commerce-modes',
  'low-stock-products',
  'availability-prompt',
  'seller-service-bookings',
  'seller-trust-snapshot',
  'seller-profile-for-festivals',

  // Buyer orders, tracking & service bookings
  'orders',
  'active-orders-strip',
  'order-detail',
  'order-timeline',
  'payment-record',
  'dispute-for-order',
  'service-booking-order',
  'buyer-service-bookings',
  'service-slots',
  'service-slots-store',
  'booking-addons',
  'session-feedback',
  'buyer-recurring-configs',

  // Marketplace & discovery
  'marketplace-sellers',
  'marketplace-products',
  'products-by-category',
  'category-products',
  'popular-products',
  'nearby-products',
  'product-facets',
  'product-favorites',
  'product-favorites-list',
  'location-stats',
  'social-proof',
  'auto-highlights',
  'recently-viewed-products',
  'community-teaser',
  'sellers-by-category',

  // Chat & messaging
  'seller-chat',
  'unread-chat-counts',
  'chat-unread-count',

  // User profile, wallet & society
  'buyer-wallet',
  'wallet-history',
  'delivery-addresses',
  'society-header-stats',
  'resident-job-requests',
  'my-deliveries',
  'pending-deliveries',
  'my-delivery-partner-profile',
  'admin-command-center-snapshot',
  'admin-withdrawal-console',
  'admin-seller-credits',
]);

/**
 * Listens for mobile resume (iOS & Android appStateChange / resume) and
 * web visibility/focus changes. When the user pushes down the app (backgrounds/minimizes)
 * and returns, it automatically revalidates session, profile (store approval & roles),
 * invalidates all caches, and triggers active query refetches so the whole page
 * updates with real-time data without requiring a force-close.
 */
export function useAppLifecycle() {
  const queryClient = useQueryClient();
  const autoCancelFiredRef = useRef(false);
  const staleCleanupFiredRef = useRef(false);
  const lastResumeTimeRef = useRef(0);

  // Trigger cold-start cleanup (deferred by 10s so boot is lightning fast)
  useEffect(() => {
    if (autoCancelFiredRef.current) return;
    autoCancelFiredRef.current = true;

    const timer = setTimeout(() => {
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
  }, [queryClient]);

  // Terminal order push listener
  useEffect(() => {
    const onTerminalPush = () => {
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && RESUME_QUERY_PREFIXES.has(key);
        },
      });
      window.dispatchEvent(new Event('order-detail-refetch'));
      window.dispatchEvent(new CustomEvent('app:invalidate-marketplace'));
    };
    window.addEventListener('order-terminal-push', onTerminalPush);
    return () => window.removeEventListener('order-terminal-push', onTerminalPush);
  }, [queryClient]);

  // Unified foreground / resume revalidation engine
  const handleForegroundResume = useCallback(async () => {
    const now = Date.now();
    // Throttle duplicate events within 1500ms (e.g. appStateChange + visibilitychange + focus)
    if (now - lastResumeTimeRef.current < 1500) {
      return;
    }
    lastResumeTimeRef.current = now;

    // 1. Refresh auth session to ensure token freshness
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) {
        console.warn('[Lifecycle] Resume refreshSession note:', error?.message);
      }
    } catch (e) {
      console.warn('[Lifecycle] Resume refreshSession error:', e);
    }

    // 2. Dispatch profile refresh to sync store approval, roles, and user context
    window.dispatchEvent(new CustomEvent('app:refresh-profile'));

    // 3. Invalidate all dynamic queries across buyer and seller surfaces
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && RESUME_QUERY_PREFIXES.has(key);
      },
    });

    // 4. Actively refetch whatever queries are currently mounted and active on screen
    void queryClient.refetchQueries({
      type: 'active',
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && RESUME_QUERY_PREFIXES.has(key);
      },
    });

    // 5. Notify downstream listeners (marketplaces, order details, notifications)
    window.dispatchEvent(new CustomEvent('app:resume-refresh'));
    window.dispatchEvent(new CustomEvent('app:invalidate-marketplace'));
    window.dispatchEvent(new Event('order-detail-refetch'));

    // 6. Background clean-up of stale notifications if user is logged in
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from('user_notifications')
        .select('id, title, body, type, action_url, is_read, created_at, data')
        .eq('user_id', user.id)
        .eq('is_read', false)
        .limit(50)
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
  }, [queryClient]);

  // Native Capacitor App Resume & State Change Listeners (iOS & Android)
  useEffect(() => {
    let unlistenAppState: (() => void) | undefined;
    let unlistenResume: (() => void) | undefined;

    (async () => {
      try {
        const { App } = await import('@capacitor/app');

        const stateSub = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) {
            void handleForegroundResume();
          }
        });
        unlistenAppState = () => stateSub.remove();

        const resumeSub = await App.addListener('resume', () => {
          void handleForegroundResume();
        });
        unlistenResume = () => resumeSub.remove();
      } catch (err) {
        // Not running on Capacitor native
      }
    })();

    return () => {
      unlistenAppState?.();
      unlistenResume?.();
    };
  }, [handleForegroundResume]);

  // Web & Browser Visibility / Focus Listeners (Desktop & Mobile Web)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void handleForegroundResume();
      }
    };

    const handleWindowFocus = () => {
      void handleForegroundResume();
    };

    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        void handleForegroundResume();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleWindowFocus);
      window.addEventListener('pageshow', handlePageShow);
    }

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleWindowFocus);
        window.removeEventListener('pageshow', handlePageShow);
      }
    };
  }, [handleForegroundResume]);
}
