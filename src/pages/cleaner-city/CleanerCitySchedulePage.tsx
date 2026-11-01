// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useClearCommuteOverride,
  useCommuteOverrides,
  useCommuteTemplates,
  useCleanerCityProfile,
  useEffectiveSchedule,
  usePauseCommute,
  useSetCommuteOverride,
  useSetCommuteTemplate,
} from '@/hooks/queries/useCleanerCity';
import {
  CLEANER_CITY_OVERRIDE_KINDS,
  CLEANER_CITY_WEEKDAYS,
  DEFAULT_COMMUTE_TIMEZONE,
} from '@/lib/cleaner-city/constants';
import { cn } from '@/lib/utils';

function todayInTz(tz = DEFAULT_COMMUTE_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function timeToInput(value: string | null | undefined) {
  if (!value) return '';
  return String(value).slice(0, 5);
}

type DayDraft = {
  is_working: boolean;
  depart_time: string;
  return_time: string;
  pickup_label: string;
};

const emptyDay = (): DayDraft => ({
  is_working: true,
  depart_time: '08:30',
  return_time: '18:30',
  pickup_label: '',
});

export default function CleanerCitySchedulePage() {
  const { data: profile } = useCleanerCityProfile();
  const { data: templates = [] } = useCommuteTemplates();
  const tz = profile?.timezone || DEFAULT_COMMUTE_TIMEZONE;
  const today = todayInTz(tz);
  const weekEnd = addDays(today, 13);
  const { data: overrides = [] } = useCommuteOverrides(today, weekEnd);

  const setTemplate = useSetCommuteTemplate();
  const setOverride = useSetCommuteOverride();
  const clearOverride = useClearCommuteOverride();
  const pauseCommute = usePauseCommute();

  const [days, setDays] = useState<Record<number, DayDraft>>({});
  const [overrideDate, setOverrideDate] = useState(addDays(today, 1));
  const [overrideKind, setOverrideKind] = useState('time_change');
  const [overrideWorking, setOverrideWorking] = useState(true);
  const [overrideDepart, setOverrideDepart] = useState('09:15');
  const [overrideReturn, setOverrideReturn] = useState('18:30');
  const [overrideNote, setOverrideNote] = useState('');

  const { data: effectiveTomorrow } = useEffectiveSchedule(overrideDate);

  useEffect(() => {
    const next: Record<number, DayDraft> = {};
    for (const wd of CLEANER_CITY_WEEKDAYS) {
      const row = templates.find((t) => t.weekday === wd.value);
      next[wd.value] = row
        ? {
            is_working: row.is_working,
            depart_time: timeToInput(row.depart_time) || '08:30',
            return_time: timeToInput(row.return_time) || '18:30',
            pickup_label: row.pickup_label || '',
          }
        : emptyDay();
    }
    setDays(next);
  }, [templates]);

  useEffect(() => {
    if (overrideKind === 'wfh' || overrideKind === 'leave' || overrideKind === 'holiday') {
      setOverrideWorking(false);
    } else {
      setOverrideWorking(true);
    }
  }, [overrideKind]);

  const previewDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(today, i)),
    [today],
  );

  if (!profile) {
    return (
      <AppLayout headerTitle="My commute schedule">
        <CleanerCityGate>
          <div className="p-4 pb-24 space-y-3" data-testid="cleaner-city-schedule-missing-profile">
            <p className="text-sm text-muted-foreground">
              Create your commute profile first, then set the weekly schedule.
            </p>
            <Link to="/cleaner-city/setup" className="text-sm font-semibold text-primary">
              Go to set up
            </Link>
          </div>
        </CleanerCityGate>
      </AppLayout>
    );
  }

  const saveWeekday = async (weekday: number) => {
    const draft = days[weekday] || emptyDay();
    try {
      await setTemplate.mutateAsync({
        weekday,
        is_working: draft.is_working,
        depart_time: draft.depart_time || null,
        return_time: draft.return_time || null,
        pickup_label: draft.pickup_label || null,
      });
      toast.success('Saved that day only');
    } catch (e: any) {
      toast.error(e?.message || 'Could not save day');
    }
  };

  const saveOverride = async () => {
    try {
      await setOverride.mutateAsync({
        override_date: overrideDate,
        is_working: overrideWorking,
        depart_time: overrideDepart || null,
        return_time: overrideReturn || null,
        override_kind: overrideKind,
        note: overrideNote || null,
      });
      toast.success('Saved date override only');
    } catch (e: any) {
      toast.error(e?.message || 'Could not save override');
    }
  };

  const removeOverride = async (date: string) => {
    try {
      await clearOverride.mutateAsync(date);
      toast.success('Override cleared - weekly plan applies again');
    } catch (e: any) {
      toast.error(e?.message || 'Could not clear override');
    }
  };

  const togglePause = async () => {
    try {
      await pauseCommute.mutateAsync(!profile.is_paused);
      toast.success(profile.is_paused ? 'Commute resumed' : 'Commute paused');
    } catch (e: any) {
      toast.error(e?.message || 'Could not update pause');
    }
  };

  return (
    <AppLayout headerTitle="My commute schedule">
      <CleanerCityGate>
        <div className="p-4 pb-24 space-y-5" data-testid="cleaner-city-schedule">
          <div>
            <h1 className="text-xl font-bold text-foreground">Flexible schedule</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Weekly plan is editable per day. A date override never rewrites the rest of the week.
              Timezone: {tz}
            </p>
          </div>

          <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Pause discovery</h2>
              <Button variant="outline" size="sm" onClick={togglePause} disabled={pauseCommute.isPending}>
                {profile.is_paused ? 'Resume' : 'Pause'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {profile.is_paused
                ? 'You are paused - no new matches until you resume.'
                : 'Active - matching can use your schedule once rides ship.'}
            </p>
          </section>

          <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <h2 className="text-sm font-semibold">Weekly recurring plan</h2>
            <p className="text-xs text-muted-foreground">
              Saving Monday never changes Tuesday. Use WFH / off for non-commute days.
            </p>
            <div className="space-y-3">
              {CLEANER_CITY_WEEKDAYS.map((wd) => {
                const draft = days[wd.value] || emptyDay();
                return (
                  <div
                    key={wd.value}
                    className="rounded-xl border border-border p-3 space-y-2"
                    data-testid={`schedule-weekday-${wd.value}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{wd.full}</p>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={draft.is_working}
                          onChange={(e) =>
                            setDays((prev) => ({
                              ...prev,
                              [wd.value]: { ...draft, is_working: e.target.checked },
                            }))
                          }
                        />
                        Commuting
                      </label>
                    </div>
                    {draft.is_working && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[11px]">Depart</Label>
                          <Input
                            type="time"
                            value={draft.depart_time}
                            onChange={(e) =>
                              setDays((prev) => ({
                                ...prev,
                                [wd.value]: { ...draft, depart_time: e.target.value },
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px]">Return</Label>
                          <Input
                            type="time"
                            value={draft.return_time}
                            onChange={(e) =>
                              setDays((prev) => ({
                                ...prev,
                                [wd.value]: { ...draft, return_time: e.target.value },
                              }))
                            }
                          />
                        </div>
                      </div>
                    )}
                    <Input
                      placeholder="Pickup point (optional)"
                      value={draft.pickup_label}
                      onChange={(e) =>
                        setDays((prev) => ({
                          ...prev,
                          [wd.value]: { ...draft, pickup_label: e.target.value },
                        }))
                      }
                    />
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => saveWeekday(wd.value)}
                      disabled={setTemplate.isPending}
                    >
                      Save {wd.label} only
                    </Button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <h2 className="text-sm font-semibold">One-day override</h2>
            <p className="text-xs text-muted-foreground">
              Change tomorrow or any date without editing the weekly template.
            </p>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={overrideDate} onChange={(e) => setOverrideDate(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              {CLEANER_CITY_OVERRIDE_KINDS.map((kind) => (
                <button
                  key={kind.value}
                  type="button"
                  onClick={() => setOverrideKind(kind.value)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-[11px] font-semibold',
                    overrideKind === kind.value ? 'border-primary bg-primary/5' : 'border-border',
                  )}
                >
                  {kind.label}
                </button>
              ))}
            </div>
            {(overrideKind === 'time_change' || overrideKind === 'custom') && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">Depart</Label>
                  <Input type="time" value={overrideDepart} onChange={(e) => setOverrideDepart(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Return</Label>
                  <Input type="time" value={overrideReturn} onChange={(e) => setOverrideReturn(e.target.value)} />
                </div>
              </div>
            )}
            <Input
              placeholder="Note (optional)"
              value={overrideNote}
              onChange={(e) => setOverrideNote(e.target.value)}
            />
            <Button onClick={saveOverride} disabled={setOverride.isPending} className="w-full">
              Save override for {overrideDate} only
            </Button>
            {effectiveTomorrow && (
              <div
                className="rounded-xl bg-muted/60 p-3 text-xs space-y-1"
                data-testid="effective-schedule-preview"
              >
                <p className="font-semibold">Effective for {overrideDate}</p>
                <p>Source: {effectiveTomorrow.source}</p>
                <p>
                  {effectiveTomorrow.is_paused
                    ? 'Paused'
                    : effectiveTomorrow.is_working
                      ? `Depart ${timeToInput(effectiveTomorrow.depart_time) || '-'} / Return ${timeToInput(effectiveTomorrow.return_time) || '-'}`
                      : 'Not commuting'}
                </p>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <h2 className="text-sm font-semibold">Upcoming overrides</h2>
            {overrides.length === 0 && (
              <p className="text-xs text-muted-foreground">No overrides in the next two weeks.</p>
            )}
            {overrides.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-2 text-sm border-b border-border py-2">
                <div>
                  <p className="font-medium">{row.override_date}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.override_kind}
                    {row.is_working
                      ? ` - ${timeToInput(row.depart_time)}`
                      : ' - not commuting'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeOverride(row.override_date)}
                  disabled={clearOverride.isPending}
                >
                  Clear
                </Button>
              </div>
            ))}
            <div className="pt-1">
              <p className="text-[11px] text-muted-foreground mb-2">Next 7 days (preview dates)</p>
              <div className="flex flex-wrap gap-1.5">
                {previewDates.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[11px]',
                      d === overrideDate ? 'border-primary text-primary' : 'border-border',
                    )}
                    onClick={() => setOverrideDate(d)}
                  >
                    {d.slice(5)}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <div className="flex flex-col gap-2 text-center">
            <Link to="/cleaner-city/setup" className="text-sm text-muted-foreground">
              Edit profile and work email
            </Link>
            <Link to="/cleaner-city" className="text-sm font-semibold text-primary">
              Back to A Cleaner City
            </Link>
          </div>
        </div>
      </CleanerCityGate>
    </AppLayout>
  );
}
