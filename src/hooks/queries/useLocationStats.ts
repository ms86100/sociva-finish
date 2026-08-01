// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { jitteredStaleTime } from '@/lib/query-utils';

interface LocationStats {
  sellersNearby: number;
  ordersToday: number;
  societiesNearby: number;
}

export function useLocationStats(
  lat: number | null | undefined,
  lng: number | null | undefined,
  radiusKm: number = 5,
) {
  return useQuery<LocationStats>({
    queryKey: ['location-stats', lat, lng, radiusKm],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_location_stats', {
        _lat: lat!,
        _lng: lng!,
        _radius_km: radiusKm,
      } as any);

      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      return {
        sellersNearby: Number(row?.sellers_count ?? 0),
        ordersToday: Number(row?.orders_today ?? 0),
        societiesNearby: Number(row?.societies_count ?? 0),
      };
    },
    enabled: lat != null && lng != null,
    staleTime: jitteredStaleTime(5 * 60_000),
  });
}
