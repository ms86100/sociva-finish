// @ts-nocheck
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App, URLOpenListenerEvent } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { isAppUpdatePath, storeUrlForPlatform } from '@/lib/app-update-link';

const PENDING_DEEP_LINK_KEY = 'sociva_pending_deep_link';
export const AUTH_RETURN_TO_KEY = 'sociva_auth_return_to';

/**
 * Top-level HashRouter segments that may arrive via App Links / sociva://.
 * Keep aligned with src/App.tsx routes. Legacy aliases remapped in sanitizeDeepLinkPath.
 */
export const KNOWN_DEEP_LINK_ROUTES = new Set([
  'orders', 'order', 'home', 'profile', 'cart', 'shop',
  'seller', 'sellers', 'settings', 'notifications', 'tracking', 'la-debug',
  'become-seller', 'talk-to-sociva', 'admin', 'product', 'products', 'categories',
  'category', 'search', 'community', 'favorites', 'wishlist',
  'address', 'addresses', 'checkout', 'checkouts', 'auth', 'privacy-policy',
  'terms', 'help', 'bulletin', 'marketplace', 'offers',
  'explore', 'book', 'services', 'contact', 'discovery', 'discover-location',
  'subscriptions', 'directory', 'disputes', 'workforce', 'group-buys',
  'parcels', 'parking', 'visitors', 'maintenance', 'inspection',
  'payment-milestones', 'authorized-persons', 'worker-hire', 'worker',
  'guard-kiosk', 'gate-entry', 'security', 'builder', 'builder-inspections',
  'delivery-partners', 'my-deliveries', 'my-workers', 'worker-attendance',
  'worker-leave', 'worker-salary', 'society', 'festival-collection',
  'docs', 'api-docs', 'push-debug', 'account', 'reset-password',
  'pricing', 'refund-policy', 'delete-account', 'community-rules',
  'welcome', 'landing', 'update',
]);

/** Historic / campaign paths → live HashRouter destinations. */
const LEGACY_DEEP_LINK_REMAP: Record<string, string> = {
  '/home': '/',
  '/marketplace': '/',
  '/offers': '/',
  '/bulletin': '/community',
  '/shop': '/',
  '/contact': '/services',
  '/account': '/profile',
};

/**
 * Store a pending deep link path for deferred navigation after auth hydration.
 */
export function setPendingDeepLink(path: string) {
  try {
    sessionStorage.setItem(PENDING_DEEP_LINK_KEY, sanitizeDeepLinkPath(path));
  } catch { /* storage unavailable */ }
}

export function peekPendingDeepLink(): string | null {
  try {
    return sessionStorage.getItem(PENDING_DEEP_LINK_KEY);
  } catch {
    return null;
  }
}

/**
 * Consume and clear the pending deep link. Returns null if none.
 */
export function consumePendingDeepLink(): string | null {
  try {
    const path = sessionStorage.getItem(PENDING_DEEP_LINK_KEY);
    if (path) sessionStorage.removeItem(PENDING_DEEP_LINK_KEY);
    return path ? sanitizeDeepLinkPath(path) : null;
  } catch {
    return null;
  }
}

export function setAuthReturnTo(path: string) {
  const clean = String(path || '').trim();
  if (!clean || clean === '/auth' || clean.startsWith('/auth?')) return;
  try {
    sessionStorage.setItem(AUTH_RETURN_TO_KEY, clean.startsWith('/') ? clean : `/${clean}`);
  } catch { /* storage unavailable */ }
}

export function consumeAuthReturnTo(): string | null {
  try {
    const path = sessionStorage.getItem(AUTH_RETURN_TO_KEY);
    if (path) sessionStorage.removeItem(AUTH_RETURN_TO_KEY);
    return path;
  } catch {
    return null;
  }
}

/**
 * Remap legacy aliases and reject unknown top segments to `/` (never `/orders`).
 */
export function sanitizeDeepLinkPath(rawPath: string): string {
  let path = String(rawPath || '/').trim() || '/';
  if (!path.startsWith('/')) path = `/${path}`;
  path = path.replace(/\/{2,}/g, '/');

  const qIndex = path.indexOf('?');
  const pathname = qIndex >= 0 ? path.slice(0, qIndex) : path;
  const search = qIndex >= 0 ? path.slice(qIndex) : '';

  const remappedBase = LEGACY_DEEP_LINK_REMAP[pathname] || LEGACY_DEEP_LINK_REMAP[pathname.replace(/\/$/, '') || '/'];
  if (remappedBase != null) {
    return `${remappedBase}${search}`;
  }

  const topSegment = pathname.split('/').filter(Boolean)[0];
  if (topSegment && !KNOWN_DEEP_LINK_ROUTES.has(topSegment)) {
    console.warn('Deep link: unknown route segment', topSegment, '→ fallback to /');
    return '/';
  }
  return `${pathname}${search}`;
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
    // HTTPS App Link without hash - use pathname (Capacitor often delivers path only)
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

  // OG share bounce URLs open the native app before HTML redirect runs.
  // Map them to real HashRouter routes (otherwise "api" falls through to home).
  const shareProduct = path.match(/^\/api\/share\/product\/([^/?#]+)/i);
  if (shareProduct?.[1]) {
    return `/product/${decodeURIComponent(shareProduct[1])}`;
  }
  const shareStore = path.match(/^\/api\/share\/store\/([^/?#]+)/i);
  if (shareStore?.[1]) {
    return `/seller/${decodeURIComponent(shareStore[1])}`;
  }
  // Public alias. The in-app store route is /seller/:id, not /store/:id.
  const storeAlias = path.match(/^\/store\/([^/?#]+)/i);
  if (storeAlias?.[1]) {
    return `/seller/${decodeURIComponent(storeAlias[1])}`;
  }

  return sanitizeDeepLinkPath(path);
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

        if (isAppUpdatePath(path)) {
          const storeUrl = storeUrlForPlatform(Capacitor.getPlatform());
          Browser.open({ url: storeUrl }).catch(() => {
            window.location.href = storeUrl;
          });
          return;
        }

        if (path && path !== '/') {
          console.log('Deep link path resolved:', path);
          setPendingDeepLink(path);
        }
      } catch (error) {
        console.error('Error parsing deep link:', error);
        setPendingDeepLink('/');
      }
    };

    // Listen for app URL open events (warm/hot start deep links)
    const listenerPromise = App.addListener('appUrlOpen', handleDeepLink);

    // Check if app was opened via deep link (cold start) - only once per session
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
  }, []); // No dependencies - this effect must run exactly once
}
