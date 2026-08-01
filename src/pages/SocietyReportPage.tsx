// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { BarChart3, TrendingUp, TrendingDown, Minus, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';

interface ReportData {
  expenses_total: number;
  expenses_count: number;
  income_total: number;
  disputes_opened: number;
  disputes_resolved: number;
  snags_opened: number;
  snags_fixed: number;
  milestones_count: number;
  documents_uploaded: number;
  questions_answered: number;
  questions_total: number;
  maintenance_collected: number;
  maintenance_pending: number;
  avg_response_hours: number | null;
}

export default function SocietyReportPage() {
  const { profile, isAdmin, effectiveSocietyId, effectiveSociety } = useAuth();
  const [monthOffset, setMonthOffset] = useState(0);
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const { formatPrice } = useCurrency();

  const targetMonth = subMonths(new Date(), monthOffset);
  const monthStart = startOfMonth(targetMonth).toISOString();
  const monthEnd = endOfMonth(targetMonth).toISOString();
  const monthLabel = format(targetMonth, 'MMMM yyyy');

  useEffect(() => {
    if (!effectiveSocietyId) return;
    generateReport();
  }, [effectiveSocietyId, monthOffset]);

  const generateReport = async () => {
    setLoading(true);
    const sid = effectiveSocietyId!;

    const [expenses, income, disputesOpened, disputesResolved, snagsOpened, snagsFixed, milestones, docs, qTotal, qAnswered, mCollected, mPending, ackedDisputes, ackedSnags] = await Promise.all([
      supabase.from('society_expenses').select('amount').eq('society_id', sid).gte('expense_date', monthStart).lte('expense_date', monthEnd),
      supabase.from('society_income').select('amount').eq('society_id', sid).gte('income_date', monthStart).lte('income_date', monthEnd),
      supabase.from('dispute_tickets').select('id', { count: 'exact', head: true }).eq('society_id', sid).gte('created_at', monthStart).lte('created_at', monthEnd),
      supabase.from('dispute_tickets').select('id', { count: 'exact', head: true }).eq('society_id', sid).in('status', ['resolved', 'closed']).gte('created_at', monthStart).lte('created_at', monthEnd),
      supabase.from('snag_tickets').select('id', { count: 'exact', head: true }).eq('society_id', sid).gte('created_at', monthStart).lte('created_at', monthEnd),
      supabase.from('snag_tickets').select('id', { count: 'exact', head: true }).eq('society_id', sid).in('status', ['fixed', 'verified', 'closed']).gte('created_at', monthStart).lte('created_at', monthEnd),
      supabase.from('construction_milestones').select('id', { count: 'exact', head: true }).eq('society_id', sid).gte('created_at', monthStart).lte('created_at', monthEnd),
      supabase.from('project_documents').select('id', { count: 'exact', head: true }).eq('society_id', sid).gte('created_at', monthStart).lte('created_at', monthEnd),
      supabase.from('project_questions').select('id', { count: 'exact', head: true }).eq('society_id', sid).gte('created_at', monthStart).lte('created_at', monthEnd),
      supabase.from('project_questions').select('id', { count: 'exact', head: true }).eq('society_id', sid).eq('is_answered', true).gte('created_at', monthStart).lte('created_at', monthEnd),
      supabase.from('maintenance_dues').select('id', { count: 'exact', head: true }).eq('society_id', sid).eq('status', 'paid').eq('month', format(targetMonth, 'yyyy-MM')),
      supabase.from('maintenance_dues').select('id', { count: 'exact', head: true }).eq('society_id', sid).in('status', ['pending', 'overdue']).eq('month', format(targetMonth, 'yyyy-MM')),
      supabase.from('dispute_tickets').select('created_at, acknowledged_at').eq('society_id', sid).not('acknowledged_at', 'is', null).gte('created_at', monthStart).lte('created_at', monthEnd),
      supabase.from('snag_tickets').select('created_at, acknowledged_at').eq('society_id', sid).not('acknowledged_at', 'is', null).gte('created_at', monthStart).lte('created_at', monthEnd),
    ]);

    const expTotal = (expenses.data || []).reduce((s, e: any) => s + Number(e.amount), 0);
    const incTotal = (income.data || []).reduce((s, e: any) => s + Number(e.amount), 0);

    const allAcked = [...(ackedDisputes.data || []), ...(ackedSnags.data || [])];
    let avgHours: number | null = null;
    if (allAcked.length > 0) {
      const total = allAcked.reduce((sum, item: any) => {
        return sum + (new Date(item.acknowledged_at).getTime() - new Date(item.created_at).getTime()) / 3600000;
      }, 0);
      avgHours = Math.round(total / allAcked.length);
    }

    setReport({
      expenses_total: expTotal,
      expenses_count: expenses.data?.length || 0,
      income_total: incTotal,
      disputes_opened: disputesOpened.count || 0,
      disputes_resolved: disputesResolved.count || 0,
      snags_opened: snagsOpened.count || 0,
      snags_fixed: snagsFixed.count || 0,
      milestones_count: milestones.count || 0,
      documents_uploaded: docs.count || 0,
      questions_answered: qAnswered.count || 0,
      questions_total: qTotal.count || 0,
      maintenance_collected: mCollected.count || 0,
      maintenance_pending: mPending.count || 0,
      avg_response_hours: avgHours,
    });
    setLoading(false);
  };

  const StatRow = ({ label, value, trend }: { label: string; value: string; trend?: 'up' | 'down' | 'neutral' }) => (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-semibold tabular-nums">{value}</span>
        {trend === 'up' && <TrendingUp size={12} className="text-success" />}
        {trend === 'down' && <TrendingDown size={12} className="text-destructive" />}
        {trend === 'neutral' && <Minus size={12} className="text-muted-foreground" />}
      </div>
    </div>
  );

  return (
    <AppLayout headerTitle="Monthly Report" showLocation={false}>
      <FeatureGate feature="monthly_report_card">
      <div className="p-4 space-y-4">
        {/* Month Navigator */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon" onClick={() => setMonthOffset(o => o + 1)}>
            <ChevronLeft size={18} />
          </Button>
          <div className="text-center">
            <p className="font-semibold">{monthLabel}</p>
            <p className="text-xs text-muted-foreground">{effectiveSociety?.name}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setMonthOffset(o => Math.max(0, o - 1))} disabled={monthOffset === 0}>
            <ChevronRight size={18} />
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" /></div>
        ) : report ? (
          <>
            {/* Financial Summary */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">💰 Financial Summary</CardTitle></CardHeader>
              <CardContent className="divide-y divide-border">
                <StatRow label="Total Expenses" value={formatPrice(report.expenses_total)} />
                <StatRow label="Expense Entries" value={String(report.expenses_count)} />
                <StatRow label="Total Income" value={formatPrice(report.income_total)} />
                <StatRow
                  label="Net Position"
                  value={formatPrice(report.income_total - report.expenses_total)}
                  trend={report.income_total >= report.expenses_total ? 'up' : 'down'}
                />
              </CardContent>
            </Card>

            {/* Governance */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">⚖️ Governance</CardTitle></CardHeader>
              <CardContent className="divide-y divide-border">
                <StatRow label="Disputes Opened" value={String(report.disputes_opened)} />
                <StatRow
                  label="Disputes Resolved"
                  value={report.disputes_opened > 0 ? `${report.disputes_resolved}/${report.disputes_opened} (${Math.round(report.disputes_resolved / report.disputes_opened * 100)}%)` : '0'}
                  trend={report.disputes_opened > 0 && report.disputes_resolved === report.disputes_opened ? 'up' : 'neutral'}
                />
                <StatRow label="Snags Reported" value={String(report.snags_opened)} />
                <StatRow
                  label="Snags Fixed"
                  value={report.snags_opened > 0 ? `${report.snags_fixed}/${report.snags_opened} (${Math.round(report.snags_fixed / report.snags_opened * 100)}%)` : '0'}
                  trend={report.snags_opened > 0 && report.snags_fixed === report.snags_opened ? 'up' : 'neutral'}
                />
                {report.avg_response_hours !== null && (
                  <StatRow
                    label="Avg. Response Time"
                    value={`${report.avg_response_hours}h`}
                    trend={report.avg_response_hours <= 24 ? 'up' : report.avg_response_hours <= 48 ? 'neutral' : 'down'}
                  />
                )}
              </CardContent>
            </Card>

            {/* Transparency */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">📊 Transparency</CardTitle></CardHeader>
              <CardContent className="divide-y divide-border">
                <StatRow label="Construction Updates" value={String(report.milestones_count)} />
                <StatRow label="Documents Uploaded" value={String(report.documents_uploaded)} />
                <StatRow
                  label="Q&A Response Rate"
                  value={report.questions_total > 0 ? `${report.questions_answered}/${report.questions_total} (${Math.round(report.questions_answered / report.questions_total * 100)}%)` : 'No questions'}
                  trend={report.questions_total > 0 && report.questions_answered === report.questions_total ? 'up' : 'neutral'}
                />
              </CardContent>
            </Card>

            {/* Maintenance */}
            {(report.maintenance_collected > 0 || report.maintenance_pending > 0) && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">🏠 Maintenance</CardTitle></CardHeader>
                <CardContent className="divide-y divide-border">
                  <StatRow label="Payments Collected" value={String(report.maintenance_collected)} />
                  <StatRow
                    label="Pending Payments"
                    value={String(report.maintenance_pending)}
                    trend={report.maintenance_pending === 0 ? 'up' : 'down'}
                  />
                  {(report.maintenance_collected + report.maintenance_pending) > 0 && (
                    <StatRow
                      label="Collection Rate"
                      value={`${Math.round(report.maintenance_collected / (report.maintenance_collected + report.maintenance_pending) * 100)}%`}
                      trend={report.maintenance_collected / (report.maintenance_collected + report.maintenance_pending) >= 0.9 ? 'up' : 'down'}
                    />
                  )}
                </CardContent>
              </Card>
            )}
          </>
        ) : null}
      </div>
      </FeatureGate>
    </AppLayout>
  );
}
