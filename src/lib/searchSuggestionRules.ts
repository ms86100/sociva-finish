import { shouldShowMonetaryPrice } from '@/lib/marketplace-constants';
import { modeForAction, resolveListingAction, type CategoryActionConfig } from '@/lib/commerce-mode';

export type SuggestionIntent = 'products' | 'services' | 'bookable' | 'enquiries';

export function suggestionIntent(
  product: { action_type?: string | null; category?: string | null },
  categoryConfigs?: readonly CategoryActionConfig[] | null,
): SuggestionIntent {
  const action = resolveListingAction(product.action_type, product.category, categoryConfigs);
  const mode = modeForAction(action);
  if (mode === 'shop') return 'products';
  if (mode === 'book') return 'bookable';
  return action === 'request_service' ? 'services' : 'enquiries';
}

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
