import type { ProductActionType } from '@/types/Database';
import { deriveActionType } from '@/lib/marketplace-constants';

/**
 * Buyer-facing commerce modes. Mirrors action_type_workflow_map.checkout_mode:
 * cart -> home (the Shop tab is retired; /shop redirects there),
 * booking -> book, inquiry/contact -> services.
 */
export type CommerceMode = 'shop' | 'book' | 'services';

export const ACTION_TO_MODE: Record<ProductActionType, CommerceMode> = {
  add_to_cart: 'shop',
  buy_now: 'shop',
  book: 'book',
  schedule_visit: 'book',
  request_service: 'services',
  request_quote: 'services',
  make_offer: 'services',
  contact_seller: 'services',
};

export interface CategoryActionConfig {
  category: string;
  transactionType?: string | null;
  behavior?: { supportsCart?: boolean; enquiryOnly?: boolean } | null;
}

/**
 * The single buyer-side action resolver: product override, then category
 * transaction_type, then category behavior flags (see deriveActionType).
 */
export function resolveListingAction(
  actionType: string | null | undefined,
  category: string | null | undefined,
  categoryConfigs?: readonly CategoryActionConfig[] | null,
): ProductActionType {
  const cfg = category ? categoryConfigs?.find((c) => c.category === category) : undefined;
  return deriveActionType(
    actionType ?? null,
    cfg?.transactionType ?? null,
    cfg
      ? { supportsCart: cfg.behavior?.supportsCart, enquiryOnly: cfg.behavior?.enquiryOnly }
      : null,
  );
}

export function modeForAction(action: ProductActionType): CommerceMode {
  return ACTION_TO_MODE[action] ?? 'shop';
}

export function resolveCommerceMode(
  listing: { action_type?: string | null; category?: string | null },
  categoryConfigs?: readonly CategoryActionConfig[] | null,
): CommerceMode {
  return modeForAction(resolveListingAction(listing.action_type, listing.category, categoryConfigs));
}

/**
 * Repeat rails must not guess shop when action/category are missing.
 * Unknown rows are dropped instead of defaulting to add_to_cart.
 */
export function listingBelongsToMode(
  listing: { action_type?: string | null; category?: string | null },
  mode: CommerceMode,
  categoryConfigs?: readonly CategoryActionConfig[] | null,
): boolean {
  const action = String(listing.action_type || '').trim();
  const category = String(listing.category || '').trim();
  if (!action && !category) return false;
  const cfg = category
    ? categoryConfigs?.find((c) => c.category === category)
    : undefined;
  if (!action && !cfg) return false;
  return resolveCommerceMode(listing, categoryConfigs) === mode;
}

/**
 * Sellers sometimes leave a dummy ₹1 price on Book listings.
 * Free (₹0) consults stay visible; hide positive stub prices at or below ₹1.
 */
export function isPlaceholderListingPrice(price: number | null | undefined): boolean {
  const n = Number(price);
  return Number.isFinite(n) && n > 0 && n <= 1;
}

const PLACEHOLDER_COPY_RE = /price\s*placeholder|placeholder\s+listing(\s+at)?\s*₹?\s*1\b|seller will update/i;

/**
 * Book browse should not show stub catalogue rows.
 * Hide positive stub prices (₹0 < price ≤ ₹1). Keep ₹0 free / price-on-request
 * services even if seed copy still says "placeholder" - that leftover text must
 * not wipe a real Shrivara-style menu down to one visible row.
 */
export function isPlaceholderBookListing(listing: {
  price?: number | null;
  name?: string | null;
  description?: string | null;
}): boolean {
  if (isPlaceholderListingPrice(listing.price)) return true;
  const price = Number(listing.price);
  if (Number.isFinite(price) && price === 0) return false;
  const blob = `${listing.name || ''} ${listing.description || ''}`;
  return PLACEHOLDER_COPY_RE.test(blob);
}

export function filterByMode<T extends {
  action_type?: string | null;
  category?: string | null;
  price?: number | null;
  name?: string | null;
  description?: string | null;
}>(
  listings: readonly T[],
  mode: CommerceMode,
  categoryConfigs?: readonly CategoryActionConfig[] | null,
): T[] {
  return listings.filter((l) => {
    if (resolveCommerceMode(l, categoryConfigs) !== mode) return false;
    if (mode === 'book' && isPlaceholderBookListing(l)) return false;
    return true;
  });
}

/**
 * A photo chip belongs to the mode with the most listings in that category.
 * A tie uses the category's own transaction type so Salon is not repeated
 * on Book and Contact.
 */
export function owningModeForCategory(
  counts: Partial<Record<CommerceMode, number>>,
  category: string,
  categoryConfigs?: readonly CategoryActionConfig[] | null,
): CommerceMode | null {
  const shop = counts.shop || 0;
  const book = counts.book || 0;
  const services = counts.services || 0;
  if (shop + book + services === 0) return null;
  const ranked: [CommerceMode, number][] = [
    ['shop', shop],
    ['book', book],
    ['services', services],
  ];
  const max = Math.max(shop, book, services);
  const winners = ranked.filter(([, n]) => n === max).map(([mode]) => mode);
  if (winners.length === 1) return winners[0];
  const fallback = resolveCommerceMode({ action_type: null, category }, categoryConfigs);
  return winners.includes(fallback) ? fallback : winners[0];
}

export function categoriesOwnedByMode(
  buckets: Record<CommerceMode, readonly { category?: string | null }[]>,
  mode: CommerceMode,
  categoryConfigs?: readonly CategoryActionConfig[] | null,
): Set<string> {
  const counts = new Map<string, Record<CommerceMode, number>>();
  const modes: CommerceMode[] = ['shop', 'book', 'services'];
  for (const bucketMode of modes) {
    for (const listing of buckets[bucketMode] || []) {
      const category = listing.category;
      if (!category) continue;
      const row = counts.get(category) || { shop: 0, book: 0, services: 0 };
      row[bucketMode] += 1;
      counts.set(category, row);
    }
  }
  const owned = new Set<string>();
  for (const [category, row] of counts) {
    if ((row[mode] || 0) > 0 && owningModeForCategory(row, category, categoryConfigs) === mode) {
      owned.add(category);
    }
  }
  return owned;
}

/**
 * Categories with at least one listing on this mode.
 * A salon enquiry still gets a Salon chip on Contact when most salon
 * listings are bookings.
 */
export function categoriesListedInMode(
  buckets: Record<CommerceMode, readonly { category?: string | null }[]>,
  mode: CommerceMode,
): Set<string> {
  const listed = new Set<string>();
  for (const listing of buckets[mode] || []) {
    const category = listing.category;
    if (category) listed.add(category);
  }
  return listed;
}
