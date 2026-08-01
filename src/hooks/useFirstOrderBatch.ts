// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Hook that checks if the buyer has zero completed orders with given sellers,
 * returning a map of seller_id → is_first_order boolean.
 * Uses the `check_first_order_batch` RPC for efficient batch checking.
 */
export function useFirstOrderBatch(sellerIds: string[]) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['first-order-batch', user?.id, sellerIds.sort().join(',')],
    queryFn: async (): Promise<Record<string, boolean>> => {
      if (!user || sellerIds.length === 0) return {};

      const { data, error } = await supabase.rpc('check_first_order_batch', {
        _buyer_id: user.id,
        _seller_ids: sellerIds,
      });

      if (error) {
        console.error('[useFirstOrderBatch] RPC error:', error.message);
        return {};
      }

      const map: Record<string, boolean> = {};
      (data as any[] || []).forEach((row: any) => {
        map[row.seller_id] = row.is_first_order;
      });
      return map;
    },
    enabled: !!user && sellerIds.length > 0,
    staleTime: 5 * 60_000,
  });
}
