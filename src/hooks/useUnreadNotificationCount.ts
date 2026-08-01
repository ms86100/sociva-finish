// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useSellerContext } from '@/contexts/AuthContext';

const SELLER_ONLY_TYPES = [
  'settlement', 'seller_approved', 'seller_rejected', 'seller_suspended',
  'product_approved', 'product_rejected', 'license_approved', 'license_rejected',
  'moderation', 'seller_daily_summary',
] as const;
const SELLER_ONLY_FILTER = `(${SELLER_ONLY_TYPES.join(',')})`;

// Pure-buyer types — when in seller mode, exclude from the badge so it means
// "things needing seller attention" only (inbox still shows them).
const BUYER_ONLY_TYPES = [
  'delivery_proximity', 'delivery_proximity_imminent',
  'delivery_en_route', 'buyer_otp',
] as const;
const BUYER_ONLY_FILTER = `(${BUYER_ONLY_TYPES.join(',')})`;


export function useUnreadNotificationCount() {
  const { user } = useAuth();
  let isSeller = false;
  try { isSeller = useSellerContext().isSeller; } catch { /* outside provider */ }

  const { data: count = 0 } = useQuery({
    queryKey: ['unread-notifications', user?.id, isSeller ? 'seller' : 'buyer'],
    queryFn: async () => {
      if (!user) return 0;
      let q = supabase
        .from('user_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false);

      if (!isSeller) {
        // Buyer mode — hide seller-only and seller-targeted notifications
        q = q
          .not('type', 'in', SELLER_ONLY_FILTER)
          .not('data->>target_role', 'eq', 'seller');
      } else {
        // Seller mode — exclude pure-buyer types from the badge count
        q = q.not('type', 'in', BUYER_ONLY_FILTER);
      }

      const { count } = await q;
      return count || 0;
    },
    enabled: !!user,
    staleTime: 60_000,
    // Perf: removed refetchInterval — realtime channel on user_notifications
    // already invalidates this key when new notifications arrive.
  });

  return count;
}
