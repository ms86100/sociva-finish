// @ts-nocheck
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface NotificationTemplate {
  id: string;
  key: string;
  title_template: string;
  body_template: string;
  channel: string;
  tone: string;
  active: boolean;
  description: string | null;
}

export function useNotificationTemplates() {
  return useQuery<NotificationTemplate[]>({
    queryKey: ['notification-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_templates')
        .select('*')
        .order('key');
      if (error) throw error;
      return (data || []) as NotificationTemplate[];
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useUpdateNotificationTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<NotificationTemplate> }) => {
      const { error } = await supabase.from('notification_templates').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-templates'] }),
  });
}

export function useEngineRuns(limit = 20) {
  return useQuery({
    queryKey: ['notification-engine-runs', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_engine_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data || [];
    },
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}
