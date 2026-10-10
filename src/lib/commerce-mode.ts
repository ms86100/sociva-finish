import type { ProductActionType } from '@/types/Database';
import { deriveActionType } from '@/lib/marketplace-constants';

/**
 * Buyer-facing commerce modes. Mirrors action_type_workflow_map.checkout_mode:
 * cart -> shop, booking -> book, inquiry/contact -> services.
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
