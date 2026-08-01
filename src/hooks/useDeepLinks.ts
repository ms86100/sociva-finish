// @ts-nocheck
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App, URLOpenListenerEvent } from '@capacitor/app';

const PENDING_DEEP_LINK_KEY = 'sociva_pending_deep_link';

/**
 * Known top-level route segments used for deep-link fallback validation.
 */
const KNOWN_ROUTES = new Set([
  'orders', 'order', 'home', 'profile', 'cart', 'shop',
  'seller', 'settings', 'notifications', 'tracking', 'la-debug',
  'become-seller', 'admin',
]);

/**
 * Store a pending deep link path for deferred navigation after auth hydration.
 */
export function setPendingDeepLink(path: string) {
  try {
    sessionStorage.setItem(PENDING_DEEP_LINK_KEY, path);
  } catch { /* storage unavailable */ }
}

/**
 * Consume and clear the pending deep link. Returns null if none.
 */
export function consumePendingDeepLink(): string | null {
  try {
    const path = sessionStorage.getItem(PENDING_DEEP_LINK_KEY);
    if (path) sessionStorage.removeItem(PENDING_DEEP_LINK_KEY);
    return path;
  } catch {
    return null;
  }
}

/**
 * Hook to handle deep links in Capacitor native apps
 *
 * Supports:
 * - Custom URL scheme: sociva://orders/123
 * - Universal Links (iOS): https://www.sociva.in/#/orders/123
 * - App Links (Android): https://www.sociva.in/#/orders/123
 *
 * Since the app uses HashRouter, deep link paths are extracted from:
 * 1. The hash fragment (e.g., /#/orders/123 -> /orders/123)
 * 2. hostname+pathname for custom schemes (sociva://orders/123 → /orders/123)
 *
 * Deep links are stored in sessionStorage so they survive auth hydration.
 */
export function useDeepLinks() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    // Guard: only process getLaunchUrl once per app session to prevent
    // stale deep links from re-firing on effect re-runs.
    const LAUNCH_PROCESSED_KEY = 'sociva_launch_url_processed';
    const launchAlreadyProcessed = sessionStorage.getItem(LAUNCH_PROCESSED_KEY) === '1';

    const handleDeepLink = (event: URLOpenListenerEvent) => {
      console.log('Deep link received:', event.url);

      try {
        const url = new URL(event.url);
        let path = '';

        // Check if URL has a hash (for universal links with HashRouter)
        if (url.hash && url.hash.startsWith('#/')) {
          path = url.hash.substring(1);
        } else if (url.protocol === 'sociva:') {
          // Custom URL scheme: sociva://orders/123
          const host = url.hostname;
          const rest = url.pathname;
          path = `/${host}${rest === '/' ? '' : rest}`;
          if (url.search) {
            path += url.search;
          }
        } else {
          // Universal link without hash, use pathname
          path = url.pathname;
          if (url.search) {
            path += url.search;
          }
        }

        if (path && path !== '/') {
          // Validate the top-level route segment exists
          const topSegment = path.split('/').filter(Boolean)[0];
          if (topSegment && !KNOWN_ROUTES.has(topSegment)) {
            console.warn('Deep link: unknown route segment', topSegment, '→ fallback to /orders');
            path = '/orders';
          }

          console.log('Deep link path resolved:', path);
          setPendingDeepLink(path);
        }
      } catch (error) {
        console.error('Error parsing deep link:', error);
        setPendingDeepLink('/orders');
      }
    };

    // Listen for app URL open events (warm/hot start deep links)
    const listenerPromise = App.addListener('appUrlOpen', handleDeepLink);

    // Check if app was opened via deep link (cold start) — only once per session
    if (!launchAlreadyProcessed) {
      App.getLaunchUrl().then((launchUrl) => {
        if (launchUrl?.url) {
          console.log('App launched via deep link:', launchUrl.url);
          sessionStorage.setItem(LAUNCH_PROCESSED_KEY, '1');
          handleDeepLink({ url: launchUrl.url });
        }
      });
    }

    // Cleanup listener on unmount
    return () => {
      listenerPromise.then((listener) => listener.remove());
    };
  }, []); // No dependencies — this effect must run exactly once
}
