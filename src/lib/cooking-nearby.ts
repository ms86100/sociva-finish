import { computeStoreStatus } from '@/lib/store-availability';
import { displaySellerStoreName } from '@/lib/seller-journey';
import { isFoodListingCategory } from '@/lib/food-facets';

export const COOKING_NEARBY_HEADING = 'Cooking nearby';

export interface CookingNearbyListing {
  id?: string;
  category?: string | null;
  parentGroup?: string | null;
  image_url?: string | null;
  seller_id?: string | null;
  seller_name?: string | null;
  seller_is_available?: boolean | null;
  seller_availability_start?: string | null;
  seller_availability_end?: string | null;
  seller_operating_days?: string[] | null;
  seller_profile_image_url?: string | null;
}

export interface CookingNearbyKitchen {
  sellerId: string;
  name: string;
  imageUrl: string | null;
  open: boolean;
  href: string;
}

/** Short first-name style label for the story circle (Meera's Kitchen -> Meera). */
export function cookingNearbyDisplayName(raw: string | null | undefined): string {
  const store = displaySellerStoreName(raw, '') || String(raw || '').trim();
  if (!store) return 'Neighbor';
  const first = store.split(/\s+/)[0]?.replace(/['’].*$/, '') || store;
  return first.length > 12 ? `${first.slice(0, 11)}...` : first;
}

/**
 * Unique food kitchens for the Home Lobby "Cooking nearby" strip.
 * Open kitchens first; profile photo preferred, then a dish photo.
 */
export function buildCookingNearbyKitchens(
  listings: readonly CookingNearbyListing[],
  options?: {
    limit?: number;
    categoryConfigs?: readonly { category: string; parentGroup?: string | null }[] | null;
    sellerImages?: ReadonlyMap<string, { profileImage: string | null; coverImage: string | null }>;
  },
): CookingNearbyKitchen[] {
  const limit = options?.limit ?? 8;
  const bySeller = new Map<string, CookingNearbyKitchen>();

  for (const listing of listings) {
    const sellerId = String(listing.seller_id || '').trim();
    if (!sellerId || bySeller.has(sellerId)) continue;

    const config = options?.categoryConfigs?.find((row) => row.category === listing.category);
    const isFood = isFoodListingCategory(
      config?.parentGroup || listing.parentGroup,
      listing.category,
    );
    if (!isFood) continue;

    const status = computeStoreStatus(
      listing.seller_availability_start,
      listing.seller_availability_end,
      listing.seller_operating_days,
      listing.seller_is_available ?? true,
    );
    const open = status.status === 'open';
    const images = options?.sellerImages?.get(sellerId);
    const imageUrl =
      images?.profileImage
      || listing.seller_profile_image_url
      || listing.image_url
      || images?.coverImage
      || null;

    bySeller.set(sellerId, {
      sellerId,
      name: cookingNearbyDisplayName(listing.seller_name),
      imageUrl,
      open,
      href: `/seller/${sellerId}`,
    });
  }

  const ranked = [...bySeller.values()].sort((a, b) => Number(b.open) - Number(a.open));
  return ranked.slice(0, limit);
}
