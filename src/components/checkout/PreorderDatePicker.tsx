// @ts-nocheck
import { useState, useMemo } from 'react';
import { format, startOfDay, isBefore } from 'date-fns';
import { CalendarIcon, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { formatLeadTimeAdvanceNotice } from '@/lib/lead-time';
import {
  CLOSED_STORE_BUYER_CONFIRM_COPY,
  DEFAULT_SCHEDULE_PREP_MINUTES,
  formatMinutes12h,
  intersectScheduleSlots,
  listScheduleSlots,
  type StoreHoursInput,
} from '@/lib/store-schedule';

function formatTime12h(time24: string): string {
  const [h, m] = time24.split(':').map(Number);
  return formatMinutes12h(h * 60 + m);
}

function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

interface PreorderDatePickerProps {
  leadTimeHours: number;
  selectedDate: Date | null;
  selectedTime: string | null;
  onDateChange: (date: Date | null) => void;
  onTimeChange: (time: string | null) => void;
  /** Optional cutoff time (e.g. "18:00") - slots after this are filtered out */
  cutoffTime?: string | null;
  storeHours?: StoreHoursInput | StoreHoursInput[] | null;
  required?: boolean;
  closedStore?: boolean;
}

export function PreorderDatePicker({
  leadTimeHours,
  selectedDate,
  selectedTime,
  onDateChange,
  onTimeChange,
  cutoffTime,
  storeHours,
  required,
  closedStore,
}: PreorderDatePickerProps) {
  const [calendarOpen, setCalendarOpen] = useState(false);

  const hoursList = useMemo<StoreHoursInput[]>(() => {
    const list = Array.isArray(storeHours)
      ? storeHours.filter(Boolean)
      : storeHours
        ? [storeHours]
        : [];
    if (list.length > 0) return list;
    return [{
      prepMinutes: DEFAULT_SCHEDULE_PREP_MINUTES,
      leadMinutes: leadTimeHours > 0 ? Math.round(leadTimeHours * 60) : 0,
    }];
  }, [storeHours, leadTimeHours]);

  const allSlots = useMemo(() => {
    const slots = hoursList.length > 1
      ? intersectScheduleSlots(hoursList)
      : listScheduleSlots(hoursList[0]);
    if (!cutoffTime) return slots;
    return slots.filter((slot) => slot.time < cutoffTime.slice(0, 5));
  }, [hoursList, cutoffTime]);

  const eligibleDates = useMemo(() => {
    const seen = new Set<string>();
    const dates: Date[] = [];
    for (const slot of allSlots) {
      if (seen.has(slot.date)) continue;
      seen.add(slot.date);
      const [y, m, d] = slot.date.split('-').map(Number);
      dates.push(new Date(y, m - 1, d, 12, 0, 0, 0));
    }
    return dates;
  }, [allSlots]);

  const eligibleKeys = useMemo(() => new Set(allSlots.map((slot) => slot.date)), [allSlots]);

  const timeSlots = useMemo(() => {
    if (!selectedDate) {
      const first = eligibleDates[0];
      if (!first) return [];
      const key = dateKey(first);
      return allSlots.filter((slot) => slot.date === key).map((slot) => slot.time);
    }
    const key = dateKey(selectedDate);
    return allSlots.filter((slot) => slot.date === key).map((slot) => slot.time);
  }, [allSlots, selectedDate, eligibleDates]);

  const subtitle = closedStore
    ? 'This store is closed. Pick a time after it opens.'
    : leadTimeHours > 0
      ? `This order requires ${formatLeadTimeAdvanceNotice(leadTimeHours)}`
      : 'Choose a time during store hours';

  return (
    <div className="bg-accent/5 border border-accent/20 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Clock size={16} className="text-accent" />
        <div>
          <p className="text-sm font-semibold text-foreground">Schedule Delivery</p>
          <p className="text-[11px] text-muted-foreground">{subtitle}</p>
          {closedStore && (
            <p className="text-[11px] text-muted-foreground mt-1">{CLOSED_STORE_BUYER_CONFIRM_COPY}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "justify-start text-left font-normal text-sm h-10",
                !selectedDate && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {selectedDate ? format(selectedDate, 'MMM d') : 'Date'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selectedDate ?? undefined}
              onSelect={(d) => {
                onDateChange(d ?? null);
                if (d && selectedTime) {
                  const key = dateKey(d);
                  const stillValid = allSlots.some((slot) => slot.date === key && slot.time === selectedTime);
                  if (!stillValid) onTimeChange(null);
                }
                setCalendarOpen(false);
              }}
              disabled={(date) => !eligibleKeys.has(dateKey(date)) || isBefore(startOfDay(date), startOfDay(new Date()))}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>

        <Select value={selectedTime ?? ''} onValueChange={(v) => onTimeChange(v || null)}>
          <SelectTrigger className="h-10 text-sm">
            <SelectValue placeholder="Time" />
          </SelectTrigger>
          <SelectContent className="max-h-48">
            {timeSlots.map(slot => (
              <SelectItem key={slot} value={slot}>{formatTime12h(slot)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {allSlots.length === 0 && (
        <p className="text-[11px] text-destructive font-medium">
          No upcoming hours overlap. Checkout one store at a time.
        </p>
      )}
      {selectedDate && selectedTime && (
        <p className="text-xs text-accent font-medium">
          Scheduled for {format(selectedDate, 'EEEE, MMM d')} at {formatTime12h(selectedTime)}
        </p>
      )}
      {required && allSlots.length > 0 && !(selectedDate && selectedTime) && (
        <p className="text-[11px] text-destructive font-medium">Scheduling is required for this order</p>
      )}
    </div>
  );
}
