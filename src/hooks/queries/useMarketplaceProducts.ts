// @ts-nocheck
import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { jitteredStaleTime } from '@/lib/query-utils';

/**
 * Product row from get_products_for_sellers RPC.
 */
export interface MarketplaceProduct {
  product_id: string;
  seller_id: string;
  product_name: string;
  price: number;
  image_url: string | null;
  category: string | null;
  is_veg: boolean;
  is_available: boolean;
  is_bestseller: boolean;
  is_recommended: boolean;
  is_urgent: boolean;
  action_type: string | null;
  contact_phone: string | null;
  mrp: number | null;
  discount_percentage: number | null;
  description: string | null;
}

const BATCH_SIZE = 25;
const PAGE_SIZE = 50;
const HARD_CAP = 1000;

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/**
 * Phase 2: Fetch products for given seller IDs with infinite scroll.
 * - Batches seller IDs (max 25 per call)
 * - Paginates with 50 products per page
 * - Hard cap at 1000 total items to protect mobile memory
 */
export function useMarketplaceProducts(
  sellerIds: string[],
  options?: { category?: string }
) {
  const { category } = options ?? {};
  const sortedIds = [...sellerIds].sort();
  const idsKey = sortedIds.join(',');

  const query = useInfiniteQuery({
    queryKey: ['marketplace-products', idsKey, category ?? 'all'],
    queryFn: async ({ pageParam = 0 }): Promise<MarketplaceProduct[]> => {
      if (sellerIds.length === 0) return [];

      const batches = chunk(sellerIds, BATCH_SIZE);

      const batchResults = await Promise.all(
        batches.map(async (batchIds) => {
          const { data, error } = await supabase.rpc('get_products_for_sellers' as any, {
            _seller_ids: batchIds,
            _category: category ?? null,
            _limit: PAGE_SIZE,
            _offset: pageParam as number,
          });

          if (error) {
            console.error('Marketplace products RPC error (batch):', error);
            return [] as MarketplaceProduct[];
          }

          return (data || []) as MarketplaceProduct[];
        })
      );

      return batchResults.flat();
    },
    getNextPageParam: (lastPage, allPages) => {
      const totalFetched = allPages.reduce((sum, page) => sum + page.length, 0);
      // Hard cap: stop fetching after 1000 items
      if (totalFetched >= HARD_CAP) return undefined;
      // If last page returned fewer than expected, we've reached the end
      if (lastPage.length < PAGE_SIZE) return undefined;
      return totalFetched;
    },
    initialPageParam: 0,
    enabled: sellerIds.length > 0,
    staleTime: jitteredStaleTime(10 * 60 * 1000),
  });

  // Flatten all pages into a single array for backward compatibility
  const allProducts = query.data?.pages.flat() ?? [];

  return {
    ...query,
    data: allProducts,
  };
}
