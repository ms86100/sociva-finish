// @ts-nocheck
/**
 * Demand-stats RPC hook. Chart analytics live in `@/hooks/useSellerAnalytics`
 * (settled GMV only — single money source with dashboard KPIs).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface DemandStats {
  active_buyers_in_society: number;
  view_count: number;
  order_count: number;
  conversion_rate: number;
}

export function useSellerDemandStats(sellerId: string | null) {
  return useQuery({
    queryKey: ['seller-demand-stats-summary', sellerId],
    queryFn: async (): Promise<DemandStats> => {
      if (!sellerId) throw new Error('No seller ID');
      const { data, error } = await supabase.rpc('get_seller_demand_stats', {
        _seller_id: sellerId,
      });
      if (error) throw error;
      return data as unknown as DemandStats;
    },
    enabled: !!sellerId,
    staleTime: 10 * 60 * 1000,
  });
}
