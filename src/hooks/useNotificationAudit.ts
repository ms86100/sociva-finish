import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AuditRow {
  id: string;
  entity_type: string;
  entity_id: string;
  rule_id: string | null;
  rule_key: string | null;
  queue_id: string | null;
  user_id: string | null;
  escalation_level: number;
  triggered_at: string;
  delivered_at: string | null;
  read_at: string | null;
  action_taken: string | null;
  status: string;
  error: string | null;
}

export function useNotificationAudit(limit = 100) {
  return useQuery({
    queryKey: ['notification-audit', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_audit_log' as any)
        .select('*')
        .order('triggered_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data || []) as unknown as AuditRow[];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
