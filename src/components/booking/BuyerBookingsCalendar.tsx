// @ts-nocheck
import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { format, startOfToday, isSameDay, differenceInHours, differenceInMinutes, isPast } from 'date-fns';
import { useBuyerServiceBookings, BuyerBooking } from '@/hooks/useServiceBookings';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Calendar, Clock, MapPin, Video, Home, Store, Zap } from 'lucide-react';
import { useFlowStepLabels } from '@/hooks/useFlowStepLabels';

const LOCATION_ICONS: Record<string, typeof MapPin> = {
  home_visit: Home,
  at_seller: Store,
  online: Video,
};

function getCountdownText(booking: BuyerBooking): string | null {
  if (!booking.booking_date || !booking.start_time) return null;
  // Parse as IST (+05:30) since booking dates/times are stored in IST
  const appointmentTime = new Date(`${booking.booking_date}T${booking.start_time}+05:30`);
  if (isPast(appointmentTime)) return null;

  const hoursUntil = differenceInHours(appointmentTime, new Date());
  const minutesUntil = differenceInMinutes(appointmentTime, new Date());

  if (minutesUntil < 60) return `in ${minutesUntil}m`;
  if (hoursUntil < 24) return `in ${hoursUntil}h`;
  const days = Math.ceil(hoursUntil / 24);
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

export function BuyerBookingsCalendar() {
  const { user } = useAuth();
  const { data: bookings = [], isLoading } = useBuyerServiceBookings(user?.id);
  const { getFlowLabel } = useFlowStepLabels();
  const [selectedDate, setSelectedDate] = useState(startOfToday());

  const bookingDates = useMemo(() => {
    const dateSet = new Set(bookings.map((b) => b.booking_date));
    return Array.from(dateSet).sort().map((d) => new Date(d + 'T00:00:00'));
  }, [bookings]);

  const filteredBookings = useMemo(() => {
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    return bookings.filter((b) => b.booking_date === dateStr);
  }, [bookings, selectedDate]);

  useEffect(() => {
    if (bookingDates.length > 0 && !bookingDates.some((d) => isSameDay(d, selectedDate))) {
      setSelectedDate(bookingDates[0]);
    }
  }, [bookingDates]);

  const nextBooking = useMemo(() => {
    const now = new Date();
    return bookings.find((b) => {
      if (['completed', 'cancelled', 'no_show'].includes(b.status)) return false;
      // Parse as IST since booking times are stored in IST
      const apptTime = new Date(`${b.booking_date}T${b.start_time}+05:30`);
      return apptTime > now;
    }) || null;
  }, [bookings]);

  if (isLoading) {
    return (
      <Card className="mb-3">
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (bookings.length === 0) return null;

  return (
    <Card className="mb-3">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Calendar size={15} className="text-primary" />
            My Appointments
          </CardTitle>
          <span className="text-[10px] text-muted-foreground">{bookings.length} upcoming</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {nextBooking && (
          <Link to={`/orders/${nextBooking.order_id}`}>
            <div className="p-3 rounded-xl bg-primary/5 border border-primary/15 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-primary uppercase tracking-wide flex items-center gap-1">
                  <Zap size={10} /> Next Appointment
                </span>
                {getCountdownText(nextBooking) && (
                  <span className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                    {getCountdownText(nextBooking)}
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold truncate">{nextBooking.product_name || 'Service'}</p>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar size={10} />
                  {format(new Date(nextBooking.booking_date + 'T00:00'), 'MMM d')}
                </span>
                <span className="flex items-center gap-1">
                  <Clock size={10} />
                  {nextBooking.start_time?.slice(0, 5)}
                </span>
                {nextBooking.seller_name && (
                  <span className="truncate">{nextBooking.seller_name}</span>
                )}
              </div>
            </div>
          </Link>
        )}

        {bookingDates.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            {bookingDates.map((date) => {
              const isDateToday = isSameDay(date, startOfToday());
              const isSelected = isSameDay(date, selectedDate);
              const count = bookings.filter((b) => b.booking_date === format(date, 'yyyy-MM-dd')).length;
              return (
                <button
                  key={date.toISOString()}
                  onClick={() => setSelectedDate(date)}
                  className={cn(
                    'flex flex-col items-center py-1.5 px-3 rounded-lg text-xs transition-colors shrink-0',
                    isSelected ? 'bg-primary text-primary-foreground' : isDateToday ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
                  )}
                >
                  <span className="font-medium">{format(date, 'EEE')}</span>
                  <span className="text-[10px]">{format(date, 'MMM d')}</span>
                  {count > 1 && <span className="text-[9px] mt-0.5">{count}</span>}
                </button>
              );
            })}
          </div>
        )}

        <div className="space-y-2">
          <p className="text-[10px] font-medium text-muted-foreground">
            {format(selectedDate, 'EEEE, MMM d')} • {filteredBookings.length} booking{filteredBookings.length !== 1 ? 's' : ''}
          </p>

          {filteredBookings.length === 0 ? (
            <div className="text-center py-4 text-xs text-muted-foreground">
              No appointments this day
            </div>
          ) : (
            filteredBookings.map((booking) => {
              const LocationIcon = LOCATION_ICONS[booking.location_type] || MapPin;
              return (
                <Link key={booking.id} to={`/orders/${booking.order_id}`}>
                  <div className="p-3 rounded-lg border bg-card active:scale-[0.99] transition-transform">
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col items-center text-center min-w-[45px]">
                        <Clock size={11} className="text-muted-foreground mb-0.5" />
                        <span className="text-xs font-semibold">{booking.start_time?.slice(0, 5)}</span>
                        <span className="text-[9px] text-muted-foreground">{booking.end_time?.slice(0, 5)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{booking.product_name || 'Service'}</p>
                        <p className="text-xs text-muted-foreground truncate">{booking.seller_name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <LocationIcon size={9} />
                            <span className="capitalize">{booking.location_type?.replace('_', ' ')}</span>
                          </span>
                          {booking.staff_name && (
                            <span className="text-[10px] text-muted-foreground">• {booking.staff_name}</span>
                          )}
                        </div>
                      </div>
                      <Badge variant="secondary" className={cn('text-[9px] shrink-0', getFlowLabel(booking.status).color)}>
                        {getFlowLabel(booking.status).label}
                      </Badge>
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
