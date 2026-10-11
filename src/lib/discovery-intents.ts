import {
  TASTE_MOODS,
  isFoodParentGroup,
  productMatchesFoodFacets,
  foodFacetsBrowsePath,
  type TasteMood,
} from '@/lib/food-facets';

export interface DiscoveryCategoryInput {
  category: string;
  parentGroup: string;
  displayName: string;
  icon: string;
  imageUrl?: string | null;
  products: Array<{
    id?: string;
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

function firstImage(products: DiscoveryCategoryInput['products']): string | null {
  return products.find((p) => p.image_url)?.image_url || null;
}

function moodCount(mood: TasteMood, products: DiscoveryCategoryInput['products']): number {
  const selected = {
    cuisine: mood.facet === 'cuisine' ? mood.value : null,
    meal: mood.facet === 'meal' ? mood.value : null,
    course: mood.facet === 'course' ? mood.value : null,
  };
  return products.filter((p) => productMatchesFoodFacets(p, selected as any)).length;
}

/**
 * Homepage / search shortcuts from live inventory only.
 * Never emits a chip whose result set is empty.
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

  const categoryIntents: DiscoveryIntent[] = scoped
    .filter((g) => g.products.length > 0)
    .map((g) => ({
      id: `cat:${g.category}`,
      label: g.displayName,
      icon: g.icon,
      imageUrl: firstImage(g.products) || g.imageUrl || null,
      count: g.products.length,
      href: `/category/${g.parentGroup}?sub=${encodeURIComponent(g.category)}`,
      kind: 'category' as const,
    }))
    .sort((a, b) => b.count - a.count);

  const foodProducts = scoped
    .filter((g) => isFoodParentGroup(g.parentGroup))
    .flatMap((g) => g.products);

  const moodIntents: DiscoveryIntent[] = [];
  if (foodProducts.length > 0 && (!activeGroup || isFoodParentGroup(activeGroup))) {
    for (const mood of TASTE_MOODS) {
      const count = moodCount(mood, foodProducts);
      if (count <= 0) continue;
      const facet = { cuisine: null, meal: null, course: null, [mood.facet]: mood.value };
      moodIntents.push({
        id: `mood:${mood.id}`,
        label: mood.label,
        icon: mood.emoji,
        imageUrl: firstImage(foodProducts.filter((p) => productMatchesFoodFacets(p, facet as any))) || mood.imageUrl || null,
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

  const seen = new Set<string>();
  const unique: DiscoveryIntent[] = [];
  for (const intent of mixed) {
    if (intent.count <= 0) continue;
    if (seen.has(intent.id)) continue;
    seen.add(intent.id);
    unique.push(intent);
    if (unique.length >= maxChips) break;
  }
  return unique;
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

  const categoryIntents: DiscoveryIntent[] = groups
    .map((group) => {
      const products = hasFacet
        ? group.products.filter((product) => productMatchesFoodFacets(product, facets))
        : group.products;
      if (products.length === 0) return null;
      return {
        id: `cat:${group.category}`,
        label: group.displayName,
        icon: group.icon,
        imageUrl: firstImage(products) || group.imageUrl || null,
        count: products.length,
        href: `/category/${group.parentGroup}?sub=${encodeURIComponent(group.category)}`,
        kind: 'category' as const,
      };
    })
    .filter((intent): intent is DiscoveryIntent => intent !== null)
    .sort((a, b) => b.count - a.count);

  const moodScope = (category
    ? groups.filter((group) => group.category === category)
    : groups.filter((group) => isFoodParentGroup(group.parentGroup))
  ).flatMap((group) => group.products);

  const moodIntents: DiscoveryIntent[] = [];
  if (moodScope.length > 0) {
    for (const mood of TASTE_MOODS) {
      const count = moodCount(mood, moodScope);
      if (count <= 0) continue;
      const facet = { cuisine: null, meal: null, course: null, [mood.facet]: mood.value };
      moodIntents.push({
        id: `mood:${mood.id}`,
        label: mood.label,
        icon: mood.emoji,
        imageUrl: firstImage(moodScope.filter((product) => productMatchesFoodFacets(product, facet as any))) || mood.imageUrl || null,
        count,
        href: foodFacetsBrowsePath(
          groups.find((group) => isFoodParentGroup(group.parentGroup))?.parentGroup || 'food_beverages',
          { [mood.facet]: mood.value },
        ),
        kind: 'food_mood',
      });
    }
  }

  return [...categoryIntents, ...moodIntents];
}
