// @ts-nocheck
import { useMemo, useState, useRef, useEffect } from 'react';
import { format, addDays, startOfToday, isSameDay, isToday as isDateToday } from 'date-fns';
import { useSellerServiceBookings } from '@/hooks/useServiceBookings';
import { useScheduledOrders } from '@/hooks/useScheduledOrders';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Clock, User, CalendarCheck, MessageCircle, ChevronLeft, ChevronRight, ShoppingBag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useFlowStepLabels } from '@/hooks/useFlowStepLabels';
import { formatPreparationByLine } from '@/lib/scheduled-orders';

interface SellerScheduleViewProps {
  sellerId: string;
}

const WINDOW_DAYS = 14;

type AgendaItem =
  | { kind: 'booking'; id: string; time: string; endTime?: string; title: string; subtitle: string; status: string; orderId: string }
  | { kind: 'order'; id: string; time: string; title: string; subtitle: string; status: string; orderId: string; prepLine?: string | null };

export function SellerScheduleView({ sellerId }: SellerScheduleViewProps) {
  const { data: bookings = [], isLoading: bookingsLoading } = useSellerServiceBookings(sellerId);
  const { data: scheduledData, isLoading: ordersLoading } = useScheduledOrders({ sellerId });
  const scheduledOrders = scheduledData?.all ?? [];
  const { getFlowLabel } = useFlowStepLabels();
  const navigate = useNavigate();
  const today = useMemo(() => startOfToday(), []);
  const [windowStart, setWindowStart] = useState<Date>(today);
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const stripRef = useRef<HTMLDivElement>(null);
  const isLoading = bookingsLoading || ordersLoading;

  const days = useMemo(
    () => Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(windowStart, i)),
    [windowStart],
  );

  const countsByDate = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of bookings) {
      if (['cancelled', 'no_show'].includes(b.status)) continue;
      map[b.booking_date] = (map[b.booking_date] || 0) + 1;
    }
    for (const o of scheduledOrders) {
      if (!o.scheduled_date) continue;
      map[o.scheduled_date] = (map[o.scheduled_date] || 0) + 1;
    }
    return map;
  }, [bookings, scheduledOrders]);

  const selectedStr = format(selectedDate, 'yyyy-MM-dd');

  const dayAgenda = useMemo((): AgendaItem[] => {
    const items: AgendaItem[] = [];

    for (const b of bookings) {
      if (b.booking_date !== selectedStr || ['cancelled', 'no_show'].includes(b.status)) continue;
      items.push({
        kind: 'booking',
        id: b.id,
        time: b.start_time?.slice(0, 5) || '—',
        endTime: b.end_time?.slice(0, 5),
        title: b.product_name || 'Service',
        subtitle: b.buyer_name || 'Customer',
        status: b.status,
        orderId: b.order_id,
      });
    }

    for (const o of scheduledOrders) {
      if (o.scheduled_date !== selectedStr) continue;
      const itemCount = o.items?.reduce((s, i) => s + (i.quantity || 1), 0) || 0;
      const itemLabel = o.items?.[0]?.product_name || 'Order';
      items.push({
        kind: 'order',
        id: o.id!,
        time: (o.scheduled_time_start || o.scheduled_time || '12:00').slice(0, 5),
        title: itemCount > 1 ? `${itemLabel} +${itemCount - 1} more` : itemLabel,
        subtitle: o.buyer?.name || 'Customer',
        status: o.status || 'scheduled',
        orderId: o.id!,
        prepLine: formatPreparationByLine(o),
      });
    }

    return items.sort((a, b) => a.time.localeCompare(b.time));
  }, [bookings, scheduledOrders, selectedStr]);

  useEffect(() => {
    const el = stripRef.current?.querySelector(`[data-date="${selectedStr}"]`) as HTMLElement | null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [selectedStr]);

  const shiftWindow = (deltaDays: number) => {
    setWindowStart((prev) => addDays(prev, deltaDays));
  };
  const jumpToToday = () => {
    setWindowStart(today);
    setSelectedDate(today);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => shiftWindow(-7)}>
          <ChevronLeft size={14} />
        </Button>
        <Button variant="ghost" size="sm" className="h-8 text-xs flex-1" onClick={jumpToToday}>
          {format(windowStart, 'MMM d')} – {format(addDays(windowStart, WINDOW_DAYS - 1), 'MMM d, yyyy')}
        </Button>
        <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => shiftWindow(7)}>
          <ChevronRight size={14} />
        </Button>
      </div>

      <div ref={stripRef} className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none">
        {days.map((day) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const isSelected = isSameDay(day, selectedDate);
          const isTodayDate = isDateToday(day);
          const count = countsByDate[dateStr] || 0;
          return (
            <button
              key={dateStr}
              data-date={dateStr}
              onClick={() => setSelectedDate(day)}
              className={cn(
                'flex flex-col items-center justify-center min-w-[48px] h-16 rounded-lg border transition-all shrink-0',
                isSelected
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : isTodayDate
                    ? 'bg-accent/40 border-primary/40 text-foreground'
                    : 'bg-card border-border text-foreground hover:bg-accent/30',
              )}
            >
              <span className={cn('text-[10px] font-medium uppercase', isSelected ? 'opacity-90' : 'text-muted-foreground')}>
                {format(day, 'EEE')}
              </span>
              <span className="text-base font-semibold leading-tight tabular-nums">{format(day, 'd')}</span>
              <div className="flex items-center gap-0.5 mt-0.5 h-1.5">
                {count > 0 && (
                  <span className={cn('w-1.5 h-1.5 rounded-full', isSelected ? 'bg-primary-foreground' : 'bg-primary')} />
                )}
              </div>
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarCheck size={16} className="text-primary" />
            {isDateToday(selectedDate) ? "Today's Schedule" : format(selectedDate, 'EEE, MMM d')}
            {dayAgenda.length > 0 && (
              <Badge variant="secondary" className="text-[10px] ml-auto">{dayAgenda.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-0 px-4 pb-4">
          {isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : dayAgenda.length === 0 ? (
            <div className="text-center py-6">
              <Clock size={24} className="mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                Nothing scheduled for {format(selectedDate, 'EEE, d MMM')}
              </p>
            </div>
          ) : (
            <div className="relative">
              {dayAgenda.map((item, i) => {
                const isLast = i === dayAgenda.length - 1;
                const isActive = item.status === 'in_progress' || item.status === 'preparing';
                const statusInfo = getFlowLabel(item.status);
                return (
                  <div key={`${item.kind}-${item.id}`} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className={cn(
                          'w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 z-10',
                          isActive ? 'bg-primary ring-2 ring-primary/30' :
                          item.status === 'completed' ? 'bg-muted-foreground' : 'bg-primary/50',
                        )}
                      />
                      {!isLast && <div className="w-px flex-1 bg-border min-h-[40px]" />}
                    </div>

                    <div className={cn('pb-4 flex-1 min-w-0', isLast && 'pb-0')}>
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-semibold tabular-nums text-foreground">{item.time}</span>
                        {item.kind === 'booking' && item.endTime && (
                          <span className="text-[10px] text-muted-foreground">– {item.endTime}</span>
                        )}
                        <Badge variant="secondary" className={cn('text-[9px] h-4 ml-auto', statusInfo.color)}>
                          {statusInfo.label}
                        </Badge>
                      </div>
                      <p className="text-sm font-medium truncate mt-0.5 flex items-center gap-1">
                        {item.kind === 'order' && <ShoppingBag size={12} className="text-primary shrink-0" />}
                        {item.title}
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <User size={10} /> {item.subtitle}
                      </p>
                      {item.kind === 'order' && item.prepLine && (
                        <p className="text-[10px] text-amber-700 dark:text-amber-300 mt-0.5">{item.prepLine}</p>
                      )}
                      <div className="flex gap-1.5 mt-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] px-2 gap-1"
                          onClick={() => navigate(`/orders/${item.orderId}`)}
                        >
                          <MessageCircle size={10} /> View
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
