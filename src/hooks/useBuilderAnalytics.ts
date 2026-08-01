// @ts-nocheck
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/hooks/useCurrency';

export interface SocietyAnalytics {
  id: string;
  name: string;
  totalSnags: number;
  resolvedSnags: number;
  totalDisputes: number;
  resolvedDisputes: number;
  avgResolutionHours: number;
  slaBreached: number;
  slaOnTrack: number;
  revenue: number;
  memberCount: number;
}

export function useBuilderAnalytics() {
  const { managedBuilderIds, isAdmin } = useAuth();
  const { formatPrice } = useCurrency();
  const [societies, setSocieties] = useState<SocietyAnalytics[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [monthlyTrend, setMonthlyTrend] = useState<any[]>([]);

  useEffect(() => {
    if (managedBuilderIds.length === 0 && !isAdmin) return;
    fetchAnalytics();
  }, [managedBuilderIds, isAdmin]);

  const fetchAnalytics = async () => {
    try {
      const builderId = managedBuilderIds[0];
      if (!builderId) return;

      const { data: bSocieties } = await supabase
        .from('builder_societies')
        .select('society_id, society:societies!builder_societies_society_id_fkey(id, name, member_count)')
        .eq('builder_id', builderId);

      if (!bSocieties || bSocieties.length === 0) { setIsLoading(false); return; }

      const societyIds = bSocieties.map(s => s.society_id);

      const [snagsRes, disputesRes, ordersRes] = await Promise.all([
        supabase.from('snag_tickets').select('id, society_id, status, created_at, acknowledged_at').in('society_id', societyIds),
        supabase.from('dispute_tickets').select('id, society_id, status, created_at, acknowledged_at, resolved_at, sla_deadline').in('society_id', societyIds),
        supabase.from('orders').select('total_amount, society_id, created_at').in('society_id', societyIds).eq('status', 'completed'),
      ]);

      const snags = snagsRes.data || [];
      const disputes = disputesRes.data || [];
      const orders = ordersRes.data || [];
      const now = new Date().toISOString();

      const analyticsMap: SocietyAnalytics[] = bSocieties.map(bs => {
        const s = bs.society as any;
        const societySnags = snags.filter(sn => sn.society_id === bs.society_id);
        const societyDisputes = disputes.filter(d => d.society_id === bs.society_id);
        const societyOrders = orders.filter(o => o.society_id === bs.society_id);
        const resolvedSnags = societySnags.filter(sn => ['fixed', 'verified', 'closed'].includes(sn.status));
        const resolvedDisputes = societyDisputes.filter(d => ['resolved', 'closed'].includes(d.status));
        const resolvedWithTime = resolvedDisputes.filter(d => d.resolved_at);
        const avgHours = resolvedWithTime.length > 0
          ? resolvedWithTime.reduce((sum, d) => sum + (new Date(d.resolved_at!).getTime() - new Date(d.created_at).getTime()) / 3600000, 0) / resolvedWithTime.length : 0;
        const openDisputes = societyDisputes.filter(d => !['resolved', 'closed'].includes(d.status));
        return {
          id: bs.society_id, name: s?.name || 'Unknown',
          totalSnags: societySnags.length, resolvedSnags: resolvedSnags.length,
          totalDisputes: societyDisputes.length, resolvedDisputes: resolvedDisputes.length,
          avgResolutionHours: Math.round(avgHours),
          slaBreached: openDisputes.filter(d => d.sla_deadline < now).length,
          slaOnTrack: openDisputes.filter(d => d.sla_deadline >= now).length,
          revenue: societyOrders.reduce((sum, o) => sum + Number(o.total_amount), 0),
          memberCount: s?.member_count || 0,
        };
      });

      setSocieties(analyticsMap);

      // Monthly trend
      const months: any[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(); d.setMonth(d.getMonth() - i);
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
        const monthSnags = snags.filter(s => s.created_at.startsWith(monthKey));
        const monthDisputes = disputes.filter(dd => dd.created_at.startsWith(monthKey));
        months.push({
          month: label,
          complaints: monthSnags.length + monthDisputes.length,
          resolved: monthSnags.filter(item => ['fixed', 'verified', 'closed'].includes(item.status)).length + monthDisputes.filter(item => item.resolved_at && item.resolved_at.startsWith(monthKey)).length,
        });
      }
      setMonthlyTrend(months);
    } catch (error) {
      console.error('Analytics error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const totals = useMemo(() => ({
    totalSnags: societies.reduce((s, a) => s + a.totalSnags, 0),
    resolvedSnags: societies.reduce((s, a) => s + a.resolvedSnags, 0),
    totalDisputes: societies.reduce((s, a) => s + a.totalDisputes, 0),
    resolvedDisputes: societies.reduce((s, a) => s + a.resolvedDisputes, 0),
    totalRevenue: societies.reduce((s, a) => s + a.revenue, 0),
    totalMembers: societies.reduce((s, a) => s + a.memberCount, 0),
    totalBreached: societies.reduce((s, a) => s + a.slaBreached, 0),
    totalOnTrack: societies.reduce((s, a) => s + a.slaOnTrack, 0),
    avgResolution: societies.length > 0
      ? Math.round(societies.reduce((s, a) => s + a.avgResolutionHours, 0) / societies.filter(s => s.avgResolutionHours > 0).length || 0) : 0,
  }), [societies]);

  const resolutionRate = totals.totalSnags + totals.totalDisputes > 0
    ? Math.round(((totals.resolvedSnags + totals.resolvedDisputes) / (totals.totalSnags + totals.totalDisputes)) * 100) : 0;

  const snagCategoryData = useMemo(() => societies.map(s => ({
    name: s.name.length > 12 ? s.name.slice(0, 12) + '…' : s.name,
    snags: s.totalSnags, disputes: s.totalDisputes, resolved: s.resolvedSnags + s.resolvedDisputes,
  })), [societies]);

  const slaData = useMemo(() => [
    { name: 'On Track', value: totals.totalOnTrack },
    { name: 'Breached', value: totals.totalBreached },
  ], [totals]);

  return {
    societies, isLoading, monthlyTrend, totals, resolutionRate,
    snagCategoryData, slaData, formatPrice,
  };
}
