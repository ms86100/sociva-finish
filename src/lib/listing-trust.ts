/** Store stars only when enough reviews exist - 1 review at 5.0 looks fake on every dish. */
export const MIN_REVIEWS_FOR_LISTING_STAR = 3;

export type ListingTrustInput = {
  rating?: number | null;
  reviews?: number | null;
  completedOrders?: number | null;
};

/**
 * Buyer-facing trust chip for listing cards.
 * Prefer rated reviews; else order count; else "New kitchen".
 * Never show a naked ★5.0 with 0-2 reviews.
 */
export function listingTrustLabel(input: ListingTrustInput): string | null {
  const reviews = Number(input.reviews) || 0;
  const rating = Number(input.rating) || 0;
  if (reviews >= MIN_REVIEWS_FOR_LISTING_STAR && rating > 0) {
    return `${rating.toFixed(1)} (${reviews})`;
  }
  const orders = Number(input.completedOrders) || 0;
  if (orders > 0) {
    return `${orders} order${orders === 1 ? '' : 's'}`;
  }
  return 'New kitchen';
}

export function listingTrustShowsStar(input: ListingTrustInput): boolean {
  const reviews = Number(input.reviews) || 0;
  const rating = Number(input.rating) || 0;
  return reviews >= MIN_REVIEWS_FOR_LISTING_STAR && rating > 0;
}

/** Shorter store name for tight cards: "Mountain High Studio Cafe" → "Mountain High". */
export function listingStoreChip(name: string | null | undefined): string {
  const raw = String(name || '')
    .replace(/^\[(ARCHIVED|HOLD)\]\s*/i, '')
    .trim();
  if (!raw) return '';
  const stripped = raw
    .replace(/\s+(studio\s+)?(cafe|kitchen|bakes?|foods?|homestyle|home\s*foods?|eatery|canteen)$/i, '')
    .trim();
  return stripped || raw;
}
