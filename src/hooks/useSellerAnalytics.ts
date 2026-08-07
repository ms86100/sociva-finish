// @ts-nocheck
/**
 * Canonical seller analytics for the dashboard Stats tab.
 * Settled-only revenue/AOV — same GMV definition as get_seller_dashboard_kpis.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { subDays, format } from 'date-fns';
import { isSettledRevenueOrder, computeFulfillMinutes, resolveFulfillEndAt } from '@/lib/seller-order-board';

export interface DailyRevenue {
  date: string;
  revenue: number;
  orders: number;
}

export interface TopProduct {
  product_id: string;
  name: string;
  views: number;
  orders: number;
  revenue: number;
  qty: number;
}

export interface SellerAnalyticsData {
  dailyRevenue: DailyRevenue[];
  topProducts: TopProduct[];
  repeatCustomerRate: number;
  totalCustomers: number;
  avgOrderValue: number;
  peakHours: { hour: number; count: number }[];
  cancelRate: number;
  refundRate: number;
  avgFulfillMinutes: number | null;
  settledRevenue30d: number;
  settledOrders30d: number;
}

export function useSellerAnalytics(sellerId: string | null) {
  return useQuery({
    queryKey: ['seller-analytics-charts', sellerId],
    queryFn: async (): Promise<SellerAnalyticsData> => {
      const thirtyDaysAgo = subDays(new Date(), 30).toISOString();

      const [ordersRes, itemsRes, viewsRes] = await Promise.all([
        supabase
          .from('orders')
          .select('id, total_amount, buyer_id, created_at, updated_at, delivered_at, status_changed_at, status, payment_status')
          .eq('seller_id', sellerId!)
          .gte('created_at', thirtyDaysAgo)
          .neq('status', 'payment_pending'),
        supabase
          .from('order_items')
          .select('product_id, product_name, quantity, unit_price, order:orders!inner(seller_id, status, payment_status, created_at)')
          .eq('order.seller_id', sellerId!)
          .gte('order.created_at', thirtyDaysAgo),
        supabase
          .from('product_views')
          .select('product_id, products(name)')
          .eq('seller_id', sellerId!)
          .gte('viewed_at', thirtyDaysAgo),
      ]);

      const orderList = ordersRes.data || [];
      const settled = orderList.filter((o) => isSettledRevenueOrder(o.status, o.payment_status));

      const dailyMap = new Map<string, { revenue: number; orders: number }>();
      for (let i = 29; i >= 0; i--) {
        dailyMap.set(format(subDays(new Date(), i), 'MMM dd'), { revenue: 0, orders: 0 });
      }
      settled.forEach((o) => {
        const d = format(new Date(o.created_at), 'MMM dd');
        const entry = dailyMap.get(d);
        if (entry) {
          entry.revenue += Number(o.total_amount) || 0;
          entry.orders += 1;
        }
      });
      const dailyRevenue = Array.from(dailyMap.entries()).map(([date, v]) => ({ date, ...v }));

      const viewMap = new Map<string, { name: string; views: number }>();
      (viewsRes.data || []).forEach((v: any) => {
        const existing = viewMap.get(v.product_id);
        if (existing) existing.views += 1;
        else viewMap.set(v.product_id, { name: v.products?.name || 'Unknown', views: 1 });
      });

      const salesMap = new Map<string, { name: string; qty: number; revenue: number; orders: number }>();
      (itemsRes.data || []).forEach((item: any) => {
        const ord = item.order;
        if (!ord || !isSettledRevenueOrder(ord.status, ord.payment_status)) return;
        const key = item.product_id || item.product_name;
        if (!key) return;
        const existing = salesMap.get(key) || {
          name: item.product_name || 'Unknown',
          qty: 0,
          revenue: 0,
          orders: 0,
        };
        existing.qty += Number(item.quantity) || 0;
        existing.revenue += (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
        existing.orders += 1;
        salesMap.set(key, existing);
      });

      const topProducts: TopProduct[] = Array.from(salesMap.entries())
        .map(([product_id, v]) => ({
          product_id,
          name: v.name,
          qty: v.qty,
          revenue: v.revenue,
          orders: v.orders,
          views: viewMap.get(product_id)?.views || 0,
        }))
        .sort((a, b) => b.revenue - a.revenue || b.qty - a.qty)
        .slice(0, 5);

      // If no sales yet, fall back to views so the panel isn't empty
      if (topProducts.length === 0) {
        topProducts.push(
          ...Array.from(viewMap.entries())
            .map(([product_id, v]) => ({
              product_id,
              name: v.name,
              views: v.views,
              orders: 0,
              revenue: 0,
              qty: 0,
            }))
            .sort((a, b) => b.views - a.views)
            .slice(0, 5),
        );
      }

      const buyerCounts = new Map<string, number>();
      settled.forEach((o) => {
        buyerCounts.set(o.buyer_id, (buyerCounts.get(o.buyer_id) || 0) + 1);
      });
      const totalCustomers = buyerCounts.size;
      const repeatCustomers = Array.from(buyerCounts.values()).filter((c) => c > 1).length;
      const repeatCustomerRate = totalCustomers > 0 ? (repeatCustomers / totalCustomers) * 100 : 0;

      const settledRevenue30d = settled.reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
      const settledOrders30d = settled.length;
      const avgOrderValue = settledOrders30d > 0 ? settledRevenue30d / settledOrders30d : 0;

      const hourCounts = new Array(24).fill(0);
      settled.forEach((o) => {
        const istTime = new Date(o.created_at).toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: 'numeric',
          hour12: false,
        });
        const h = parseInt(istTime, 10);
        if (!isNaN(h) && h >= 0 && h < 24) hourCounts[h]++;
      });
      const peakHours = hourCounts
        .map((count, hour) => ({ hour, count }))
        .filter((h) => h.count > 0)
        .sort((a, b) => b.count - a.count);

      const considered = orderList.length;
      const cancelled = orderList.filter((o) =>
        ['cancelled', 'rejected', 'returned', 'failed', 'no_show'].includes(o.status),
      ).length;
      const refunded = orderList.filter((o) => o.payment_status === 'refunded').length;
      const cancelRate = considered > 0 ? Math.round((cancelled / considered) * 100) : 0;
      const refundRate = considered > 0 ? Math.round((refunded / considered) * 100) : 0;

      let fulfillSum = 0;
      let fulfillN = 0;
      settled.forEach((o) => {
        const mins = computeFulfillMinutes(o.created_at, resolveFulfillEndAt(o));
        if (mins != null) {
          fulfillSum += mins;
          fulfillN++;
        }
      });

      return {
        dailyRevenue,
        topProducts,
        repeatCustomerRate,
        totalCustomers,
        avgOrderValue,
        peakHours,
        cancelRate,
        refundRate,
        avgFulfillMinutes: fulfillN > 0 ? Math.round(fulfillSum / fulfillN) : null,
        settledRevenue30d,
        settledOrders30d,
      };
    },
    enabled: !!sellerId,
    staleTime: 60_000,
  });
}
