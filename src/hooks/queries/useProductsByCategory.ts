// @ts-nocheck
import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ProductWithSeller } from '@/components/product/ProductListingCard';
import { useMarketplaceData } from './useMarketplaceData';
import { useAuth } from '@/contexts/AuthContext';
import { mapProduct } from './useNearbyProducts';

interface CategoryGroup {
  category: string;
  parentGroup: string;
  displayName: string;
  icon: string;
  products: ProductWithSeller[];
}

/**
 * Coordinate-based product discovery grouped by category.
 * Derives from the shared marketplace data cache — zero additional RPC calls.
 */
export function useProductsByCategory(limit = 50) {
  const { data: sellers, isLoading, error } = useMarketplaceData();
  const { effectiveSocietyId } = useAuth();
  const queryClient = useQueryClient();

  const data = useMemo((): CategoryGroup[] => {
    if (!sellers || sellers.length === 0) return [];

    // Get category configs from cache
    let configs: any[] | undefined = queryClient.getQueryData(['category-configs']);
    const configMap = new Map(
      (configs || []).map((c: any) => [
        c.category,
        { parent_group: c.parent_group || c.parentGroup, display_name: c.display_name || c.displayName, icon: c.icon },
      ])
    );

    // Flatten seller → products (flags now come from RPC)
    const allProducts: ProductWithSeller[] = [];
    for (const seller of sellers) {
      const items = seller.matching_products;
      if (!Array.isArray(items)) continue;
      for (const p of items) {
        allProducts.push(mapProduct(p, seller));
      }
    }

    // Group by category
    const grouped: Record<string, ProductWithSeller[]> = {};
    for (const product of allProducts) {
      const cat = product.category;
      if (!grouped[cat]) grouped[cat] = [];
      if (grouped[cat].length < limit) grouped[cat].push(product);
    }

    const result: CategoryGroup[] = [];
    for (const [category, items] of Object.entries(grouped)) {
      const cfg = configMap.get(category);
      result.push({
        category,
        parentGroup: cfg?.parent_group || category,
        displayName: cfg?.display_name || category,
        icon: cfg?.icon || '📦',
        products: items,
      });
    }

    return result;
  }, [sellers, queryClient, limit]);

  return {
    data,
    isLoading,
    error,
  };
}
