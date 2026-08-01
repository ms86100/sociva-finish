// @ts-nocheck
import { useState, useMemo } from 'react';
import { format, addHours, startOfHour, isAfter, isBefore, startOfDay, addDays } from 'date-fns';
import { CalendarIcon, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/** Convert "14:00" → "2:00 PM", "09:30" → "9:30 AM" */
function formatTime12h(time24: string): string {
  const [h, m] = time24.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

interface PreorderDatePickerProps {
  leadTimeHours: number;
  selectedDate: Date | null;
  selectedTime: string | null;
  onDateChange: (date: Date | null) => void;
  onTimeChange: (time: string | null) => void;
  /** Optional cutoff time (e.g. "18:00") — slots after this are filtered out */
  cutoffTime?: string | null;
}

export function PreorderDatePicker({ leadTimeHours, selectedDate, selectedTime, onDateChange, onTimeChange, cutoffTime }: PreorderDatePickerProps) {
  const [calendarOpen, setCalendarOpen] = useState(false);

  const earliestDate = useMemo(() => addHours(new Date(), leadTimeHours), [leadTimeHours]);
  const earliestDay = startOfDay(earliestDate);

  // Parse cutoff time once
  const cutoffHour = useMemo(() => {
    if (!cutoffTime) return null;
    const [h, m] = cutoffTime.split(':').map(Number);
    return { h, m: m || 0 };
  }, [cutoffTime]);

  // Generate time slots in 30-min intervals from 6am to 10pm
  const timeSlots = useMemo(() => {
    const slots: string[] = [];
    for (let h = 6; h <= 22; h++) {
      slots.push(`${String(h).padStart(2, '0')}:00`);
      if (h < 22) slots.push(`${String(h).padStart(2, '0')}:30`);
    }

    // Apply cutoff time filter — remove slots at or after the cutoff
    let filtered = slots;
    if (cutoffHour) {
      filtered = filtered.filter(slot => {
        const [h, m] = slot.split(':').map(Number);
        return h < cutoffHour.h || (h === cutoffHour.h && m < cutoffHour.m);
      });
    }

    if (!selectedDate) return filtered;

    // Filter out times that are before the earliest allowed time on the selected day
    const selectedDay = startOfDay(selectedDate);
    if (selectedDay.getTime() === earliestDay.getTime()) {
      const earliestHour = earliestDate.getHours();
      const earliestMin = earliestDate.getMinutes();
      return filtered.filter(slot => {
        const [h, m] = slot.split(':').map(Number);
        return h > earliestHour || (h === earliestHour && m >= earliestMin);
      });
    }
    return filtered;
  }, [selectedDate, earliestDate, earliestDay, cutoffHour]);

  return (
    <div className="bg-accent/5 border border-accent/20 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Clock size={16} className="text-accent" />
        <div>
          <p className="text-sm font-semibold text-foreground">Schedule Delivery</p>
          <p className="text-[11px] text-muted-foreground">
            This order requires at least {leadTimeHours}hr advance notice
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Date Picker */}
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
                // Reset time if it's no longer valid for the new date
                if (d && selectedTime) {
                  const dDay = startOfDay(d);
                  if (dDay.getTime() === earliestDay.getTime()) {
                    const [h, m] = selectedTime.split(':').map(Number);
                    if (h < earliestDate.getHours() || (h === earliestDate.getHours() && m < earliestDate.getMinutes())) {
                      onTimeChange(null);
                    }
                  }
                }
                setCalendarOpen(false);
              }}
              disabled={(date) => isBefore(startOfDay(date), earliestDay)}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>

        {/* Time Picker */}
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

      {selectedDate && selectedTime && (
        <p className="text-xs text-accent font-medium">
          📅 Scheduled for {format(selectedDate, 'EEEE, MMM d')} at {formatTime12h(selectedTime)}
        </p>
      )}
    </div>
  );
}
