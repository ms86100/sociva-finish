/**
 * Routes guests may open without an account (App Store 5.1.1(v) + Swiggy-style browse).
 * Cart is guest-ok; placing an order still requires OTP. Profile/orders/seller/admin stay gated.
 */

const GUEST_BROWSE_EXACT = new Set([
  '/',
  '/search',
  '/categories',
  '/discover-location',
  '/cart',
]);

const GUEST_BROWSE_PREFIXES = [
  '/category/',
  '/discovery/',
  '/product/',
  '/festival-collection/',
] as const;

/** Public seller storefront only — not /seller/products, /seller/settings, etc. */
const SELLER_APP_SEGMENTS = new Set([
  'products',
  'settings',
  'dashboard',
  'orders',
  'credits',
  'wallet',
  'payouts',
  'analytics',
  'onboarding',
  'become',
  'delivery',
  'notifications',
  'support',
  'reviews',
  'store',
  'stores',
  'messages',
  'earnings',
  'coupons',
  'category-requests',
]);

const SELLER_STOREFRONT = /^\/seller\/([^/]+)\/?$/;

export function isGuestBrowsePath(pathname: string): boolean {
  const path = (pathname || '/').split('?')[0] || '/';
  if (GUEST_BROWSE_EXACT.has(path)) return true;
  if (GUEST_BROWSE_PREFIXES.some((p) => path.startsWith(p))) return true;
  const storefront = path.match(SELLER_STOREFRONT);
  if (storefront && !SELLER_APP_SEGMENTS.has(storefront[1])) return true;
  return false;
}

export function authReturnPath(pathname: string, search = ''): string {
  const path = pathname || '/';
  const full = `${path}${search || ''}`;
  return full.startsWith('/') ? full : '/';
}
