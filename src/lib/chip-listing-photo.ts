import {
  CATEGORY_PRIMARY_MEAL,
  inferFoodFacets,
  productMatchesFoodFacets,
  type FoodMealId,
  type TasteMood,
} from '@/lib/food-facets';

type ChipListing = {
  category?: string | null;
  tags?: string[] | null;
  cuisine_type?: string | null;
  name?: string;
  image_url?: string | null;
};

/**
 * Meal the listing actually belongs to for chip photos:
 * 1. Category leaf that is a meal (snacks, breakfast_items)
 * 2. Explicit meal: tag
 * 3. Name hints
 */
export function listingPrimaryMeal(product: ChipListing): FoodMealId | null {
  const categoryMeal = CATEGORY_PRIMARY_MEAL[String(product.category || '').trim()];
  if (categoryMeal) return categoryMeal;
  const tagged = (product.tags || [])
    .map((tag) => String(tag || ''))
    .find((tag) => tag.startsWith('meal:'));
  if (tagged) {
    const id = tagged.slice('meal:'.length);
    if (id === 'breakfast' || id === 'lunch' || id === 'dinner' || id === 'snack') return id;
  }
  return inferFoodFacets(product.name || '').meal;
}

/** Prefer a photo that is not already on another chip. Never invent a stock URL. */
export function pickListingChipPhoto<T extends { image_url?: string | null }>(
  products: readonly T[],
  used: Set<string>,
): string | null {
  const photos = products
    .map((product) => product.image_url)
    .filter((url): url is string => !!url && url.trim().length > 0);
  const fresh = photos.find((url) => !used.has(url));
  const url = fresh || photos[0] || null;
  if (url) used.add(url);
  return url;
}

/**
 * Listings whose photo may represent this mood chip.
 * Meal chips prefer items whose primary meal is this meal so a snacks
 * listing cannot illustrate Breakfast.
 */
export function listingsForMoodChip<T extends ChipListing>(
  products: readonly T[],
  mood: Pick<TasteMood, 'facet' | 'value'>,
): T[] {
  const selected = {
    cuisine: mood.facet === 'cuisine' ? mood.value : null,
    meal: mood.facet === 'meal' ? mood.value : null,
    course: mood.facet === 'course' ? mood.value : null,
  };
  const matches = products.filter((product) => productMatchesFoodFacets(product, selected as any));
  if (mood.facet !== 'meal') return matches;
  const preferred = matches.filter((product) => listingPrimaryMeal(product) === mood.value);
  return preferred.length > 0 ? preferred : matches;
}

export function listingPhotoForFacet<T extends ChipListing>(
  products: readonly T[],
  mood: Pick<TasteMood, 'facet' | 'value'>,
  used: Set<string>,
): string | null {
  return pickListingChipPhoto(listingsForMoodChip(products, mood), used);
}
