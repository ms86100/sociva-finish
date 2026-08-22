// @ts-nocheck
import { useNavigate } from 'react-router-dom';
import { CalendarClock, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useScheduledOrders } from '@/hooks/useScheduledOrders';
import { ScheduledOrderCountdown } from '@/components/orders/ScheduledOrderCountdown';
import { formatPreparationByLine, formatScheduledDateTime } from '@/lib/scheduled-orders';

interface UpcomingScheduledPanelProps {
  sellerId: string;
  compact?: boolean;
  onOpenCalendar?: () => void;
}

export function UpcomingScheduledPanel({ sellerId, compact, onOpenCalendar }: UpcomingScheduledPanelProps) {
  const navigate = useNavigate();
  const { data, isLoading } = useScheduledOrders({ sellerId });

  if (isLoading) {
    return <Skeleton className={compact ? 'h-24 w-full rounded-xl' : 'h-40 w-full rounded-xl'} />;
  }

  const upcoming = data?.upcoming ?? [];
  const grouped = data?.grouped ?? [];
  const next = data?.next;

  if (upcoming.length === 0) return null;

  return (
    <Card className="border-primary/20 bg-primary/[0.03]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <CalendarClock size={16} className="text-primary" />
          Upcoming scheduled orders
          <span className="ml-auto text-xs font-normal text-muted-foreground">{upcoming.length} total</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {next && (
          <div className="rounded-xl border border-border/60 bg-background p-3 space-y-1.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Next scheduled order</p>
            <p className="text-sm font-semibold">{formatScheduledDateTime(next)}</p>
            <p className="text-xs text-muted-foreground">
              Order #{next.id.slice(-6).toUpperCase()}
              {next.buyer?.name ? ` · ${next.buyer.name}` : ''}
            </p>
            {formatPreparationByLine(next) && (
              <p className="text-xs text-amber-700 dark:text-amber-300">{formatPreparationByLine(next)}</p>
            )}
            <ScheduledOrderCountdown order={next} size="sm" />
          </div>
        )}

        {!compact && grouped.slice(0, 4).map((g) => (
          <div key={g.date} className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{g.label}</span>
            <span className="font-semibold tabular-nums">{g.orders.length} orders</span>
          </div>
        ))}

        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1"
          onClick={() => (onOpenCalendar ? onOpenCalendar() : navigate('/seller?filter=upcoming'))}
        >
          {onOpenCalendar ? 'Open calendar' : 'View all upcoming'}
          <ChevronRight size={14} />
        </Button>
      </CardContent>
    </Card>
  );
}
