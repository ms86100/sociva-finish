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

const DISH_NAME_HINT =
  /\b(thali|biryani|rice|curry|paratha|dosa|idli|roti|chapati|paneer|chicken|mutton|dal|sabzi|bharta|bhurji|poha|pulao|khichdi|momos?|noodle|pasta|salad|pickle|rasgulla|samosa|pakoda|cutlet|meal|fry|masala|raita|kadhi|rajma|chole|chola|puri|poori|aloo|gobhi|gobi|potato|mushroom)\b/i;

const CHIP_PHOTO_DEPRIORITIZE = /\b(madhubani|makhana)\b/i;
const CHIP_PHOTO_PREFER =
  /\b(samosa|pakoda|pakora|fries|chips|namkeen|cookie|biscuit|mixture|sev|mathri|chaat|kachori|cutlet|momos?|chops|bhujia)\b/i;

function chipPhotoRank(name: string): number {
  if (CHIP_PHOTO_DEPRIORITIZE.test(name)) return 2;
  if (CHIP_PHOTO_PREFER.test(name) || DISH_NAME_HINT.test(name)) return 0;
  return 1;
}

/**
 * Prefer a photo that is not already on another chip.
 * Returns null when every candidate is already used so curated art can fill
 * the gap instead of recycling the same biryani or leaving a blank chip.
 */
export function pickListingChipPhoto<T extends { image_url?: string | null; name?: string }>(
  products: readonly T[],
  used: Set<string>,
): string | null {
  const withPhotos = products.filter((product) => !!product.image_url && product.image_url.trim().length > 0);
  const ranked = [...withPhotos].sort(
    (a, b) => chipPhotoRank(a.name || '') - chipPhotoRank(b.name || ''),
  );
  const unusedAppealing = ranked.find(
    (product) => chipPhotoRank(product.name || '') < 2 && !used.has(product.image_url as string),
  );
  const unusedAny = ranked.find((product) => !used.has(product.image_url as string));
  const picked = unusedAppealing || unusedAny || null;
  const url = picked?.image_url || null;
  if (url) used.add(url);
  return url;
}

/** Prefer a plated dish photo over logos, pamphlets, and storefront shots. */
export function pickDishListingPhoto<T extends { name?: string; image_url?: string | null }>(
  products: readonly T[],
  used?: Set<string>,
): string | null {
  const candidates = products.filter((product) => !!product.image_url && product.image_url.trim().length > 0);
  const ranked = [
    ...candidates.filter((product) => DISH_NAME_HINT.test(product.name || '')),
    ...candidates.filter((product) => !DISH_NAME_HINT.test(product.name || '')),
  ];
  const unused = ranked.find((product) => !used || !used.has(product.image_url as string));
  // With a used-set, never recycle; without one, keep the best dish photo.
  const picked = used ? unused : (unused || ranked[0]);
  const url = picked?.image_url || null;
  if (url && used) used.add(url);
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
