import type { FoodCuisineId, FoodMealId } from '@/lib/food-facets';
import neighborHero from '@/assets/sociva-neighbor-hero.jpg';
import homeFoodCategory from '@/assets/categories/home-food.jpg';
import snacksCategory from '@/assets/categories/snacks.jpg';

/**
 * Locked destination art for food chips and meal-time tiles.
 * Live listing photos may enrich a chip, but these URLs guarantee
 * Breakfast / Cafe / Pickles / Home Food never render as a blank circle.
 */
export const CURATED_MEAL_ART: Record<FoodMealId, string> = {
  breakfast:
    'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?auto=format&fit=crop&w=600&q=80',
  lunch:
    'https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=600&q=80',
  dinner:
    'https://images.unsplash.com/photo-1565557623262-b51c2513a641?auto=format&fit=crop&w=600&q=80',
  snack:
    'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=600&q=80',
};

/** Wide hero for Home / Home Food - local bundled art so the banner never goes black. */
export const HOME_FOOD_HERO_ART: string = neighborHero;

/** Wide hero for Restaurant Food Room. */
export const RESTAURANT_FOOD_HERO_ART: string = homeFoodCategory;

/** Category chips - Home Food uses bundled art so it never blanks when listing thumbs fail. */
export const CURATED_CATEGORY_ART: Record<string, string> = {
  home_food: homeFoodCategory,
  cafe:
    'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=600&q=80',
  snacks: snacksCategory,
  pickles:
    'https://images.unsplash.com/photo-1592419044706-39796d40f98c?auto=format&fit=crop&w=600&q=80',
  restaurant:
    'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=600&q=80',
  breakfast_items: CURATED_MEAL_ART.breakfast,
};

/** Cuisine filter chips (South / North / Chinese...) always have identifiable food art. */
export const CURATED_CUISINE_ART: Record<FoodCuisineId, string> = {
  south_indian:
    'https://images.unsplash.com/photo-1630383249896-424e482df921?auto=format&fit=crop&w=600&q=80',
  north_indian:
    'https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=600&q=80',
  chinese:
    'https://images.unsplash.com/photo-1525755662778-989d0524087e?auto=format&fit=crop&w=600&q=80',
  tandoori:
    'https://images.unsplash.com/photo-1599487488170-d11ec9c172f3?auto=format&fit=crop&w=600&q=80',
  continental:
    'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80',
  other: CURATED_MEAL_ART.lunch,
};

export function curatedMealArt(meal: FoodMealId | string | null | undefined): string | null {
  if (!meal) return null;
  return CURATED_MEAL_ART[meal as FoodMealId] || null;
}

export function curatedCategoryArt(category: string | null | undefined): string | null {
  if (!category) return null;
  return CURATED_CATEGORY_ART[category] || null;
}

export function curatedCuisineArt(cuisine: FoodCuisineId | string | null | undefined): string | null {
  if (!cuisine) return null;
  const key = String(cuisine).trim().toLowerCase().replace(/\s+/g, '_');
  return CURATED_CUISINE_ART[key as FoodCuisineId] || null;
}

/** Infer cuisine from listing name/tags when cuisine_type is missing. */
export function inferCuisineFromListing(listing: {
  name?: string | null;
  tags?: string[] | null;
  cuisine_type?: string | null;
}): FoodCuisineId | null {
  if (listing.cuisine_type) {
    const key = String(listing.cuisine_type).trim().toLowerCase().replace(/\s+/g, '_');
    if (key in CURATED_CUISINE_ART) return key as FoodCuisineId;
  }
  const hay = [
    String(listing.name || ''),
    ...(listing.tags || []).map(String),
  ].join(' ').toLowerCase();
  if (/dosa|idli|sambar|rasam|uttapam|vada|filter coffee|south indian/.test(hay)) return 'south_indian';
  if (/butter chicken|dal makhani|paneer tikka|north indian|roti|naan/.test(hay)) return 'north_indian';
  if (/fried rice|noodles|manchurian|hakka|chinese/.test(hay)) return 'chinese';
  if (/tandoori|seekh|kebab/.test(hay)) return 'tandoori';
  return null;
}

/**
 * Display art for a listing card. Prefer live photo; if missing, use cuisine /
 * meal / category curated art so South dishes never render as a blank block.
 */
export function listingDisplayArt(listing: {
  image_url?: string | null;
  category?: string | null;
  cuisine_type?: string | null;
  tags?: string[] | null;
  name?: string | null;
}): string | null {
  const live = String(listing.image_url || '').trim();
  if (live) return live;
  const cuisine = inferCuisineFromListing(listing);
  const mealTag = (listing.tags || [])
    .map((tag) => String(tag).toLowerCase())
    .find((tag) => tag.startsWith('meal:'));
  const meal = mealTag ? mealTag.slice('meal:'.length) : null;
  return curatedCuisineArt(cuisine)
    || curatedMealArt(meal)
    || curatedCategoryArt(listing.category);
}

/** Fallback when a live listing URL 404s - never leave a blank gray tile. */
export function listingArtFallback(listing: {
  image_url?: string | null;
  category?: string | null;
  cuisine_type?: string | null;
  tags?: string[] | null;
  name?: string | null;
}): string | null {
  const cuisine = inferCuisineFromListing(listing);
  const mealTag = (listing.tags || [])
    .map((tag) => String(tag).toLowerCase())
    .find((tag) => tag.startsWith('meal:'));
  const meal = mealTag ? mealTag.slice('meal:'.length) : null;
  const curated = curatedCuisineArt(cuisine)
    || curatedMealArt(meal)
    || curatedCategoryArt(listing.category);
  const live = String(listing.image_url || '').trim();
  if (curated && curated !== live) return curated;
  return curatedCategoryArt('home_food');
}

/**
 * Prefer a fresh live listing photo. If none is left unused, fall back to
 * curated art so the chip is never blank. Marks the chosen URL as used.
 */
export function resolveFoodChipArt(
  liveUrl: string | null | undefined,
  opts: {
    meal?: FoodMealId | null;
    category?: string | null;
    cuisine?: FoodCuisineId | string | null;
  },
  used: Set<string>,
): string | null {
  const live = String(liveUrl || '').trim();
  if (live && !used.has(live)) {
    used.add(live);
    return live;
  }
  const curated =
    curatedMealArt(opts.meal)
    || curatedCuisineArt(opts.cuisine)
    || curatedCategoryArt(opts.category);
  if (curated && !used.has(curated)) {
    used.add(curated);
    return curated;
  }
  if (curated) return curated;
  if (live) return live;
  return null;
}

/** Unique kitchens behind a meal tile - never a wild 20-360 min range. */
export function guidedKitchenCountLabel(
  listings: readonly { seller_id?: string | null; seller_name?: string | null }[],
): string {
  const ids = new Set(
    listings.map((row) => String(row.seller_id || '').trim()).filter(Boolean),
  );
  if (ids.size > 0) return ids.size === 1 ? '1 kitchen' : `${ids.size} kitchens`;

  const names = new Set(
    listings.map((row) => String(row.seller_name || '').trim()).filter(Boolean),
  );
  if (names.size > 0) return names.size === 1 ? '1 kitchen' : `${names.size} kitchens`;

  const n = listings.length;
  if (n <= 0) return '';
  return n === 1 ? '1 dish' : `${n} dishes`;
}

/** Unique restaurant / cafe spots for Room aisle chips. */
export function guidedSpotCountLabel(
  listings: readonly { seller_id?: string | null; seller_name?: string | null }[],
): string {
  const ids = new Set(
    listings.map((row) => String(row.seller_id || '').trim()).filter(Boolean),
  );
  if (ids.size > 0) return ids.size === 1 ? '1 spot' : `${ids.size} spots`;

  const names = new Set(
    listings.map((row) => String(row.seller_name || '').trim()).filter(Boolean),
  );
  if (names.size > 0) return names.size === 1 ? '1 spot' : `${names.size} spots`;

  const n = listings.length;
  if (n <= 0) return '';
  return n === 1 ? '1 dish' : `${n} dishes`;
}
