// @ts-nocheck
import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTerminalStatuses } from '@/hooks/useCategoryStatusFlow';
import { Order } from '@/types/database';

const PAGE_SIZE = 20;

type OrderFilter = 'all' | 'active' | 'completed' | 'cancelled';

async function fetchOrdersPage(
  type: 'buyer' | 'seller',
  userId: string,
  sellerId: string | undefined,
  filter: OrderFilter,
  terminalSet: Set<string>,
  successSet: Set<string>,
  cursor?: string,
) {
  let query;
  if (type === 'buyer') {
    query = supabase
      .from('orders')
      .select(`id, created_at, status, payment_status, payment_type, total_amount, order_type, fulfillment_type, delivery_handled_by, transaction_type, auto_cancel_at, seller_id, buyer_id, checkout_group_id, idempotency_key, failure_owner, rejection_reason, seller:seller_profiles(business_name, cover_image_url), items:order_items(id, product_name, quantity, unit_price, subtotal, status, product_image)`)
      .eq('buyer_id', userId)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);

    // Show payment_pending so buyers can see unpaid / confirm-pending orders
    if (filter === 'active' && terminalSet.size > 0) {
      query = query.not('status', 'in', `(${[...terminalSet].map(s => `"${s}"`).join(',')})`);
    } else if (filter === 'completed' && successSet.size > 0) {
      query = query.in('status', [...successSet] as any);
    } else if (filter === 'cancelled' && terminalSet.size > 0 && successSet.size > 0) {
      const cancelledStatuses = [...terminalSet].filter(s => !successSet.has(s));
      if (cancelledStatuses.length > 0) query = query.in('status', cancelledStatuses as any);
    }
  } else {
    query = supabase
      .from('orders')
      .select(`id, created_at, status, payment_status, total_amount, order_type, fulfillment_type, delivery_handled_by, transaction_type, auto_cancel_at, seller_id, buyer_id, buyer:profiles!orders_buyer_id_fkey(name, block, flat_number, phone), items:order_items(id, product_name, quantity, unit_price, subtotal, status, product_image)`)
      .eq('seller_id', sellerId!)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);
  }

  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  const { data } = await query;
  const results = (data as any[]) || [];
  return results;
}

export function useOrdersList(
  type: 'buyer' | 'seller',
  userId: string,
  sellerId?: string,
  filter: OrderFilter = 'all',
) {
  const { successSet, terminalSet } = useTerminalStatuses();

  const result = useInfiniteQuery({
    queryKey: ['orders', type, userId, sellerId, filter],
    queryFn: ({ pageParam }) =>
      fetchOrdersPage(type, userId, sellerId, filter, terminalSet, successSet, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return lastPage[lastPage.length - 1]?.created_at;
    },
    enabled: !!userId && (type === 'buyer' || !!sellerId),
    staleTime: 2 * 60_000,
  });

  const orders = result.data?.pages.flat() as Order[] ?? [];

  return {
    orders,
    isLoading: result.isLoading,
    hasMore: result.hasNextPage ?? false,
    isLoadingMore: result.isFetchingNextPage,
    loadMore: () => result.fetchNextPage(),
    successSet,
  };
}
