// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { MARKETPLACE_RADIUS_KM } from '@/lib/marketplace-constants';
import { jitteredStaleTime } from '@/lib/query-utils';

/**
 * Fetches radius-based social proof for a batch of product IDs.
 * Uses browsing location coordinates to count nearby buyers.
 * Falls back to society-scoped counting if no coordinates available.
 * Returns a Map<productId, familiesThisWeek>.
 */
export function useSocialProof(productIds: string[]) {
  const { browsingLocation } = useBrowsingLocation();
  const lat = browsingLocation?.lat;
  const lng = browsingLocation?.lng;

  return useQuery({
    queryKey: ['social-proof', lat, lng, productIds.length, productIds.slice().sort().join(',')],
    queryFn: async (): Promise<Map<string, number>> => {
      if (productIds.length === 0 || !lat || !lng) return new Map();

      const { data, error } = await supabase.rpc('get_society_order_stats', {
        _product_ids: productIds,
        _lat: lat,
        _lng: lng,
        _radius_km: MARKETPLACE_RADIUS_KM,
      } as any);

      if (error) {
        console.warn('[SocialProof] RPC error:', error.message);
        return new Map();
      }

      const map = new Map<string, number>();
      for (const row of (data as any[]) || []) {
        if (row.families_this_week > 0) {
          map.set(row.product_id, row.families_this_week);
        }
      }
      return map;
    },
    enabled: productIds.length > 0 && !!lat && !!lng,
    staleTime: jitteredStaleTime(5 * 60 * 1000),
  });
}
