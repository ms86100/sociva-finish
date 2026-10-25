import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { MARKETPLACE_RADIUS_KM } from '@/lib/marketplace-constants';
import type { ProductWithSeller } from '@/components/product/ProductListingCard';

export { listingMatchesSearchText } from '@/lib/listing-search';

export function mapFtsRowToListing(row: Record<string, unknown>): ProductWithSeller {
  return {
    id: String(row.product_id || ''),
    seller_id: String(row.seller_id || ''),
    name: String(row.product_name || ''),
    price: Number(row.price || 0),
    image_url: (row.image_url as string | null) || null,
    category: String(row.category || ''),
    is_veg: (row.is_veg as boolean | null) ?? null,
    is_available: row.is_available !== false,
    is_bestseller: false,
    is_recommended: false,
    is_urgent: false,
    description: (row.description as string | null) || null,
    action_type: (row.action_type as string | null) || null,
    mrp: (row.mrp as number | null) ?? null,
    discount_percentage: (row.discount_percentage as number | null) ?? null,
    seller_name: String(row.seller_name || ''),
    seller_rating: Number(row.seller_rating || 0),
    seller_reviews: Number(row.seller_total_reviews || 0),
    society_name: (row.society_name as string | null) || null,
    distance_km: (row.distance_km as number | null) ?? null,
    created_at: '',
    updated_at: '',
  };
}

export function useNearbyProductSearch(query: string, limit = 40) {
  const { profile } = useAuth();
  const { browsingLocation } = useBrowsingLocation();
  const trimmed = query.trim();
  const lat = browsingLocation?.lat;
  const lng = browsingLocation?.lng;
  const radiusKm = profile?.search_radius_km ?? MARKETPLACE_RADIUS_KM;

  return useQuery({
    queryKey: ['home-search-fts', trimmed, lat, lng, radiusKm, limit],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.rpc('search_products_fts' as never, {
        _query: trimmed,
        _lat: lat ?? null,
        _lng: lng ?? null,
        _radius_km: radiusKm,
        _limit: limit,
        _offset: 0,
      } as never);
      if (signal?.aborted) return [] as ProductWithSeller[];
      if (error) {
        console.error('Home FTS search error:', error);
        return [] as ProductWithSeller[];
      }
      return ((data || []) as Record<string, unknown>[]).map(mapFtsRowToListing);
    },
    enabled: trimmed.length >= 2,
    staleTime: 60 * 1000,
  });
}
