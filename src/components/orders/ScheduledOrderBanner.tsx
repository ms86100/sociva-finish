// @ts-nocheck
import { Clock } from 'lucide-react';
import {
  canBuyerCancelScheduled,
  formatPreparationByLine,
  formatScheduledDateTime,
  getCancellationCutoffAt,
  isScheduledOrder,
  isUpcomingScheduled,
  type ScheduledOrderLike,
} from '@/lib/scheduled-orders';
import { ScheduledOrderCountdown } from '@/components/orders/ScheduledOrderCountdown';
import { ScheduledOrderTimeline } from '@/components/orders/ScheduledOrderTimeline';
import { format } from 'date-fns';

interface ScheduledOrderBannerProps {
  order: ScheduledOrderLike & { status?: string | null };
  view: 'buyer' | 'seller';
}

export function ScheduledOrderBanner({ order, view }: ScheduledOrderBannerProps) {
  if (!isScheduledOrder(order)) return null;

  const upcoming = isUpcomingScheduled(order);
  const cutoff = getCancellationCutoffAt(order);
  const canCancel = canBuyerCancelScheduled(order);

  return (
    <div className="space-y-3">
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5 min-w-0">
            <Clock size={18} className="text-primary shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground">Scheduled Order</p>
              <p className="text-sm font-medium text-primary mt-0.5">{formatScheduledDateTime(order)}</p>
              {view === 'buyer' && upcoming && (
                <p className="text-xs text-muted-foreground mt-1">
                  Your order will be prepared and fulfilled on the scheduled date.
                </p>
              )}
              {view === 'seller' && upcoming && (
                <p className="text-xs text-muted-foreground mt-1">
                  Accept anytime. Preparation and delivery unlock when the scheduled window opens.
                </p>
              )}
              {view === 'seller' && formatPreparationByLine(order) && (
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">{formatPreparationByLine(order)}</p>
              )}
            </div>
          </div>
          <ScheduledOrderCountdown order={order} />
        </div>
        {cutoff && view === 'buyer' && (
          <p className="text-[11px] text-muted-foreground pl-7">
            {canCancel
              ? `Cancellation allowed until ${format(cutoff, 'MMM d · h:mm a')}`
              : 'Cancellation cutoff has passed'}
          </p>
        )}
      </div>

      <div className="bg-card border border-border/60 rounded-xl p-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Timeline</p>
        <ScheduledOrderTimeline order={order} />
      </div>
    </div>
  );
}
