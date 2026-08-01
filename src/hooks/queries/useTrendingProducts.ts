// @ts-nocheck
import { useMemo } from 'react';
import { ProductWithSeller } from '@/components/product/ProductListingCard';
import { useMarketplaceData } from './useMarketplaceData';
import { flattenSellersToProducts } from './useNearbyProducts';

/**
 * Trending products derived from the shared marketplace data cache.
 * Zero additional RPC calls.
 */
export function useTrendingProducts(limit = 10) {
  const { data: sellers, isLoading, error } = useMarketplaceData();

  const data = useMemo((): ProductWithSeller[] => {
    if (!sellers || sellers.length === 0) return [];
    return flattenSellersToProducts(sellers).slice(0, limit);
  }, [sellers, limit]);

  return { data, isLoading, error };
}
