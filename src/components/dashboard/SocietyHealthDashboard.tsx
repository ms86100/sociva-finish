// @ts-nocheck
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useSocietyHealthMetrics } from '@/hooks/queries/useSocietyHealthMetrics';
import { useAuth } from '@/contexts/AuthContext';
import {
  Shield, Clock, ShieldCheck, Bug, IndianRupee,
  Building2, CreditCard, Users, ChevronRight, TrendingUp
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCurrency } from '@/hooks/useCurrency';

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

export function SocietyHealthDashboard() {
  const { effectiveSociety } = useAuth();
  const { data: metrics, isLoading } = useSocietyHealthMetrics();
  const { formatPrice } = useCurrency();

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full rounded-xl" />
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (!metrics) return null;

  const info = getTrustInfo(metrics.trustScore);

  const disputeRate = metrics.disputesOpenedThisMonth > 0
    ? Math.round((metrics.disputesResolvedThisMonth / metrics.disputesOpenedThisMonth) * 100)
    : null;

  return (
    <div className="space-y-3">
      {/* Trust Score Hero */}
      <Card className="border-primary/20 overflow-hidden">
        <CardContent className="p-0">
          <div className="bg-gradient-to-r from-primary/5 to-primary/10 p-4">
            <div className="flex items-center gap-3">
              <div className="relative w-14 h-14 shrink-0">
                <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                  <circle cx="18" cy="18" r="15" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
                  <circle cx="18" cy="18" r="15" fill="none" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinecap="round"
                    strokeDasharray={`${(metrics.trustScore / 10) * 94.2} 94.2`}
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-sm font-bold">
                  {metrics.trustScore.toFixed(1)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Society Health</p>
                <p className={cn('text-base font-bold', info.color)}>{info.label}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {effectiveSociety?.name} · {metrics.memberCount} members
                </p>
              </div>
              <Link to="/society/reports" className="shrink-0">
                <ChevronRight size={16} className="text-muted-foreground" />
              </Link>
            </div>
          </div>

          {/* Key Metrics Strip */}
          <div className="grid grid-cols-3 divide-x divide-border">
            {/* Response Time */}
            <div className="p-3 text-center">
              <Clock size={14} className="mx-auto text-primary mb-1" />
              <p className="text-sm font-bold">
                {metrics.avgResponseHours !== null
                  ? metrics.avgResponseHours < 1 ? '<1h' : `${metrics.avgResponseHours}h`
                  : '—'}
              </p>
              <p className="text-[9px] text-muted-foreground">Avg Response</p>
            </div>

            {/* Disputes Resolved */}
            <div className="p-3 text-center">
              <ShieldCheck size={14} className="mx-auto text-success mb-1" />
              <p className="text-sm font-bold">
                {disputeRate !== null ? `${disputeRate}%` : '—'}
              </p>
              <p className="text-[9px] text-muted-foreground">Resolved</p>
            </div>

            {/* Snags Fixed */}
            <div className="p-3 text-center">
              <Bug size={14} className="mx-auto text-warning mb-1" />
              <p className="text-sm font-bold">{metrics.snagsFixedThisMonth}</p>
              <p className="text-[9px] text-muted-foreground">Snags Fixed</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-2 gap-2">
        <Link to="/society/finances">
          <Card className="hover:shadow-sm transition-shadow">
            <CardContent className="p-3 flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-warning/10 flex items-center justify-center">
                <IndianRupee size={14} className="text-warning" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate">{formatPrice(metrics.expenseAmountThisMonth)}</p>
                <p className="text-[9px] text-muted-foreground">{metrics.expensesThisMonth} entries this month</p>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link to="/society/progress">
          <Card className="hover:shadow-sm transition-shadow">
            <CardContent className="p-3 flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Building2 size={14} className="text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold">{metrics.constructionProgress}%</p>
                <p className="text-[9px] text-muted-foreground">{metrics.milestonesThisMonth} updates</p>
              </div>
            </CardContent>
          </Card>
        </Link>

        {metrics.pendingDues > 0 && (
          <Link to="/maintenance">
            <Card className="hover:shadow-sm transition-shadow border-destructive/20">
              <CardContent className="p-3 flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-destructive/10 flex items-center justify-center">
                  <CreditCard size={14} className="text-destructive" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-destructive">{metrics.pendingDues} pending</p>
                  <p className="text-[9px] text-muted-foreground">Maintenance dues</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        )}

        {metrics.snagsOpenThisMonth > 0 && (
          <Link to="/society/snags">
            <Card className="hover:shadow-sm transition-shadow">
              <CardContent className="p-3 flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-destructive/10 flex items-center justify-center">
                  <Bug size={14} className="text-destructive" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold">{metrics.snagsOpenThisMonth} open</p>
                  <p className="text-[9px] text-muted-foreground">Snag reports</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        )}
      </div>
    </div>
  );
}
