import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ProductWithSeller } from '@/components/product/ProductListingCard';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import {
  type CategoryActionConfig,
  type CommerceMode,
  modeForAction,
  resolveListingAction,
} from '@/lib/commerce-mode';
import { useMarketplaceData, type RpcSellerRow } from './useMarketplaceData';
import { mapProduct } from './useNearbyProducts';

/** get_products_for_sellers returns at most this many listings per seller. */
export const SELLER_LISTING_CAP = 60;

const TOP_UP_PAGE_SIZE = 1000;

/** Same row shape get_products_for_sellers feeds into matching_products. */
const TOP_UP_COLUMNS =
  'id, seller_id, name, price, image_url, category, is_veg, is_available, is_bestseller, is_recommended, is_urgent, action_type, contact_phone, mrp, discount_percentage';

export type CommerceModeBuckets = Record<CommerceMode, ProductWithSeller[]>;

export function cappedSellerIds(sellers: readonly RpcSellerRow[]): string[] {
  return sellers
    .filter((s) => Array.isArray(s.matching_products) && s.matching_products.length >= SELLER_LISTING_CAP)
    .map((s) => s.seller_id)
    .sort();
}

/**
 * Full listing set for sellers the marketplace RPC truncated. Mirrors the
 * seller storefront query (available + approved) so nothing valid is omitted.
 */
export async function fetchSellerListingsTopUp(sellerIds: readonly string[]): Promise<any[]> {
  const rows: any[] = [];
  for (const sellerId of sellerIds) {
    for (let from = 0; ; from += TOP_UP_PAGE_SIZE) {
      const { data, error } = await supabase
        .from('products')
        .select(TOP_UP_COLUMNS)
        .eq('seller_id', sellerId)
        .eq('is_available', true)
        .eq('approval_status', 'approved')
        .order('is_bestseller', { ascending: false, nullsFirst: false })
        .order('is_recommended', { ascending: false, nullsFirst: false })
        .order('name')
        .order('id')
        .range(from, from + TOP_UP_PAGE_SIZE - 1);
      if (error) throw error;
      const page = data || [];
      rows.push(...page);
      if (page.length < TOP_UP_PAGE_SIZE) break;
    }
  }
  return rows;
}

/** Base RPC rows first, then any top-up rows the RPC cap left out. */
export function mergeTopUpListings(
  sellers: readonly RpcSellerRow[],
  topUpRows: readonly any[] | undefined,
): RpcSellerRow[] {
  if (!topUpRows || topUpRows.length === 0) return sellers as RpcSellerRow[];
  const bySeller = new Map<string, any[]>();
  for (const row of topUpRows) {
    const list = bySeller.get(row.seller_id) || [];
    list.push(row);
    bySeller.set(row.seller_id, list);
  }
  return sellers.map((seller) => {
    const extra = bySeller.get(seller.seller_id);
    if (!extra) return seller;
    const base = Array.isArray(seller.matching_products) ? seller.matching_products : [];
    const seen = new Set(base.map((p) => p.id));
    const merged = [...base];
    for (const row of extra) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
    }
    return { ...seller, matching_products: merged };
  });
}

/**
 * Classify every listing exactly once through resolveListingAction. The raw
 * action_type is used because mapProduct defaults a null action to add_to_cart.
 */
export function bucketListingsByMode(
  sellers: readonly RpcSellerRow[],
  categoryConfigs: readonly CategoryActionConfig[],
): CommerceModeBuckets {
  const buckets: CommerceModeBuckets = { shop: [], book: [], services: [] };
  const seen = new Set<string>();
  for (const seller of sellers) {
    const items = seller.matching_products;
    if (!Array.isArray(items)) continue;
    for (const raw of items) {
      if (!raw?.id || seen.has(raw.id)) continue;
      seen.add(raw.id);
      const action = resolveListingAction(raw.action_type, raw.category, categoryConfigs);
      const listing = mapProduct(raw, seller);
      if (!raw.action_type) listing.action_type = action;
      buckets[modeForAction(action)].push(listing);
    }
  }
  return buckets;
}

/**
 * Listings for one commerce mode, built on the shared marketplace data hook.
 * Loads every seller page and tops up sellers capped by the products RPC.
 */
export function useCommerceModeListings(mode: CommerceMode) {
  const { configs: categoryConfigs, isLoading: configsLoading } = useCategoryConfigs();
  const market = useMarketplaceData();
  const { fetchNextSellers, hasMoreSellers } = market;
  const sellerCount = market.sellers?.length ?? 0;

  useEffect(() => {
    if (hasMoreSellers) void fetchNextSellers();
  }, [hasMoreSellers, sellerCount, fetchNextSellers]);

  const capped = useMemo(() => cappedSellerIds(market.data), [market.data]);
  const topUp = useQuery({
    queryKey: ['commerce-mode-topup', capped.join(',')],
    queryFn: () => fetchSellerListingsTopUp(capped),
    enabled: capped.length > 0,
    staleTime: 10 * 60 * 1000,
  });

  const sellers = useMemo(
    () => mergeTopUpListings(market.data, topUp.data),
    [market.data, topUp.data],
  );
  const buckets = useMemo(
    () => bucketListingsByMode(sellers, categoryConfigs as CategoryActionConfig[]),
    [sellers, categoryConfigs],
  );

  const isLoading =
    configsLoading
    || market.isLoading
    || !!hasMoreSellers
    || (capped.length > 0 && topUp.isLoading);

  return {
    listings: buckets[mode],
    buckets,
    categoryConfigs,
    isLoading,
    topUpError: topUp.error as Error | null,
    retryTopUp: topUp.refetch,
  };
}
