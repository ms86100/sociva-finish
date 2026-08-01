// @ts-nocheck
/**
 * Idle-time route prefetcher. Warms up dynamic-import chunks for likely-next
 * routes after the current page has painted, so navigations feel instant.
 *
 * Bottom-nav pages (Home/Orders/Cart/Society/Profile/Search) are eager-loaded
 * in App.tsx — this only warms secondary routes.
 */

const PREFETCH_KEYS = new Set<string>();

type Importer = () => Promise<unknown>;

function whenIdle(cb: () => void, timeout = 1500) {
  if (typeof window === 'undefined') return;
  const ric = (window as any).requestIdleCallback as
    | ((cb: () => void, opts?: { timeout: number }) => number)
    | undefined;
  if (ric) {
    ric(cb, { timeout });
  } else {
    setTimeout(cb, 800);
  }
}

function prefetch(key: string, importer: Importer) {
  if (PREFETCH_KEYS.has(key)) return;
  PREFETCH_KEYS.add(key);
  importer().catch((err) => {
    PREFETCH_KEYS.delete(key);
    console.debug('[prefetch] failed for', key, err);
  });
}

/**
 * Prefetch high-traffic secondary routes after first paint.
 */
export function prefetchBuyerRoutes() {
  whenIdle(() => prefetch('order-detail', () => import('@/pages/OrderDetailPage')), 800);
  whenIdle(() => prefetch('seller-detail', () => import('@/pages/SellerDetailPage')), 1000);
  whenIdle(() => prefetch('product', () => import('@/pages/ProductDeepLinkPage')), 1200);
  whenIdle(() => prefetch('notifications', () => import('@/pages/NotificationsPage')), 1400);
  whenIdle(() => prefetch('notification-inbox', () => import('@/pages/NotificationInboxPage')), 1600);
  whenIdle(() => prefetch('categories', () => import('@/pages/CategoriesPage')), 1800);
  whenIdle(() => prefetch('favorites', () => import('@/pages/FavoritesPage')), 2000);
  whenIdle(() => prefetch('become-seller', () => import('@/pages/BecomeSellerPage')), 2500);
}
