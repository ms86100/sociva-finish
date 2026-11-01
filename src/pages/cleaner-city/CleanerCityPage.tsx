// @ts-nocheck
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { CommuteJourney } from '@/components/cleaner-city/CommuteJourney';
import {
  CalendarClock,
  Car,
  ChevronDown,
  Leaf,
  MessageCircle,
  MapPin,
  Shield,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react';
import {
  CleanerCityActiveMissionCard,
  CleanerCityActiveMissionDock,
} from '@/components/cleaner-city/CleanerCityActiveMissionCard';
import {
  useCleanerCityBadges,
  useCleanerCityProfile,
  useCleanerCityWorkVerification,
  useConfirmPublication,
  useEffectiveSchedule,
  useMarkWfh,
  useCleanerCityVehicles,
  useCommuteTemplates,
  useEmergencyContacts,
  useMyPublications,
  useMyRides,
  useMyWaitlist,
  useOfficeLocations,
  useRepeatLastCommute,
  useRequestRide,
} from '@/hooks/queries/useCleanerCity';
import { useAuth } from '@/contexts/AuthContext';
import { DEFAULT_COMMUTE_TIMEZONE, WORK_EMAIL_BADGE } from '@/lib/cleaner-city/constants';
import { cn } from '@/lib/utils';

function todayIso(tz = DEFAULT_COMMUTE_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDaysIso(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayLabel(date: string, today: string) {
  if (date === today) return 'Today';
  if (date === addDaysIso(today, 1)) return 'Tomorrow';
  return date;
}

const ACTIVE_RIDE_STATUSES = [
  'requested',
  'confirmed',
  'pickup_pending',
  'started',
  'safety_incident',
];

export default function CleanerCityPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const arrivalNotice = (location.state as { notice?: string } | null)?.notice || '';
  const { data: profile } = useCleanerCityProfile();
  const { data: verification } = useCleanerCityWorkVerification();
  const { data: rides = [] } = useMyRides();
  const { data: publications = [] } = useMyPublications();
  const { data: waitlist = [] } = useMyWaitlist();
  const confirmPublication = useConfirmPublication();
  const { data: badges = [] } = useCleanerCityBadges();
  const { data: offices = [] } = useOfficeLocations();
  const { data: templates = [] } = useCommuteTemplates();
  const { data: vehicles = [] } = useCleanerCityVehicles();
  const { data: contacts = [] } = useEmergencyContacts();
  const repeatLast = useRepeatLastCommute();
  const markWfh = useMarkWfh();
  const requestRide = useRequestRide();
  const today = todayIso(profile?.timezone || DEFAULT_COMMUTE_TIMEZONE);
  const tomorrow = addDaysIso(today, 1);
  const { data: todaySchedule } = useEffectiveSchedule(profile ? today : null);
  const ready = !!profile && verification?.status === 'verified' && !profile.is_paused;
  const completedRides = rides.filter((r) => r.status === 'completed').length;
  const hostRole = profile?.role !== 'guest';
  const LIVE_MISSION_STATUSES = ['pickup_pending', 'started', 'safety_incident'];
  const UPCOMING_RIDE_STATUSES = ['requested', 'confirmed', 'pickup_pending', 'started', 'safety_incident'];
  const activeRide =
    rides.find((r) => r.travel_date === today && LIVE_MISSION_STATUSES.includes(r.status)) ||
    rides.find((r) => LIVE_MISSION_STATUSES.includes(r.status)) ||
    rides.find((r) => r.travel_date === today && ACTIVE_RIDE_STATUSES.includes(r.status)) ||
    rides.find((r) => ACTIVE_RIDE_STATUSES.includes(r.status)) ||
    null;
  const upcomingRides = rides
    .filter(
      (r) =>
        UPCOMING_RIDE_STATUSES.includes(r.status) &&
        String(r.travel_date || '') >= today &&
        r.id !== activeRide?.id,
    )
    .sort((a, b) => {
      const da = `${a.travel_date || ''} ${String(a.depart_time || '')}`;
      const db = `${b.travel_date || ''} ${String(b.depart_time || '')}`;
      return da.localeCompare(db);
    })
    .slice(0, 3);
  const upcomingHosting = publications
    .filter(
      (p) =>
        ['published', 'full'].includes(p.status) &&
        (p.travel_date === today || p.travel_date === tomorrow),
    )
    .sort((a, b) => {
      const da = `${a.travel_date || ''} ${String(a.depart_time || '')}`;
      const db = `${b.travel_date || ''} ${String(b.depart_time || '')}`;
      return da.localeCompare(db);
    })
    .slice(0, 3);
  const showUpcomingSection =
    !!activeRide || upcomingRides.length > 0 || upcomingHosting.length > 0;
  const quests = [
    {
      id: 'email',
      title: 'Verify work email',
      detail: 'Open setup and confirm the code',
      href: '/cleaner-city/setup',
      done: verification?.status === 'verified',
    },
    {
      id: 'office',
      title: 'Pin your office',
      detail: 'Save the office pin on the map',
      href: '/cleaner-city/route',
      done: offices.length > 0,
    },
    {
      id: 'pickup',
      title: 'Pin pickup near home',
      detail: 'Save at least one weekday pickup',
      href: '/cleaner-city/route',
      done: templates.some((t) => t.pickup_latitude != null),
    },
    {
      id: 'times',
      title: 'Set leave and return',
      detail: 'Save the weekly schedule',
      href: '/cleaner-city/schedule',
      done: templates.some((t) => t.is_working && t.depart_time),
    },
    hostRole
      ? {
          id: 'vehicle',
          title: 'Add your vehicle',
          detail: 'Car or bike, then offer seats',
          href: '/cleaner-city/vehicle',
          done: vehicles.length > 0,
        }
      : {
          id: 'find',
          title: 'Find a ride',
          detail: 'Search the society or city marketplace',
          href: '/cleaner-city/find',
          done: rides.length > 0,
        },
    {
      id: 'safety',
      title: 'Verify an emergency contact',
      detail: 'A phone code, or a linked Sociva account',
      href: '/cleaner-city/safety',
      done: contacts.some((c) => c.verified_at),
    },
    {
      id: 'ride',
      title: 'Finish a ride',
      detail: 'Complete one commute together',
      href: activeRide ? `/cleaner-city/ride/${activeRide.id}` : '/cleaner-city/find',
      done: completedRides > 0,
    },
  ];

  const draftPublications = publications.filter((p) => p.status === 'draft');
  const tomorrowPublications = publications.filter(
    (p) => p.travel_date === tomorrow && ['draft', 'published', 'full'].includes(p.status),
  );
  const openWaitlist = waitlist.filter((w) => w.status === 'open');

  const confirmDraft = async (publicationId: string, confirm: boolean) => {
    try {
      await confirmPublication.mutateAsync({ publication_id: publicationId, confirm });
      toast.success(confirm ? 'Seats confirmed and published' : 'Draft skipped');
    } catch (e: any) {
      toast.error(e?.message || 'Could not update draft');
    }
  };

  const repeatCommute = async () => {
    try {
      const result = await repeatLast.mutateAsync();
      if (result?.action === 'booked' && result.ride_id) {
        navigate(`/cleaner-city/ride/${result.ride_id}`, {
          state: { notice: 'Requested the same host for tomorrow. Wait for them to confirm.' },
        });
        return;
      }
      if (result?.action === 'request' && result.publication_id) {
        const ride = await requestRide.mutateAsync({ publication_id: result.publication_id });
        if (ride?.id) {
          navigate(`/cleaner-city/ride/${ride.id}`, {
            state: { notice: 'Requested the same host for tomorrow. Wait for them to confirm.' },
          });
          return;
        }
      }
      if (result?.action === 'draft' && result.publication_id) {
        navigate('/cleaner-city/offer', {
          state: { notice: 'Tomorrow is drafted from your last commute. Confirm the seats when they look right.' },
        });
        return;
      }
      toast.success(
        result?.action === 'exists'
          ? 'Tomorrow already has a commute from you'
          : 'Tomorrow draft created from your last commute',
      );
    } catch (e: any) {
      const message = String(e?.message || '');
      toast.error(
        message.includes('schema cache')
          ? 'Repeat last commute is on the server. Tap the button once more.'
          : message || 'Could not repeat the last commute',
      );
    }
  };

  const markDayWfh = async (date: string) => {
    try {
      await markWfh.mutateAsync(date);
      toast.success('Marked WFH. That day will not publish.');
    } catch (e: any) {
      toast.error(e?.message || 'Could not mark WFH');
    }
  };

  const [settingsOpen, setSettingsOpen] = useState(!ready);
  const incomingHostRequests = rides.filter(
    (r) => r.host_user_id === user?.id && r.status === 'requested',
  );

  return (
    <AppLayout headerTitle="A Cleaner City">
      <CleanerCityGate>
        <div className="p-4 pb-24 space-y-4" data-testid="cleaner-city-hub">
          {arrivalNotice && (
            <div className="rounded-2xl border border-[#A3C9A8]/40 bg-[#A3C9A8]/15 p-4 text-sm text-foreground">
              {arrivalNotice}
            </div>
          )}
          <div className="overflow-hidden rounded-[26px] border border-white/10 bg-[#0D3327] px-4 py-5 text-white">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-extrabold tracking-tight">sociva</p>
                <h1 className="mt-1 text-[24px] font-extrabold leading-tight text-[#A3C9A8]">
                  A Cleaner City
                </h1>
                <p className="mt-2 text-sm font-medium text-white/85">
                  Find a seat or offer one for your office run.
                </p>
              </div>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10">
                <Leaf size={18} className="text-[#A3C9A8]" aria-hidden />
              </span>
            </div>
            {profile && (
              <div
                className={cn(
                  'mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold',
                  profile.autopilot_enabled
                    ? 'bg-[#A3C9A8]/20 text-[#A3C9A8]'
                    : 'bg-white/10 text-white/70',
                )}
                data-testid="cleaner-city-autopilot-chip"
              >
                <Zap size={12} aria-hidden />
                {profile.autopilot_enabled
                  ? `Autopilot on - ${profile.autopilot_confirm_mode === 'auto' ? 'auto publish' : 'confirm each day'}`
                  : 'Autopilot off'}
              </div>
            )}
          </div>

          {incomingHostRequests.length > 0 && (
            <Link
              to="/cleaner-city/find"
              state={{ openHosting: true, notice: 'Seat requests waiting - accept or decline.' }}
              className="block rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4"
              data-testid="cleaner-city-hub-incoming"
            >
              <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">
                {incomingHostRequests.length} seat request
                {incomingHostRequests.length === 1 ? '' : 's'} waiting
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Tap to accept or decline
              </p>
            </Link>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Link
              to={ready ? '/cleaner-city/find' : '/cleaner-city/setup'}
              className={cn(
                'rounded-2xl border-2 border-primary/40 bg-primary/10 p-4 min-h-[120px]',
                !ready && 'opacity-90',
              )}
              data-testid="cleaner-city-find-link"
            >
              <Users size={20} className="text-primary mb-2" aria-hidden />
              <p className="text-base font-extrabold text-foreground">Find a ride</p>
              <p className="text-xs text-muted-foreground mt-1">I need a seat</p>
              <p className="text-[10px] text-muted-foreground mt-3">
                {ready ? 'See neighbours leaving near your time' : 'Verify work email first'}
              </p>
            </Link>
            <Link
              to={ready ? '/cleaner-city/offer' : '/cleaner-city/setup'}
              className={cn(
                'rounded-2xl border-2 border-primary/40 bg-primary/10 p-4 min-h-[120px]',
                !ready && 'opacity-90',
              )}
              data-testid="cleaner-city-offer-link"
            >
              <Car size={20} className="text-primary mb-2" aria-hidden />
              <p className="text-base font-extrabold text-foreground">Offer a ride</p>
              <p className="text-xs text-muted-foreground mt-1">I have an empty seat</p>
              <p className="text-[10px] text-muted-foreground mt-3">
                {ready ? 'Publish seats for today or tomorrow' : 'Verify work email first'}
              </p>
            </Link>
          </div>

          {showUpcomingSection ? (
            <section
              className="space-y-3"
              data-testid="cleaner-city-upcoming-section"
            >
              <div className="flex items-end justify-between gap-2 px-0.5">
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-primary">
                    Your upcoming
                  </p>
                  <p className="text-sm font-semibold text-foreground">
                    {activeRide ? 'Live mission and next rides' : 'Next ride on your board'}
                  </p>
                </div>
              </div>

              {activeRide ? (
                <CleanerCityActiveMissionCard
                  ride={activeRide}
                  myUserId={user?.id}
                  todayIso={today}
                />
              ) : null}

              {upcomingRides.map((ride) => {
                const isHost = ride.host_user_id === user?.id;
                const partner = isHost ? ride.guest_name : ride.host_name;
                return (
                  <Link
                    key={ride.id}
                    to={`/cleaner-city/ride/${ride.id}`}
                    className="block rounded-2xl border border-primary/30 bg-card p-4"
                    data-testid="cleaner-city-upcoming-ride"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-primary">
                          {isHost ? 'Hosting' : 'Riding'} · {dayLabel(String(ride.travel_date || ''), today)}
                        </p>
                        <p className="mt-1 text-sm font-extrabold text-foreground truncate">
                          {partner || 'Neighbour'}
                          {ride.depart_time
                            ? ` · leaves ${String(ride.depart_time).slice(0, 5)}`
                            : ''}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground truncate">
                          {ride.origin_label || 'Pickup'} → {ride.destination_label || 'Drop'}
                        </p>
                        <p className="mt-1 text-[11px] font-semibold text-foreground/80 capitalize">
                          {String(ride.status || '').replace(/_/g, ' ')}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-[10px] font-extrabold text-primary">
                        Open
                      </span>
                    </div>
                  </Link>
                );
              })}

              {upcomingHosting.map((p) => (
                <Link
                  key={p.id}
                  to="/cleaner-city/find"
                  state={{
                    openHosting: true,
                    notice: 'Your seats are live. Accept requests here when neighbours ask.',
                  }}
                  className="relative block overflow-hidden rounded-2xl border border-primary/30 bg-primary/10 p-4"
                  data-testid="cleaner-city-upcoming-hosting"
                >
                  <div className="flex items-start gap-3">
                    <span className="relative mt-1.5 flex h-2.5 w-2.5 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-primary">
                        Seats live · {dayLabel(p.travel_date, today)}
                      </p>
                      <p className="mt-1 text-sm font-extrabold text-foreground">
                        Leave {String(p.depart_time || '').slice(0, 5) || '-'}
                        {p.direction ? ` · ${String(p.direction).replace('_', ' ')}` : ''}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground truncate">
                        {p.origin_label || 'Pickup'} → {p.destination_label || 'Office'}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {p.seats_available != null
                          ? `${p.seats_available} seat${p.seats_available === 1 ? '' : 's'} open`
                          : 'Open hosting to catch requests'}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </section>
          ) : null}

          {!ready && (
            <div
              className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950 space-y-2"
              data-testid="cleaner-city-setup-checklist"
            >
              <p className="text-sm font-semibold">Finish setup to ride</p>
              <ol className="text-xs space-y-1.5 list-decimal pl-4">
                <li className={profile ? 'line-through opacity-60' : ''}>
                  Save commute profile (role + transport)
                </li>
                <li className={verification?.status === 'verified' ? 'line-through opacity-60' : ''}>
                  Verify official work email on an approved company domain
                </li>
                <li>Add office and pickup pins, then schedule</li>
              </ol>
              <Link
                to="/cleaner-city/setup"
                className="inline-flex mt-1 text-sm font-semibold text-primary underline"
              >
                Continue setup
              </Link>
            </div>
          )}

          {!ready && (
            <CommuteJourney
              quests={quests}
              completedRides={completedRides}
              cityOn={!!profile?.open_city_matching}
              badges={badges}
            />
          )}

          {draftPublications.length > 0 && (
            <div
              className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3"
              data-testid="cleaner-city-draft-publications"
            >
              <p className="text-sm font-semibold text-amber-950">
                Autopilot drafted {draftPublications.length} commute
                {draftPublications.length === 1 ? '' : 's'}
              </p>
              <p className="text-xs text-amber-900">
                Confirm to publish seats for neighbours, or skip for that day.
              </p>
              {draftPublications.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-amber-200 bg-white/60 p-3 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-amber-950">
                      {dayLabel(p.travel_date, today)} · {String(p.depart_time || '').slice(0, 5)} ·{' '}
                      {p.direction?.replace('_', ' ')}
                    </p>
                    <p className="text-[11px] text-amber-800 mt-0.5">
                      {p.seats_total} seat{p.seats_total === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      className="rounded-lg border border-amber-300 px-2.5 py-1 text-[11px] font-semibold text-amber-900"
                      onClick={() => confirmDraft(p.id, false)}
                      disabled={confirmPublication.isPending}
                    >
                      Skip
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-amber-300 px-2.5 py-1 text-[11px] font-semibold text-amber-900"
                      onClick={() => markDayWfh(p.travel_date)}
                      disabled={markWfh.isPending}
                      data-testid="cleaner-city-wfh"
                    >
                      WFH
                    </button>
                    <button
                      type="button"
                      className="rounded-lg bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground"
                      onClick={() => confirmDraft(p.id, true)}
                      disabled={confirmPublication.isPending}
                    >
                      Confirm
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {ready && (
            <div className="rounded-2xl border border-border bg-card p-4 space-y-3" data-testid="cleaner-city-tomorrow-card">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Tomorrow</p>
                <button
                  type="button"
                  className="rounded-lg bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground"
                  onClick={repeatCommute}
                  disabled={repeatLast.isPending || requestRide.isPending}
                  data-testid="cleaner-city-repeat-last"
                >
                  Repeat last commute
                </button>
              </div>
              {tomorrowPublications.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {profile?.autopilot_enabled
                    ? profile.autopilot_confirm_mode === 'auto'
                      ? 'Autopilot has not published tomorrow yet.'
                      : 'No tomorrow draft yet. Autopilot creates it in the evening, or repeat your last commute.'
                    : 'Turn on Autopilot or repeat your last commute to put tomorrow on the board.'}
                </p>
              )}
              {tomorrowPublications.map((p) => (
                <p key={p.id} className="text-xs text-muted-foreground" data-testid="cleaner-city-tomorrow-row">
                  Tomorrow · {String(p.depart_time || '').slice(0, 5)} · {p.direction?.replace('_', ' ')} · {p.status}
                  {p.seats_available != null ? ` · ${p.seats_available} seats` : ''}
                </p>
              ))}
              {openWaitlist.length > 0 && (
                <Link
                  to="/cleaner-city/find"
                  className="block text-xs font-semibold text-primary"
                  data-testid="cleaner-city-waitlist-chip"
                >
                  Waitlist · {openWaitlist.length} open {openWaitlist.length === 1 ? 'day' : 'days'} - open Find
                </Link>
              )}
            </div>
          )}

          {ready && (
            <div
              className="rounded-2xl border border-border bg-card p-4"
              data-testid="cleaner-city-impact"
            >
              <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-primary">
                Your impact
              </p>
              <p className="mt-1 text-2xl font-extrabold text-foreground">{completedRides}</p>
              <p className="text-sm font-semibold text-foreground">
                {completedRides === 1 ? 'shared ride finished' : 'shared rides finished'}
              </p>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <button
              type="button"
              className="flex w-full items-center justify-between px-4 py-3 text-left"
              onClick={() => setSettingsOpen((v) => !v)}
              data-testid="cleaner-city-settings-toggle"
            >
              <div>
                <p className="text-sm font-semibold">More commute settings</p>
                <p className="text-[11px] text-muted-foreground">
                  Schedule, pins, vehicle, chat, safety
                </p>
              </div>
              <ChevronDown
                size={16}
                className={cn(
                  'text-muted-foreground transition-transform',
                  settingsOpen && 'rotate-180',
                )}
              />
            </button>
            {settingsOpen && (
              <div className="border-t border-border px-4 py-4 space-y-3">
                <Link
                  to="/cleaner-city/setup"
                  className="flex items-center gap-3 rounded-xl border border-border p-3"
                  data-testid="cleaner-city-setup-link"
                >
                  <ShieldCheck className="text-primary shrink-0" size={18} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {profile ? 'Edit my commute' : 'Set up my commute'}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {verification?.status === 'verified'
                        ? WORK_EMAIL_BADGE
                        : 'Profile + work email'}
                    </p>
                  </div>
                </Link>
                {profile && (
                  <>
                    <Link
                      to="/cleaner-city/schedule"
                      className="flex items-center gap-3 rounded-xl border border-border p-3"
                      data-testid="cleaner-city-schedule-link"
                    >
                      <CalendarClock className="text-primary shrink-0" size={18} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">My commute schedule</p>
                        <p className="text-[11px] text-muted-foreground">
                          {todaySchedule?.is_paused
                            ? 'Paused'
                            : todaySchedule?.is_working
                              ? `Today ${String(todaySchedule.depart_time || '').slice(0, 5) || '-'}`
                              : 'Set leave times'}
                        </p>
                      </div>
                    </Link>
                    <div className="grid grid-cols-2 gap-2">
                      <Link
                        to="/cleaner-city/vehicle"
                        className="rounded-xl border border-border p-3"
                        data-testid="cleaner-city-vehicle-link"
                      >
                        <Car size={16} className="text-primary mb-1.5" aria-hidden />
                        <p className="text-sm font-semibold">My vehicle</p>
                      </Link>
                      <Link
                        to="/cleaner-city/route"
                        className="rounded-xl border border-border p-3"
                        data-testid="cleaner-city-route-link"
                      >
                        <MapPin size={16} className="text-primary mb-1.5" aria-hidden />
                        <p className="text-sm font-semibold">Office and pickup</p>
                      </Link>
                      <Link
                        to="/cleaner-city/circles"
                        className="rounded-xl border border-border p-3"
                        data-testid="cleaner-city-circles-link"
                      >
                        <Users size={16} className="text-primary mb-1.5" aria-hidden />
                        <p className="text-sm font-semibold">Trusted circles</p>
                      </Link>
                      <Link
                        to="/cleaner-city/chat"
                        className="rounded-xl border border-border p-3"
                        data-testid="cleaner-city-chat-link"
                      >
                        <MessageCircle size={16} className="text-primary mb-1.5" aria-hidden />
                        <p className="text-sm font-semibold">Chat</p>
                      </Link>
                      <Link
                        to="/cleaner-city/safety"
                        className="rounded-xl border border-border p-3 col-span-2"
                        data-testid="cleaner-city-safety-link"
                      >
                        <Shield size={16} className="text-primary mb-1.5" aria-hidden />
                        <p className="text-sm font-semibold">Safety</p>
                        <p className="text-[11px] text-muted-foreground">Contacts and blocks</p>
                      </Link>
                    </div>
                  </>
                )}
                {ready && (
                  <CommuteJourney
                    quests={quests}
                    completedRides={completedRides}
                    cityOn={!!profile?.open_city_matching}
                    badges={badges}
                  />
                )}
              </div>
            )}
          </div>

          {activeRide ? (
            <CleanerCityActiveMissionDock ride={activeRide} myUserId={user?.id} />
          ) : null}
        </div>
      </CleanerCityGate>
    </AppLayout>
  );
}
