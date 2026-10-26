import {
  TASTE_MOODS,
  CATEGORY_PRIMARY_MEAL,
  isFoodParentGroup,
  productMatchesFoodFacets,
  listingMatchesCategoryChip,
  mealOwnedByCategoryChip,
  foodFacetsBrowsePath,
  type TasteMood,
} from '@/lib/food-facets';
import { listingPhotoForFacet, pickListingChipPhoto } from '@/lib/chip-listing-photo';
import { curatedCuisineArt, curatedMealArt, resolveFoodChipArt } from '@/lib/food-chip-art';
import type { FoodMealId } from '@/lib/food-facets';

export interface DiscoveryCategoryInput {
  category: string;
  parentGroup: string;
  displayName: string;
  icon: string;
  imageUrl?: string | null;
  products: Array<{
    id?: string;
    category?: string | null;
    image_url?: string | null;
    tags?: string[] | null;
    cuisine_type?: string | null;
    name?: string;
  }>;
}

export interface DiscoveryIntent {
  id: string;
  label: string;
  icon: string;
  imageUrl: string | null;
  count: number;
  href: string;
  kind: 'category' | 'food_mood';
}

/** Home Lobby snippet chip order from the approved mockup. */
export const LOBBY_SNIPPET_CHIP_IDS = [
  'cat:home_food',
  'cat:cafe',
  'cat:snacks',
  'cat:pickles',
  'mood:breakfast',
] as const;

/**
 * Prefer the mockup 5-chip row (Home Food, Cafe, Snacks, Pickles, Breakfast).
 * Falls back to the next live chips when a preferred slot has no inventory.
 * If Breakfast mood was folded into a category chip, still surface it for Lobby parity.
 */
export function orderLobbySnippetChips(
  intents: readonly DiscoveryIntent[],
  limit = 5,
): DiscoveryIntent[] {
  const byId = new Map(intents.map((intent) => [intent.id, intent]));
  if (!byId.has('mood:breakfast')) {
    const breakfastArt = curatedMealArt('breakfast');
    byId.set('mood:breakfast', {
      id: 'mood:breakfast',
      label: 'Breakfast',
      icon: 'Coffee',
      imageUrl: breakfastArt,
      count: Math.max(1, intents.find((intent) => intent.id === 'cat:home_food')?.count || 0),
      href: foodFacetsBrowsePath('food_beverages', { meal: 'breakfast' }),
      kind: 'food_mood',
    });
  }

  const picked: DiscoveryIntent[] = [];
  const used = new Set<string>();

  for (const id of LOBBY_SNIPPET_CHIP_IDS) {
    const hit = byId.get(id);
    if (!hit || used.has(hit.id)) continue;
    // Prefer slots that exist in live inventory, except Breakfast which is always shown
    if (hit.count <= 0 && hit.id !== 'mood:breakfast') continue;
    picked.push(hit);
    used.add(hit.id);
    if (picked.length >= limit) return picked;
  }

  for (const intent of intents) {
    if (used.has(intent.id)) continue;
    picked.push(intent);
    used.add(intent.id);
    if (picked.length >= limit) break;
  }
  return picked;
}

function listingsInGroup(group: DiscoveryCategoryInput) {
  return group.products.map((product) => ({
    ...product,
    category: product.category || group.category,
  }));
}

function moodCount(mood: TasteMood, products: ReturnType<typeof listingsInGroup>): number {
  const selected = {
    cuisine: mood.facet === 'cuisine' ? mood.value : null,
    meal: mood.facet === 'meal' ? mood.value : null,
    course: mood.facet === 'course' ? mood.value : null,
  };
  return products.filter((p) => productMatchesFoodFacets(p, selected as any)).length;
}

function liveCategoryIds(groups: DiscoveryCategoryInput[]): Set<string> {
  return new Set(groups.filter((group) => group.products.length > 0).map((group) => group.category));
}

function chipCountForGroup(
  group: DiscoveryCategoryInput,
  allListings: ReturnType<typeof listingsInGroup>,
): number {
  if (!CATEGORY_PRIMARY_MEAL[group.category]) return group.products.length;
  return allListings.filter((product) => listingMatchesCategoryChip(product, group.category)).length;
}

function photoPoolForGroup(
  group: DiscoveryCategoryInput,
  allListings: ReturnType<typeof listingsInGroup>,
) {
  const own = listingsInGroup(group);
  if (!CATEGORY_PRIMARY_MEAL[group.category]) return own;
  const matched = allListings.filter((product) => listingMatchesCategoryChip(product, group.category));
  return matched.length > 0 ? matched : own;
}

function takeUniqueIntents(intents: DiscoveryIntent[], maxChips?: number): DiscoveryIntent[] {
  const seenIds = new Set<string>();
  const seenLabels = new Set<string>();
  const unique: DiscoveryIntent[] = [];
  for (const intent of intents) {
    if (intent.count <= 0) continue;
    if (seenIds.has(intent.id)) continue;
    const labelKey = intent.label.trim().toLowerCase();
    if (seenLabels.has(labelKey)) continue;
    seenIds.add(intent.id);
    seenLabels.add(labelKey);
    unique.push(intent);
    if (maxChips != null && unique.length >= maxChips) break;
  }
  return unique;
}

/**
 * Homepage / search shortcuts from live inventory only.
 * Never emits a chip whose result set is empty.
 * Chip photos are listing images: one listing per chip, unused photos first.
 */
export function buildDiscoveryIntents(
  groups: DiscoveryCategoryInput[],
  options?: { activeGroup?: string | null; maxChips?: number },
): DiscoveryIntent[] {
  const activeGroup = options?.activeGroup || null;
  const maxChips = options?.maxChips ?? 12;
  const scoped = activeGroup
    ? groups.filter((g) => g.parentGroup === activeGroup)
    : groups;
  const usedPhotos = new Set<string>();
  const scopedListings = scoped.flatMap((g) => listingsInGroup(g));
  const coveredCategories = liveCategoryIds(scoped);

  const categoryIntents: DiscoveryIntent[] = scoped
    .filter((g) => g.products.length > 0)
    .map((g) => {
      // pickListingChipPhoto already claims the URL in usedPhotos when it hits.
      // Home Food falls back to bundled curated art so the circle never blanks.
      const live = pickListingChipPhoto(photoPoolForGroup(g, scopedListings), usedPhotos);
      return {
        id: `cat:${g.category}`,
        label: g.displayName,
        icon: g.icon,
        imageUrl: live || resolveFoodChipArt(g.imageUrl, { category: g.category }, usedPhotos),
        count: chipCountForGroup(g, scopedListings),
        href: `/category/${g.parentGroup}?sub=${encodeURIComponent(g.category)}`,
        kind: 'category' as const,
      };
    })
    .sort((a, b) => b.count - a.count);

  const foodProducts = scoped
    .filter((g) => isFoodParentGroup(g.parentGroup))
    .flatMap((g) => listingsInGroup(g));

  const moodIntents: DiscoveryIntent[] = [];
  if (foodProducts.length > 0 && (!activeGroup || isFoodParentGroup(activeGroup))) {
    for (const mood of TASTE_MOODS) {
      if (mealOwnedByCategoryChip(mood, coveredCategories)) continue;
      const count = moodCount(mood, foodProducts);
      if (count <= 0) continue;
      const meal = mood.facet === 'meal' ? (mood.value as FoodMealId) : null;
      const cuisine = mood.facet === 'cuisine' ? mood.value : null;
      // Meal / cuisine moods are destinations - always curated art so Breakfast
      // and South never go blank when a listing thumb is missing or broken.
      let imageUrl: string | null = null;
      if (meal) {
        const art = curatedMealArt(meal);
        if (art) {
          usedPhotos.add(art);
          imageUrl = art;
        }
      } else if (cuisine) {
        const art = curatedCuisineArt(cuisine);
        if (art) {
          usedPhotos.add(art);
          imageUrl = art;
        } else {
          const live = listingPhotoForFacet(foodProducts, mood, usedPhotos);
          imageUrl = live || resolveFoodChipArt(null, { cuisine }, usedPhotos);
        }
      } else {
        const live = listingPhotoForFacet(foodProducts, mood, usedPhotos);
        imageUrl = live || resolveFoodChipArt(null, { meal }, usedPhotos);
      }
      moodIntents.push({
        id: `mood:${mood.id}`,
        label: mood.label,
        icon: mood.emoji,
        imageUrl,
        count,
        href: foodFacetsBrowsePath('food_beverages', { [mood.facet]: mood.value }),
        kind: 'food_mood',
      });
    }
  }

  // When browsing All, lead with live categories so doctors/repairs aren't buried under meals.
  // Food moods follow only if they have stock.
  const mixed = activeGroup && isFoodParentGroup(activeGroup)
    ? [...moodIntents, ...categoryIntents]
    : [...categoryIntents, ...moodIntents];

  return takeUniqueIntents(mixed, maxChips);
}

export interface BrowseSelection {
  category?: string | null;
  facets?: Partial<{ cuisine: string | null; meal: string | null; course: string | null }>;
}

/**
 * One filter row for a category page.
 * Category chips only stay when they still have items for the active meal or cuisine.
 * Meal chips stay available so the buyer can switch, but only when that meal exists
 * in the selected category.
 */
export function relevantBrowseIntents(
  groups: DiscoveryCategoryInput[],
  selection?: BrowseSelection,
): DiscoveryIntent[] {
  const facets = {
    cuisine: selection?.facets?.cuisine || null,
    meal: selection?.facets?.meal || null,
    course: selection?.facets?.course || null,
  };
  const category = selection?.category || null;
  const hasFacet = !!(facets.cuisine || facets.meal || facets.course);
  const usedPhotos = new Set<string>();
  const allListings = groups.flatMap((group) => listingsInGroup(group));
  const coveredCategories = liveCategoryIds(groups);

  const categoryIntents: DiscoveryIntent[] = groups
    .map((group) => {
      const own = listingsInGroup(group);
      const pool = CATEGORY_PRIMARY_MEAL[group.category]
        ? allListings.filter((product) => listingMatchesCategoryChip(product, group.category))
        : own;
      const products = hasFacet
        ? pool.filter((product) => productMatchesFoodFacets(product, facets))
        : pool;
      if (products.length === 0) return null;
      const live = pickListingChipPhoto(products, usedPhotos);
      return {
        id: `cat:${group.category}`,
        label: group.displayName,
        icon: group.icon,
        imageUrl: live || resolveFoodChipArt(group.imageUrl, { category: group.category }, usedPhotos),
        count: products.length,
        href: `/category/${group.parentGroup}?sub=${encodeURIComponent(group.category)}`,
        kind: 'category' as const,
      };
    })
    .filter((intent): intent is DiscoveryIntent => intent !== null)
    .sort((a, b) => b.count - a.count);

  const moodScope = category
    ? allListings.filter((product) => listingMatchesCategoryChip(product, category))
    : groups.filter((group) => isFoodParentGroup(group.parentGroup)).flatMap((group) => listingsInGroup(group));

  const moodIntents: DiscoveryIntent[] = [];
  if (moodScope.length > 0) {
    for (const mood of TASTE_MOODS) {
      if (mealOwnedByCategoryChip(mood, coveredCategories)) continue;
      const count = moodCount(mood, moodScope);
      if (count <= 0) continue;
      const meal = mood.facet === 'meal' ? (mood.value as FoodMealId) : null;
      let imageUrl: string | null = null;
      if (meal) {
        const art = curatedMealArt(meal);
        if (art) {
          usedPhotos.add(art);
          imageUrl = art;
        }
      } else {
        const live = listingPhotoForFacet(moodScope, mood, usedPhotos);
        imageUrl = live || resolveFoodChipArt(null, { meal }, usedPhotos);
      }
      moodIntents.push({
        id: `mood:${mood.id}`,
        label: mood.label,
        icon: mood.emoji,
        imageUrl,
        count,
        href: foodFacetsBrowsePath(
          groups.find((group) => isFoodParentGroup(group.parentGroup))?.parentGroup || 'food_beverages',
          { [mood.facet]: mood.value },
        ),
        kind: 'food_mood',
      });
    }
  }

  return takeUniqueIntents([...categoryIntents, ...moodIntents]);
}
