// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface StuckOrder {
  id: string;
  status: string;
  status_changed_at: string;
  buyer_id: string;
  seller_id: string;
  elapsed_seconds: number;
}

/**
 * Lists orders sitting in any non-terminal status long enough to have
 * triggered at least the L1 reminder rule.
 */
export function useStuckOrders() {
  return useQuery<StuckOrder[]>({
    queryKey: ['stuck-orders'],
    queryFn: async () => {
      // Pull active L1 rules to find shortest delay per status
      const { data: rules } = await supabase
        .from('notification_rules')
        .select('trigger_status, delay_seconds, escalation_level, entity_type')
        .eq('entity_type', 'order')
        .eq('active', true)
        .order('escalation_level');

      const minDelayByStatus: Record<string, number> = {};
      for (const r of rules || []) {
        const cur = minDelayByStatus[(r as any).trigger_status];
        if (cur === undefined || (r as any).delay_seconds < cur) {
          minDelayByStatus[(r as any).trigger_status] = (r as any).delay_seconds;
        }
      }

      const statuses = Object.keys(minDelayByStatus);
      if (statuses.length === 0) return [];

      const { data: orders, error } = await supabase
        .from('orders')
        .select('id, status, status_changed_at, buyer_id, seller_id')
        .in('status', statuses)
        .order('status_changed_at', { ascending: true })
        .limit(200);
      if (error) throw error;

      const now = Date.now();
      return (orders || [])
        .map((o) => {
          const elapsed = Math.floor((now - new Date((o as any).status_changed_at).getTime()) / 1000);
          return { ...(o as any), elapsed_seconds: elapsed } as StuckOrder;
        })
        .filter((o) => o.elapsed_seconds >= (minDelayByStatus[o.status] ?? Infinity));
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
