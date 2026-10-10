import type { ProductActionType } from '@/types/Database';
import { deriveActionType } from '@/lib/marketplace-constants';

/**
 * Buyer-facing commerce modes. Mirrors action_type_workflow_map.checkout_mode:
 * cart -> home (the Shop tab is retired; /shop redirects there),
 * booking -> book, inquiry/contact -> services.
 */
export type CommerceMode = 'shop' | 'book' | 'services';

export const ACTION_TO_MODE: Record<ProductActionType, CommerceMode> = {
  add_to_cart: 'shop',
  buy_now: 'shop',
  book: 'book',
  schedule_visit: 'book',
  request_service: 'services',
  request_quote: 'services',
  make_offer: 'services',
  contact_seller: 'services',
};

export interface CategoryActionConfig {
  category: string;
  transactionType?: string | null;
  behavior?: { supportsCart?: boolean; enquiryOnly?: boolean } | null;
}

/**
 * The single buyer-side action resolver: product override, then category
 * transaction_type, then category behavior flags (see deriveActionType).
 */
export function resolveListingAction(
  actionType: string | null | undefined,
  category: string | null | undefined,
  categoryConfigs?: readonly CategoryActionConfig[] | null,
): ProductActionType {
  const cfg = category ? categoryConfigs?.find((c) => c.category === category) : undefined;
  return deriveActionType(
    actionType ?? null,
    cfg?.transactionType ?? null,
    cfg
      ? { supportsCart: cfg.behavior?.supportsCart, enquiryOnly: cfg.behavior?.enquiryOnly }
      : null,
  );
}

export function modeForAction(action: ProductActionType): CommerceMode {
  return ACTION_TO_MODE[action] ?? 'shop';
}

export function resolveCommerceMode(
  listing: { action_type?: string | null; category?: string | null },
  categoryConfigs?: readonly CategoryActionConfig[] | null,
): CommerceMode {
  return modeForAction(resolveListingAction(listing.action_type, listing.category, categoryConfigs));
}

export function filterByMode<T extends { action_type?: string | null; category?: string | null }>(
  listings: readonly T[],
  mode: CommerceMode,
  categoryConfigs?: readonly CategoryActionConfig[] | null,
): T[] {
  return listings.filter((l) => resolveCommerceMode(l, categoryConfigs) === mode);
}

/**
 * A photo chip belongs to the mode with the most listings in that category.
 * A tie uses the category's own transaction type so Salon is not repeated
 * on Book and Contact.
 */
export function owningModeForCategory(
  counts: Partial<Record<CommerceMode, number>>,
  category: string,
  categoryConfigs?: readonly CategoryActionConfig[] | null,
): CommerceMode | null {
  const shop = counts.shop || 0;
  const book = counts.book || 0;
  const services = counts.services || 0;
  if (shop + book + services === 0) return null;
  const ranked: [CommerceMode, number][] = [
    ['shop', shop],
    ['book', book],
    ['services', services],
  ];
  const max = Math.max(shop, book, services);
  const winners = ranked.filter(([, n]) => n === max).map(([mode]) => mode);
  if (winners.length === 1) return winners[0];
  const fallback = resolveCommerceMode({ action_type: null, category }, categoryConfigs);
  return winners.includes(fallback) ? fallback : winners[0];
}

export function categoriesOwnedByMode(
  buckets: Record<CommerceMode, readonly { category?: string | null }[]>,
  mode: CommerceMode,
  categoryConfigs?: readonly CategoryActionConfig[] | null,
): Set<string> {
  const counts = new Map<string, Record<CommerceMode, number>>();
  const modes: CommerceMode[] = ['shop', 'book', 'services'];
  for (const bucketMode of modes) {
    for (const listing of buckets[bucketMode] || []) {
      const category = listing.category;
      if (!category) continue;
      const row = counts.get(category) || { shop: 0, book: 0, services: 0 };
      row[bucketMode] += 1;
      counts.set(category, row);
    }
  }
  const owned = new Set<string>();
  for (const [category, row] of counts) {
    if ((row[mode] || 0) > 0 && owningModeForCategory(row, category, categoryConfigs) === mode) {
      owned.add(category);
    }
  }
  return owned;
}
