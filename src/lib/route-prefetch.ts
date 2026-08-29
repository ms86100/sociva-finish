// @ts-nocheck
/**
 * Idle-time route prefetcher. Warms up dynamic-import chunks for likely-next
 * routes after the current page has painted, so navigations feel instant.
 *
 * Bottom-nav pages (except Home) are lazy — prefetch them first after idle.
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
 * Prefetch high-traffic routes after first paint (Home stays eager).
 */
export function prefetchBuyerRoutes() {
  // Bottom-nav tabs first — highest chance of next tap
  whenIdle(() => prefetch('search', () => import('@/pages/SearchPage')), 400);
  whenIdle(() => prefetch('orders', () => import('@/pages/OrdersPage')), 600);
  whenIdle(() => prefetch('cart', () => import('@/pages/CartPage')), 800);
  whenIdle(() => prefetch('society', () => import('@/pages/SocietyDashboardPage')), 1000);
  whenIdle(() => prefetch('profile', () => import('@/pages/ProfilePage')), 1200);

  whenIdle(() => prefetch('order-detail', () => import('@/pages/OrderDetailPage')), 1400);
  whenIdle(() => prefetch('seller-detail', () => import('@/pages/SellerDetailPage')), 1600);
  whenIdle(() => prefetch('product', () => import('@/pages/ProductDeepLinkPage')), 1800);
  whenIdle(() => prefetch('notifications', () => import('@/pages/NotificationsPage')), 2000);
  whenIdle(() => prefetch('notification-inbox', () => import('@/pages/NotificationInboxPage')), 2200);
  whenIdle(() => prefetch('categories', () => import('@/pages/CategoriesPage')), 2400);
  whenIdle(() => prefetch('favorites', () => import('@/pages/FavoritesPage')), 2600);
  whenIdle(() => prefetch('become-seller', () => import('@/pages/BecomeSellerPage')), 3000);
}

/** Warm the become-seller chunk while the seller is on their dashboard. */
export function prefetchSellerRoutes() {
  whenIdle(() => prefetch('become-seller', () => import('@/pages/BecomeSellerPage')), 200);
  whenIdle(() => prefetch('seller-products', () => import('@/pages/SellerProductsPage')), 600);
  whenIdle(() => prefetch('seller-settings', () => import('@/pages/SellerSettingsPage')), 900);
}
