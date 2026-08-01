// @ts-nocheck
import { useSellerServiceBookings } from '@/hooks/useServiceBookings';
import { Card, CardContent } from '@/components/ui/card';
import { Calendar, Clock, AlertCircle, CheckCircle2 } from 'lucide-react';
import { format, startOfWeek, endOfWeek, isWithinInterval } from 'date-fns';

interface ServiceBookingStatsProps {
  sellerId: string;
}

export function ServiceBookingStats({ sellerId }: ServiceBookingStatsProps) {
  const { data: bookings = [] } = useSellerServiceBookings(sellerId);

  const now = new Date();
  const todayStr = format(now, 'yyyy-MM-dd');
  const weekStart = startOfWeek(now);
  const weekEnd = endOfWeek(now);

  const todaysBookings = bookings.filter(b => b.booking_date === todayStr);
  const pendingRequests = bookings.filter(b => b.status === 'requested');
  const upcomingConfirmed = bookings.filter(b =>
    ['confirmed', 'scheduled'].includes(b.status) && b.booking_date >= todayStr
  );
  const completedThisWeek = bookings.filter(b => {
    if (b.status !== 'completed') return false;
    try {
      const d = new Date(b.booking_date);
      return isWithinInterval(d, { start: weekStart, end: weekEnd });
    } catch { return false; }
  });

  const stats = [
    {
      icon: Calendar,
      label: "Today",
      value: todaysBookings.length,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      icon: AlertCircle,
      label: "Pending",
      value: pendingRequests.length,
      color: 'text-warning',
      bgColor: 'bg-warning/10',
      pulse: pendingRequests.length > 0,
    },
    {
      icon: Clock,
      label: "Upcoming",
      value: upcomingConfirmed.length,
      color: 'text-info',
      bgColor: 'bg-info/10',
    },
    {
      icon: CheckCircle2,
      label: "This Week",
      value: completedThisWeek.length,
      color: 'text-success',
      bgColor: 'bg-success/10',
    },
  ];

  const allZero = stats.every(s => s.value === 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-3">
        {stats.map((stat) => (
          <Card key={stat.label} className={`${(stat as any).pulse ? 'ring-1 ring-warning/30 animate-pulse' : ''}`}>
            <CardContent className="p-2.5 flex flex-col items-center text-center">
              <div className={`w-8 h-8 rounded-full ${stat.bgColor} flex items-center justify-center mb-1`}>
                <stat.icon size={14} className={stat.color} />
              </div>
              <span className="text-lg font-bold tabular-nums">{stat.value}</span>
              <span className="text-[11px] text-muted-foreground">{stat.label}</span>
            </CardContent>
          </Card>
        ))}
      </div>
      {allZero && (
        <p className="text-xs text-muted-foreground text-center py-2">
          Add service products and set store hours to start receiving bookings
        </p>
      )}
    </div>
  );
}
