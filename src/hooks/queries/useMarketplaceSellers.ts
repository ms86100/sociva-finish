// @ts-nocheck
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { withTelemetry } from '@/lib/perf-telemetry';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { MARKETPLACE_RADIUS_KM } from '@/lib/marketplace-constants';
import { useAuth } from '@/contexts/AuthContext';
import { jitteredStaleTime } from '@/lib/query-utils';
import { useEffect } from 'react';

/**
 * Lightweight seller row — NO embedded products, just metadata + product_count.
 * This is the Phase 1 payload for marketplace discovery.
 */
export interface MarketplaceSeller {
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
  society_name: string | null;
  availability_start: string | null;
  availability_end: string | null;
  seller_latitude: number | null;
  seller_longitude: number | null;
  operating_days: string[] | null;
  distance_km: number;
  product_count: number;
  avg_response_minutes: number | null;
  last_active_at: string | null;
  completed_order_count: number | null;
}

const PAGE_SIZE = 50;
const HARD_CAP = 1000;

/**
 * Phase 1: Fetch nearby sellers WITHOUT products.
 * Uses infinite scroll with 50 sellers/page and hard cap at 1000.
 */
export function useMarketplaceSellers() {
  const { browsingLocation } = useBrowsingLocation();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  // Listen for marketplace invalidation events (fired on seller approval/rejection)
  useEffect(() => {
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['marketplace-sellers'] });
      queryClient.invalidateQueries({ queryKey: ['marketplace-products'] });
    };
    window.addEventListener('app:invalidate-marketplace', handler);
    return () => window.removeEventListener('app:invalidate-marketplace', handler);
  }, [queryClient]);

  const lat = browsingLocation?.lat;
  const lng = browsingLocation?.lng;
  const radiusKm = profile?.search_radius_km ?? MARKETPLACE_RADIUS_KM;

  const query = useInfiniteQuery({
    queryKey: ['marketplace-sellers', lat, lng, radiusKm],
    queryFn: async ({ pageParam = 0 }): Promise<MarketplaceSeller[]> => {
      if (!lat || !lng) return [];

      return withTelemetry('rpc:search_sellers_paginated', async () => {
        const { data, error } = await supabase.rpc('search_sellers_paginated' as any, {
          _lat: lat,
          _lng: lng,
          _radius_km: radiusKm,
          _limit: PAGE_SIZE,
          _offset: pageParam as number,
        });

        if (error) {
          console.error('Marketplace sellers RPC error:', error);
          return [];
        }

        return (data || []) as MarketplaceSeller[];
      });
    },
    getNextPageParam: (lastPage, allPages) => {
      const totalFetched = allPages.reduce((sum, page) => sum + page.length, 0);
      if (totalFetched >= HARD_CAP) return undefined;
      if (lastPage.length < PAGE_SIZE) return undefined;
      return totalFetched;
    },
    initialPageParam: 0,
    enabled: !!(lat && lng),
    staleTime: jitteredStaleTime(10 * 60 * 1000),
  });

  // Flatten all pages for backward compatibility
  const allSellers = query.data?.pages.flat() ?? [];

  return {
    ...query,
    data: allSellers,
  };
}
