// @ts-nocheck
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Bot, Store, Package, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

interface AIReviewEntry {
  id: string;
  target_type: string;
  target_id: string;
  decision: string;
  confidence: number;
  reason: string;
  rule_hits: string[];
  model_used: string;
  society_id: string | null;
  created_at: string;
  input_snapshot: Record<string, any>;
}

const DECISION_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  approved: { label: 'Approved', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', icon: CheckCircle },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: XCircle },
  flagged: { label: 'Flagged', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: AlertTriangle },
};

export function AdminAIReviewLog() {
  const [filterDecision, setFilterDecision] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');

  const { data: logs, isLoading } = useQuery({
    queryKey: ['ai-review-log', filterDecision, filterType],
    queryFn: async () => {
      let query = supabase
        .from('ai_review_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (filterDecision !== 'all') query = query.eq('decision', filterDecision);
      if (filterType !== 'all') query = query.eq('target_type', filterType);

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as AIReviewEntry[];
    },
    staleTime: 2 * 60_000,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-2">
        <div className="w-8 h-8 rounded-xl bg-violet-500/10 flex items-center justify-center">
          <Bot size={15} className="text-violet-600" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-foreground tracking-tight">AI Auto-Review Log</h3>
          <p className="text-[10px] text-muted-foreground">Background AI decisions on sellers & products</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <Select value={filterDecision} onValueChange={setFilterDecision}>
          <SelectTrigger className="w-32 h-8 text-xs rounded-xl border-border/60">
            <SelectValue placeholder="Decision" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Decisions</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="flagged">Flagged</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-32 h-8 text-xs rounded-xl border-border/60">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="seller">Sellers</SelectItem>
            <SelectItem value="product">Products</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      {logs && logs.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {(['approved', 'rejected', 'flagged'] as const).map(d => {
            const count = logs.filter(l => l.decision === d).length;
            const cfg = DECISION_CONFIG[d];
            const Icon = cfg.icon;
            return (
              <Card key={d} className="border-0 shadow-[var(--shadow-card)] rounded-xl">
                <CardContent className="p-3 flex items-center gap-2">
                  <Icon size={14} className={cfg.color.split(' ').pop()} />
                  <div>
                    <p className="text-lg font-bold tabular-nums">{count}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{cfg.label}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Log entries */}
      {(!logs || logs.length === 0) ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-muted/80 flex items-center justify-center mb-3">
            <Bot size={22} className="text-muted-foreground/60" />
          </div>
          <p className="text-sm text-muted-foreground font-medium">No AI reviews yet</p>
          <p className="text-xs text-muted-foreground mt-1">The background AI reviewer will process pending items automatically</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {logs.map((entry, idx) => {
            const cfg = DECISION_CONFIG[entry.decision] || DECISION_CONFIG.flagged;
            const Icon = cfg.icon;
            const name = entry.input_snapshot?.business_name || entry.input_snapshot?.name || entry.target_id.slice(0, 8);
            return (
              <motion.div key={entry.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.02 }}>
                <Card className="border-0 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-md)] transition-all duration-300 rounded-2xl">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', entry.target_type === 'seller' ? 'bg-emerald-500/10' : 'bg-blue-500/10')}>
                          {entry.target_type === 'seller' ? <Store size={15} className="text-emerald-600" /> : <Package size={15} className="text-blue-600" />}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-sm truncate">{name}</p>
                          <p className="text-[11px] text-muted-foreground capitalize">{entry.target_type} • {format(new Date(entry.created_at), 'MMM d, h:mm a')}</p>
                          {entry.reason && (
                            <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{entry.reason}</p>
                          )}
                          {entry.rule_hits && entry.rule_hits.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {entry.rule_hits.map((hit, i) => (
                                <Badge key={i} variant="outline" className="text-[9px] h-4 px-1.5 rounded-md">{hit}</Badge>
                              ))}
                            </div>
                          )}
                          <p className="text-[10px] text-muted-foreground mt-1">{entry.model_used}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <Badge className={cn('text-[10px] h-5 px-2 rounded-lg font-semibold border-0', cfg.color)}>
                          <Icon size={10} className="mr-1" />
                          {cfg.label}
                        </Badge>
                        <span className="text-[11px] font-mono font-bold tabular-nums">
                          {(entry.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
