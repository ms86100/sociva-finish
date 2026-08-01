// @ts-nocheck
/**
 * Visibility Engine — Deterministic UI Surface Rules
 *
 * Centralizes route-based visibility so components don't hardcode
 * their own hide/show logic independently.
 *
 * Rules:
 *   • FloatingCartBar: visible when cart has items AND not on cart/checkout
 *   • ActiveOrderStrip (home): visible when active order AND on home page
 */

export const CART_HIDDEN_ROUTES = ['/cart', '/checkout'] as const;

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
