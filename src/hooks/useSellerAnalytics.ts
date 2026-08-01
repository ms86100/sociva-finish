// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { startOfDay, subDays, format } from 'date-fns';

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
}

export interface SellerAnalyticsData {
  dailyRevenue: DailyRevenue[];
  topProducts: TopProduct[];
  repeatCustomerRate: number;
  totalCustomers: number;
  avgOrderValue: number;
  peakHours: { hour: number; count: number }[];
}

export function useSellerAnalytics(sellerId: string | null) {
  return useQuery({
    queryKey: ['seller-analytics-charts', sellerId],
    queryFn: async (): Promise<SellerAnalyticsData> => {
      const thirtyDaysAgo = subDays(new Date(), 30).toISOString();

      // Parallel fetch: orders + product views at the same time
      const [ordersRes, viewsRes] = await Promise.all([
        supabase
          .from('orders')
          .select('id, total_amount, buyer_id, created_at, status')
          .eq('seller_id', sellerId!)
          .gte('created_at', thirtyDaysAgo)
          .not('status', 'in', '("cancelled","rejected","payment_pending")'),
        supabase
          .from('product_views')
          .select('product_id, products(name)')
          .eq('seller_id', sellerId!)
          .gte('viewed_at', thirtyDaysAgo),
      ]);

      const orderList = ordersRes.data || [];
      const views = viewsRes.data || [];

      // Daily revenue
      const dailyMap = new Map<string, { revenue: number; orders: number }>();
      for (let i = 29; i >= 0; i--) {
        const d = format(subDays(new Date(), i), 'MMM dd');
        dailyMap.set(d, { revenue: 0, orders: 0 });
      }
      orderList.forEach(o => {
        const d = format(new Date(o.created_at), 'MMM dd');
        const entry = dailyMap.get(d);
        if (entry) {
          entry.revenue += Number(o.total_amount) || 0;
          entry.orders += 1;
        }
      });
      const dailyRevenue = Array.from(dailyMap.entries()).map(([date, v]) => ({ date, ...v }));

      const viewMap = new Map<string, { name: string; views: number }>();
      (views).forEach((v: any) => {
        const existing = viewMap.get(v.product_id);
        if (existing) {
          existing.views += 1;
        } else {
          viewMap.set(v.product_id, { name: v.products?.name || 'Unknown', views: 1 });
        }
      });
      const topProducts: TopProduct[] = Array.from(viewMap.entries())
        .map(([product_id, v]) => ({ product_id, ...v, orders: 0 }))
        .sort((a, b) => b.views - a.views)
        .slice(0, 5);

      // Repeat customer rate
      const buyerCounts = new Map<string, number>();
      orderList.forEach(o => {
        buyerCounts.set(o.buyer_id, (buyerCounts.get(o.buyer_id) || 0) + 1);
      });
      const totalCustomers = buyerCounts.size;
      const repeatCustomers = Array.from(buyerCounts.values()).filter(c => c > 1).length;
      const repeatCustomerRate = totalCustomers > 0 ? (repeatCustomers / totalCustomers) * 100 : 0;

      // Average order value
      const totalRevenue = orderList.reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
      const avgOrderValue = orderList.length > 0 ? totalRevenue / orderList.length : 0;

      // Peak hours
      const hourCounts = new Array(24).fill(0);
      orderList.forEach(o => {
        // Use IST for consistent peak hour analysis
        const istTime = new Date(o.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false });
        const h = parseInt(istTime, 10);
        if (!isNaN(h) && h >= 0 && h < 24) hourCounts[h]++;
      });
      const peakHours = hourCounts.map((count, hour) => ({ hour, count })).filter(h => h.count > 0).sort((a, b) => b.count - a.count);

      return { dailyRevenue, topProducts, repeatCustomerRate, totalCustomers, avgOrderValue, peakHours };
    },
    enabled: !!sellerId,
    staleTime: 5 * 60_000,
  });
}
