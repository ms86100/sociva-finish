// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useSellerContext } from '@/contexts/AuthContext';
import { SELLER_LIFECYCLE_OR_FILTER, SELLER_ONLY_INBOX_FILTER } from '@/lib/notification-visibility';

// Pure-buyer types — when in seller mode, exclude from the badge so it means
// "things needing seller attention" only (inbox still shows them).
const BUYER_ONLY_TYPES = [
  'delivery_proximity', 'delivery_proximity_imminent',
  'delivery_en_route', 'buyer_otp',
] as const;
const BUYER_ONLY_FILTER = `(${BUYER_ONLY_TYPES.join(',')})`;


export function useUnreadNotificationCount() {
  const { user } = useAuth();
  const { isSeller } = useSellerContext();

  const { data: count = 0 } = useQuery({
    queryKey: ['unread-notifications', user?.id, isSeller ? 'seller' : 'buyer'],
    queryFn: async () => {
      if (!user) return 0;
      let q = supabase
        .from('user_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false)
        .gt('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

      if (!isSeller) {
        // Buyer mode — hide seller-only and seller-targeted notifications
        q = q
          .not('type', 'in', SELLER_ONLY_INBOX_FILTER)
          .or(SELLER_LIFECYCLE_OR_FILTER);
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
