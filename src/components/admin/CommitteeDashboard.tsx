// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, CheckCircle2, Clock, Users, IndianRupee, Shield, TrendingUp } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface DashboardMetrics {
  openDisputes: number;
  resolvedDisputes: number;
  openSnags: number;
  resolvedSnags: number;
  pendingVisitors: number;
  maintenanceCollected: number;
  maintenancePending: number;
  totalResidents: number;
  pendingApprovals: number;
}

interface Props {
  societyId: string;
}

export function CommitteeDashboard({ societyId }: Props) {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMetrics();
  }, [societyId]);

  const fetchMetrics = async () => {
    setLoading(true);
    const [disputes, snags, visitors, maintenanceDues, residents, pending] = await Promise.all([
      supabase.from('dispute_tickets').select('status').eq('society_id', societyId),
      supabase.from('snag_tickets').select('status').eq('society_id', societyId),
      supabase.from('visitor_entries').select('status').eq('society_id', societyId).eq('status', 'expected'),
      supabase.from('maintenance_dues').select('status, amount').eq('society_id', societyId),
      supabase.from('profiles').select('id').eq('society_id', societyId).eq('verification_status', 'approved'),
      supabase.from('profiles').select('id').eq('society_id', societyId).eq('verification_status', 'pending'),
    ]);

    const disputeData = disputes.data || [];
    const snagData = snags.data || [];
    const duesData = (maintenanceDues.data as any[]) || [];

    setMetrics({
      openDisputes: disputeData.filter(d => !['resolved', 'closed'].includes(d.status)).length,
      resolvedDisputes: disputeData.filter(d => ['resolved', 'closed'].includes(d.status)).length,
      openSnags: snagData.filter(s => !['fixed', 'verified', 'closed'].includes(s.status)).length,
      resolvedSnags: snagData.filter(s => ['fixed', 'verified', 'closed'].includes(s.status)).length,
      pendingVisitors: (visitors.data || []).length,
      maintenanceCollected: duesData.filter(d => d.status === 'paid').reduce((s, d) => s + Number(d.amount), 0),
      maintenancePending: duesData.filter(d => d.status !== 'paid').reduce((s, d) => s + Number(d.amount), 0),
      totalResidents: (residents.data || []).length,
      pendingApprovals: (pending.data || []).length,
    });
    setLoading(false);
  };

  if (loading) {
    return <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}</div>;
  }

  const { formatPrice } = useCurrency();
  if (!metrics) return null;

  const collectionRate = (metrics.maintenanceCollected + metrics.maintenancePending) > 0
    ? Math.round((metrics.maintenanceCollected / (metrics.maintenanceCollected + metrics.maintenancePending)) * 100)
    : 0;

  const metricCards = [
    { icon: AlertTriangle, value: metrics.openDisputes, label: 'Open Disputes', color: 'bg-rose-500/10 text-rose-600' },
    { icon: AlertTriangle, value: metrics.openSnags, label: 'Open Snags', color: 'bg-amber-500/10 text-amber-600' },
    { icon: Users, value: metrics.pendingApprovals, label: 'Pending Approvals', color: 'bg-blue-500/10 text-blue-600' },
    { icon: Shield, value: metrics.pendingVisitors, label: 'Expected Visitors', color: 'bg-violet-500/10 text-violet-600' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
          <TrendingUp size={15} className="text-primary" />
        </div>
        <h3 className="text-sm font-bold text-foreground">Operations Overview</h3>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {metricCards.map((m, idx) => {
          const MIcon = m.icon;
          return (
            <motion.div key={m.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
              <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl hover:shadow-[var(--shadow-md)] transition-all duration-300">
                <CardContent className="p-4 text-center">
                  <div className={cn('w-9 h-9 rounded-xl mx-auto mb-2 flex items-center justify-center', m.color.split(' ')[0])}>
                    <MIcon size={16} className={m.color.split(' ')[1]} />
                  </div>
                  <p className="text-2xl font-extrabold tabular-nums">{m.value}</p>
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-widest mt-0.5">{m.label}</p>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {/* Maintenance Collection */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                  <IndianRupee size={15} className="text-emerald-600" />
                </div>
                <p className="font-bold text-sm">Maintenance Collection</p>
              </div>
              <span className="text-xs font-extrabold text-primary tabular-nums">{collectionRate}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2.5 mb-3">
              <motion.div 
                className="bg-primary h-2.5 rounded-full" 
                initial={{ width: 0 }} 
                animate={{ width: `${collectionRate}%` }} 
                transition={{ duration: 0.8, delay: 0.3 }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground font-medium">
              <span>{formatPrice(metrics.maintenanceCollected)} collected</span>
              <span>{formatPrice(metrics.maintenancePending)} pending</span>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Resolution rates */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
          <CardContent className="p-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-widest mb-1.5">Dispute Resolution</p>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={15} className="text-emerald-500" />
                <span className="font-extrabold text-lg tabular-nums">
                  {metrics.openDisputes + metrics.resolvedDisputes > 0
                    ? Math.round((metrics.resolvedDisputes / (metrics.openDisputes + metrics.resolvedDisputes)) * 100)
                    : 0}%
                </span>
              </div>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-widest mb-1.5">Snag Resolution</p>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={15} className="text-emerald-500" />
                <span className="font-extrabold text-lg tabular-nums">
                  {metrics.openSnags + metrics.resolvedSnags > 0
                    ? Math.round((metrics.resolvedSnags / (metrics.openSnags + metrics.resolvedSnags)) * 100)
                    : 0}%
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
