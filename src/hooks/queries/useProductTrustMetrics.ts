// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ProductTrustMetric {
  product_id: string;
  total_orders: number;
  unique_buyers: number;
  last_ordered_at: string | null;
  repeat_buyer_count: number;
}

export interface SellerTrustSnapshot {
  completed_orders: number;
  cancelled_orders: number;
  avg_response_min: number;
  repeat_customer_pct: number;
  unique_customers: number;
  recent_order_count: number;
}

export function useProductTrustMetrics(productIds: string[]) {
  return useQuery({
    queryKey: ['product-trust-metrics', productIds.sort().join(',')],
    queryFn: async (): Promise<Record<string, ProductTrustMetric>> => {
      if (productIds.length === 0) return {};

      const { data, error } = await supabase.rpc('get_product_trust_metrics', {
        _product_ids: productIds,
      });

      if (error) {
        console.error('Error fetching product trust metrics:', error);
        return {};
      }

      const map: Record<string, ProductTrustMetric> = {};
      (data as any[] || []).forEach((m: any) => {
        map[m.product_id] = m;
      });
      return map;
    },
    enabled: productIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSellerTrustSnapshot(sellerId: string | null) {
  return useQuery({
    queryKey: ['seller-trust-snapshot', sellerId],
    queryFn: async (): Promise<SellerTrustSnapshot | null> => {
      if (!sellerId) return null;

      const { data, error } = await supabase.rpc('get_seller_trust_snapshot', {
        _seller_id: sellerId,
      });

      if (error) {
        console.error('Error fetching seller trust snapshot:', error);
        return null;
      }

      return (data as any[])?.[0] || null;
    },
    enabled: !!sellerId,
    staleTime: 5 * 60 * 1000,
  });
}

/** Format "last ordered" into human-readable relative time */
export function formatLastOrdered(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return null; // too old to show
}
