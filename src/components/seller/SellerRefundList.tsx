// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Clock, CheckCircle2, XCircle, Loader2, ShieldAlert, ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import { cardEntrance, staggerContainer } from '@/lib/motion-variants';
import { useState } from 'react';
import { useCurrency } from '@/hooks/useCurrency';

interface SellerRefundListProps {
  sellerId: string;
  forceExpanded?: boolean;
}

const STATUS_STYLES: Record<string, { label: string; color: string; icon: any }> = {
  requested: { label: 'Action Needed', color: 'bg-warning/10 text-warning border-warning/20', icon: Clock },
  approved: { label: 'Approved', color: 'bg-primary/10 text-primary border-primary/20', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'bg-destructive/10 text-destructive border-destructive/20', icon: XCircle },
  settled: { label: 'Settled', color: 'bg-success/10 text-success border-success/20', icon: CheckCircle2 },
  processing: { label: 'Processing', color: 'bg-blue-500/10 text-blue-500 border-blue-500/20', icon: Clock },
};

export function SellerRefundList({ sellerId, forceExpanded = false }: SellerRefundListProps) {
  const { formatPrice } = useCurrency();
  const [expanded, setExpanded] = useState(forceExpanded);
  const { data: refunds = [], isLoading, error } = useQuery({
    queryKey: ['seller-refund-requests', sellerId],
    queryFn: async () => {
      const { data: refundData, error } = await supabase
        .from('refund_requests')
        .select('id, order_id, status, category, reason, amount, created_at, orders!inner(seller_id)')
        .eq('orders.seller_id', sellerId)
        .order('created_at', { ascending: false })
        .limit(forceExpanded ? 100 : 10);

      if (error) throw error;
      return refundData || [];
    },
    enabled: !!sellerId,
    staleTime: 60_000,
  });

  // Loading & error states stay compact
  if (isLoading) return null;
  if (error) return null;

  // Empty state — only render full empty card when forced (dedicated tab)
  if (refunds.length === 0) {
    if (!forceExpanded) return null;
    return (
      <div className="text-center py-12 bg-card border border-border rounded-xl">
        <ShieldAlert className="mx-auto text-muted-foreground mb-2" size={32} />
        <p className="text-sm text-muted-foreground">No disputes or refunds</p>
        <p className="text-xs text-muted-foreground mt-1">When buyers raise a refund, you'll see it here.</p>
      </div>
    );
  }

  const pendingCount = refunds.filter((r: any) => r.status === 'requested').length;
  const totalRefundAmount = refunds.filter((r: any) => ['approved', 'settled', 'processing', 'auto_approved'].includes(r.status)).reduce((sum: number, r: any) => sum + (r.amount || 0), 0);

  // When no pending: show collapsed single-line summary (skip when forceExpanded)
  if (pendingCount === 0 && !expanded && !forceExpanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full flex items-center justify-between bg-card border border-border rounded-lg px-3 py-2 text-xs hover:bg-accent/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <ShieldAlert size={13} className="text-muted-foreground" />
          <span className="text-muted-foreground">
            {refunds.length} dispute{refunds.length !== 1 ? 's' : ''}
            {totalRefundAmount > 0 && ` · ${formatPrice(totalRefundAmount)} in refunds`}
          </span>
        </div>
        <ChevronDown size={13} className="text-muted-foreground" />
      </button>
    );
  }

  return (
    <motion.div variants={cardEntrance} className="bg-card border border-border rounded-xl p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert size={14} className={pendingCount > 0 ? 'text-warning' : 'text-muted-foreground'} />
          <h3 className="font-semibold text-xs">Disputes & Refunds</h3>
          {pendingCount > 0 && (
            <Badge variant="destructive" className="text-[10px] h-4 px-1.5 rounded-full animate-pulse">
              {pendingCount} action needed
            </Badge>
          )}
        </div>
        {pendingCount === 0 && !forceExpanded && (
          <button onClick={() => setExpanded(false)} className="text-xs text-muted-foreground hover:text-foreground">
            Collapse
          </button>
        )}
      </div>

      {totalRefundAmount > 0 && (
        <div className="flex items-center gap-2 bg-destructive/5 border border-destructive/15 rounded-lg p-2">
          <AlertTriangle size={12} className="text-destructive shrink-0" />
          <p className="text-[10px] text-muted-foreground">
            {formatPrice(totalRefundAmount)} in refunds
          </p>
        </div>
      )}

      <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-1.5">
        <AnimatePresence>
          {refunds.map((refund: any) => {
            const config = STATUS_STYLES[refund.status] || STATUS_STYLES.requested;
            const Icon = config.icon;
            const isPending = refund.status === 'requested';

            return (
              <motion.div key={refund.id} variants={cardEntrance} layout>
                <Link to={`/orders/${refund.order_id}`}>
                  <div className={`rounded-lg border p-2.5 transition-colors hover:bg-accent/5 ${isPending ? 'border-warning/30 bg-warning/5' : 'border-border'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium border flex items-center gap-1 ${config.color}`}>
                          <Icon size={9} />
                          {config.label}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {refund.category?.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <ChevronRight size={12} className="text-muted-foreground" />
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-muted-foreground truncate max-w-[200px]">
                        "{refund.reason}"
                      </p>
                      <p className="text-xs font-bold tabular-nums">{formatPrice(refund.amount)}</p>
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
