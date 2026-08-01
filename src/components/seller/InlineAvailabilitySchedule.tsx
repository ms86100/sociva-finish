// @ts-nocheck
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar, Clock } from 'lucide-react';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface DayScheduleData {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

export const INITIAL_AVAILABILITY_SCHEDULE: DayScheduleData[] = DAYS.map((_, i) => ({
  day_of_week: i,
  start_time: '09:00',
  end_time: '18:00',
  is_active: i >= 1 && i <= 6,
}));

interface InlineAvailabilityScheduleProps {
  schedule: DayScheduleData[];
  onChange: (schedule: DayScheduleData[]) => void;
}

export function InlineAvailabilitySchedule({ schedule, onChange }: InlineAvailabilityScheduleProps) {
  const updateDay = (index: number, field: keyof DayScheduleData, value: any) => {
    onChange(schedule.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  };
  const activeDays = schedule.filter(d => d.is_active).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Calendar size={14} className="text-primary" />
        <Label className="text-xs font-semibold">Service Availability</Label>
        <span className="text-[10px] text-muted-foreground ml-auto">{activeDays} day{activeDays !== 1 ? 's' : ''} active</span>
      </div>
      <p className="text-[11px] text-muted-foreground">Set when this service is available for bookings. Time slots will be auto-generated.</p>
      <div className="space-y-1.5">
        {schedule.map((day, index) => (
          <div key={day.day_of_week} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-colors ${day.is_active ? 'bg-card border-border' : 'bg-muted/30 border-transparent'}`}>
            <Switch checked={day.is_active} onCheckedChange={(v) => updateDay(index, 'is_active', v)} className="scale-75" />
            <span className="text-xs font-medium w-8">{DAYS[index]}</span>
            {day.is_active ? (
              <div className="flex items-center gap-1.5 flex-1">
                <Input type="time" value={day.start_time} onChange={(e) => updateDay(index, 'start_time', e.target.value)} className="h-7 text-[11px] w-[88px] px-1.5" />
                <span className="text-[10px] text-muted-foreground">—</span>
                <Input type="time" value={day.end_time} onChange={(e) => updateDay(index, 'end_time', e.target.value)} className="h-7 text-[11px] w-[88px] px-1.5" />
              </div>
            ) : (
              <span className="text-[11px] text-muted-foreground italic">Off</span>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-start gap-1.5 px-2 py-1.5 rounded bg-muted/50">
        <Clock size={12} className="text-muted-foreground mt-0.5 flex-shrink-0" />
        <p className="text-[10px] text-muted-foreground leading-relaxed">Slots will be generated based on the session duration you set above. You can block/unblock individual slots after saving.</p>
      </div>
    </div>
  );
}
