// @ts-nocheck
import { useState, useMemo } from 'react';
import { format, addDays, isSameDay, startOfToday, isAfter, setHours, setMinutes } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { Clock, CalendarDays } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface TimeSlot {
  time: string;
  label: string;
  available: boolean;
}

interface TimeSlotPickerProps {
  availableSlots?: { date: string; slots: string[] }[];
  selectedDate: Date | undefined;
  selectedTime: string | undefined;
  onDateSelect: (date: Date | undefined) => void;
  onTimeSelect: (time: string) => void;
  serviceDuration?: number; // in minutes
  availabilityStart?: string; // "09:00"
  availabilityEnd?: string; // "21:00"
  unavailableDates?: Date[];
  maxBookingDays?: number;
  className?: string;
}

export function TimeSlotPicker({
  availableSlots,
  selectedDate,
  selectedTime,
  onDateSelect,
  onTimeSelect,
  serviceDuration = 60,
  availabilityStart = '09:00',
  availabilityEnd = '21:00',
  unavailableDates = [],
  maxBookingDays = 30,
  className,
}: TimeSlotPickerProps) {
  const today = startOfToday();
  const maxDate = addDays(today, maxBookingDays);

  // Generate time slots based on availability
  const timeSlots = useMemo(() => {
    if (!selectedDate) return [];

    // If specific available slots are provided, use those
    if (availableSlots) {
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      const daySlots = availableSlots.find((s) => s.date === dateStr);
      if (daySlots) {
        const now = new Date();
        const isTodayDate = isSameDay(selectedDate, today);
        return daySlots.slots.map((time) => {
          const [h, m] = time.split(':').map(Number);
          const slotDate = setMinutes(setHours(selectedDate, h), m);
          return {
            time,
            label: format(slotDate, 'h:mm a'),
            available: !isTodayDate || isAfter(slotDate, now),
          };
        });
      }
      return [];
    }

    // Generate slots based on availability hours
    const slots: TimeSlot[] = [];
    const [startHour, startMin] = availabilityStart.split(':').map(Number);
    const [endHour, endMin] = availabilityEnd.split(':').map(Number);

    const startTime = setMinutes(setHours(selectedDate, startHour), startMin);
    const endTime = setMinutes(setHours(selectedDate, endHour), endMin);

    let currentSlot = startTime;
    const now = new Date();
    const isToday = isSameDay(selectedDate, today);

    while (currentSlot < endTime) {
      const slotTime = format(currentSlot, 'HH:mm');
      const isAvailable = !isToday || isAfter(currentSlot, now);

      slots.push({
        time: slotTime,
        label: format(currentSlot, 'h:mm a'),
        available: isAvailable,
      });

      // Add service duration for next slot (default 30 min intervals)
      currentSlot = new Date(currentSlot.getTime() + 30 * 60 * 1000);
    }

    return slots;
  }, [selectedDate, availableSlots, availabilityStart, availabilityEnd, serviceDuration]);

  // Generate quick date options for next 7 days
  const quickDates = useMemo(() => {
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(today, i);
      dates.push({
        date,
        label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : format(date, 'EEE'),
        dateLabel: format(date, 'd MMM'),
      });
    }
    return dates;
  }, []);

  const isDateDisabled = (date: Date) => {
    return unavailableDates.some((d) => isSameDay(d, date));
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* Quick Date Selection */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <CalendarDays size={16} className="text-muted-foreground" />
          <span className="text-sm font-medium">Select Date</span>
        </div>
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 -mx-4 px-4">
          {quickDates.map(({ date, label, dateLabel }) => {
            const isSelected = selectedDate && isSameDay(date, selectedDate);
            const isDisabled = isDateDisabled(date);
            return (
              <motion.button
                key={date.toISOString()}
                onClick={() => !isDisabled && onDateSelect(date)}
                disabled={isDisabled}
                whileTap={{ scale: 0.93 }}
                animate={isSelected ? { scale: [1, 1.06, 1] } : {}}
                transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                className={cn(
                  'flex flex-col items-center min-w-[60px] p-2 rounded-lg border transition-all',
                  isSelected
                    ? 'border-primary bg-primary/10 text-primary'
                    : isDisabled
                    ? 'border-border bg-muted text-muted-foreground opacity-50'
                    : 'border-border hover:border-primary/50'
                )}
              >
                <span className="text-xs font-medium">{label}</span>
                <span className="text-sm font-semibold">{dateLabel}</span>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Full Calendar (collapsed by default, expandable) */}
      <details className="group">
        <summary className="text-sm text-muted-foreground cursor-pointer hover:text-foreground">
          Show full calendar
        </summary>
        <div className="mt-2 flex justify-center">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={onDateSelect}
            disabled={(date) => date < today || date > maxDate || isDateDisabled(date)}
            className="rounded-md border pointer-events-auto"
          />
        </div>
      </details>

      {/* Time Slots */}
      {selectedDate && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Clock size={16} className="text-muted-foreground" />
            <span className="text-sm font-medium">Select Time</span>
            {serviceDuration && (
              <span className="text-xs text-muted-foreground">
                ({serviceDuration} min session)
              </span>
            )}
          </div>

          {timeSlots.length > 0 ? (
            <ScrollArea className="h-48">
              <div className="grid grid-cols-3 gap-2 pr-4">
                {timeSlots.map(({ time, label, available }) => (
                  <motion.button
                    key={time}
                    onClick={() => available && onTimeSelect(time)}
                    disabled={!available}
                    whileTap={{ scale: 0.93 }}
                    animate={selectedTime === time ? { scale: [1, 1.08, 1] } : {}}
                    transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                    className={cn(
                      'p-2 rounded-lg text-sm font-medium transition-all',
                      selectedTime === time
                        ? 'bg-primary text-primary-foreground'
                        : available
                        ? 'bg-muted hover:bg-muted/80'
                        : 'bg-muted/50 text-muted-foreground line-through'
                    )}
                  >
                    {label}
                  </motion.button>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No available slots for this date
            </p>
          )}
        </div>
      )}
    </div>
  );
}
