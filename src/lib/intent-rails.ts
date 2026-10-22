import { MIN_RAIL_CARDS } from '@/lib/discovery-density';

export interface IntentListing {
  id: string;
  category: string;
  seller_id?: string | null;
  created_at?: string | null;
  completed_order_count?: number | null;
  distance_km?: number | null;
}

export interface IntentRail<T> {
  title: string;
  products: T[];
}

export interface IntentRailSet<T> {
  recentlyViewed: IntentRail<T> | null;
  primary: IntentRail<T> | null;
  foodPopular: IntentRail<T> | null;
  newlyListed: IntentRail<T> | null;
  sinceLastVisit: IntentRail<T> | null;
  moreInCategory: IntentRail<T> | null;
  favourites: IntentRail<T> | null;
}

/** Product-card rails that can stack above the All catalog. Seller rows are not included. */
export const INTENT_CARD_RAIL_KEYS = [
  'recentlyViewed',
  'newlyListed',
  'sinceLastVisit',
  'moreInCategory',
  'favourites',
] as const;

const DISCOVERY_PER_SELLER = 2;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function createdMs(listing: IntentListing): number {
  const value = listing.created_at ? Date.parse(listing.created_at) : NaN;
  return Number.isFinite(value) ? value : 0;
}

function byCompleted(a: IntentListing, b: IntentListing): number {
  return (b.completed_order_count || 0) - (a.completed_order_count || 0);
}

function byDistance(a: IntentListing, b: IntentListing): number {
  return (a.distance_km ?? 999) - (b.distance_km ?? 999);
}

function byNewest(a: IntentListing, b: IntentListing): number {
  return createdMs(b) - createdMs(a);
}

function sellerKey(listing: IntentListing): string {
  return listing.seller_id || listing.id;
}

/** One store should not fill the rail just because it has many ordered dishes. */
function productsBySeller<T extends IntentListing>(products: readonly T[], sellerLimit: number): T[] {
  const groups = new Map<string, T[]>();
  for (const listing of products) {
    const key = sellerKey(listing);
    const bucket = groups.get(key);
    if (bucket) bucket.push(listing);
    else groups.set(key, [listing]);
  }
  const ranked = [...groups.values()];
  for (const bucket of ranked) bucket.sort(byCompleted);
  ranked.sort((a, b) => {
    const orders = byCompleted(a[0], b[0]);
    if (orders !== 0) return orders;
    return byDistance(a[0], b[0]);
  });
  return ranked.slice(0, sellerLimit).flat();
}

function inIdOrder<T extends IntentListing>(listings: readonly T[], ids: readonly string[], limit: number): T[] {
  const byId = new Map(listings.map((listing) => [listing.id, listing]));
  const found: T[] = [];
  for (const id of ids) {
    const listing = byId.get(id);
    if (!listing) continue;
    found.push(listing);
    if (found.length >= limit) break;
  }
  return found;
}

function selectUnused<T extends IntentListing>(
  listings: readonly T[],
  used: Set<string>,
  limit: number,
  perSeller = 0,
): T[] {
  const sellerCounts = new Map<string, number>();
  const out: T[] = [];
  for (const listing of listings) {
    if (used.has(listing.id)) continue;
    if (perSeller > 0) {
      const key = sellerKey(listing);
      const count = sellerCounts.get(key) || 0;
      if (count >= perSeller) continue;
      sellerCounts.set(key, count + 1);
    }
    out.push(listing);
    if (out.length >= limit) break;
  }
  return out;
}

function shownRail<T extends IntentListing>(
  title: string,
  selected: T[],
  used: Set<string>,
): IntentRail<T> | null {
  if (selected.length === 0) return null;
  for (const listing of selected) used.add(listing.id);
  return { title, products: selected };
}

export function listingIdsFromCardRails<T extends IntentListing>(rails: IntentRailSet<T>): Set<string> {
  const ids = new Set<string>();
  for (const key of INTENT_CARD_RAIL_KEYS) {
    const products = rails[key]?.products || [];
    if (products.length < MIN_RAIL_CARDS) continue;
    for (const listing of products) ids.add(listing.id);
  }
  return ids;
}

/** All-catalog grid must not repeat cards already shown in stacked product rails. */
export function listingsForCatalogGrid<T extends { id: string }>(
  listings: readonly T[],
  railIds: ReadonlySet<string>,
  categorySelected: boolean,
): T[] {
  if (categorySelected) return [...listings];
  return listings.filter((listing) => !railIds.has(listing.id));
}

/**
 * Sections for one destination. A rail is omitted when its data is empty.
 * Popularity uses completed_order_count only. Seller "bestseller" flags are not used.
 */
export function buildIntentRails<T extends IntentListing>(input: {
  mode: 'shop' | 'book' | 'services';
  products: readonly T[];
  recentIds: readonly string[];
  favoriteIds: readonly string[];
  lastOpenedAt: number | null;
  now: number;
  limit?: number;
  isFood?: (listing: T) => boolean;
  categoryLabel?: (category: string) => string;
}): IntentRailSet<T> {
  const limit = input.limit ?? 12;
  const products = input.products;
  const hasCompleted = products.some((listing) => (listing.completed_order_count || 0) > 0);
  const used = new Set<string>();

  const recentlyViewed = shownRail(
    input.mode === 'book' ? 'Recently viewed services' : 'Recently viewed',
    selectUnused(inIdOrder(products, input.recentIds, limit), used, limit),
    used,
  );

  const favourites = shownRail(
    'Your favourites',
    selectUnused(inIdOrder(products, input.favoriteIds, limit), used, limit),
    used,
  );

  let primary: IntentRail<T> | null = null;
  if (products.length > 0 && input.mode === 'shop') {
    primary = hasCompleted
      ? { title: 'Popular nearby', products: productsBySeller(products, limit) }
      : { title: 'Nearby to order', products: productsBySeller(products, limit) };
  } else if (products.length > 0 && input.mode === 'book') {
    primary = hasCompleted
      ? { title: 'Popular services', products: productsBySeller(products, limit) }
      : { title: 'Nearby to book', products: productsBySeller(products, limit) };
  } else if (products.length > 0 && input.mode === 'services') {
    primary = hasCompleted
      ? { title: 'Popular nearby', products: productsBySeller(products, limit) }
      : { title: 'Businesses nearby', products: productsBySeller(products, limit) };
  }

  const primarySellers = new Set((primary?.products || []).map(sellerKey));
  const foodOnly = input.mode === 'shop' && input.isFood
    ? products
      .filter((listing) => input.isFood!(listing) && (listing.completed_order_count || 0) > 0)
      .filter((listing) => !primarySellers.has(sellerKey(listing)))
      .sort(byCompleted)
    : [];
  const foodPopular = shownRail(
    'Popular food nearby',
    selectUnused(foodOnly, used, limit, DISCOVERY_PER_SELLER),
    used,
  );

  const weekAgo = input.now - WEEK_MS;
  const newTitle = input.mode === 'book' ? 'New services' : input.mode === 'services' ? 'New businesses' : 'New nearby';
  const newlyListed = shownRail(
    newTitle,
    selectUnused(
      products.filter((listing) => createdMs(listing) >= weekAgo).sort(byNewest),
      used,
      limit,
      DISCOVERY_PER_SELLER,
    ),
    used,
  );

  const sinceLastVisit = input.lastOpenedAt == null
    ? null
    : shownRail(
      'New since your last visit',
      selectUnused(
        products.filter((listing) => createdMs(listing) > input.lastOpenedAt!).sort(byNewest),
        used,
        limit,
        DISCOVERY_PER_SELLER,
      ),
      used,
    );

  const anchor = inIdOrder(products, input.recentIds, 1)[0];
  const moreInCategory = anchor
    ? shownRail(
      `More in ${input.categoryLabel?.(anchor.category) || anchor.category}`,
      selectUnused(
        products.filter((listing) => listing.category === anchor.category),
        used,
        limit,
        DISCOVERY_PER_SELLER,
      ),
      used,
    )
    : null;

  return {
    recentlyViewed,
    primary,
    foodPopular,
    newlyListed,
    sinceLastVisit,
    moreInCategory,
    favourites,
  };
}
