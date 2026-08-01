import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface EngineRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  rules_evaluated: number;
  entities_scanned: number;
  notifications_enqueued: number;
  errors: number;
  locked: boolean;
  note: string | null;
  details: Record<string, number>;
}

export function useEngineHealth() {
  return useQuery({
    queryKey: ['notification-engine-runs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_engine_runs' as any)
        .select('*')
        .order('started_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as unknown as EngineRun[];
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
