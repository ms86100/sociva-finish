/** Buyer-facing store context for cart / checkout line items. */

export type CartSellerInsights = {
  storeName: string;
  locationLabel: string | null;
  distanceLabel: string | null;
  prepLabel: string | null;
  ratingLabel: string | null;
  isVeg: boolean | null;
  category: string | null;
};

function formatDistanceKm(km: unknown): string | null {
  const n = typeof km === 'number' ? km : Number(km);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n < 0.1) return 'Nearby';
  if (n < 1) return `${Math.round(n * 1000)} m away`;
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} km away`;
}

export function getCartSellerInsights(product: any): CartSellerInsights {
  const seller = product?.seller;
  const storeName =
    (seller?.business_name && String(seller.business_name).trim())
    || (product?.seller_name && String(product.seller_name).trim())
    || 'Neighbourhood store';

  const locationLabel =
    (seller?.store_location_label && String(seller.store_location_label).trim())
    || (seller?.society?.name && String(seller.society.name).trim())
    || (product?.society_name && String(product.society_name).trim())
    || null;

  const prepMins = product?.prep_time_minutes ?? seller?.avg_prep_time;
  const prepLabel =
    typeof prepMins === 'number' && prepMins > 0
      ? `Ready in ~${prepMins} min`
      : null;

  const rating = product?.seller_rating ?? seller?.average_rating ?? seller?.rating;
  const ratingLabel =
    typeof rating === 'number' && rating > 0
      ? `${rating.toFixed(1)}★`
      : null;

  return {
    storeName,
    locationLabel,
    distanceLabel: formatDistanceKm(product?.distance_km),
    prepLabel,
    ratingLabel,
    isVeg: typeof product?.is_veg === 'boolean' ? product.is_veg : null,
    category: product?.category ? String(product.category) : null,
  };
}

/** One short meta line under product name on checkout. */
export function cartItemMetaLine(product: any): string | null {
  const i = getCartSellerInsights(product);
  const bits = [i.locationLabel, i.distanceLabel, i.prepLabel].filter(Boolean);
  return bits.length ? bits.join(' · ') : null;
}
