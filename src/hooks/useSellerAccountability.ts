import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface SellerMetric {
  seller_id: string;
  avg_response_seconds: number;
  missed_orders_count: number;
  escalation_hits: number;
  total_orders_30d: number;
  last_active_at: string | null;
  updated_at: string;
  business_name?: string | null;
}

export function useSellerAccountability() {
  return useQuery({
    queryKey: ['seller-performance-metrics'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('seller_performance_metrics' as any)
        .select('*')
        .order('escalation_hits', { ascending: false })
        .limit(200);
      if (error) throw error;

      const rows = (data || []) as unknown as SellerMetric[];
      const ids = rows.map((r) => r.seller_id);
      if (ids.length === 0) return rows;

      const { data: profiles } = await supabase
        .from('seller_profiles')
        .select('id, business_name')
        .in('id', ids);
      const nameMap = new Map<string, string>();
      for (const p of profiles || []) {
        nameMap.set((p as any).id, (p as any).business_name);
      }
      return rows.map((r) => ({
        ...r,
        business_name: nameMap.get(r.seller_id) || null,
      }));
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
