// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { cardEntrance, staggerContainer } from '@/lib/motion-variants';

const ACTION_LABELS: Record<string, string> = {
  order_created: 'You placed this order',
  order_status_changed: 'Status updated',
  payment_confirmed: 'Payment confirmed',
  payment_received: 'Payment received by seller',
  delivery_assigned: 'Delivery partner assigned',
  delivery_picked_up: 'Order picked up for delivery',
  delivery_completed: 'Order delivered',
  review_submitted: 'You left a review',
  order_cancelled: 'Order cancelled',
};

/** Buyer-facing copy — who did what, what happens next */
const STATUS_LABELS: Record<string, string> = {
  payment_pending: 'Complete payment',
  awaiting_cod_confirmation: 'Awaiting cash confirmation',
  pending: 'Order received — waiting for seller',
  placed: 'Order placed',
  accepted: 'Seller accepted',
  confirmed: 'Seller confirmed',
  scheduled: 'Scheduled',
  preparing: 'Preparing',
  ready: 'Ready / Out for delivery',
  picked_up: 'Picked up',
  on_the_way: 'On the way',
  out_for_delivery: 'Out for delivery',
  arrived: 'Arrived',
  at_gate: 'At your society gate',
  delivered: 'Delivered',
  completed: 'Order completed',
  cancelled: 'Order cancelled',
  rejected: 'Seller could not fulfill this order',
  enquired: 'Enquiry sent to the seller',
  quoted: 'Seller accepted the enquiry',
};

type TimelineEvent = {
  id: string;
  action: string;
  actor_id: string | null;
  metadata: any;
  created_at: string;
};

/** Prefer friendly lifecycle labels (same tone as ScheduledOrderTimeline). */
export function getTimelineLabel(action: string, metadata: any): string {
  const status =
    metadata?.new_status ||
    metadata?.to_status ||
    (typeof action === 'string' && action.startsWith('order_status_') && action !== 'order_status_changed'
      ? action.replace(/^order_status_/, '')
      : null);

  if (status && STATUS_LABELS[status]) return STATUS_LABELS[status];
  if (status) return status.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

  if (action === 'order_status_changed' && metadata?.new_status) {
    return STATUS_LABELS[metadata.new_status] || `Status: ${metadata.new_status.replace(/_/g, ' ')}`;
  }
  return ACTION_LABELS[action] || action.replace(/_/g, ' ');
}

function getStatusKey(action: string, metadata: any): string | null {
  if (metadata?.new_status) return String(metadata.new_status);
  if (metadata?.to_status) return String(metadata.to_status);
  if (action?.startsWith('order_status_') && action !== 'order_status_changed') {
    return action.replace(/^order_status_/, '');
  }
  return null;
}

/**
 * Audit logs often emit both `order_status_changed` and `order_status_<status>`
 * for the same transition. Keep one friendly row per status (+ non-status events).
 */
export function dedupeTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  const seenStatus = new Set<string>();
  const out: TimelineEvent[] = [];

  // Prefer `order_status_changed` over bare `order_status_*` when both exist.
  const ranked = [...events].sort((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    if (ta !== tb) return ta - tb;
    const score = (e: TimelineEvent) => (e.action === 'order_status_changed' ? 0 : e.action.startsWith('order_status_') ? 1 : 2);
    return score(a) - score(b);
  });

  for (const event of ranked) {
    const status = getStatusKey(event.action, event.metadata);
    if (status) {
      const key = `${status}@${new Date(event.created_at).getTime()}`;
      // Also collapse same status within 2s (clock skew / dual writers)
      const nearKey = [...seenStatus].find((k) => {
        const [s, t] = k.split('@');
        return s === status && Math.abs(Number(t) - new Date(event.created_at).getTime()) <= 2000;
      });
      if (nearKey || seenStatus.has(key)) continue;
      seenStatus.add(key);
    }
    out.push(event);
  }

  return out.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

function getActorLabel(actorId: string | null, metadata: any): string {
  if (!actorId) return 'System';
  if (metadata?.actor_role === 'seller') return 'Seller';
  if (metadata?.actor_role === 'buyer') return 'You (buyer)';
  if (metadata?.actor_role === 'delivery') return 'Delivery partner';
  return 'System';
}

interface OrderTimelineProps {
  orderId: string;
}

const eventVariant = {
  hidden: { opacity: 0, x: -8 },
  show: { opacity: 1, x: 0 },
};

export function OrderTimeline({ orderId }: OrderTimelineProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const { data: events = [] } = useQuery({
    queryKey: ['order-timeline', orderId],
    queryFn: async () => {
      const { data } = await supabase
        .from('audit_log')
        .select('id, action, actor_id, metadata, created_at')
        .eq('target_type', 'order')
        .eq('target_id', orderId)
        .order('created_at', { ascending: true });
      return (data || []) as TimelineEvent[];
    },
    staleTime: 60_000,
  });

  const cleaned = useMemo(() => dedupeTimelineEvents(events), [events]);

  if (cleaned.length === 0) return null;

  const visibleEvents = isExpanded ? cleaned : cleaned.slice(-3);

  return (
    <motion.div
      variants={cardEntrance}
      initial="hidden"
      animate="show"
      className="bg-card/80 backdrop-blur-lg border border-border/50 rounded-xl p-4 shadow-sm"
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full mb-3"
      >
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Order Timeline
        </p>
        {cleaned.length > 3 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {isExpanded ? 'Show less' : `Show all (${cleaned.length})`}
            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </span>
        )}
      </button>

      <motion.div
        className="relative pl-4"
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        key={isExpanded ? 'expanded' : 'collapsed'}
      >
        {/* Gradient timeline rail */}
        <div className="absolute left-[7px] top-1 bottom-1 w-px bg-gradient-to-b from-primary/60 via-border to-border" />
        <AnimatePresence mode="popLayout">
          {visibleEvents.map((event, i) => {
            const isLatest = i === visibleEvents.length - 1;
            return (
              <motion.div
                key={event.id}
                variants={eventVariant}
                initial="hidden"
                animate="show"
                exit="hidden"
                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                className="relative flex items-start gap-3 pb-3 last:pb-0"
              >
                <div className="relative -ml-4 mt-1 z-10 shrink-0">
                  {isLatest && (
                    <motion.div
                      className="absolute inset-0 rounded-full bg-primary/40"
                      animate={{ scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] }}
                      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  )}
                  <div className={cn(
                    'relative w-3 h-3 rounded-full border-2',
                    isLatest
                      ? 'bg-primary border-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.15)]'
                      : 'bg-card border-muted-foreground/30',
                  )} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    'text-sm',
                    isLatest ? 'font-semibold text-foreground' : 'font-medium text-foreground/80',
                  )}>
                    {getTimelineLabel(event.action, event.metadata)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {format(new Date(event.created_at), 'MMM d, h:mm a')}
                    {' · '}
                    {getActorLabel(event.actor_id, event.metadata)}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
