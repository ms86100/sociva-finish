// @ts-nocheck
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format, addDays, startOfToday, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar, Lock, Unlock, Loader2, Info, AlertTriangle } from 'lucide-react';
import { cn, friendlyError } from '@/lib/utils';
import { toast } from 'sonner';
import { showFeedback } from '@/components/FeedbackPopupProvider';

interface SlotsManagerProps { sellerId: string; }

type Slot = {
  id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  max_capacity: number;
  booked_count: number;
  is_blocked: boolean;
};

const fmtTime = (t: string) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, '0')} ${period}`;
};

const statusOf = (s: Slot) => {
  if (s.is_blocked) return { label: 'Blocked', cls: 'bg-muted text-muted-foreground border-border' };
  if (s.booked_count >= s.max_capacity) return { label: 'Full', cls: 'bg-destructive/10 text-destructive border-destructive/30' };
  if (s.booked_count > 0) return { label: 'Booked', cls: 'bg-info/10 text-info border-info/30' };
  return { label: 'Available', cls: 'bg-success/10 text-success border-success/30' };
};

export function SlotsManager({ sellerId }: SlotsManagerProps) {
  const queryClient = useQueryClient();
  const today = startOfToday();
  const [rangeStart, setRangeStart] = useState(format(today, 'yyyy-MM-dd'));
  const [rangeEnd, setRangeEnd] = useState(format(addDays(today, 13), 'yyyy-MM-dd'));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<'block' | 'unblock' | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['seller-slots-range', sellerId, rangeStart, rangeEnd],
    enabled: !!sellerId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('service_slots')
        .select('id, slot_date, start_time, end_time, max_capacity, booked_count, is_blocked')
        .eq('seller_id', sellerId)
        .is('product_id', null)
        .gte('slot_date', rangeStart)
        .lte('slot_date', rangeEnd)
        .order('slot_date')
        .order('start_time');
      if (error) throw error;
      return (data || []) as Slot[];
    },
  });

  const slots = data || [];

  const grouped = useMemo(() => {
    const m: Record<string, Slot[]> = {};
    slots.forEach((s) => { (m[s.slot_date] ||= []).push(s); });
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [slots]);

  const counts = useMemo(() => {
    let avail = 0, booked = 0, blocked = 0;
    slots.forEach((s) => {
      if (s.is_blocked) blocked++;
      else if (s.booked_count > 0) booked++;
      else avail++;
    });
    return { avail, booked, blocked, total: slots.length };
  }, [slots]);

  const toggleSlot = async (slot: Slot) => {
    if (slot.booked_count > 0 && !slot.is_blocked) {
      toast.error('Cannot block a slot that already has bookings');
      return;
    }
    setBusyId(slot.id);
    const { error } = await supabase
      .from('service_slots')
      .update({ is_blocked: !slot.is_blocked })
      .eq('id', slot.id)
      .eq('seller_id', sellerId);
    setBusyId(null);
    if (error) { toast.error(friendlyError(error) || 'Failed to update slot'); return; }
    showFeedback({
        title: slot.is_blocked ? 'Slot enabled' : 'Slot blocked',
        variant: 'success',
      });
    queryClient.invalidateQueries({ queryKey: ['seller-slots-range', sellerId] });
  };

  const bulkAction = async (mode: 'block' | 'unblock') => {
    const targets = slots.filter((s) => mode === 'block' ? (!s.is_blocked && s.booked_count === 0) : s.is_blocked);
    if (targets.length === 0) {
      toast.info(mode === 'block' ? 'No slots available to block in this range' : 'No blocked slots in this range');
      return;
    }
    setBulkBusy(mode);
    const ids = targets.map((s) => s.id);
    const batch = 200;
    let failed = 0;
    for (let i = 0; i < ids.length; i += batch) {
      const { error } = await supabase
        .from('service_slots')
        .update({ is_blocked: mode === 'block' })
        .in('id', ids.slice(i, i + batch))
        .eq('seller_id', sellerId);
      if (error) failed += Math.min(batch, ids.length - i);
    }
    setBulkBusy(null);
    if (failed > 0) toast.error(`${failed} slot(s) failed to update`);
    else showFeedback({
        title: `${targets.length} slot(s) ${mode === 'block' ? 'blocked' : 'unblocked'}`,
        variant: 'success',
      });
    queryClient.invalidateQueries({ queryKey: ['seller-slots-range', sellerId] });
  };

  const setPreset = (days: number) => {
    setRangeStart(format(today, 'yyyy-MM-dd'));
    setRangeEnd(format(addDays(today, days - 1), 'yyyy-MM-dd'));
  };

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border p-3 sm:p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-primary" />
          <h3 className="font-semibold text-sm">Slot Manager</h3>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {counts.total} slots · {counts.avail} avail · {counts.booked} booked · {counts.blocked} blocked
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div>
            <Label className="text-[11px] text-muted-foreground">From</Label>
            <Input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">To</Label>
            <Input type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} min={rangeStart} className="h-8 text-xs" />
          </div>
          <div className="col-span-2 sm:col-span-2 flex items-end gap-1.5">
            <Button variant="outline" size="sm" className="h-8 text-[11px] flex-1" onClick={() => setPreset(7)}>7d</Button>
            <Button variant="outline" size="sm" className="h-8 text-[11px] flex-1" onClick={() => setPreset(14)}>14d</Button>
            <Button variant="outline" size="sm" className="h-8 text-[11px] flex-1" onClick={() => setPreset(30)}>30d</Button>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs flex-1 gap-1.5" onClick={() => bulkAction('block')} disabled={bulkBusy !== null}>
            {bulkBusy === 'block' ? <Loader2 size={12} className="animate-spin" /> : <Lock size={12} />}
            Block all in range
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs flex-1 gap-1.5" onClick={() => bulkAction('unblock')} disabled={bulkBusy !== null}>
            {bulkBusy === 'unblock' ? <Loader2 size={12} className="animate-spin" /> : <Unlock size={12} />}
            Unblock all
          </Button>
        </div>

        <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground bg-muted/50 rounded p-2">
          <Info size={11} className="mt-0.5 shrink-0" />
          <span>Slots are <strong>store-wide</strong> — booking any service at a time makes that time unavailable for every service in your store. Adjust the slot length, buffer, and capacity in the <strong>Hours</strong> tab.</span>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-10 bg-muted/30 rounded-xl border border-dashed">
          <AlertTriangle className="mx-auto text-muted-foreground mb-2" size={28} />
          <p className="text-sm font-medium">No slots in this date range</p>
          <p className="text-[11px] text-muted-foreground mt-1 max-w-xs mx-auto">
            Make sure your working hours are saved and at least one approved bookable service exists.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map(([date, items]) => {
            const d = parseISO(date);
            return (
              <div key={date} className="bg-card rounded-xl border overflow-hidden">
                <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">{format(d, 'EEE, d MMM')}</p>
                    <p className="text-[10px] text-muted-foreground">{items.length} slots</p>
                  </div>
                </div>
                <div className="p-2 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-1.5">
                  {items.map((s) => {
                    const st = statusOf(s);
                    const disabled = busyId === s.id || (s.booked_count > 0 && !s.is_blocked);
                    return (
                      <button
                        key={s.id}
                        onClick={() => toggleSlot(s)}
                        disabled={disabled}
                        className={cn(
                          'text-left px-2.5 py-2 rounded-lg border transition-all hover:shadow-sm',
                          s.is_blocked ? 'opacity-60' : '',
                          disabled && s.booked_count > 0 ? 'cursor-not-allowed' : 'hover:border-primary/40 active:scale-[0.98]',
                        )}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[12px] font-semibold tabular-nums">{fmtTime(s.start_time)}</span>
                          {busyId === s.id ? (
                            <Loader2 size={10} className="animate-spin text-muted-foreground" />
                          ) : s.is_blocked ? (
                            <Lock size={10} className="text-muted-foreground" />
                          ) : (
                            <Unlock size={10} className="text-muted-foreground opacity-50" />
                          )}
                        </div>
                        <Badge variant="outline" className={cn('mt-1 h-4 px-1.5 text-[9px] font-medium border', st.cls)}>{st.label}</Badge>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
