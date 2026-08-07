// @ts-nocheck
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  aggregateSellerBoardFromOrders,
  emptyBoardCounts,
  emptyDashboardKpis,
  getIstPeriodBounds,
  statusesForFilter,
  type SellerBoardCounts,
  type SellerDashboardKpis,
  type SellerOrderFilter,
} from '@/lib/seller-order-board';

const PAGE_SIZE = 20;

function mapKpiRpc(raw: Record<string, unknown> | null): SellerDashboardKpis {
  if (!raw) return emptyDashboardKpis();
  return {
    totalOrders: Number(raw.total_orders) || 0,
    pendingOrders: Number(raw.pending_orders) || 0,
    preparingOrders: Number(raw.preparing_orders) || 0,
    readyOrders: Number(raw.ready_orders) || 0,
    inTransitOrders: Number(raw.in_transit_orders) || 0,
    codConfirmOrders: Number(raw.cod_confirm_orders) || 0,
    completedOrders: Number(raw.completed_orders) || 0,
    doneToday: Number(raw.done_today) || 0,
    cancelledOrders: Number(raw.cancelled_orders) || 0,
    noShowOrders: Number(raw.no_show_orders) || 0,
    terminalFailOrders: Number(raw.terminal_fail_orders) || 0,
    enquiryOrders: Number(raw.enquiry_orders) || 0,
    todayOrders: Number(raw.today_orders) || 0,
    pendingRefunds: Number(raw.pending_refunds) || 0,
    totalEarnings: Number(raw.total_earnings) || 0,
    todayEarnings: Number(raw.today_earnings) || 0,
    weekEarnings: Number(raw.week_earnings) || 0,
    monthEarnings: Number(raw.month_earnings) || 0,
    avgFulfillMinutes: raw.avg_fulfill_minutes == null ? null : Number(raw.avg_fulfill_minutes),
    cancelRate30d: Number(raw.cancel_rate_30d) || 0,
    refundRate30d: Number(raw.refund_rate_30d) || 0,
  };
}

function mapCountsRpc(raw: Record<string, unknown> | null): SellerBoardCounts {
  if (!raw) return emptyBoardCounts();
  return {
    all: Number(raw.all) || 0,
    today: Number(raw.today) || 0,
    enquiries: Number(raw.enquiries) || 0,
    pending: Number(raw.pending) || 0,
    preparing: Number(raw.preparing) || 0,
    ready: Number(raw.ready) || 0,
    in_transit: Number(raw.in_transit) || 0,
    cod_confirm: Number(raw.cod_confirm) || 0,
    completed: Number(raw.completed) || 0,
    cancelled: Number(raw.cancelled) || 0,
    refunded: Number(raw.refunded) || 0,
    no_show: Number(raw.no_show) || 0,
    terminal_fail: Number(raw.terminal_fail) || 0,
  };
}

async function fetchKpisClientFallback(sellerId: string): Promise<SellerDashboardKpis> {
  const [{ data: orders }, { count: pendingRefunds }] = await Promise.all([
    supabase
      .from('orders')
      .select('status, total_amount, created_at, updated_at, delivered_at, status_changed_at, payment_status')
      .eq('seller_id', sellerId),
    supabase
      .from('refund_requests')
      .select('id, orders!inner(seller_id)', { count: 'exact', head: true })
      .eq('orders.seller_id', sellerId)
      .eq('status', 'requested'),
  ]);

  const { kpis } = aggregateSellerBoardFromOrders(orders || [], {
    pendingRefunds: pendingRefunds || 0,
  });
  return kpis;
}

async function fetchCountsClientFallback(sellerId: string): Promise<SellerBoardCounts> {
  const { data: orders } = await supabase
    .from('orders')
    .select('id, status, created_at, payment_status')
    .eq('seller_id', sellerId);

  const ids = (orders || []).map((o: any) => o.id);
  let refundedIds = new Set<string>();
  if (ids.length > 0) {
    const { data: refunds } = await supabase
      .from('refund_requests')
      .select('order_id')
      .in('order_id', ids)
      .in('status', ['requested', 'approved', 'settled', 'processing', 'auto_approved', 'completed']);
    refundedIds = new Set((refunds || []).map((r: any) => r.order_id));
  }

  const { counts } = aggregateSellerBoardFromOrders(
    (orders || []).map((o: any) => ({
      ...o,
      is_refunded: o.payment_status === 'refunded' || refundedIds.has(o.id),
    })),
  );
  return counts;
}

/**
 * Consolidated seller dashboard KPIs via get_seller_dashboard_kpis RPC
 * (client aggregate fallback if RPC not deployed yet).
 */
export function useSellerOrderStats(sellerId: string | null) {
  return useQuery({
    queryKey: ['seller-dashboard-stats', sellerId],
    queryFn: async (): Promise<SellerDashboardKpis> => {
      const { data, error } = await supabase.rpc('get_seller_dashboard_kpis', {
        p_seller_id: sellerId!,
      });
      if (!error && data) return mapKpiRpc(data as Record<string, unknown>);
      console.warn('[useSellerOrderStats] RPC fallback:', error?.message);
      return fetchKpisClientFallback(sellerId!);
    },
    enabled: !!sellerId,
    staleTime: 15_000,
  });
}

/**
 * Filter counts via get_seller_order_board_counts — must match list filter semantics.
 */
export function useSellerOrderFilterCounts(sellerId: string | null) {
  return useQuery({
    queryKey: ['seller-order-filter-counts', sellerId],
    queryFn: async (): Promise<SellerBoardCounts> => {
      const { data, error } = await supabase.rpc('get_seller_order_board_counts', {
        p_seller_id: sellerId!,
      });
      if (!error && data) return mapCountsRpc(data as Record<string, unknown>);
      console.warn('[useSellerOrderFilterCounts] RPC fallback:', error?.message);
      return fetchCountsClientFallback(sellerId!);
    },
    enabled: !!sellerId,
    staleTime: 15_000,
  });
}

export function useSellerOrdersInfinite(sellerId: string | null, filter: string = 'all') {
  return useInfiniteQuery({
    queryKey: ['seller-orders', sellerId, filter],
    queryFn: async ({ pageParam }) => {
      let query = supabase
        .from('orders')
        .select(
          `id, created_at, status, payment_status, total_amount, order_type, fulfillment_type, delivery_handled_by, transaction_type, auto_cancel_at, auto_accepted, seller_id, buyer_id, rejection_reason, buyer:profiles!orders_buyer_id_fkey(name, block, flat_number, phone), items:order_items(id, product_name, quantity, unit_price, status)`,
        )
        .eq('seller_id', sellerId!)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)
        .or('status.neq.payment_pending,payment_status.eq.buyer_confirmed');

      const { todayISO } = getIstPeriodBounds();
      const typedFilter = filter as SellerOrderFilter;

      switch (typedFilter) {
        case 'today':
          query = query.gte('created_at', todayISO);
          break;
        case 'pending':
          query = query.or(
            `status.in.(${statusesForFilter('pending')!.join(',')}),and(status.eq.payment_pending,payment_status.eq.buyer_confirmed)`,
          );
          break;
        case 'refunded': {
          const { data: refundRows } = await supabase
            .from('refund_requests')
            .select('order_id, orders!inner(seller_id)')
            .eq('orders.seller_id', sellerId!)
            .in('status', ['requested', 'approved', 'settled', 'processing', 'auto_approved', 'completed']);
          const refundOrderIds = [...new Set((refundRows || []).map((r: any) => r.order_id))];
          if (refundOrderIds.length === 0) {
            query = query.eq('payment_status', 'refunded');
          } else {
            query = query.or(`payment_status.eq.refunded,id.in.(${refundOrderIds.join(',')})`);
          }
          break;
        }
        case 'all':
          break;
        default: {
          const statuses = statusesForFilter(typedFilter);
          if (statuses?.length) {
            query = query.in('status', statuses);
          }
          break;
        }
      }

      if (pageParam) {
        query = query.lt('created_at', pageParam);
      }

      const { data } = await query;
      return (data as any[]) || [];
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return lastPage[lastPage.length - 1]?.created_at;
    },
    enabled: !!sellerId,
    staleTime: 30_000,
  });
}

export type { SellerBoardCounts, SellerDashboardKpis, SellerOrderFilter };
