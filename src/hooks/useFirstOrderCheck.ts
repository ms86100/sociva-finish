// @ts-nocheck
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Batch-check whether the current user has prior completed orders
 * with each seller in a given list. Returns a Set of seller IDs
 * where the user has NEVER ordered before (first-order eligible).
 *
 * Uses the check_first_order_batch RPC for a single round-trip.
 */
export function useFirstOrderCheck(userId: string | undefined, sellerIds: string[]) {
  const [firstOrderSellerIds, setFirstOrderSellerIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!userId || sellerIds.length === 0) {
      setFirstOrderSellerIds(new Set());
      return;
    }

    const check = async () => {
      try {
        const { data, error } = await supabase.rpc('check_first_order_batch', {
          _buyer_id: userId,
          _seller_ids: sellerIds,
        });

        if (error) {
          console.warn('[FirstOrderCheck] RPC error:', error.message);
          // Fallback to direct query
          const { data: fallbackData } = await supabase
            .from('orders')
            .select('seller_id')
            .eq('buyer_id', userId)
            .in('seller_id', sellerIds)
            .in('status', ['completed', 'delivered', 'ready']);

          const sellersWithHistory = new Set((fallbackData || []).map(r => r.seller_id));
          setFirstOrderSellerIds(new Set(sellerIds.filter(id => !sellersWithHistory.has(id))));
          return;
        }

        const firstTimeSellers = new Set<string>();
        for (const row of data || []) {
          if (row.is_first_order) {
            firstTimeSellers.add(row.seller_id);
          }
        }
        setFirstOrderSellerIds(firstTimeSellers);
      } catch (err) {
        console.error('[FirstOrderCheck] Unexpected error:', err);
        setFirstOrderSellerIds(new Set());
      }
    };

    check();
  }, [userId, sellerIds.join(',')]);

  return firstOrderSellerIds;
}
