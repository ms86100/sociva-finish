// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { jitteredStaleTime } from '@/lib/query-utils';

export interface SellerTrustTierData {
  tier_key: string;
  tier_label: string;
  badge_color: string;
  icon_name: string;
  growth_label: string | null;
  growth_icon: string | null;
}

/**
 * Fetches the seller's trust tier from the DB-backed trust_tier_config table.
 * Replaces all hardcoded tier logic.
 */
export function useSellerTrustTier(sellerId: string | null | undefined) {
  return useQuery({
    queryKey: ['seller-trust-tier', sellerId],
    queryFn: async (): Promise<SellerTrustTierData | null> => {
      if (!sellerId) return null;

      const { data, error } = await supabase.rpc('get_seller_trust_tier', {
        _seller_id: sellerId,
      });

      if (error) {
        console.warn('[useSellerTrustTier] RPC error:', error.message);
        return null;
      }

      const row = (data as any[])?.[0];
      return row || null;
    },
    enabled: !!sellerId,
    staleTime: jitteredStaleTime(5 * 60 * 1000),
  });
}
