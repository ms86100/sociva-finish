/**
 * Buyer chip groups. Product category slugs stay as stored.
 * Coaching is shown with Tuition. Beauty is shown with Salon.
 */
const BUYER_CHIP_ALIASES: Record<string, string> = {
  coaching: 'tuition',
  beauty: 'salon',
};

export function buyerChipCategory(category: string | null | undefined): string | null {
  if (!category) return null;
  return BUYER_CHIP_ALIASES[category] || category;
}

export function isBuyerChipAlias(category: string | null | undefined): boolean {
  return !!category && category in BUYER_CHIP_ALIASES;
}

/** Slugs that belong on a tapped chip, including the chip itself. */
export function categoriesForBuyerChip(chipId: string): string[] {
  const aliases = Object.entries(BUYER_CHIP_ALIASES)
    .filter(([, canonical]) => canonical === chipId)
    .map(([alias]) => alias);
  return [chipId, ...aliases];
}

export function categoryMatchesBuyerChip(
  productCategory: string | null | undefined,
  chipId: string | null | undefined,
): boolean {
  if (!chipId) return true;
  return buyerChipCategory(productCategory) === chipId;
}
