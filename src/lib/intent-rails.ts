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

function pick<T extends IntentListing>(listings: readonly T[], limit: number): T[] {
  return listings.slice(0, limit);
}

function rail<T extends IntentListing>(title: string, products: T[]): IntentRail<T> | null {
  return products.length > 0 ? { title, products } : null;
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

  const recentlyViewed = rail(
    input.mode === 'book' ? 'Recently viewed services' : 'Recently viewed',
    inIdOrder(products, input.recentIds, limit),
  );

  const favourites = rail('Your favourites', inIdOrder(products, input.favoriteIds, limit));

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
  const foodPopular = rail('Popular food nearby', pick(foodOnly, limit));

  const weekAgo = input.now - WEEK_MS;
  const newTitle = input.mode === 'book' ? 'New services' : input.mode === 'services' ? 'New businesses' : 'New nearby';
  const newlyListed = rail(
    newTitle,
    pick(products.filter((listing) => createdMs(listing) >= weekAgo).sort(byNewest), limit),
  );

  const sinceLastVisit = input.lastOpenedAt == null
    ? null
    : rail(
      'New since your last visit',
      pick(products.filter((listing) => createdMs(listing) > input.lastOpenedAt!).sort(byNewest), limit),
    );

  const anchor = inIdOrder(products, input.recentIds, 1)[0];
  const moreInCategory = anchor
    ? rail(
      `More in ${input.categoryLabel?.(anchor.category) || anchor.category}`,
      pick(products.filter((listing) => listing.category === anchor.category && listing.id !== anchor.id), limit),
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
