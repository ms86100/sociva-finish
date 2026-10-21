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
 * Legacy Home poster builder. Home no longer mounts these rows: chips and
 * curated rails already cover browse. Keep returning [] so a stray call
 * cannot bring back one-card rows with empty space.
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
  void groups;
  void options;
  return [];
}
