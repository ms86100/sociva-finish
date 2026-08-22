// @ts-nocheck
import { Check, Circle } from 'lucide-react';
import { format } from 'date-fns';
import { buildScheduledTimeline, type ScheduledOrderLike } from '@/lib/scheduled-orders';
import { cn } from '@/lib/utils';

interface ScheduledOrderTimelineProps {
  order: ScheduledOrderLike;
  className?: string;
}

export function ScheduledOrderTimeline({ order, className }: ScheduledOrderTimelineProps) {
  const steps = buildScheduledTimeline(order);

  return (
    <div className={cn('space-y-0', className)}>
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        const Icon = step.state === 'done' ? Check : Circle;
        return (
          <div key={step.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center shrink-0',
                  step.state === 'done' && 'bg-primary text-primary-foreground',
                  step.state === 'current' && 'bg-primary/20 text-primary ring-2 ring-primary/40',
                  step.state === 'upcoming' && 'bg-muted text-muted-foreground',
                )}
              >
                <Icon size={step.state === 'done' ? 14 : 10} />
              </div>
              {!isLast && <div className="w-px flex-1 bg-border min-h-[28px]" />}
            </div>
            <div className={cn('pb-4 flex-1 min-w-0', isLast && 'pb-0')}>
              <p
                className={cn(
                  'text-sm font-medium',
                  step.state === 'upcoming' ? 'text-muted-foreground' : 'text-foreground',
                )}
              >
                {step.label}
              </p>
              {step.detail && (
                <p className="text-xs text-muted-foreground mt-0.5">{step.detail}</p>
              )}
              {step.at && step.state === 'done' && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {format(new Date(step.at), 'MMM d · h:mm a')}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
