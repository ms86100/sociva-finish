import { shouldShowMonetaryPrice } from '@/lib/marketplace-constants';

export function suggestionShowsPrice(
  actionType?: string | null,
  price?: number | null,
): boolean {
  return shouldShowMonetaryPrice(actionType, price);
}

type LiveProduct = {
  category?: string | null;
  is_available?: boolean | null;
};

type LiveSeller = {
  matching_products?: LiveProduct[] | null;
};

export function liveCategorySlugs(sellers: LiveSeller[] | null | undefined): Set<string> {
  const slugs = new Set<string>();
  for (const seller of sellers || []) {
    for (const product of seller.matching_products || []) {
      if (!product?.category || product.is_available === false) continue;
      slugs.add(product.category);
    }
  }
  return slugs;
}

export function categoryIsSuggestable(
  slug: string,
  isActive: boolean | undefined,
  liveSlugs: Set<string>,
  marketplaceReady: boolean,
): boolean {
  if (!marketplaceReady || isActive === false) return false;
  return liveSlugs.has(slug);
}
