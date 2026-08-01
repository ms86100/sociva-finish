// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ReliabilityBreakdown {
  overall_score: number;
  fulfillment_score: number;
  ontime_score: number;
  response_score: number;
  retention_score: number;
  rating_score: number;
  cancellation_score: number;
  total_orders: number;
  completed_orders: number;
}

export function useSellerReliability(sellerId: string | null) {
  return useQuery({
    queryKey: ['seller-reliability', sellerId],
    queryFn: async (): Promise<ReliabilityBreakdown | null> => {
      if (!sellerId) return null;
      const { data, error } = await supabase.rpc('get_seller_reliability_breakdown', {
        _seller_id: sellerId,
      });
      if (error) {
        console.error('Reliability breakdown error:', error);
        return null;
      }
      return (data as any[])?.[0] || null;
    },
    enabled: !!sellerId,
    staleTime: 5 * 60 * 1000,
  });
}
