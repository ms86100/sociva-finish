// @ts-nocheck
import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Calendar, Clock, CheckCircle2, Loader2, AlertCircle, Users } from 'lucide-react';
import { format, addDays } from 'date-fns';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface DaySchedule {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

const DEFAULT_SCHEDULE: DaySchedule[] = DAYS.map((_, i) => ({
  day_of_week: i,
  start_time: '09:00',
  end_time: '18:00',
  is_active: i >= 1 && i <= 6,
}));

interface ServiceAvailabilityManagerProps {
  sellerId: string;
  onComplete?: () => void;
}

export function ServiceAvailabilityManager({ sellerId, onComplete }: ServiceAvailabilityManagerProps) {
  const [schedule, setSchedule] = useState<DaySchedule[]>(DEFAULT_SCHEDULE);
  const [slotMinutes, setSlotMinutes] = useState(60);
  const [bufferMinutes, setBufferMinutes] = useState(0);
  const [maxCapacity, setMaxCapacity] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [feedback, setFeedback] = useState('');
  const [slotCount, setSlotCount] = useState<number | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [{ data: sched }, { data: profile }, { data: slotRows }] = await Promise.all([
          (supabase.from('service_availability_schedules') as any)
            .select('day_of_week, start_time, end_time, is_active')
            .eq('seller_id', sellerId)
            .is('product_id', null)
            .order('day_of_week'),
          supabase
            .from('seller_profiles')
            .select('booking_slot_minutes, booking_slot_buffer_minutes, booking_slot_max_capacity')
            .eq('id', sellerId)
            .maybeSingle(),
          (supabase.from('service_slots') as any)
            .select('id', { count: 'exact', head: true })
            .eq('seller_id', sellerId)
            .is('product_id', null)
            .gte('slot_date', format(new Date(), 'yyyy-MM-dd')),
        ]);

        if (!isMounted.current) return;

        if (sched && sched.length > 0) {
          const merged = DEFAULT_SCHEDULE.map(def => {
            const row = sched.find((r: any) => r.day_of_week === def.day_of_week);
            return row ? {
              day_of_week: row.day_of_week,
              start_time: row.start_time?.slice(0, 5) || def.start_time,
              end_time: row.end_time?.slice(0, 5) || def.end_time,
              is_active: row.is_active ?? def.is_active,
            } : def;
          });
          setSchedule(merged);
        }

        if (profile) {
          setSlotMinutes(profile.booking_slot_minutes ?? 60);
          setBufferMinutes(profile.booking_slot_buffer_minutes ?? 0);
          setMaxCapacity(profile.booking_slot_max_capacity ?? 1);
        }

        setSlotCount((slotRows as any)?.count ?? null);
      } catch (err) {
        console.error('Failed to load availability:', err);
      } finally {
        if (isMounted.current) setIsLoading(false);
      }
    })();
  }, [sellerId]);

  const updateDay = (index: number, field: keyof DaySchedule, value: any) => {
    setSchedule(prev => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
    if (saveState !== 'idle') { setSaveState('idle'); setFeedback(''); }
  };

  const handleSave = async () => {
    if (saveState === 'saving') return;
    setSaveState('saving');
    setFeedback('');

    try {
      // 1) Save store-level booking config (triggers slot regen)
      const { error: profileErr } = await supabase
        .from('seller_profiles')
        .update({
          booking_slot_minutes: Math.max(5, Math.min(480, Number(slotMinutes) || 60)),
          booking_slot_buffer_minutes: Math.max(0, Math.min(120, Number(bufferMinutes) || 0)),
          booking_slot_max_capacity: Math.max(1, Math.min(99, Number(maxCapacity) || 1)),
        })
        .eq('id', sellerId);
      if (profileErr) throw profileErr;

      // 2) Replace store-level schedule (triggers slot regen)
      const { error: deleteErr } = await (supabase.from('service_availability_schedules') as any)
        .delete()
        .eq('seller_id', sellerId)
        .is('product_id', null);
      if (deleteErr) throw deleteErr;

      const scheduleRows = schedule.map(s => ({
        seller_id: sellerId,
        product_id: null,
        day_of_week: s.day_of_week,
        start_time: s.start_time,
        end_time: s.end_time,
        is_active: s.is_active,
      }));

      const { error: schedErr } = await (supabase.from('service_availability_schedules') as any)
        .insert(scheduleRows);
      if (schedErr) throw schedErr;

      // 3) Re-read slot count (DB triggers have already regenerated)
      const { count } = await (supabase.from('service_slots') as any)
        .select('id', { count: 'exact', head: true })
        .eq('seller_id', sellerId)
        .is('product_id', null)
        .gte('slot_date', format(new Date(), 'yyyy-MM-dd'));

      if (!isMounted.current) return;
      setSlotCount(count ?? null);
      setSaveState('saved');
      setFeedback(
        count && count > 0
          ? `Saved — ${count} store-wide slots generated for the next 30 days`
          : 'Saved — add an approved bookable service to start generating slots'
      );
      requestAnimationFrame(() => onComplete?.());
    } catch (err: any) {
      console.error('Failed to save:', err);
      if (!isMounted.current) return;
      setSaveState('error');
      setFeedback(err.message || 'Failed to save schedule');
    }
  };

  if (isLoading) {
    return (
      <div className="bg-card rounded-xl p-4 shadow-sm border animate-pulse">
        <div className="h-6 bg-muted rounded w-48 mb-4" />
        <div className="space-y-2">{[...Array(7)].map((_, i) => <div key={i} className="h-10 bg-muted rounded" />)}</div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl p-4 sm:p-5 shadow-sm border space-y-4">
      <div className="flex items-center gap-2">
        <Calendar size={18} className="text-primary" />
        <h3 className="font-semibold">Booking Configuration</h3>
      </div>

      {/* Store-wide slot config */}
      <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-primary" />
          <span className="text-sm font-medium">Slot grid</span>
          <span className="ml-auto text-[10px] text-muted-foreground">applies to every service in your store</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label className="text-[11px] text-muted-foreground">Length (min)</Label>
            <Input type="number" min={5} max={480} step={5} value={slotMinutes}
              onChange={(e) => setSlotMinutes(Number(e.target.value))} className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Buffer (min)</Label>
            <Input type="number" min={0} max={120} step={5} value={bufferMinutes}
              onChange={(e) => setBufferMinutes(Number(e.target.value))} className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground flex items-center gap-1"><Users size={10} /> Max/slot</Label>
            <Input type="number" min={1} max={99} value={maxCapacity}
              onChange={(e) => setMaxCapacity(Number(e.target.value))} className="h-8 text-xs" />
          </div>
        </div>
      </div>

      {/* Working hours per day */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground">Working hours</Label>
        {schedule.map((day, index) => (
          <div key={day.day_of_week}
            className={`grid grid-cols-[36px_40px_1fr] items-center gap-x-3 px-3 py-2.5 rounded-lg border transition-colors ${
              day.is_active ? 'bg-card border-border' : 'bg-muted/30 border-transparent'
            }`}>
            <Switch checked={day.is_active} onCheckedChange={(v) => updateDay(index, 'is_active', v)} />
            <span className="text-sm font-medium">{DAYS[index]}</span>
            {day.is_active ? (
              <div className="flex items-center gap-2">
                <Input type="time" value={day.start_time}
                  onChange={(e) => updateDay(index, 'start_time', e.target.value)}
                  className="h-9 text-sm min-w-[90px] max-w-[120px] flex-1" />
                <span className="text-xs text-muted-foreground shrink-0">to</span>
                <Input type="time" value={day.end_time}
                  onChange={(e) => updateDay(index, 'end_time', e.target.value)}
                  className="h-9 text-sm min-w-[90px] max-w-[120px] flex-1" />
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Closed</span>
            )}
          </div>
        ))}
      </div>

      <Button onClick={handleSave} disabled={saveState === 'saving'} className="w-full gap-2">
        {saveState === 'saving' ? <Loader2 size={16} className="animate-spin" /> : null}
        Save & regenerate slots
      </Button>

      {saveState === 'saved' && feedback && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
          <CheckCircle2 size={16} className="text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
          <p className="text-sm text-green-800 dark:text-green-300">{feedback}</p>
        </div>
      )}
      {saveState === 'error' && feedback && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-destructive/10 border border-destructive/30">
          <AlertCircle size={16} className="text-destructive mt-0.5 shrink-0" />
          <p className="text-sm text-destructive">{feedback}</p>
        </div>
      )}

      {slotCount !== null && saveState === 'idle' && (
        <p className="text-[11px] text-muted-foreground text-center">
          {slotCount > 0 ? `${slotCount} slots live for the next 30 days` : 'No slots yet — save to generate'}
        </p>
      )}
    </div>
  );
}
