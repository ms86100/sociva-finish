// @ts-nocheck
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Shield, FileText, MessageSquare, Wrench, Users, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TrustMetrics {
  score: number;
  documentsUploaded: number;
  qaResponseRate: number;
  avgDisputeResolutionDays: number;
  snagResolutionRate: number;
  bulletinPostsThisMonth: number;
  expensesDocumented: boolean;
}

const TRUST_LABELS: { min: number; label: string; color: string }[] = [
  { min: 9, label: 'Model Community', color: 'text-success' },
  { min: 7, label: 'Thriving', color: 'text-success' },
  { min: 5, label: 'Active', color: 'text-info' },
  { min: 3, label: 'Growing', color: 'text-warning' },
  { min: 0, label: 'Getting Started', color: 'text-muted-foreground' },
];

function getTrustInfo(score: number) {
  return TRUST_LABELS.find(t => score >= t.min) || TRUST_LABELS[TRUST_LABELS.length - 1];
}

export function TrustScoreDetailed() {
  const { effectiveSocietyId } = useAuth();
  const [metrics, setMetrics] = useState<TrustMetrics | null>(null);

  useEffect(() => {
    if (!effectiveSocietyId) return;
    fetchMetrics();
  }, [effectiveSocietyId]);

  const fetchMetrics = async () => {
    const sid = effectiveSocietyId!;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const [
      scoreRes,
      docsRes,
      qaTotal,
      qaAnswered,
      disputeTotal,
      disputeResolved,
      snagTotal,
      snagResolved,
      bulletinRes,
      expenseRes,
    ] = await Promise.all([
      supabase.from('societies').select('trust_score').eq('id', sid).single(),
      supabase.from('project_documents').select('id', { count: 'exact', head: true }).eq('society_id', sid),
      supabase.from('project_questions').select('id', { count: 'exact', head: true }).eq('society_id', sid),
      supabase.from('project_questions').select('id', { count: 'exact', head: true }).eq('society_id', sid).eq('is_answered', true),
      supabase.from('dispute_tickets').select('id', { count: 'exact', head: true }).eq('society_id', sid).gte('created_at', ninetyDaysAgo),
      supabase.from('dispute_tickets').select('id', { count: 'exact', head: true }).eq('society_id', sid).in('status', ['resolved', 'closed']).gte('created_at', ninetyDaysAgo),
      supabase.from('snag_tickets').select('id', { count: 'exact', head: true }).eq('society_id', sid).gte('created_at', ninetyDaysAgo),
      supabase.from('snag_tickets').select('id', { count: 'exact', head: true }).eq('society_id', sid).in('status', ['fixed', 'verified', 'closed']).gte('created_at', ninetyDaysAgo),
      supabase.from('bulletin_posts').select('id', { count: 'exact', head: true }).eq('society_id', sid).gte('created_at', thirtyDaysAgo),
      supabase.from('society_expenses').select('id', { count: 'exact', head: true }).eq('society_id', sid).gte('created_at', ninetyDaysAgo),
    ]);

    const qaT = qaTotal.count || 0;
    const qaA = qaAnswered.count || 0;
    const dT = disputeTotal.count || 0;
    const dR = disputeResolved.count || 0;
    const sT = snagTotal.count || 0;
    const sR = snagResolved.count || 0;

    setMetrics({
      score: Number(scoreRes.data?.trust_score || 0),
      documentsUploaded: docsRes.count || 0,
      qaResponseRate: qaT > 0 ? Math.round((qaA / qaT) * 100) : 0,
      avgDisputeResolutionDays: dT > 0 ? Math.round((dR / dT) * 100) : 0,
      snagResolutionRate: sT > 0 ? Math.round((sR / sT) * 100) : 0,
      bulletinPostsThisMonth: bulletinRes.count || 0,
      expensesDocumented: (expenseRes.count || 0) > 0,
    });
  };

  if (!metrics) return null;

  const info = getTrustInfo(metrics.score);

  const metricItems = [
    {
      icon: FileText,
      label: 'Documents uploaded',
      value: `${metrics.documentsUploaded}`,
      good: metrics.documentsUploaded >= 3,
    },
    {
      icon: MessageSquare,
      label: 'Q&A response rate',
      value: `${metrics.qaResponseRate}%`,
      good: metrics.qaResponseRate >= 70,
    },
    {
      icon: Shield,
      label: 'Dispute resolution',
      value: `${metrics.avgDisputeResolutionDays}%`,
      good: metrics.avgDisputeResolutionDays >= 70,
    },
    {
      icon: Wrench,
      label: 'Snag resolution',
      value: `${metrics.snagResolutionRate}%`,
      good: metrics.snagResolutionRate >= 70,
    },
    {
      icon: Users,
      label: 'Community posts (30d)',
      value: `${metrics.bulletinPostsThisMonth}`,
      good: metrics.bulletinPostsThisMonth >= 5,
    },
    {
      icon: TrendingUp,
      label: 'Expenses documented',
      value: metrics.expensesDocumented ? 'Yes' : 'No',
      good: metrics.expensesDocumented,
    },
  ];

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {/* Header with score */}
        <div className="flex items-center gap-3">
          <div className="relative w-14 h-14">
            <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
              <circle cx="18" cy="18" r="15" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
              <circle cx="18" cy="18" r="15" fill="none" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinecap="round"
                strokeDasharray={`${(metrics.score / 10) * 94.2} 94.2`}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-sm font-bold">
              {metrics.score.toFixed(1)}
            </span>
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Society Trust Score</p>
            <p className={cn('text-sm font-bold', info.color)}>{info.label}</p>
          </div>
        </div>

        {/* Breakdown */}
        <div className="grid grid-cols-2 gap-2">
          {metricItems.map(({ icon: Icon, label, value, good }) => (
            <div
              key={label}
              className={cn(
                'flex items-center gap-2 p-2 rounded-lg border text-xs',
                good ? 'border-success/30 bg-success/10' : 'border-border bg-muted/30'
              )}
            >
              <Icon size={14} className={good ? 'text-success' : 'text-muted-foreground'} />
              <div className="min-w-0">
                <p className="font-semibold">{value}</p>
                <p className="text-[10px] text-muted-foreground truncate">{label}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
