// @ts-nocheck
import { useMemo, useState } from 'react';
import { format, isBefore, startOfToday } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useServiceSlots, slotsToPickerFormat, findSlot, normalizeSlotTime } from '@/hooks/useServiceSlots';
import { TimeSlotPicker } from './TimeSlotPicker';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { CalendarClock, Loader2 } from 'lucide-react';
import { friendlyError } from '@/lib/utils';

const RESCHEDULABLE_STATUSES = new Set(['confirmed', 'scheduled', 'rescheduled']);

interface BuyerRescheduleBookingProps {
  bookingId: string;
  orderId: string;
  productId: string;
  sellerId: string;
  status: string;
  currentDate?: string | null;
  currentStartTime?: string | null;
}

export function BuyerRescheduleBooking({
  bookingId,
  orderId,
  productId,
  status,
  currentDate,
  currentStartTime,
}: BuyerRescheduleBookingProps) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedTime, setSelectedTime] = useState<string | undefined>();

  const { data: serviceSlots = [], refetch: refetchSlots } = useServiceSlots(
    isOpen ? productId : undefined
  );
  const availableSlots = useMemo(
    () => slotsToPickerFormat(serviceSlots),
    [serviceSlots]
  );

  if (!RESCHEDULABLE_STATUSES.has(status)) return null;

  const isDateValid = selectedDate && !isBefore(selectedDate, startOfToday());
  const canSubmit = !!isDateValid && !!selectedTime && !isSubmitting;

  const resetSelection = () => {
    setSelectedDate(undefined);
    setSelectedTime(undefined);
  };

  const handleReschedule = async () => {
    if (!canSubmit || !selectedDate || !selectedTime) return;
    setIsSubmitting(true);
    try {
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      const normalizedTime = normalizeSlotTime(selectedTime);
      const slot = findSlot(serviceSlots, dateStr, normalizedTime);

      if (!slot || slot.booked_count >= slot.max_capacity) {
        toast.error('Selected slot is no longer available. Refreshing...');
        refetchSlots();
        return;
      }

      // Same slot/time — nothing to do
      if (
        currentDate === dateStr
        && (currentStartTime === slot.start_time || currentStartTime?.slice(0, 5) === slot.start_time?.slice(0, 5))
      ) {
        toast.info('Please choose a different date or time.');
        return;
      }

      const { data, error } = await supabase.rpc('reschedule_service_booking', {
        _booking_id: bookingId,
        _new_slot_id: slot.id,
        _new_date: dateStr,
        _new_start_time: slot.start_time,
        _new_end_time: slot.end_time,
      });

      if (error) throw error;

      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        toast.error(result?.error || 'Failed to reschedule booking');
        refetchSlots();
        return;
      }

      supabase.functions.invoke('process-notification-queue').catch(() => {});

      queryClient.invalidateQueries({ queryKey: ['service-booking-order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['service-slots'] });
      queryClient.invalidateQueries({ queryKey: ['service-slots-store', productId] });
      queryClient.invalidateQueries({ queryKey: ['seller-service-bookings'] });
      queryClient.invalidateQueries({ queryKey: ['buyer-service-bookings'] });
      queryClient.invalidateQueries({ queryKey: ['order-detail'] });
      window.dispatchEvent(new Event('booking-changed'));

      toast.success('Booking rescheduled');
      setIsOpen(false);
      resetSelection();
    } catch (err: any) {
      console.error('Reschedule booking error:', err);
      toast.error(friendlyError(err) || 'Failed to reschedule booking');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (isSubmitting) return;
        setIsOpen(open);
        if (!open) resetSelection();
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <CalendarClock size={14} /> Reschedule
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Reschedule Booking</AlertDialogTitle>
          <AlertDialogDescription>
            {currentDate && currentStartTime
              ? `Current: ${currentDate} at ${String(currentStartTime).slice(0, 5)}. Pick a new available slot.`
              : 'Pick a new available date and time for this booking.'}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <TimeSlotPicker
          selectedDate={selectedDate}
          selectedTime={selectedTime}
          onDateSelect={(date) => {
            setSelectedDate(date);
            setSelectedTime(undefined);
          }}
          onTimeSelect={setSelectedTime}
          availableSlots={availableSlots}
        />

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>Keep Current Time</AlertDialogCancel>
          <Button onClick={handleReschedule} disabled={!canSubmit}>
            {isSubmitting && <Loader2 className="animate-spin mr-1" size={14} />}
            Confirm Reschedule
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
