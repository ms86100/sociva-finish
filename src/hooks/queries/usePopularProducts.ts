// @ts-nocheck
import { useMemo } from 'react';
import { ProductWithSeller } from '@/components/product/ProductListingCard';
import { useMarketplaceData } from './useMarketplaceData';
import { flattenSellersToProducts, mapProduct } from './useNearbyProducts';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { MARKETPLACE_RADIUS_KM } from '@/lib/marketplace-constants';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { jitteredStaleTime } from '@/lib/query-utils';

/**
 * Popular products derived from the shared marketplace data cache.
 * Zero additional RPC calls.
 */
export function usePopularProducts(limit = 12) {
  const { data: sellers, isLoading, error } = useMarketplaceData();

  const data = useMemo((): ProductWithSeller[] => {
    if (!sellers || sellers.length === 0) return [];
    const products = flattenSellersToProducts(sellers);
    // Sort: bestsellers first, then by name; limit
    return products
      .sort((a, b) => (b.is_bestseller ? 1 : 0) - (a.is_bestseller ? 1 : 0))
      .slice(0, limit);
  }, [sellers, limit]);

  return { data, isLoading, error };
}

/**
 * Products for a specific parentGroup — derives from shared marketplace data.
 * Zero additional RPC calls for the main product list.
 */
export function useCategoryProducts(parentGroup: string | null) {
  const { data: sellers, isLoading, error } = useMarketplaceData();
  const queryClient = useQueryClient();

  const data = useMemo((): ProductWithSeller[] => {
    if (!parentGroup || !sellers || sellers.length === 0) return [];

    // Get categories for this parent group from cache
    const configs: any[] | undefined = queryClient.getQueryData(['category-configs']);
    const categorySet = new Set(
      (configs || [])
        .filter((c: any) => (c.parent_group || c.parentGroup) === parentGroup)
        .map((c: any) => c.category)
    );
    if (categorySet.size === 0) return [];

    const products: ProductWithSeller[] = [];
    const seenIds = new Set<string>();

    for (const seller of sellers) {
      const items = seller.matching_products;
      if (!Array.isArray(items)) continue;
      for (const p of items) {
        if (!categorySet.has(p.category)) continue;
        if (seenIds.has(p.id)) continue;
        seenIds.add(p.id);
        products.push(mapProduct(p, seller));
      }
    }
    return products;
  }, [parentGroup, sellers, queryClient]);

  return { data, isLoading, error };
}
