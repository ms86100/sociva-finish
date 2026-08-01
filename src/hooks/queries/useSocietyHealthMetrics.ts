// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface SocietyHealthMetrics {
  trustScore: number;
  avgResponseHours: number | null;
  disputesResolvedThisMonth: number;
  disputesOpenedThisMonth: number;
  snagsFixedThisMonth: number;
  snagsOpenThisMonth: number;
  expensesThisMonth: number;
  expenseAmountThisMonth: number;
  constructionProgress: number;
  milestonesThisMonth: number;
  pendingDues: number;
  memberCount: number;
}

export function useSocietyHealthMetrics() {
  const { effectiveSocietyId } = useAuth();

  return useQuery({
    queryKey: ['society-health-metrics', effectiveSocietyId],
    queryFn: async (): Promise<SocietyHealthMetrics> => {
      const sid = effectiveSocietyId!;
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();

      const [
        trustRes,
        disputesOpened,
        disputesResolved,
        snagsOpen,
        snagsFixed,
        expenses,
        milestones,
        latestMilestone,
        pendingDues,
        members,
        ackedDisputes,
        ackedSnags,
      ] = await Promise.all([
        supabase.from('societies').select('trust_score').eq('id', sid).single(),
        supabase.from('dispute_tickets').select('id', { count: 'exact', head: true }).eq('society_id', sid).gte('created_at', thirtyDaysAgo),
        supabase.from('dispute_tickets').select('id', { count: 'exact', head: true }).eq('society_id', sid).in('status', ['resolved', 'closed']).gte('created_at', thirtyDaysAgo),
        supabase.from('snag_tickets').select('id', { count: 'exact', head: true }).eq('society_id', sid).not('status', 'in', '("fixed","verified","closed")'),
        supabase.from('snag_tickets').select('id', { count: 'exact', head: true }).eq('society_id', sid).in('status', ['fixed', 'verified', 'closed']).gte('created_at', thirtyDaysAgo),
        supabase.from('society_expenses').select('amount').eq('society_id', sid).gte('created_at', thirtyDaysAgo),
        supabase.from('construction_milestones').select('id', { count: 'exact', head: true }).eq('society_id', sid).gte('created_at', thirtyDaysAgo),
        supabase.from('construction_milestones').select('completion_percentage').eq('society_id', sid).order('created_at', { ascending: false }).limit(1).single(),
        supabase.from('maintenance_dues').select('id', { count: 'exact', head: true }).eq('society_id', sid).eq('status', 'pending'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('society_id', sid).eq('verification_status', 'approved'),
        supabase.from('dispute_tickets').select('created_at, acknowledged_at').eq('society_id', sid).not('acknowledged_at', 'is', null).gte('created_at', ninetyDaysAgo),
        supabase.from('snag_tickets').select('created_at, acknowledged_at').eq('society_id', sid).not('acknowledged_at', 'is', null).gte('created_at', ninetyDaysAgo),
      ]);

      // Calculate avg response time
      const allAcked = [...(ackedDisputes.data || []), ...(ackedSnags.data || [])];
      let avgHours: number | null = null;
      if (allAcked.length > 0) {
        const totalH = allAcked.reduce((sum, item: any) => {
          return sum + (new Date(item.acknowledged_at).getTime() - new Date(item.created_at).getTime()) / 3600000;
        }, 0);
        avgHours = Math.round(totalH / allAcked.length);
      }

      const expenseAmount = (expenses.data || []).reduce((s: number, e: any) => s + Number(e.amount), 0);

      return {
        trustScore: Number(trustRes.data?.trust_score || 0),
        avgResponseHours: avgHours,
        disputesResolvedThisMonth: disputesResolved.count || 0,
        disputesOpenedThisMonth: disputesOpened.count || 0,
        snagsFixedThisMonth: snagsFixed.count || 0,
        snagsOpenThisMonth: snagsOpen.count || 0,
        expensesThisMonth: (expenses.data || []).length,
        expenseAmountThisMonth: expenseAmount,
        constructionProgress: latestMilestone.data?.completion_percentage || 0,
        milestonesThisMonth: milestones.count || 0,
        pendingDues: pendingDues.count || 0,
        memberCount: members.count || 0,
      };
    },
    enabled: !!effectiveSocietyId,
    staleTime: 60_000,
  });
}
