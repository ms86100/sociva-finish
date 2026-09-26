// @ts-nocheck
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useMarketplaceSellers, MarketplaceSeller } from './useMarketplaceSellers';
import { useMarketplaceProducts, MarketplaceProduct } from './useMarketplaceProducts';

/**
 * Raw seller row shape - backward compatible with all consumer hooks.
 * Now composed from two lightweight RPCs instead of one monolithic RPC.
 */
export interface RpcSellerRow {
  seller_id: string;
  user_id: string;
  business_name: string;
  description: string | null;
  categories: string[] | null;
  primary_group: string | null;
  cover_image_url: string | null;
  profile_image_url: string | null;
  is_available: boolean;
  is_featured: boolean;
  rating: number;
  total_reviews: number;
  matching_products: any[];
  distance_km: number;
  society_name: string | null;
  availability_start: string | null;
  availability_end: string | null;
  seller_latitude: number | null;
  seller_longitude: number | null;
  operating_days: string[] | null;
  avg_response_minutes: number | null;
  last_active_at: string | null;
  completed_order_count: number | null;
  home_service_available?: boolean | null;
  home_service_fee?: number | null;
  fulfillment_mode?: string | null;
}

/**
 * Backward-compatible marketplace data hook.
 * Composes useMarketplaceSellers + useMarketplaceProducts into the
 * same RpcSellerRow[] shape that all consumer hooks expect.
 *
 * Phase 1 (sellers) loads instantly (~1KB total).
 * Phase 2 (products) loads in parallel once seller IDs are known.
 *
 * Consumer hooks see no change - they still get RpcSellerRow[].
 */
export function useMarketplaceData() {
  const sellersQuery = useMarketplaceSellers();
  const sellers = sellersQuery.data;

  const sellerIds = useMemo(
    () => (sellers || []).map((s) => s.seller_id),
    [sellers]
  );

  const productsQuery = useMarketplaceProducts(sellerIds);
  const products = productsQuery.data;
  const homeServiceQuery = useQuery({
    queryKey: ['seller-home-service', sellerIds.join(',')],
    enabled: sellerIds.length > 0,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const rows: Array<{
        id: string;
        home_service_available: boolean | null;
        home_service_fee: number | null;
        fulfillment_mode: string | null;
      }> = [];
      for (let i = 0; i < sellerIds.length; i += 80) {
        const chunk = sellerIds.slice(i, i + 80);
        const { data, error } = await supabase
          .from('seller_profiles')
          .select('id, home_service_available, home_service_fee, fulfillment_mode')
          .in('id', chunk);
        if (error) return rows;
        rows.push(...((data || []) as typeof rows));
      }
      return rows;
    },
  });
  const homeBySeller = useMemo(() => {
    const map = new Map<string, { home: boolean; fee: number | null; mode: string | null }>();
    for (const row of homeServiceQuery.data || []) {
      map.set(row.id, {
        home: row.home_service_available === true,
        fee: row.home_service_fee,
        mode: row.fulfillment_mode,
      });
    }
    return map;
  }, [homeServiceQuery.data]);

  // Combine sellers + products into backward-compatible shape
  const data = useMemo((): RpcSellerRow[] => {
    if (!sellers || sellers.length === 0) return [];

    // Group products by seller_id for O(1) lookup
    const productsBySeller = new Map<string, any[]>();
    if (products) {
      for (const p of products) {
        const list = productsBySeller.get(p.seller_id) || [];
        list.push({
          id: p.product_id,
          name: p.product_name,
          price: p.price,
          image_url: p.image_url,
          category: p.category,
          is_veg: p.is_veg,
          is_available: p.is_available,
          is_bestseller: p.is_bestseller,
          is_recommended: p.is_recommended,
          is_urgent: p.is_urgent,
          action_type: p.action_type,
          contact_phone: p.contact_phone,
          mrp: p.mrp,
          discount_percentage: p.discount_percentage,
          tags: p.tags || null,
          cuisine_type: p.cuisine_type || null,
          subcategory_id: p.subcategory_id || null,
        });
        productsBySeller.set(p.seller_id, list);
      }
    }

    return sellers.map((s): RpcSellerRow => ({
      seller_id: s.seller_id,
      user_id: s.user_id,
      business_name: s.business_name,
      description: s.description,
      categories: s.categories,
      primary_group: s.primary_group,
      cover_image_url: s.cover_image_url,
      profile_image_url: s.profile_image_url,
      is_available: s.is_available,
      is_featured: s.is_featured,
      rating: s.rating,
      total_reviews: s.total_reviews,
      matching_products: productsBySeller.get(s.seller_id) || [],
      distance_km: s.distance_km,
      society_name: s.society_name,
      availability_start: s.availability_start,
      availability_end: s.availability_end,
      seller_latitude: s.seller_latitude,
      seller_longitude: s.seller_longitude,
      operating_days: s.operating_days,
      avg_response_minutes: s.avg_response_minutes ?? null,
      last_active_at: s.last_active_at ?? null,
      completed_order_count: s.completed_order_count ?? null,
      home_service_available: homeBySeller.get(s.seller_id)?.home ?? false,
      home_service_fee: homeBySeller.get(s.seller_id)?.fee ?? null,
      fulfillment_mode: homeBySeller.get(s.seller_id)?.mode ?? null,
    }));
  }, [sellers, products, homeBySeller]);

  return {
    data,
    isLoading: sellersQuery.isLoading || productsQuery.isLoading,
    error: sellersQuery.error || productsQuery.error,
    sellersReady: !sellersQuery.isLoading && !!sellers,
    sellers,
    // Expose infinite scroll controls
    fetchNextSellers: sellersQuery.fetchNextPage,
    hasMoreSellers: sellersQuery.hasNextPage,
    fetchNextProducts: productsQuery.fetchNextPage,
    hasMoreProducts: productsQuery.hasNextPage,
  };
}
