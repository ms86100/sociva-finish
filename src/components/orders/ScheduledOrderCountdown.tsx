// @ts-nocheck
import { cn } from '@/lib/utils';
import {
  getScheduledCountdownLabel,
  resolveScheduledPhase,
  type ScheduledOrderLike,
} from '@/lib/scheduled-orders';

interface ScheduledOrderCountdownProps {
  order: ScheduledOrderLike;
  className?: string;
  size?: 'sm' | 'md';
}

export function ScheduledOrderCountdown({ order, className, size = 'md' }: ScheduledOrderCountdownProps) {
  const label = getScheduledCountdownLabel(order);
  const phase = resolveScheduledPhase(order);
  const isUrgent = phase === 'preparation_due' || phase === 'due_today' || label.includes('Starts in');

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full font-semibold tabular-nums',
        size === 'sm' ? 'px-2.5 py-0.5 text-[11px]' : 'px-3 py-1 text-xs',
        isUrgent ? 'bg-amber-500/15 text-amber-800 dark:text-amber-200' : 'bg-primary/10 text-primary',
        className,
      )}
    >
      {label}
    </div>
  );
}
