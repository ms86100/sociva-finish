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
 * Normalize an inbound Capacitor / App Link / custom-scheme URL into a HashRouter path.
 *
 * Supports:
 * - Custom scheme: sociva://orders/123 → /orders/123
 * - Hash App Links: https://www.sociva.in/#/orders/123 → /orders/123
 * - Path-style links (Android Intent may strip hash): https://www.sociva.in/orders/123 → /orders/123
 * - Encoded hash in path: /%23/orders/123
 */
export function resolveDeepLinkPath(rawUrl: string): string {
  const url = new URL(rawUrl);
  let path = '';

  if (url.hash && (url.hash.startsWith('#/') || url.hash.startsWith('#%2F') || url.hash.startsWith('#%2f'))) {
    const decodedHash = decodeURIComponent(url.hash);
    path = decodedHash.startsWith('#') ? decodedHash.substring(1) : decodedHash;
  } else if (url.protocol === 'sociva:') {
    // sociva://orders/123 or sociva:///orders/123
    const host = url.hostname;
    const rest = url.pathname || '';
    if (host) {
      path = `/${host}${rest === '/' ? '' : rest}`;
    } else {
      path = rest || '/';
    }
    if (url.search) path += url.search;
  } else {
    // HTTPS App Link without hash — use pathname (Capacitor often delivers path only)
    let pathname = url.pathname || '/';
    try {
      pathname = decodeURIComponent(pathname);
    } catch { /* keep raw */ }
    // Handle /#/orders embedded oddly in pathname
    if (pathname.includes('#/')) {
      path = pathname.substring(pathname.indexOf('#/') + 1);
    } else if (pathname.startsWith('/#/')) {
      path = pathname.substring(2);
    } else {
      path = pathname;
    }
    if (url.search) path += url.search;
  }

  if (!path.startsWith('/')) path = `/${path}`;
  // Collapse duplicate slashes except protocol
  path = path.replace(/\/{2,}/g, '/');
  return path;
}

/**
 * Hook to handle deep links in Capacitor native apps
 *
 * Cold start: App.getLaunchUrl()
 * Warm/hot: appUrlOpen
 * Paths are stored in sessionStorage so they survive auth hydration.
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
        let path = resolveDeepLinkPath(event.url);

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
      }).catch((err) => {
        console.warn('getLaunchUrl failed:', err);
      });
    }

    // Cleanup listener on unmount
    return () => {
      listenerPromise.then((listener) => listener.remove());
    };
  }, []); // No dependencies — this effect must run exactly once
}
