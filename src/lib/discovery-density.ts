/** Category poster blocks need a row of listings, not one lonely card. */
export const MIN_SECTION_LISTINGS = 3;

/** Horizontal seller rows and 2-column product rails need a pair. */
export const MIN_RAIL_CARDS = 2;

export function hasPosterDensity(listingCount: number): boolean {
  return listingCount >= MIN_SECTION_LISTINGS;
}

export function hasRailDensity(cardCount: number): boolean {
  return cardCount >= MIN_RAIL_CARDS;
}

export interface ShopPosterGroup {
  category: string;
  parentGroup: string;
  products: readonly unknown[];
}

export interface ShopPosterSection {
  key: string;
  parentGroup: string;
  title: string;
  categories: Set<string>;
}

/**
 * Home poster sections. Thin leaves (1-2 listings) stay on chips and the
 * product grid instead of a full-width Restaurant-style block.
 */
export function buildShopPosterSections(
  groups: readonly ShopPosterGroup[],
  options: {
    festivalFocused?: boolean;
    activeCategory?: string | null;
    titleFor: (category: string) => string;
    parentGroupFor?: (category: string) => string | undefined;
    displayOrderFor?: (category: string) => number;
    categoriesForChip?: (chipId: string) => string[];
  },
): ShopPosterSection[] {
  if (options.festivalFocused) return [];

  if (options.activeCategory) {
    const matching = new Set(
      options.categoriesForChip
        ? options.categoriesForChip(options.activeCategory)
        : [options.activeCategory],
    );
    const count = groups
      .filter((group) => matching.has(group.category))
      .reduce((sum, group) => sum + group.products.length, 0);
    if (!hasPosterDensity(count)) return [];
    const group = groups.find((item) => item.category === options.activeCategory)
      || groups.find((item) => matching.has(item.category));
    const parentGroup = options.parentGroupFor?.(options.activeCategory) || group?.parentGroup;
    if (!parentGroup) return [];
    return [{
      key: options.activeCategory,
      parentGroup,
      title: options.titleFor(options.activeCategory),
      categories: matching,
    }];
  }

  return [...groups]
    .filter((group) => hasPosterDensity(group.products.length))
    .sort((a, b) => {
      const aOrder = options.displayOrderFor?.(a.category) ?? 999;
      const bOrder = options.displayOrderFor?.(b.category) ?? 999;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return options.titleFor(a.category).localeCompare(options.titleFor(b.category));
    })
    .map((group) => ({
      key: group.category,
      parentGroup: group.parentGroup,
      title: options.titleFor(group.category),
      categories: new Set([group.category]),
    }));
}
