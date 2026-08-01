// @ts-nocheck
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const PAGE_SIZE = 20;

interface SellerDashboardStats {
  totalOrders: number;
  pendingOrders: number;
  completedOrders: number;
  preparingOrders: number;
  readyOrders: number;
  todayOrders: number;
  enquiryOrders: number;
  totalEarnings: number;
  todayEarnings: number;
  weekEarnings: number;
}

/**
 * Consolidated seller dashboard stats — merges old useSellerOrderStats + useSellerOrderFilterCounts
 * into a single query with 3 lightweight DB calls instead of 15.
 */
export function useSellerOrderStats(sellerId: string | null) {
  return useQuery({
    queryKey: ['seller-dashboard-stats', sellerId],
    queryFn: async (): Promise<SellerDashboardStats> => {
      // Use IST boundaries — orders store created_at in UTC, so compute IST midnight as UTC
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const istDateStr = `${nowIST.getFullYear()}-${String(nowIST.getMonth() + 1).padStart(2, '0')}-${String(nowIST.getDate()).padStart(2, '0')}`;
      const todayISO = new Date(`${istDateStr}T00:00:00+05:30`).toISOString();

      const weekStartIST = new Date(nowIST);
      weekStartIST.setDate(weekStartIST.getDate() - weekStartIST.getDay());
      const weekDateStr = `${weekStartIST.getFullYear()}-${String(weekStartIST.getMonth() + 1).padStart(2, '0')}-${String(weekStartIST.getDate()).padStart(2, '0')}`;
      const weekISO = new Date(`${weekDateStr}T00:00:00+05:30`).toISOString();

      // Single query: fetch status + total_amount + created_at for all seller orders
      // With 1-2 users this is tiny; even at scale the seller's own orders are bounded
      const { data: orders } = await supabase
        .from('orders')
        .select('status, total_amount, created_at, payment_status')
        .eq('seller_id', sellerId!);

      const rows = orders || [];

      let totalOrders = 0;
      let pendingOrders = 0;
      let completedOrders = 0;
      let preparingOrders = 0;
      let readyOrders = 0;
      let todayOrders = 0;
      let totalEarnings = 0;
      let todayEarnings = 0;
      let weekEarnings = 0;

      let enquiryOrders = 0;

      for (const row of rows) {
        totalOrders++;
        const amt = Number(row.total_amount) || 0;
        const isToday = row.created_at >= todayISO;
        const isWeek = row.created_at >= weekISO;

        switch (row.status) {
          case 'completed':
          case 'delivered':
            completedOrders++;
            if (row.payment_status !== 'refunded') {
              totalEarnings += amt;
              if (isToday) todayEarnings += amt;
              if (isWeek) weekEarnings += amt;
            }
            break;
          case 'preparing':
            preparingOrders++;
            pendingOrders++;
            break;
          case 'ready':
            readyOrders++;
            pendingOrders++;
            break;
          case 'enquired':
          case 'quoted':
            enquiryOrders++;
            break;
          case 'cancelled':
          case 'returned':
          case 'no_show':
          case 'payment_pending':
            // Terminal / non-actionable statuses — exclude from counts
            break;
          case 'on_the_way':
          case 'at_gate':
          case 'in_progress':
          case 'picked_up':
          case 'assigned':
          case 'arrived':
            // In-transit / active delivery — not "pending" from seller's perspective
            break;
          default:
            // placed, accepted, confirmed, requested, scheduled, etc. = pending seller action
            pendingOrders++;
            break;
        }

        if (isToday) todayOrders++;
      }

      return {
        totalOrders,
        pendingOrders,
        completedOrders,
        preparingOrders,
        readyOrders,
        todayOrders,
        enquiryOrders,
        totalEarnings,
        todayEarnings,
        weekEarnings,
      };
    },
    enabled: !!sellerId,
    staleTime: 5 * 60_000,
  });
}

/**
 * Filter counts derived from the same stats query — no extra DB calls needed.
 */
export function useSellerOrderFilterCounts(sellerId: string | null) {
  const { data: stats } = useSellerOrderStats(sellerId);

  return useQuery({
    queryKey: ['seller-order-filter-counts', sellerId],
    queryFn: () => ({
      all: stats?.totalOrders || 0,
      today: stats?.todayOrders || 0,
      enquiries: stats?.enquiryOrders || 0,
      pending: stats?.pendingOrders || 0,
      preparing: stats?.preparingOrders || 0,
      ready: stats?.readyOrders || 0,
      completed: stats?.completedOrders || 0,
    }),
    enabled: !!sellerId && !!stats,
    staleTime: 5 * 60_000,
  });
}

export function useSellerOrdersInfinite(sellerId: string | null, filter: string = 'all') {
  return useInfiniteQuery({
    queryKey: ['seller-orders', sellerId, filter],
    queryFn: async ({ pageParam }) => {
      let query = supabase
        .from('orders')
        .select(`id, created_at, status, payment_status, total_amount, order_type, fulfillment_type, delivery_handled_by, transaction_type, auto_cancel_at, auto_accepted, seller_id, buyer_id, buyer:profiles!orders_buyer_id_fkey(name, block, flat_number, phone), items:order_items(id, product_name, quantity, unit_price, status)`)
        .eq('seller_id', sellerId!)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)
        .neq('status', 'payment_pending');

      // Apply filter
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const istDateStr = `${nowIST.getFullYear()}-${String(nowIST.getMonth() + 1).padStart(2, '0')}-${String(nowIST.getDate()).padStart(2, '0')}`;
      const todayISO = new Date(`${istDateStr}T00:00:00+05:30`).toISOString();
      switch (filter) {
        case 'today':
          query = query.gte('created_at', todayISO);
          break;
        case 'enquiries':
          query = query.in('status', ['enquired', 'quoted']);
          break;
        case 'pending':
          query = query.in('status', ['placed', 'accepted', 'confirmed', 'requested', 'scheduled']);
          break;
        case 'preparing':
          query = query.eq('status', 'preparing');
          break;
        case 'ready':
          query = query.eq('status', 'ready');
          break;
        case 'completed':
          query = query.in('status', ['completed', 'delivered']);
          break;
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
    staleTime: 2 * 60_000,
  });
}
