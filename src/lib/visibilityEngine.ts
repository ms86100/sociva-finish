// @ts-nocheck
/**
 * Visibility Engine — Deterministic UI Surface Rules
 *
 * Centralizes route-based visibility so components don't hardcode
 * their own hide/show logic independently.
 *
 * Rules:
 *   • FloatingCartBar: cart has items, shopper browse route, no cart popup open
 *   • ActiveOrderStrip (home): visible when active order AND on home page
 */

export const CART_HIDDEN_ROUTES = ['/cart', '/checkout', '/checkouts'] as const;

/** Shopper browse surfaces only — never seller tools, profile, or account. */
const CART_BAR_ALLOWED_ROUTES: RegExp[] = [
  /^\/$/,
  /^\/search/,
  /^\/categories$/,
  /^\/category(\/|$)/,
  /^\/discovery\//,
  /^\/seller\/[0-9a-f-]{36}$/i,
  /^\/product\//,
  /^\/festival-collection\//,
  /^\/favorites/,
];

export function isCartBarBrowseRoute(pathname: string): boolean {
  if (isRouteHidden(pathname, CART_HIDDEN_ROUTES)) return false;
  return CART_BAR_ALLOWED_ROUTES.some((re) => re.test(pathname));
}

export function shouldShowFloatingCartBar(
  pathname: string,
  itemCount: number,
  cartPopupOpen = false,
): boolean {
  return itemCount > 0 && !cartPopupOpen && isCartBarBrowseRoute(pathname);
}

/**
 * Returns true if the given pathname should hide the element.
 * Supports both exact prefix matching and starts-with matching.
 */
export function isRouteHidden(
  pathname: string,
  hiddenPrefixes: readonly string[],
): boolean {
  return hiddenPrefixes.some((prefix) => pathname.startsWith(prefix));
}

/** Transit statuses that indicate active movement — DB-driven via trackingConfig */
import { getTrackingConfigSync } from '@/services/trackingConfig';
export function getTransitStatuses(): Set<string> {
  return new Set(getTrackingConfigSync().transit_statuses_la);
}
