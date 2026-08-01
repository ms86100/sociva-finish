// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface BuilderStats {
  totalRevenue: number;
  totalPendingApprovals: number;
  breachedSLAs: number;
  onTrackSLAs: number;
}

export function useBuilderStats(societyIds: string[]) {
  return useQuery({
    queryKey: ['builder-stats', societyIds],
    queryFn: async (): Promise<BuilderStats> => {
      if (societyIds.length === 0) {
        return { totalRevenue: 0, totalPendingApprovals: 0, breachedSLAs: 0, onTrackSLAs: 0 };
      }

      const [revenueRes, pendingUsersRes, pendingSellersRes, disputesRes] = await Promise.all([
        supabase
          .from('orders')
          .select('total_amount')
          .in('society_id', societyIds)
          .eq('status', 'completed'),
        supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .in('society_id', societyIds)
          .eq('verification_status', 'pending'),
        supabase
          .from('seller_profiles')
          .select('id', { count: 'exact', head: true })
          .in('society_id', societyIds)
          .eq('verification_status', 'pending'),
        supabase
          .from('dispute_tickets')
          .select('sla_deadline')
          .in('society_id', societyIds)
          .not('status', 'in', '("resolved","closed")'),
      ]);

      const totalRevenue = (revenueRes.data || []).reduce(
        (sum, o) => sum + Number(o.total_amount), 0
      );
      const totalPendingApprovals = (pendingUsersRes.count || 0) + (pendingSellersRes.count || 0);

      const now = new Date().toISOString();
      const disputes = disputesRes.data || [];
      const breachedSLAs = disputes.filter(d => d.sla_deadline < now).length;
      const onTrackSLAs = disputes.filter(d => d.sla_deadline >= now).length;

      return { totalRevenue, totalPendingApprovals, breachedSLAs, onTrackSLAs };
    },
    enabled: societyIds.length > 0,
    staleTime: 60 * 1000,
  });
}
