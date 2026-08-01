// @ts-nocheck
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface NotificationRule {
  id: string;
  key: string;
  entity_type: string;
  trigger_status: string;
  delay_seconds: number;
  repeat_interval_seconds: number | null;
  max_repeats: number;
  escalation_level: number;
  target_actor: string;
  template_key: string;
  priority: number;
  active: boolean;
  description: string | null;
}

export function useNotificationRules() {
  return useQuery<NotificationRule[]>({
    queryKey: ['notification-rules'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_rules')
        .select('*')
        .order('entity_type')
        .order('trigger_status')
        .order('escalation_level');
      if (error) throw error;
      return (data || []) as NotificationRule[];
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useUpdateNotificationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<NotificationRule> }) => {
      const { error } = await supabase.from('notification_rules').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-rules'] }),
  });
}
