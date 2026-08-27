// @ts-nocheck
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  aggregateSellerBoardFromOrders,
  emptyBoardCounts,
  emptyDashboardKpis,
  getIstPeriodBounds,
  isFutureScheduledAwaitingPrep,
  isPortfolioSellerId,
  statusesForFilter,
  sumBoardCounts,
  type SellerBoardCounts,
  type SellerDashboardKpis,
  type SellerOrderFilter,
} from '@/lib/seller-order-board';
import { istDateString } from '@/lib/scheduled-orders';

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
    upcoming: Number(raw.upcoming) || 0,
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

async function fetchCountsClientFallback(sellerId: string): Promise<SellerBoardCounts> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: orders } = await supabase
    .from('orders')
    .select('id, status, created_at, payment_status, scheduled_date, scheduled_time_start, scheduled_time, preparation_start_at, scheduled_fulfillment_at')
    .eq('seller_id', sellerId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2000);

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

async function fetchOneSellerKpis(sellerId: string): Promise<SellerDashboardKpis> {
  const { data, error } = await supabase.rpc('get_seller_dashboard_kpis', {
    p_seller_id: sellerId,
  });
  if (error) throw error;
  if (!data) throw new Error('Seller dashboard KPIs were not returned');
  return mapKpiRpc(data as Record<string, unknown>);
}

async function fetchPortfolioKpis(sellerIds: string[]): Promise<SellerDashboardKpis> {
  const { data, error } = await supabase.rpc('get_seller_portfolio_kpis', {
    p_seller_ids: sellerIds,
  });
  if (error) throw error;
  if (!data) throw new Error('Seller portfolio KPIs were not returned');
  return mapKpiRpc(data as Record<string, unknown>);
}

async function fetchOneSellerCounts(sellerId: string): Promise<SellerBoardCounts> {
  const { data, error } = await supabase.rpc('get_seller_order_board_counts', {
    p_seller_id: sellerId,
  });
  if (!error && data) return mapCountsRpc(data as Record<string, unknown>);
  console.warn('[useSellerOrderFilterCounts] RPC fallback:', error?.message);
  return fetchCountsClientFallback(sellerId);
}

async function fetchPortfolioCounts(sellerIds: string[]): Promise<SellerBoardCounts> {
  const { data, error } = await supabase.rpc('get_seller_portfolio_board_counts', {
    p_seller_ids: sellerIds,
  });
  if (!error && data) return mapCountsRpc(data as Record<string, unknown>);
  console.warn('[useSellerOrderFilterCounts] portfolio RPC fallback:', error?.message);
  const parts = await Promise.all(sellerIds.map(fetchOneSellerCounts));
  return sumBoardCounts(parts);
}

/**
 * Consolidated seller dashboard KPIs via get_seller_dashboard_kpis RPC.
 * Financial totals fail transparently — no silent 90-day / 2000-order fallback.
 * Pass `portfolioSellerIds` when sellerId is ALL_STORES_ID for labeled rollup.
 */
export function useSellerOrderStats(
  sellerId: string | null,
  portfolioSellerIds?: string[] | null,
) {
  const isPortfolio = isPortfolioSellerId(sellerId);
  const ids = isPortfolio ? (portfolioSellerIds || []) : sellerId ? [sellerId] : [];
  const cacheKey = isPortfolio ? ['portfolio', ...ids].join(',') : sellerId;

  return useQuery({
    queryKey: ['seller-dashboard-stats', cacheKey],
    queryFn: async (): Promise<SellerDashboardKpis> => {
      if (ids.length === 0) return emptyDashboardKpis();
      if (ids.length === 1) return fetchOneSellerKpis(ids[0]);
      return fetchPortfolioKpis(ids);
    },
    enabled: ids.length > 0,
    staleTime: 30_000,
  });
}

/**
 * Filter counts via get_seller_order_board_counts — must match list filter semantics.
 */
export function useSellerOrderFilterCounts(
  sellerId: string | null,
  portfolioSellerIds?: string[] | null,
) {
  const isPortfolio = isPortfolioSellerId(sellerId);
  const ids = isPortfolio ? (portfolioSellerIds || []) : sellerId ? [sellerId] : [];
  const cacheKey = isPortfolio ? ['portfolio', ...ids].join(',') : sellerId;

  return useQuery({
    queryKey: ['seller-order-filter-counts', cacheKey],
    queryFn: async (): Promise<SellerBoardCounts> => {
      if (ids.length === 0) return emptyBoardCounts();
      if (ids.length === 1) return fetchOneSellerCounts(ids[0]);
      return fetchPortfolioCounts(ids);
    },
    enabled: ids.length > 0,
    staleTime: 30_000,
  });
}

export function useSellerOrdersInfinite(
  sellerId: string | null,
  filter: string = 'all',
  portfolioSellerIds?: string[] | null,
) {
  const isPortfolio = isPortfolioSellerId(sellerId);
  const ids = isPortfolio ? (portfolioSellerIds || []) : sellerId ? [sellerId] : [];
  const cacheKey = isPortfolio ? ['portfolio', ...ids].join(',') : sellerId;

  return useInfiniteQuery({
    queryKey: ['seller-orders', cacheKey, filter],
    queryFn: async ({ pageParam }) => {
      if (ids.length === 0) return [];

      let query = supabase
        .from('orders')
        .select(
          `id, created_at, status, payment_status, total_amount, order_type, fulfillment_type, delivery_handled_by, transaction_type, auto_cancel_at, auto_accepted, seller_id, buyer_id, rejection_reason, delivery_address, delivery_lat, delivery_lng, scheduled_date, scheduled_time_start, scheduled_time, preparation_start_at, scheduled_fulfillment_at, cancellation_cutoff_at, buyer:profiles!orders_buyer_id_fkey(name, block, flat_number, phone, phase), items:order_items(id, product_name, quantity, unit_price, status)`,
        )
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)
        .or('status.neq.payment_pending,payment_status.eq.buyer_confirmed');

      if (ids.length === 1) {
        query = query.eq('seller_id', ids[0]);
      } else {
        query = query.in('seller_id', ids);
      }

      const { todayISO } = getIstPeriodBounds();
      const typedFilter = filter as SellerOrderFilter;
      const todayIst = istDateString();

      switch (typedFilter) {
        case 'today':
          query = query.gte('created_at', todayISO);
          break;
        case 'upcoming':
          query = query
            .not('scheduled_date', 'is', null)
            .gte('scheduled_date', todayIst)
            .in('status', statusesForFilter('upcoming')!)
            .order('scheduled_date', { ascending: true })
            .order('scheduled_time_start', { ascending: true });
          break;
        case 'pending':
          query = query.or(
            `status.in.(${statusesForFilter('pending')!.join(',')}),and(status.eq.payment_pending,payment_status.eq.buyer_confirmed)`,
          );
          break;
        case 'refunded': {
          let refundQ = supabase
            .from('refund_requests')
            .select('order_id, orders!inner(seller_id)')
            .in('status', ['requested', 'approved', 'settled', 'processing', 'auto_approved', 'completed']);
          if (ids.length === 1) {
            refundQ = refundQ.eq('orders.seller_id', ids[0]);
          } else {
            refundQ = refundQ.in('orders.seller_id', ids);
          }
          const { data: refundRows } = await refundQ;
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
      let rows = (data as any[]) || [];

      if (typedFilter === 'pending') {
        rows = rows.filter((r) => !isFutureScheduledAwaitingPrep(r));
      } else if (typedFilter === 'upcoming') {
        rows = rows.filter((r) => isFutureScheduledAwaitingPrep(r));
      }

      return rows;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return lastPage[lastPage.length - 1]?.created_at;
    },
    enabled: ids.length > 0,
    staleTime: 30_000,
  });
}

export type { SellerBoardCounts, SellerDashboardKpis, SellerOrderFilter };
