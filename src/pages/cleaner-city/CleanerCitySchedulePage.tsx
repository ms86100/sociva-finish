// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useClearCommuteOverride,
  useCommuteOverrides,
  useCommuteTemplates,
  useCleanerCityProfile,
  useEffectiveSchedule,
  usePauseCommute,
  useSetAutopilot,
  useSetCommuteOverride,
  useSetCommuteTemplate,
} from '@/hooks/queries/useCleanerCity';
import {
  CLEANER_CITY_AUTOPILOT_MODES,
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

function formatClock(value: string) {
  const [hRaw, m] = (value || '08:30').split(':');
  let h = Number(hRaw);
  if (!Number.isFinite(h)) return value || '--:--';
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${(m || '00').slice(0, 2)} ${suffix}`;
}

type DayDraft = {
  is_working: boolean;
  depart_time: string;
  return_time: string;
};

const WORK_WEEK = [1, 2, 3, 4, 5] as const;

const emptyDay = (): DayDraft => ({
  is_working: true,
  depart_time: '08:30',
  return_time: '18:30',
});

export default function CleanerCitySchedulePage() {
  const { data: profile } = useCleanerCityProfile();
  const location = useLocation();
  const navigate = useNavigate();
  const arrivalNotice = (location.state as { notice?: string } | null)?.notice || '';
  const { data: templates = [] } = useCommuteTemplates();
  const tz = profile?.timezone || DEFAULT_COMMUTE_TIMEZONE;
  const today = todayInTz(tz);
  const weekEnd = addDays(today, 13);
  const { data: overrides = [] } = useCommuteOverrides(today, weekEnd);

  const setTemplate = useSetCommuteTemplate();
  const setOverride = useSetCommuteOverride();
  const clearOverride = useClearCommuteOverride();
  const pauseCommute = usePauseCommute();
  const setAutopilot = useSetAutopilot();

  const [days, setDays] = useState<Record<number, DayDraft>>({});
  const [selectedDay, setSelectedDay] = useState(1);
  const [savingWeek, setSavingWeek] = useState(false);
  const [weekSaved, setWeekSaved] = useState(false);
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
          }
        : {
            ...emptyDay(),
            // Weekends default off - office reality
            is_working: wd.value >= 1 && wd.value <= 5,
          };
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

  const weekAlreadyConfigured = useMemo(
    () =>
      templates.some(
        (t) =>
          WORK_WEEK.includes(t.weekday as (typeof WORK_WEEK)[number]) &&
          t.is_working &&
          !!t.depart_time,
      ),
    [templates],
  );

  const selectedDraft = days[selectedDay] || emptyDay();

  const pickupHint = useMemo(() => {
    const withPin = templates.find(
      (t) =>
        typeof t.pickup_latitude === 'number' &&
        typeof t.pickup_longitude === 'number' &&
        Number.isFinite(t.pickup_latitude),
    );
    return withPin?.pickup_label || null;
  }, [templates]);

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

  const pickupFieldsFor = (weekday: number) => {
    const row = templates.find((t) => t.weekday === weekday);
    return {
      pickup_label: row?.pickup_label ?? null,
      pickup_latitude: row?.pickup_latitude ?? null,
      pickup_longitude: row?.pickup_longitude ?? null,
    };
  };

  const saveDayTemplate = async (weekday: number, draft: DayDraft) => {
    await setTemplate.mutateAsync({
      weekday,
      is_working: draft.is_working,
      depart_time: draft.depart_time || null,
      return_time: draft.return_time || null,
      ...pickupFieldsFor(weekday),
    });
  };

  const applyUsualTimesToWorkWeek = async () => {
    const source = days[selectedDay] || emptyDay();
    if (!source.depart_time || !source.return_time) {
      toast.error('Set depart and return times first');
      return;
    }
    setSavingWeek(true);
    try {
      for (const day of WORK_WEEK) {
        const draft = days[day] || emptyDay();
        await saveDayTemplate(day, {
          is_working: draft.is_working,
          depart_time: source.depart_time,
          return_time: source.return_time,
        });
      }
      // Keep weekends as currently set (usually off)
      for (const day of [6, 0] as const) {
        const draft = days[day] || { ...emptyDay(), is_working: false };
        await saveDayTemplate(day, draft);
      }
      setDays((prev) => {
        const next = { ...prev };
        for (const day of WORK_WEEK) {
          next[day] = {
            ...(next[day] || emptyDay()),
            depart_time: source.depart_time,
            return_time: source.return_time,
          };
        }
        return next;
      });
      setWeekSaved(true);
      toast.success('Work week times saved');
    } catch (e: any) {
      toast.error(e?.message || 'Could not save week');
    } finally {
      setSavingWeek(false);
    }
  };

  const saveSelectedDayOnly = async () => {
    try {
      await saveDayTemplate(selectedDay, selectedDraft);
      const dayName = CLEANER_CITY_WEEKDAYS.find((w) => w.value === selectedDay)?.full || 'Day';
      toast.success(`${dayName} updated`);
      setWeekSaved(true);
    } catch (e: any) {
      toast.error(e?.message || 'Could not save day');
    }
  };

  const toggleDayWorking = (weekday: number) => {
    setDays((prev) => {
      const draft = prev[weekday] || emptyDay();
      return {
        ...prev,
        [weekday]: { ...draft, is_working: !draft.is_working },
      };
    });
    setSelectedDay(weekday);
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
      toast.success('Saved for that date only - rest of week untouched');
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

  const toggleAutopilot = async (enabled: boolean) => {
    try {
      await setAutopilot.mutateAsync({
        enabled,
        confirm_mode: profile.autopilot_confirm_mode || 'confirm',
      });
      toast.success(enabled ? 'Autopilot enabled' : 'Autopilot disabled');
    } catch (e: any) {
      toast.error(e?.message || 'Could not update autopilot');
    }
  };

  const setAutopilotMode = async (mode: 'confirm' | 'auto') => {
    try {
      await setAutopilot.mutateAsync({
        enabled: profile.autopilot_enabled ?? false,
        confirm_mode: mode,
      });
      toast.success('Autopilot mode saved');
    } catch (e: any) {
      toast.error(e?.message || 'Could not update autopilot mode');
    }
  };

  const host = profile?.role === 'host' || profile?.role === 'both';

  return (
    <AppLayout headerTitle="My commute schedule">
      <CleanerCityGate>
        <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 pb-28 pt-4" data-testid="cleaner-city-schedule">
          {arrivalNotice ? (
            <div
              className="rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm leading-relaxed"
              data-testid="cleaner-city-schedule-notice"
            >
              {arrivalNotice}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
            {[
              { label: 'Times', done: weekSaved || weekAlreadyConfigured },
              { label: 'Exceptions', done: overrides.length > 0 },
              { label: 'Autopilot', done: !!profile.autopilot_enabled },
            ].map((step, i, arr) => (
              <div key={step.label} className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                    step.done ? 'bg-emerald-500/20 text-emerald-500' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {step.done ? <Check size={13} /> : i + 1}
                </span>
                <span
                  className={cn(
                    'truncate text-xs font-semibold',
                    step.done ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {step.label}
                </span>
                {i < arr.length - 1 ? (
                  <span className="ml-auto h-px w-3 shrink-0 bg-border sm:w-5" aria-hidden />
                ) : null}
              </div>
            ))}
          </div>

          {pickupHint ? (
            <p className="text-[11px] text-muted-foreground px-1">
              Home gate on{' '}
              <Link to="/cleaner-city/route" className="font-semibold text-primary">
                Office & pickup
              </Link>
              : {pickupHint}
            </p>
          ) : null}

          <Tabs defaultValue="week" className="w-full">
            <TabsList className="grid w-full grid-cols-3 h-11">
              <TabsTrigger value="week" data-testid="schedule-tab-week">
                My week
              </TabsTrigger>
              <TabsTrigger value="exceptions" data-testid="schedule-tab-exceptions">
                Exceptions
              </TabsTrigger>
              <TabsTrigger value="settings" data-testid="schedule-tab-settings">
                Settings
              </TabsTrigger>
            </TabsList>

            <TabsContent value="week" className="mt-6 focus-visible:outline-none">
              <div className="flex flex-col gap-6">
              <section className="rounded-2xl border border-border bg-card p-5 space-y-5">
                <div>
                  <h2 className="text-sm font-semibold">Usual leave & return</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Set once for Mon-Fri. Tap a day chip to mark WFH / off, or tweak that day only.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2" data-testid="schedule-day-chips">
                  {CLEANER_CITY_WEEKDAYS.map((wd) => {
                    const draft = days[wd.value] || emptyDay();
                    const selected = selectedDay === wd.value;
                    return (
                      <button
                        key={wd.value}
                        type="button"
                        onClick={() => setSelectedDay(wd.value)}
                        onDoubleClick={() => toggleDayWorking(wd.value)}
                        className={cn(
                          'min-w-[2.6rem] rounded-full border px-2.5 py-1.5 text-[11px] font-semibold',
                          selected && 'border-primary bg-primary/10 text-primary',
                          !selected && draft.is_working && 'border-emerald-500/40 text-foreground',
                          !selected && !draft.is_working && 'border-border text-muted-foreground opacity-70',
                        )}
                        data-testid={`schedule-weekday-${wd.value}`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {draft.is_working && <Check size={10} className="text-emerald-500" />}
                          {wd.label}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="rounded-xl border border-border/80 bg-muted/20 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">
                      {CLEANER_CITY_WEEKDAYS.find((w) => w.value === selectedDay)?.full}
                    </p>
                    <button
                      type="button"
                      onClick={() => toggleDayWorking(selectedDay)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-[11px] font-semibold',
                        selectedDraft.is_working
                          ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'border-border text-muted-foreground',
                      )}
                    >
                      {selectedDraft.is_working ? 'Commuting' : 'Off / WFH'}
                    </button>
                  </div>

                  {selectedDraft.is_working ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[11px]">Leave home</Label>
                        <Input
                          type="time"
                          value={selectedDraft.depart_time}
                          onChange={(e) =>
                            setDays((prev) => ({
                              ...prev,
                              [selectedDay]: {
                                ...selectedDraft,
                                depart_time: e.target.value,
                              },
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px]">Leave office</Label>
                        <Input
                          type="time"
                          value={selectedDraft.return_time}
                          onChange={(e) =>
                            setDays((prev) => ({
                              ...prev,
                              [selectedDay]: {
                                ...selectedDraft,
                                return_time: e.target.value,
                              },
                            }))
                          }
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No seats or matches for this weekday until you turn commuting back on.
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-3">
                  <Button
                    className="h-12 w-full font-semibold"
                    onClick={applyUsualTimesToWorkWeek}
                    disabled={setTemplate.isPending || savingWeek}
                    data-testid="schedule-save-work-week"
                  >
                    {savingWeek
                      ? 'Saving…'
                      : `Save ${formatClock(selectedDraft.depart_time)} / ${formatClock(selectedDraft.return_time)} for Mon-Fri`}
                  </Button>
                  <button
                    type="button"
                    className="py-1 text-center text-sm font-semibold text-muted-foreground"
                    onClick={saveSelectedDayOnly}
                    disabled={setTemplate.isPending || savingWeek}
                    data-testid="schedule-save-day-only"
                  >
                    Save this day only
                  </button>
                </div>
              </section>

              {weekSaved ? (
                <button
                  type="button"
                  className="py-1 text-center text-sm font-semibold text-primary"
                  data-testid="cleaner-city-schedule-next"
                  onClick={() =>
                    navigate(host ? '/cleaner-city/vehicle' : '/cleaner-city/find', {
                      state: {
                        notice: host
                          ? 'Add the car or bike you will use, then offer seats.'
                          : 'Search for a seat on your corridor.',
                      },
                    })
                  }
                >
                  {host ? 'Next - my vehicle' : 'Next - find a ride'}
                </button>
              ) : null}
              </div>
            </TabsContent>

            <TabsContent value="exceptions" className="mt-6 focus-visible:outline-none">
              <div className="flex flex-col gap-6">
              <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
                <div>
                  <h2 className="text-sm font-semibold">Change one date</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Tomorrow is WFH, or you leave late once - does not rewrite your week plan.
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {previewDates.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                        d === overrideDate ? 'border-primary bg-primary/10 text-primary' : 'border-border',
                      )}
                      onClick={() => setOverrideDate(d)}
                    >
                      {d.slice(5)}
                    </button>
                  ))}
                </div>

                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={overrideDate}
                    onChange={(e) => setOverrideDate(e.target.value)}
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  {CLEANER_CITY_OVERRIDE_KINDS.map((kind) => (
                    <button
                      key={kind.value}
                      type="button"
                      onClick={() => setOverrideKind(kind.value)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-[11px] font-semibold',
                        overrideKind === kind.value
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border',
                      )}
                    >
                      {kind.label}
                    </button>
                  ))}
                </div>

                {(overrideKind === 'time_change' || overrideKind === 'custom') && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[11px]">Leave home</Label>
                      <Input
                        type="time"
                        value={overrideDepart}
                        onChange={(e) => setOverrideDepart(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Leave office</Label>
                      <Input
                        type="time"
                        value={overrideReturn}
                        onChange={(e) => setOverrideReturn(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                <Input
                  placeholder="Note (optional)"
                  value={overrideNote}
                  onChange={(e) => setOverrideNote(e.target.value)}
                />

                <Button onClick={saveOverride} disabled={setOverride.isPending} className="w-full">
                  Save for {overrideDate} only
                </Button>

                {effectiveTomorrow && (
                  <div
                    className="rounded-xl bg-muted/60 p-3 text-xs space-y-1"
                    data-testid="effective-schedule-preview"
                  >
                    <p className="font-semibold">Effective for {overrideDate}</p>
                    <p>
                      {effectiveTomorrow.is_paused
                        ? 'Paused'
                        : effectiveTomorrow.is_working
                          ? `Leave ${timeToInput(effectiveTomorrow.depart_time) || '-'} / return ${timeToInput(effectiveTomorrow.return_time) || '-'}`
                          : 'Not commuting'}
                    </p>
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
                <h2 className="text-sm font-semibold">Upcoming exceptions</h2>
                {overrides.length === 0 && (
                  <p className="text-xs text-muted-foreground">None in the next two weeks.</p>
                )}
                {overrides.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-2 text-sm border-b border-border py-2 last:border-0"
                  >
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
              </section>
              </div>
            </TabsContent>

            <TabsContent value="settings" className="mt-6 focus-visible:outline-none">
              <div className="flex flex-col gap-6">
              <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold">Pause matching</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {profile.is_paused
                        ? 'Paused - no new matches until you resume.'
                        : 'Active - matching can use your week plan.'}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={togglePause}
                    disabled={pauseCommute.isPending}
                  >
                    {profile.is_paused ? 'Resume' : 'Pause'}
                  </Button>
                </div>
              </section>

              <section
                className="rounded-2xl border border-border bg-card p-5 space-y-3"
                data-testid="cleaner-city-autopilot-section"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold">Autopilot</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Drafts tomorrow seats from your week, vehicle, and pins.
                    </p>
                  </div>
                  <Switch
                    checked={!!profile.autopilot_enabled}
                    onCheckedChange={toggleAutopilot}
                    disabled={setAutopilot.isPending}
                    data-testid="cleaner-city-autopilot-toggle"
                  />
                </div>
                {profile.autopilot_enabled && (
                  <div className="grid grid-cols-2 gap-2">
                    {CLEANER_CITY_AUTOPILOT_MODES.map((mode) => (
                      <button
                        key={mode.value}
                        type="button"
                        onClick={() => setAutopilotMode(mode.value)}
                        disabled={setAutopilot.isPending}
                        className={cn(
                          'rounded-xl border px-3 py-2 text-left',
                          profile.autopilot_confirm_mode === mode.value
                            ? 'border-primary bg-primary/10'
                            : 'border-border',
                        )}
                        data-testid={`cleaner-city-autopilot-mode-${mode.value}`}
                      >
                        <p className="text-xs font-semibold text-foreground">{mode.label}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{mode.hint}</p>
                      </button>
                    ))}
                  </div>
                )}
                {!profile.autopilot_enabled && (
                  <p className="text-[11px] text-muted-foreground">
                    Needs an active vehicle plus office and home-gate pins.
                  </p>
                )}
              </section>

              <div className="flex flex-col gap-3 text-center pt-1">
                <Link to="/cleaner-city/route" className="text-sm font-semibold text-primary">
                  Edit office & home gate
                </Link>
                <Link to="/cleaner-city/setup" className="text-sm text-muted-foreground">
                  Edit profile and work email
                </Link>
                <Link to="/cleaner-city" className="text-sm font-semibold text-primary">
                  Back to A Cleaner City
                </Link>
              </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </CleanerCityGate>
    </AppLayout>
  );
}
