// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useState } from 'react';

export type PeriodFilter = 'today' | '7d' | '30d' | 'all';

// Status buckets for grouping
const DELIVERED_STATUSES = ['delivered', 'completed'];
const CANCELLED_STATUSES = ['cancelled', 'no_show'];

type StatusBucket = 'delivered' | 'cancelled' | 'active';

function getStatusBucket(status: string): StatusBucket {
  if (DELIVERED_STATUSES.includes(status)) return 'delivered';
  if (CANCELLED_STATUSES.includes(status)) return 'cancelled';
  return 'active';
}

function getDateFrom(period: PeriodFilter): string | null {
  const now = new Date();
  switch (period) {
    case 'today': return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    case '7d': { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString(); }
    case '30d': { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString(); }
    default: return null;
  }
}

export interface StatusBreakdownEntry {
  status: string;
  count: number;
  revenue: number;
}

export function useAdminAnalytics() {
  const [period, setPeriod] = useState<PeriodFilter>('7d');
  const dateFrom = getDateFrom(period);

  const overview = useQuery({
    queryKey: ['admin-analytics-overview', period],
    queryFn: async () => {
      // Fetch ALL orders (including cancelled)
      const base = supabase.from('orders').select('id, total_amount, status, seller_id, created_at');
      const q = dateFrom ? base.gte('created_at', dateFrom) : base;
      const { data: orders } = await q.limit(5000);

      const allOrders = orders || [];

      // Status breakdown
      const statusMap = new Map<string, { count: number; revenue: number }>();
      const sellerIds = new Set<string>();

      allOrders.forEach(o => {
        const entry = statusMap.get(o.status) || { count: 0, revenue: 0 };
        entry.count++;
        entry.revenue += o.total_amount || 0;
        statusMap.set(o.status, entry);
        if (!CANCELLED_STATUSES.includes(o.status)) {
          sellerIds.add(o.seller_id);
        }
      });

      const statusBreakdown: StatusBreakdownEntry[] = Array.from(statusMap.entries())
        .map(([status, data]) => ({ status, ...data }))
        .sort((a, b) => b.count - a.count);

      const totalOrders = allOrders.length;
      const totalRevenue = allOrders.reduce((s, o) => s + (o.total_amount || 0), 0);
      const deliveredRevenue = allOrders
        .filter(o => DELIVERED_STATUSES.includes(o.status))
        .reduce((s, o) => s + (o.total_amount || 0), 0);
      const cancelledRevenue = allOrders
        .filter(o => CANCELLED_STATUSES.includes(o.status))
        .reduce((s, o) => s + (o.total_amount || 0), 0);
      const activeSellers = sellerIds.size;

      // Items sold (from non-cancelled orders only)
      const nonCancelledOrderIds = allOrders
        .filter(o => !CANCELLED_STATUSES.includes(o.status))
        .map(o => o.id);

      let productsSold = 0;
      if (nonCancelledOrderIds.length > 0) {
        const { count } = await supabase
          .from('order_items')
          .select('id', { count: 'exact', head: true })
          .in('order_id', nonCancelledOrderIds.slice(0, 500));
        productsSold = count || 0;
      }

      return {
        totalOrders,
        totalRevenue,
        deliveredRevenue,
        cancelledRevenue,
        activeSellers,
        productsSold,
        statusBreakdown,
      };
    },
    staleTime: 5 * 60_000,
  });

  return { period, setPeriod, overview };
}

// Orders monitor with pagination
export function useOrdersMonitor(filters: {
  status?: string;
  paymentStatus?: string;
  societyId?: string;
  sellerId?: string;
  dateFrom?: string;
  page: number;
  pageSize: number;
}) {
  return useQuery({
    queryKey: ['admin-orders-monitor', filters],
    queryFn: async () => {
      const from = filters.page * filters.pageSize;
      const to = from + filters.pageSize - 1;

      let q = supabase.from('orders').select(`
        id, buyer_id, seller_id, society_id, status, total_amount, payment_type, payment_status,
        delivery_address, notes, order_type, created_at, updated_at,
        seller:seller_profiles!orders_seller_id_fkey(id, business_name, user_id),
        buyer:profiles!orders_buyer_id_fkey(id, name, phone, flat_number, block),
        items:order_items(id, product_name, quantity, unit_price, product_id)
      `, { count: 'exact' }).order('created_at', { ascending: false }).range(from, to);

      if (filters.status && filters.status !== 'all') q = q.eq('status', filters.status as any);
      if (filters.paymentStatus && filters.paymentStatus !== 'all') q = q.eq('payment_status', filters.paymentStatus as any);
      if (filters.societyId) q = q.eq('society_id', filters.societyId);
      if (filters.sellerId) q = q.eq('seller_id', filters.sellerId);
      if (filters.dateFrom) q = q.gte('created_at', filters.dateFrom);

      const { data, count, error } = await q;
      if (error) throw error;
      return { orders: data || [], total: count || 0 };
    },
    staleTime: 2 * 60_000,
  });
}

// Seller performance with status buckets
export function useSellerPerformance(period: PeriodFilter) {
  const dateFrom = getDateFrom(period);
  return useQuery({
    queryKey: ['admin-seller-performance', period],
    queryFn: async () => {
      const { data: sellers } = await supabase.from('seller_profiles').select(`
        id, business_name, rating, total_reviews, is_available, verification_status, society_id,
        society:societies!seller_profiles_society_id_fkey(name)
      `).eq('verification_status', 'approved').order('rating', { ascending: false }).limit(200);

      if (!sellers?.length) return [];

      const sellerIds = sellers.map(s => s.id);
      let ordersQ = supabase.from('orders').select('seller_id, total_amount, status, created_at').in('seller_id', sellerIds);
      if (dateFrom) ordersQ = ordersQ.gte('created_at', dateFrom);
      const { data: orders } = await ordersQ.limit(5000);

      const orderMap = new Map<string, {
        total: number; totalRevenue: number;
        delivered: number; deliveredRevenue: number;
        cancelled: number; cancelledRevenue: number;
        active: number; activeRevenue: number;
      }>();

      (orders || []).forEach(o => {
        const cur = orderMap.get(o.seller_id) || {
          total: 0, totalRevenue: 0,
          delivered: 0, deliveredRevenue: 0,
          cancelled: 0, cancelledRevenue: 0,
          active: 0, activeRevenue: 0,
        };
        const amt = o.total_amount || 0;
        cur.total++;
        cur.totalRevenue += amt;
        const bucket = getStatusBucket(o.status);
        cur[bucket]++;
        cur[`${bucket}Revenue` as keyof typeof cur] += amt;
        orderMap.set(o.seller_id, cur);
      });

      return sellers.map(s => ({
        ...s,
        societyName: (s.society as any)?.name || '—',
        ...(orderMap.get(s.id) || {
          total: 0, totalRevenue: 0,
          delivered: 0, deliveredRevenue: 0,
          cancelled: 0, cancelledRevenue: 0,
          active: 0, activeRevenue: 0,
        }),
      })).sort((a, b) => b.total - a.total);
    },
    staleTime: 5 * 60_000,
  });
}

// Buyer activity with status buckets
export function useBuyerActivity(period: PeriodFilter) {
  const dateFrom = getDateFrom(period);
  return useQuery({
    queryKey: ['admin-buyer-activity', period],
    queryFn: async () => {
      let ordersQ = supabase.from('orders').select('buyer_id, seller_id, total_amount, status, created_at');
      if (dateFrom) ordersQ = ordersQ.gte('created_at', dateFrom);
      const { data: orders } = await ordersQ.limit(5000);

      const buyerMap = new Map<string, {
        total: number; totalSpent: number; sellers: Set<string>; lastDate: string;
        delivered: number; deliveredSpent: number;
        cancelled: number; cancelledAmount: number;
        active: number;
      }>();

      (orders || []).forEach(o => {
        const cur = buyerMap.get(o.buyer_id) || {
          total: 0, totalSpent: 0, sellers: new Set(), lastDate: '',
          delivered: 0, deliveredSpent: 0,
          cancelled: 0, cancelledAmount: 0,
          active: 0,
        };
        const amt = o.total_amount || 0;
        cur.total++;
        cur.totalSpent += amt;
        cur.sellers.add(o.seller_id);
        if (o.created_at > cur.lastDate) cur.lastDate = o.created_at;

        const bucket = getStatusBucket(o.status);
        if (bucket === 'delivered') { cur.delivered++; cur.deliveredSpent += amt; }
        else if (bucket === 'cancelled') { cur.cancelled++; cur.cancelledAmount += amt; }
        else { cur.active++; }

        buyerMap.set(o.buyer_id, cur);
      });

      const buyerIds = Array.from(buyerMap.keys()).slice(0, 200);
      if (!buyerIds.length) return [];

      const { data: profiles } = await supabase.from('profiles').select('id, name, phone, flat_number, block, society_id, society:societies!profiles_society_id_fkey(name)').in('id', buyerIds);

      return (profiles || []).map(p => {
        const stats = buyerMap.get(p.id)!;
        return {
          ...p,
          societyName: (p.society as any)?.name || '—',
          orderCount: stats.total,
          totalSpent: stats.totalSpent,
          sellerCount: stats.sellers.size,
          lastOrderDate: stats.lastDate,
          delivered: stats.delivered,
          deliveredSpent: stats.deliveredSpent,
          cancelled: stats.cancelled,
          cancelledAmount: stats.cancelledAmount,
          active: stats.active,
        };
      }).sort((a, b) => b.orderCount - a.orderCount);
    },
    staleTime: 5 * 60_000,
  });
}

// Society breakdown with status buckets
export function useSocietyBreakdown(period: PeriodFilter) {
  const dateFrom = getDateFrom(period);
  return useQuery({
    queryKey: ['admin-society-breakdown', period],
    queryFn: async () => {
      const { data: societies } = await supabase.from('societies').select('id, name, member_count, is_verified').eq('is_active', true).order('member_count', { ascending: false }).limit(100);
      if (!societies?.length) return [];

      const { data: sellers } = await supabase.from('seller_profiles').select('id, society_id').eq('verification_status', 'approved');

      let ordersQ = supabase.from('orders').select('society_id, total_amount, status');
      if (dateFrom) ordersQ = ordersQ.gte('created_at', dateFrom);
      const { data: orders } = await ordersQ.limit(5000);

      const sellerCountMap = new Map<string, number>();
      (sellers || []).forEach(s => { if (s.society_id) sellerCountMap.set(s.society_id, (sellerCountMap.get(s.society_id) || 0) + 1); });

      const orderMap = new Map<string, {
        total: number; totalRevenue: number;
        delivered: number; deliveredRevenue: number;
        cancelled: number; cancelledRevenue: number;
        active: number; activeRevenue: number;
      }>();

      (orders || []).forEach(o => {
        if (!o.society_id) return;
        const cur = orderMap.get(o.society_id) || {
          total: 0, totalRevenue: 0,
          delivered: 0, deliveredRevenue: 0,
          cancelled: 0, cancelledRevenue: 0,
          active: 0, activeRevenue: 0,
        };
        const amt = o.total_amount || 0;
        cur.total++;
        cur.totalRevenue += amt;
        const bucket = getStatusBucket(o.status);
        cur[bucket]++;
        cur[`${bucket}Revenue` as keyof typeof cur] += amt;
        orderMap.set(o.society_id, cur);
      });

      return societies.map(s => ({
        ...s,
        sellerCount: sellerCountMap.get(s.id) || 0,
        ...(orderMap.get(s.id) || {
          total: 0, totalRevenue: 0,
          delivered: 0, deliveredRevenue: 0,
          cancelled: 0, cancelledRevenue: 0,
          active: 0, activeRevenue: 0,
        }),
      })).sort((a, b) => b.total - a.total);
    },
    staleTime: 5 * 60_000,
  });
}

// Category analytics — join order_items to orders for status awareness
export function useCategoryAnalytics(period: PeriodFilter) {
  const dateFrom = getDateFrom(period);
  return useQuery({
    queryKey: ['admin-category-analytics', period],
    queryFn: async () => {
      // Fetch orders with status first
      let ordersQ = supabase.from('orders').select('id, status');
      if (dateFrom) ordersQ = ordersQ.gte('created_at', dateFrom);
      const { data: ordersRaw } = await ordersQ.limit(5000);
      if (!ordersRaw?.length) return { categories: [], topProducts: [] };

      const orderStatusMap = new Map<string, string>();
      ordersRaw.forEach(o => orderStatusMap.set(o.id, o.status));
      const orderIds = ordersRaw.map(o => o.id);

      // Fetch order_items for those orders
      const { data: items } = await supabase
        .from('order_items')
        .select('order_id, product_id, product_name, quantity, unit_price')
        .in('order_id', orderIds.slice(0, 500));

      if (!items?.length) return { categories: [], topProducts: [] };

      const productIds = [...new Set(items.map(i => i.product_id).filter(Boolean))];
      const { data: products } = await supabase.from('products').select('id, category').in('id', productIds.slice(0, 500));

      const catMap = new Map<string, string>();
      (products || []).forEach(p => catMap.set(p.id, p.category));

      // Category stats with status buckets
      const categoryStats = new Map<string, {
        orderIds: Set<string>; revenue: number; quantity: number;
        deliveredRevenue: number; cancelledRevenue: number; activeRevenue: number;
        deliveredOrders: Set<string>; cancelledOrders: Set<string>; activeOrders: Set<string>;
      }>();

      const productStats = new Map<string, {
        name: string; orderIds: Set<string>; revenue: number; quantity: number;
      }>();

      items.forEach(item => {
        const cat = catMap.get(item.product_id || '') || 'unknown';
        const itemRevenue = (item.unit_price || 0) * (item.quantity || 1);
        const status = orderStatusMap.get(item.order_id) || 'unknown';
        const bucket = getStatusBucket(status);

        const cs = categoryStats.get(cat) || {
          orderIds: new Set(), revenue: 0, quantity: 0,
          deliveredRevenue: 0, cancelledRevenue: 0, activeRevenue: 0,
          deliveredOrders: new Set(), cancelledOrders: new Set(), activeOrders: new Set(),
        };
        cs.orderIds.add(item.order_id);
        cs.revenue += itemRevenue;
        cs.quantity += item.quantity || 1;
        cs[`${bucket}Revenue` as 'deliveredRevenue' | 'cancelledRevenue' | 'activeRevenue'] += itemRevenue;
        cs[`${bucket}Orders` as 'deliveredOrders' | 'cancelledOrders' | 'activeOrders'].add(item.order_id);
        categoryStats.set(cat, cs);

        const key = item.product_id || item.product_name;
        const ps = productStats.get(key) || { name: item.product_name, orderIds: new Set(), revenue: 0, quantity: 0 };
        ps.orderIds.add(item.order_id);
        ps.revenue += itemRevenue;
        ps.quantity += item.quantity || 1;
        productStats.set(key, ps);
      });

      const categories = Array.from(categoryStats.entries()).map(([cat, s]) => ({
        category: cat,
        orders: s.orderIds.size,
        quantity: s.quantity,
        revenue: s.revenue,
        deliveredRevenue: s.deliveredRevenue,
        cancelledRevenue: s.cancelledRevenue,
        activeRevenue: s.activeRevenue,
        deliveredOrders: s.deliveredOrders.size,
        cancelledOrders: s.cancelledOrders.size,
        activeOrders: s.activeOrders.size,
      })).sort((a, b) => b.orders - a.orders);

      const topProducts = Array.from(productStats.entries()).map(([_, s]) => ({
        name: s.name,
        orders: s.orderIds.size,
        revenue: s.revenue,
        quantity: s.quantity,
      })).sort((a, b) => b.orders - a.orders).slice(0, 20);

      return { categories, topProducts };
    },
    staleTime: 5 * 60_000,
  });
}
