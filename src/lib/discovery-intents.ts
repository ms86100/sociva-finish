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
      imageUrl: firstImage(g.products),
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
        imageUrl: firstImage(foodProducts.filter((p) => productMatchesFoodFacets(p, facet as any))),
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
