// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, CheckCircle2, ChevronDown, ChevronUp, MapPin, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { CleanerCityChangeRouteDrawer } from '@/components/cleaner-city/CleanerCityChangeRouteDrawer';
import { CleanerCityEditRideDrawer } from '@/components/cleaner-city/CleanerCityEditRideDrawer';
import {
  CleanerCityInactiveRideDrawer,
  type InactiveDuration,
} from '@/components/cleaner-city/CleanerCityInactiveRideDrawer';
import { CleanerCityPlannedRidesDrawer } from '@/components/cleaner-city/CleanerCityPlannedRidesDrawer';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  useCancelHostPublicationsForDate,
  useCommuteTemplates,
  useEffectiveSchedule,
  useEnsureHostPublication,
  useMyPublications,
  useMyRides,
  useOfficeLocations,
  usePauseCommute,
  useSetCommuteOverride,
  type CommutePublication,
  type EffectiveSchedule,
} from '@/hooks/queries/useCleanerCity';
import { useAuth } from '@/contexts/AuthContext';
import { getCleanerCityIntent } from '@/lib/cleaner-city/intent';
import {
  addDaysIso,
  encodeInactiveNote,
  isLegGoing,
  parseInactiveLegs,
  remainingWeekdayDates,
  stripInactiveMarker,
  withLegInactive,
  type RideDirection,
} from '@/lib/cleaner-city/legInactive';
import { cn } from '@/lib/utils';

type Mode = 'guest' | 'host';

type Props = {
  todayIso: string;
  selectedDate: string;
  onSelectDate: (iso: string) => void;
  homeLabel?: string | null;
  officeLabel?: string | null;
  profileRole?: string | null;
  /** Explicit Find a seat / Offer seats play mode from Home switch. */
  playMode?: Mode | null;
  activeDirection?: RideDirection | null;
  onFindHosts?: (info: {
    date: string;
    direction: RideDirection;
    leaveTime: string;
  }) => void;
  /** Host Find Guests - stay on Home and browse guests on this leg. */
  onFindGuests?: (info: {
    date: string;
    direction: RideDirection;
    leaveTime: string;
  }) => void;
  onReviewRequests?: () => void;
  className?: string;
};

function dateChipLabel(iso: string, today: string) {
  if (iso === today) return 'Today';
  if (iso === addDaysIso(today, 1)) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric' }).format(
    new Date(`${iso}T12:00:00`),
  );
}

function formatLeave(value?: string | null) {
  const raw = String(value || '').slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(raw)) return '--:--';
  const [hRaw, m] = raw.split(':');
  let h = Number(hRaw);
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${suffix}`;
}

function shiftHhmm(value: string | null | undefined, minutesDelta: number) {
  const raw = String(value || '08:30').slice(0, 5);
  const [h, m] = raw.split(':').map(Number);
  let total = ((h || 0) * 60 + (m || 0) + minutesDelta + 24 * 60) % (24 * 60);
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

function resolveMode(profileRole?: string | null, playMode?: Mode | null): Mode {
  if (playMode === 'host' || playMode === 'guest') return playMode;
  const intent = getCleanerCityIntent();
  if (intent === 'host') return 'host';
  if (intent === 'guest') return 'guest';
  if (profileRole === 'host') return 'host';
  return 'guest';
}

function livePub(
  publications: CommutePublication[],
  date: string,
  direction: RideDirection,
) {
  return (
    publications.find(
      (p) =>
        p.travel_date === date &&
        p.direction === direction &&
        (p.status === 'published' || p.status === 'full'),
    ) || null
  );
}

function RideLegCard({
  date,
  direction,
  schedule,
  homeLabel,
  officeLabel,
  publication,
  pendingRequests,
  startRideId,
  mode,
  busy,
  highlighted,
  going,
  ensuring,
  onToggleGoing,
  onNudgeTime,
  onEdit,
  onFindHosts,
  onFindGuests,
  onReviewRequests,
}: {
  date: string;
  direction: RideDirection;
  schedule?: EffectiveSchedule | null;
  homeLabel: string;
  officeLabel: string;
  publication: CommutePublication | null;
  pendingRequests: number;
  startRideId?: string | null;
  mode: Mode;
  busy: boolean;
  highlighted?: boolean;
  going: boolean;
  ensuring?: boolean;
  onToggleGoing: (next: boolean) => void;
  onNudgeTime: (deltaMinutes: number) => void;
  onEdit: () => void;
  onFindHosts?: Props['onFindHosts'];
  onFindGuests?: Props['onFindGuests'];
  onReviewRequests?: Props['onReviewRequests'];
}) {
  const navigate = useNavigate();
  const leaveTime =
    direction === 'to_office' ? schedule?.depart_time : schedule?.return_time;
  const origin = direction === 'to_office' ? homeLabel : officeLabel;
  const dest = direction === 'to_office' ? officeLabel : homeLabel;
  const leaveHhmm = String(leaveTime || '').slice(0, 5) || '08:30';
  const openGuestBrowse = () => {
    if (onFindGuests) {
      onFindGuests({ date, direction, leaveTime: leaveHhmm });
      return;
    }
    if (onReviewRequests && pendingRequests > 0) {
      onReviewRequests();
      return;
    }
    navigate('/cleaner-city', {
      state: { openFindGuests: true, travelDate: date, direction, departTime: leaveHhmm },
    });
  };

  // Carpool CTAs: guest finds a host; host finds guests on this road (Home browse).
  let ctaLabel = mode === 'host' ? 'Find Guests' : 'Find Hosts';
  let ctaTone: 'primary' | 'secondary' = direction === 'to_office' ? 'primary' : 'secondary';
  let ctaDisabled = false;
  let ctaAction = () =>
    onFindHosts?.({
      date,
      direction,
      leaveTime: leaveHhmm,
    });

  if (startRideId) {
    ctaLabel = 'Start Ride';
    ctaTone = 'primary';
    ctaAction = () => navigate(`/cleaner-city/ride/${startRideId}`);
  } else if (mode === 'host') {
    if (publication && pendingRequests > 0) {
      ctaLabel = `Find Guests (${pendingRequests})`;
      ctaTone = 'primary';
      ctaAction = openGuestBrowse;
    } else if (publication) {
      ctaLabel = publication.status === 'full' ? 'Seats full' : 'Find Guests';
      ctaTone = publication.status === 'full' ? 'secondary' : 'primary';
      ctaDisabled = publication.status === 'full';
      ctaAction = publication.status === 'full' ? () => {} : openGuestBrowse;
    } else if (ensuring) {
      ctaLabel = 'Finding guests…';
      ctaTone = 'secondary';
      ctaDisabled = true;
      ctaAction = () => {};
    } else if (going) {
      ctaLabel = 'Find Guests';
      ctaTone = 'primary';
      ctaAction = openGuestBrowse;
    } else {
      ctaLabel = 'Not going';
      ctaTone = 'secondary';
      ctaDisabled = true;
      ctaAction = () => {};
    }
  }

  return (
    <div className="space-y-2">
      <article
        className={cn(
          'rounded-2xl border border-border bg-card px-3 py-2.5 space-y-2.5 shadow-sm',
          highlighted && 'ring-1 ring-primary/30',
          !going && 'opacity-55',
        )}
        data-testid={`cleaner-city-your-ride-${direction}`}
        data-going={going ? 'true' : 'false'}
      >
        <div className="flex items-center gap-2">
          <div className="inline-flex items-stretch overflow-hidden rounded-lg border border-border bg-muted/35">
            <div className="flex min-w-[4.75rem] items-center justify-center px-2 py-1.5">
              <span className="text-[13px] font-bold tabular-nums text-foreground">
                {formatLeave(leaveTime)}
              </span>
            </div>
            <div className="flex flex-col border-l border-border">
              <button
                type="button"
                className="flex h-4 w-6 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                disabled={busy || !going}
                onClick={() => onNudgeTime(15)}
                aria-label="Leave 15 minutes later"
              >
                <ChevronUp size={12} strokeWidth={2.4} />
              </button>
              <button
                type="button"
                className="flex h-4 w-6 items-center justify-center border-t border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                disabled={busy || !going}
                onClick={() => onNudgeTime(-15)}
                aria-label="Leave 15 minutes earlier"
              >
                <ChevronDown size={12} strokeWidth={2.4} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Switch
              checked={going}
              disabled={busy || !!schedule?.is_paused}
              onCheckedChange={onToggleGoing}
              aria-label={going ? 'Going' : 'Not Going'}
              data-testid={`cleaner-city-going-${direction}`}
              className="h-5 w-9"
            />
            <span
              className={cn(
                'text-[12px] font-semibold',
                going ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {going ? 'Going' : 'Not Going'}
            </span>
          </div>

          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-primary"
            onClick={onEdit}
            data-testid={`cleaner-city-edit-ride-${direction}`}
          >
            <Pencil size={12} strokeWidth={2.3} />
            Edit
          </button>
        </div>

        <div className="relative ml-0.5 space-y-2 pl-4">
          <span
            aria-hidden
            className="absolute left-[3px] top-2 bottom-2 w-px border-l border-dashed border-muted-foreground/40"
          />
          <div className="relative flex items-start gap-2">
            <span
              aria-hidden
              className="absolute -left-4 top-1 h-2 w-2 rounded-full border-[1.5px] border-muted-foreground/70 bg-card"
            />
            <p className="min-w-0 flex-1 truncate text-[12px] font-medium leading-snug text-foreground">
              {origin}
            </p>
          </div>
          <div className="relative flex items-start gap-2">
            <MapPin
              aria-hidden
              size={12}
              className="absolute -left-[15px] top-0.5 text-muted-foreground"
              strokeWidth={2.2}
            />
            <p className="min-w-0 flex-1 truncate text-[12px] font-medium leading-snug text-foreground">
              {dest}
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant={ctaTone === 'primary' ? 'default' : 'secondary'}
          className={cn(
            'h-10 w-full rounded-xl text-[13px] font-bold',
            going &&
              ctaTone === 'primary' &&
              'bg-emerald-600 text-white hover:bg-emerald-700',
            going &&
              ctaTone === 'secondary' &&
              'bg-emerald-500/15 text-emerald-800 hover:bg-emerald-500/25 dark:text-emerald-200',
            !going &&
              'border border-border bg-muted/40 text-muted-foreground hover:bg-muted/40',
          )}
          disabled={ctaDisabled || (!going && !startRideId)}
          onClick={ctaAction}
          data-testid={`cleaner-city-your-ride-cta-${direction}`}
        >
          {ctaLabel}
          <span aria-hidden className="ml-1">
            →
          </span>
        </Button>
      </article>

      {!going && !schedule?.is_paused ? (
        <div
          className="flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2.5 text-white shadow-sm"
          data-testid={`cleaner-city-inactive-banner-${direction}`}
        >
          <CheckCircle2 size={16} className="shrink-0" strokeWidth={2.4} />
          <p className="text-[12px] font-semibold leading-snug">
            You&apos;re marked inactive for this trip
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function CleanerCityYourRidesBoard({
  todayIso,
  selectedDate,
  onSelectDate,
  homeLabel,
  officeLabel,
  profileRole,
  playMode,
  activeDirection,
  onFindHosts,
  onFindGuests,
  onReviewRequests,
  className,
}: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const mode = resolveMode(profileRole, playMode);
  const dateOptions = useMemo(
    () => Array.from({ length: 4 }, (_, i) => addDaysIso(todayIso, i)),
    [todayIso],
  );
  const { data: schedule } = useEffectiveSchedule(selectedDate);
  const { data: templates = [] } = useCommuteTemplates();
  const { data: publications = [] } = useMyPublications(todayIso);
  const { data: rides = [] } = useMyRides();
  const { data: offices = [] } = useOfficeLocations();
  const setOverride = useSetCommuteOverride();
  const pauseCommute = usePauseCommute();
  const ensurePub = useEnsureHostPublication();
  const cancelPubs = useCancelHostPublicationsForDate();
  const [busy, setBusy] = useState(false);
  const [editDir, setEditDir] = useState<RideDirection | null>(null);
  const [routeDir, setRouteDir] = useState<RideDirection | null>(null);
  const [inactiveDir, setInactiveDir] = useState<RideDirection | null>(null);
  const [plannedOpen, setPlannedOpen] = useState(false);
  const [ensuringDir, setEnsuringDir] = useState<RideDirection | null>(null);
  const ensuredKeysRef = useRef<Set<string>>(new Set());
  const ensureFailedKeysRef = useRef<Set<string>>(new Set());

  const office = offices.find((o) => o.is_primary) || offices[0] || null;
  const resolvedHome = homeLabel || schedule?.pickup_label || 'Home';
  const resolvedOffice = officeLabel || office?.label || 'Office';
  const weekday = new Date(`${selectedDate}T12:00:00`).getDay();
  const weekdayTemplate = templates.find((t) => t.weekday === weekday) || null;
  // Prefer live schedule times; if the day is off (--:--), fall back to week template / defaults.
  const depart = String(
    schedule?.depart_time || weekdayTemplate?.depart_time || '08:30',
  ).slice(0, 5);
  const ret = String(
    schedule?.return_time || weekdayTemplate?.return_time || '18:30',
  ).slice(0, 5);

  const pendingByPub = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of rides) {
      if (r.status !== 'requested' || !r.publication_id) continue;
      if (user?.id && r.host_user_id !== user.id) continue;
      map[r.publication_id] = (map[r.publication_id] || 0) + 1;
    }
    return map;
  }, [rides, user?.id]);

  const startRideByDirection = useMemo(() => {
    const out: Partial<Record<RideDirection, string>> = {};
    for (const r of rides) {
      if (!['confirmed', 'pickup_pending'].includes(r.status)) continue;
      if (r.travel_date !== selectedDate) continue;
      if (user?.id && r.host_user_id !== user.id && r.guest_user_id !== user.id) continue;
      const pub = publications.find((p) => p.id === r.publication_id);
      const dir = (pub?.direction || r.direction) as RideDirection | undefined;
      if (dir === 'to_office' || dir === 'to_home') out[dir] = r.id;
    }
    return out;
  }, [rides, publications, selectedDate, user?.id]);

  const saveDay = async (input: {
    date: string;
    is_working: boolean;
    depart_time: string;
    return_time: string;
    kind?: string;
    note?: string | null;
  }) => {
    await setOverride.mutateAsync({
      override_date: input.date,
      is_working: input.is_working,
      depart_time: input.depart_time,
      return_time: input.return_time,
      override_kind: input.kind || (input.is_working ? 'time_change' : 'wfh'),
      note: input.note ?? null,
    });
  };

  const ensureHostLeg = async (
    date: string,
    direction: RideDirection,
    times: { depart: string; returnTime: string },
  ) => {
    if (mode !== 'host') return;
    const key = `${date}:${direction}`;
    if (ensuredKeysRef.current.has(key) || ensureFailedKeysRef.current.has(key)) return;
    setEnsuringDir(direction);
    try {
      await ensurePub.mutateAsync({
        travel_date: date,
        direction,
        depart_time: direction === 'to_office' ? times.depart : times.returnTime,
        existing: publications,
      });
      ensuredKeysRef.current.add(key);
      ensureFailedKeysRef.current.delete(key);
    } catch (e: any) {
      ensureFailedKeysRef.current.add(key);
      toast.message(
        e?.message || 'Going is on - finish vehicle and usual road so guests can match',
      );
    } finally {
      setEnsuringDir((cur) => (cur === direction ? null : cur));
    }
  };

  const cancelHostLegs = async (
    date: string,
    directions: RideDirection[],
  ) => {
    if (mode !== 'host') return;
    try {
      await cancelPubs.mutateAsync({
        travel_date: date,
        directions,
        existing: publications,
      });
      for (const dir of directions) {
        const key = `${date}:${dir}`;
        ensuredKeysRef.current.delete(key);
        ensureFailedKeysRef.current.delete(key);
      }
    } catch (e: any) {
      toast.message(e?.message || 'Could not close seats for that trip');
    }
  };

  const markLegInactiveOnDate = async (
    date: string,
    direction: RideDirection,
    times: { depart: string; returnTime: string },
    existingNote?: string | null,
    existingWorking = true,
  ) => {
    const current = existingWorking
      ? parseInactiveLegs({ is_working: true, note: existingNote })
      : { to_office: true, to_home: true };
    const next = withLegInactive(current, direction, true);
    if (next.to_office && next.to_home) {
      await saveDay({
        date,
        is_working: false,
        depart_time: times.depart,
        return_time: times.returnTime,
        kind: 'wfh',
        note: encodeInactiveNote(next, existingNote) || 'Day off from Home',
      });
      return;
    }
    await saveDay({
      date,
      is_working: true,
      depart_time: times.depart,
      return_time: times.returnTime,
      kind: 'custom',
      note: encodeInactiveNote(next, existingNote),
    });
  };

  const turnLegOn = async (direction: RideDirection) => {
    setBusy(true);
    try {
      const current = parseInactiveLegs(schedule);
      const next = withLegInactive(current, direction, false);
      // Never clearOverride here. On WFH weekdays (e.g. Fri), clearing falls back to
      // the template and both legs flip back to Not Going.
      const bothGoing = !next.to_office && !next.to_home;
      await saveDay({
        date: selectedDate,
        is_working: true,
        depart_time: depart,
        return_time: ret,
        kind: bothGoing ? 'time_change' : 'custom',
        note: bothGoing
          ? stripInactiveMarker(schedule?.note)
          : encodeInactiveNote(next, schedule?.note),
      });
      toast.success('Marked as Going');
      ensureFailedKeysRef.current.delete(`${selectedDate}:${direction}`);
      ensuredKeysRef.current.delete(`${selectedDate}:${direction}`);
      await ensureHostLeg(selectedDate, direction, { depart, returnTime: ret });
    } catch (e: any) {
      toast.error(e?.message || 'Could not update ride');
    } finally {
      setBusy(false);
    }
  };

  const applyInactive = async (direction: RideDirection, duration: InactiveDuration) => {
    setBusy(true);
    try {
      const times = { depart, returnTime: ret };
      if (duration === 'this_trip') {
        await markLegInactiveOnDate(selectedDate, direction, times, schedule?.note, !!schedule?.is_working);
        await cancelHostLegs(selectedDate, [direction]);
        toast.success("You're marked inactive for this trip");
        return;
      }
      if (duration === 'both_today') {
        await saveDay({
          date: selectedDate,
          is_working: false,
          depart_time: depart,
          return_time: ret,
          kind: 'wfh',
          note: encodeInactiveNote(
            { to_office: true, to_home: true },
            schedule?.note,
          ) || 'Day off from Home',
        });
        await cancelHostLegs(selectedDate, ['to_office', 'to_home']);
        toast.success("You're marked inactive both ways today");
        return;
      }
      if (duration === 'tomorrow') {
        const tomorrow = addDaysIso(selectedDate, 1);
        await markLegInactiveOnDate(selectedDate, direction, times, schedule?.note, !!schedule?.is_working);
        await markLegInactiveOnDate(tomorrow, direction, times, null, true);
        await cancelHostLegs(selectedDate, [direction]);
        await cancelHostLegs(tomorrow, [direction]);
        toast.success("You're marked inactive for tomorrow's trip too");
        return;
      }
      if (duration === 'this_week') {
        const dates = remainingWeekdayDates(selectedDate);
        for (const iso of dates) {
          const isSelected = iso === selectedDate;
          await markLegInactiveOnDate(
            iso,
            direction,
            times,
            isSelected ? schedule?.note : null,
            isSelected ? !!schedule?.is_working : true,
          );
          await cancelHostLegs(iso, [direction]);
        }
        toast.success("You're marked inactive for this trip this week");
        return;
      }
      // longer
      await saveDay({
        date: selectedDate,
        is_working: false,
        depart_time: depart,
        return_time: ret,
        kind: 'leave',
        note: encodeInactiveNote(
          { to_office: true, to_home: true },
          schedule?.note,
        ) || 'Paused from Home',
      });
      await cancelHostLegs(selectedDate, ['to_office', 'to_home']);
      await pauseCommute.mutateAsync(true);
      toast.success('Matching paused - turn rides back on anytime');
      navigate('/cleaner-city/schedule', { state: { from: '/cleaner-city' } });
    } catch (e: any) {
      toast.error(e?.message || 'Could not go inactive');
      throw e;
    } finally {
      setBusy(false);
    }
  };

  // Host: Going legs without a live offer get seats opened automatically (idempotent).
  useEffect(() => {
    if (mode !== 'host' || busy || !schedule) return;
    const times = { depart, returnTime: ret };
    for (const direction of ['to_office', 'to_home'] as const) {
      if (!isLegGoing(schedule, direction)) continue;
      if (livePub(publications, selectedDate, direction)) continue;
      const key = `${selectedDate}:${direction}`;
      if (ensuredKeysRef.current.has(key) || ensureFailedKeysRef.current.has(key)) continue;
      if (ensuringDir === direction) continue;
      void ensureHostLeg(selectedDate, direction, times);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate sync when date/schedule/pubs change
  }, [mode, busy, schedule, selectedDate, publications, depart, ret]);

  const requestToggle = (direction: RideDirection, next: boolean) => {
    if (next) {
      void turnLegOn(direction);
      return;
    }
    setInactiveDir(direction);
  };

  const nudgeTime = async (direction: RideDirection, delta: number) => {
    const nextDepart = direction === 'to_office' ? shiftHhmm(depart, delta) : depart;
    const nextReturn = direction === 'to_home' ? shiftHhmm(ret, delta) : ret;
    setBusy(true);
    try {
      const inactive = parseInactiveLegs(schedule);
      await saveDay({
        date: selectedDate,
        is_working: true,
        depart_time: nextDepart,
        return_time: nextReturn,
        kind: 'time_change',
        note: encodeInactiveNote(inactive, schedule?.note),
      });
    } catch (e: any) {
      toast.error(e?.message || 'Could not update time');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className={cn('space-y-2.5', className)}
      data-testid="cleaner-city-your-rides"
      data-mode={mode}
    >
      <div className="flex items-center justify-between gap-2 px-0.5">
        <h2 className="text-[18px] font-extrabold tracking-tight text-foreground">Your rides</h2>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary"
          onClick={() => setPlannedOpen(true)}
          data-testid="cleaner-city-edit-planned-rides"
        >
          <CalendarDays size={13} strokeWidth={2.2} />
          Edit planned rides
        </button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-0.5" data-testid="cleaner-city-your-rides-dates">
        {dateOptions.map((iso) => {
          const active = iso === selectedDate;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelectDate(iso)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors',
                active
                  ? 'border-primary/40 bg-primary/15 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              {dateChipLabel(iso, todayIso)}
            </button>
          );
        })}
      </div>

      <div className="space-y-2.5">
        {([{ direction: 'to_office' as const }, { direction: 'to_home' as const }] as const).map(
          ({ direction }) => {
            const pub = livePub(publications, selectedDate, direction);
            const going = isLegGoing(schedule, direction);
            return (
              <RideLegCard
                key={direction}
                date={selectedDate}
                direction={direction}
                schedule={schedule}
                homeLabel={resolvedHome}
                officeLabel={resolvedOffice}
                publication={pub}
                pendingRequests={pub ? pendingByPub[pub.id] || 0 : 0}
                startRideId={startRideByDirection[direction] || null}
                mode={mode}
                busy={busy}
                highlighted={activeDirection === direction}
                going={going}
                ensuring={ensuringDir === direction}
                onToggleGoing={(next) => requestToggle(direction, next)}
                onNudgeTime={(delta) => void nudgeTime(direction, delta)}
                onEdit={() => setEditDir(direction)}
                onFindHosts={onFindHosts}
                onFindGuests={onFindGuests}
                onReviewRequests={onReviewRequests}
              />
            );
          },
        )}
      </div>

      <button
        type="button"
        className="flex w-full items-center justify-center rounded-xl border border-dashed border-border py-2.5 text-[12px] font-semibold text-primary"
        onClick={() => {
          if (mode === 'host') {
            onFindGuests?.({
              date: selectedDate,
              direction: 'to_office',
              leaveTime: depart,
            });
            return;
          }
          onFindHosts?.({
            date: selectedDate,
            direction: 'to_office',
            leaveTime: depart,
          });
        }}
        data-testid="cleaner-city-create-new-ride"
      >
        + Create new ride
      </button>

      <CleanerCityEditRideDrawer
        open={!!editDir}
        onOpenChange={(open) => {
          if (!open) setEditDir(null);
        }}
        date={selectedDate}
        direction={editDir || 'to_office'}
        homeLabel={resolvedHome}
        officeLabel={resolvedOffice}
        departTime={depart}
        returnTime={ret}
        isWorking={!!schedule?.is_working && !schedule?.is_paused}
        note={schedule?.note}
        onConfirmed={() => {
          setEditDir(null);
        }}
        onRequestChangeRoute={(direction) => {
          setEditDir(null);
          setRouteDir(direction);
        }}
      />

      <CleanerCityChangeRouteDrawer
        open={!!routeDir}
        onOpenChange={(open) => {
          if (!open) setRouteDir(null);
        }}
        date={selectedDate}
        direction={routeDir || 'to_office'}
        home={
          schedule?.pickup_latitude != null && schedule?.pickup_longitude != null
            ? {
                lat: Number(schedule.pickup_latitude),
                lng: Number(schedule.pickup_longitude),
                label: resolvedHome,
              }
            : weekdayTemplate?.pickup_latitude != null &&
                weekdayTemplate?.pickup_longitude != null
              ? {
                  lat: Number(weekdayTemplate.pickup_latitude),
                  lng: Number(weekdayTemplate.pickup_longitude),
                  label: resolvedHome,
                }
              : null
        }
        office={
          office?.latitude != null && office?.longitude != null
            ? {
                lat: Number(office.latitude),
                lng: Number(office.longitude),
                label: resolvedOffice,
              }
            : null
        }
        homeLabel={resolvedHome}
        officeLabel={resolvedOffice}
        publicationId={
          routeDir ? livePub(publications, selectedDate, routeDir)?.id || null : null
        }
        ensureIfGoing={routeDir ? isLegGoing(schedule, routeDir) && mode === 'host' : false}
      />

      <CleanerCityInactiveRideDrawer
        open={!!inactiveDir}
        onOpenChange={(open) => {
          if (!open) setInactiveDir(null);
        }}
        date={selectedDate}
        todayIso={todayIso}
        direction={inactiveDir || 'to_office'}
        leaveTime={
          inactiveDir === 'to_home' ? ret : depart
        }
        busy={busy}
        onConfirm={async (duration) => {
          if (!inactiveDir) return;
          await applyInactive(inactiveDir, duration);
          setInactiveDir(null);
        }}
      />

      <CleanerCityPlannedRidesDrawer
        open={plannedOpen}
        onOpenChange={setPlannedOpen}
      />
    </section>
  );
}
