// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Returns true if the seller offers any bookable/scheduleable products
 * (categories where requires_time_slot=true OR transaction_type='service_booking').
 * Used to conditionally show the Schedule tab on the seller dashboard.
 */
export function useSellerHasBookableServices(sellerId?: string | null) {
  return useQuery({
    queryKey: ['seller-has-bookable', sellerId],
    queryFn: async () => {
      if (!sellerId) return false;

      // Fetch product categories used by this seller
      const { data: products, error } = await supabase
        .from('products')
        .select('category')
        .eq('seller_id', sellerId);
      if (error) throw error;
      const categories = Array.from(new Set((products || []).map((p: any) => p.category).filter(Boolean)));
      if (categories.length === 0) return false;

      const { data: configs, error: cfgErr } = await supabase
        .from('category_config')
        .select('category, requires_time_slot, transaction_type')
        .in('category', categories);
      if (cfgErr) throw cfgErr;

      return (configs || []).some(
        (c: any) => c.requires_time_slot === true || c.transaction_type === 'service_booking'
      );
    },
    enabled: !!sellerId,
    staleTime: 5 * 60_000,
  });
}
