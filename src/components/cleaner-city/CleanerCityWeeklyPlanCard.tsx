// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Clock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useCommuteTemplates,
  useSetCommuteTemplate,
} from '@/hooks/queries/useCleanerCity';
import { CLEANER_CITY_WEEKDAYS } from '@/lib/cleaner-city/constants';
import { cn } from '@/lib/utils';

const WORK_WEEK = [1, 2, 3, 4, 5] as const;

function timeToInput(value: string | null | undefined, fallback = '08:30') {
  if (!value) return fallback;
  return String(value).slice(0, 5);
}

function formatClock(value: string) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return value || '--:--';
  let h = Number(m[1]);
  const min = m[2];
  const ap = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${min} ${ap}`;
}

type Props = {
  /** Offer embed vs Schedule / Find */
  compact?: boolean;
  className?: string;
  onSaved?: (info: { depart: string; returnTime: string; officeDays: number[] }) => void;
};

/**
 * Enter once: Mon-Fri office days, leave home, leave office.
 * Tap a day off = WFH / not commuting that weekday. Change times anytime.
 * Same card for hosts (Offer) and guests (Find / schedule).
 */
export function CleanerCityWeeklyPlanCard({ compact, className, onSaved }: Props) {
  const { data: templates = [] } = useCommuteTemplates();
  const setTemplate = useSetCommuteTemplate();

  const [officeDays, setOfficeDays] = useState(() => new Set<number>([1, 2, 3, 4, 5]));
  const [depart, setDepart] = useState('08:30');
  const [returnTime, setReturnTime] = useState('17:00');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const workRows = WORK_WEEK.map((d) => templates.find((t) => t.weekday === d)).filter(Boolean);
    if (workRows.length === 0) {
      setEditing(true);
      return;
    }
    const on = new Set<number>();
    for (const d of WORK_WEEK) {
      const row = templates.find((t) => t.weekday === d);
      if (!row || row.is_working) on.add(d);
    }
    setOfficeDays(on);
    const firstOn = workRows.find((r) => r?.is_working) || workRows[0];
    setDepart(timeToInput(firstOn?.depart_time, '08:30'));
    setReturnTime(timeToInput(firstOn?.return_time, '17:00'));
  }, [templates]);

  const configured = useMemo(
    () =>
      templates.some(
        (t) =>
          WORK_WEEK.includes(t.weekday as (typeof WORK_WEEK)[number]) &&
          !!t.depart_time,
      ),
    [templates],
  );

  const dayLabels = CLEANER_CITY_WEEKDAYS.filter((d) => WORK_WEEK.includes(d.value as any));

  const summaryDays = dayLabels
    .filter((d) => officeDays.has(d.value))
    .map((d) => d.label)
    .join(' · ');

  const saveWeek = async () => {
    if (!depart || !returnTime) {
      toast.error('Set leave home and leave office times');
      return;
    }
    if (officeDays.size === 0) {
      toast.error('Keep at least one office day, or pause commute in You');
      return;
    }
    setSaving(true);
    try {
      for (const day of WORK_WEEK) {
        const existing = templates.find((t) => t.weekday === day);
        const isWorking = officeDays.has(day);
        await setTemplate.mutateAsync({
          weekday: day,
          is_working: isWorking,
          depart_time: isWorking ? depart : null,
          return_time: isWorking ? returnTime : null,
          pickup_label: existing?.pickup_label ?? null,
          pickup_latitude: existing?.pickup_latitude ?? null,
          pickup_longitude: existing?.pickup_longitude ?? null,
        });
      }
      // Weekends stay off by default
      for (const day of [6, 0] as const) {
        const existing = templates.find((t) => t.weekday === day);
        await setTemplate.mutateAsync({
          weekday: day,
          is_working: false,
          depart_time: null,
          return_time: null,
          pickup_label: existing?.pickup_label ?? null,
          pickup_latitude: existing?.pickup_latitude ?? null,
          pickup_longitude: existing?.pickup_longitude ?? null,
        });
      }
      toast.success('Weekly plan saved');
      setEditing(false);
      onSaved?.({
        depart,
        returnTime,
        officeDays: Array.from(officeDays),
      });
    } catch (e: any) {
      toast.error(e?.message || 'Could not save weekly plan');
    } finally {
      setSaving(false);
    }
  };

  if (configured && !editing) {
    return (
      <div
        className={cn(
          'rounded-2xl border border-border bg-card px-5 py-5 shadow-sm',
          className,
        )}
        data-testid="cleaner-city-weekly-plan"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 pr-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              My week
            </p>
            <p className="mt-1.5 text-sm font-semibold">
              {summaryDays || 'No office days'}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Leave home {formatClock(depart)}
              </span>
              <span>·</span>
              <span>Leave office {formatClock(returnTime)}</span>
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Day off = WFH that weekday. Change times anytime.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 font-semibold"
            onClick={() => setEditing(true)}
          >
            Change
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-card px-5 py-5 shadow-sm space-y-3',
        className,
      )}
      data-testid="cleaner-city-weekly-plan"
    >
      <div>
        <p className="text-sm font-extrabold">My week</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {compact
            ? 'Set once for Offer and Find. Tap a day off for WFH.'
            : 'Office days, leave home, leave office - set once. Guests and hosts use the same plan.'}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Office days
        </Label>
        <div className="flex flex-wrap gap-2">
          {dayLabels.map((d) => {
            const on = officeDays.has(d.value);
            return (
              <button
                key={d.value}
                type="button"
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-full border text-xs font-bold',
                  on
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-border bg-background text-muted-foreground',
                )}
                onClick={() => {
                  setOfficeDays((prev) => {
                    const next = new Set(prev);
                    if (next.has(d.value)) next.delete(d.value);
                    else next.add(d.value);
                    return next;
                  });
                }}
              >
                {d.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Green = office. Off = WFH / not commuting that weekday.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Leave home
          </Label>
          <Input
            type="time"
            value={depart}
            onChange={(e) => setDepart(e.target.value)}
            className="h-11"
            data-testid="cleaner-city-week-depart"
          />
          <p className="text-[11px] text-muted-foreground">{formatClock(depart)}</p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Leave office
          </Label>
          <Input
            type="time"
            value={returnTime}
            onChange={(e) => setReturnTime(e.target.value)}
            className="h-11"
            data-testid="cleaner-city-week-return"
          />
          <p className="text-[11px] text-muted-foreground">{formatClock(returnTime)}</p>
        </div>
      </div>

      <div className="flex gap-2">
        {configured ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 flex-1 font-semibold"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        ) : null}
        <Button
          type="button"
          className="h-11 flex-1 bg-emerald-800 font-semibold hover:bg-emerald-900"
          disabled={saving || setTemplate.isPending}
          onClick={() => void saveWeek()}
          data-testid="cleaner-city-week-save"
        >
          {saving ? 'Saving...' : 'Save my week'}
        </Button>
      </div>
    </div>
  );
}
