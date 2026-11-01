// @ts-nocheck
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { CommuteJourney } from '@/components/cleaner-city/CommuteJourney';
import {
  CalendarClock,
  Car,
  Leaf,
  Shield,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react';
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

const ACTIVE_RIDE_STATUSES = ['requested', 'confirmed', 'pickup_pending', 'started'];

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
  const activeRide =
    rides.find((r) => r.travel_date === today && ACTIVE_RIDE_STATUSES.includes(r.status)) ||
    rides.find((r) => ACTIVE_RIDE_STATUSES.includes(r.status)) ||
    null;
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
                <p className="mt-2 text-[11px] font-extrabold uppercase tracking-[0.16em] text-white/80">
                  Commute together. Save more. Breathe better.
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

          <CommuteJourney
            quests={quests}
            completedRides={completedRides}
            cityOn={!!profile?.open_city_matching}
            badges={badges}
          />

          <div
            className="rounded-2xl border border-border bg-card p-4"
            data-testid="cleaner-city-impact"
          >
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-primary">Your impact</p>
            <p className="mt-1 text-2xl font-extrabold text-foreground">{completedRides}</p>
            <p className="text-sm font-semibold text-foreground">
              {completedRides === 1 ? 'shared ride finished' : 'shared rides finished'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Counted only when a ride is completed. A finished ride does not store a measured road distance, so emissions are not estimated.
            </p>
          </div>

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
                <p className="text-xs font-semibold text-primary" data-testid="cleaner-city-waitlist-chip">
                  Waitlist · {openWaitlist.length} open {openWaitlist.length === 1 ? 'day' : 'days'}
                </p>
              )}
            </div>
          )}

          {activeRide && (
            <Link
              to={`/cleaner-city/ride/${activeRide.id}`}
              className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 shadow-card"
              data-testid="cleaner-city-active-ride-link"
            >
              <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Car className="text-primary" size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm text-foreground">
                  {activeRide.travel_date === today ? 'Today' : activeRide.travel_date} - active ride
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Status: {activeRide.status.replace(/_/g, ' ')} ·{' '}
                  {activeRide.host_user_id === user?.id ? 'you are host' : 'you are guest'}
                </p>
              </div>
            </Link>
          )}

          <Link
            to="/cleaner-city/setup"
            className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-card"
            data-testid="cleaner-city-setup-link"
          >
            <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <ShieldCheck className="text-primary" size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm text-foreground">
                {profile ? 'Edit my commute' : 'Set up my commute'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {verification?.status === 'verified'
                  ? WORK_EMAIL_BADGE
                  : 'Profile + official work email verification'}
              </p>
            </div>
          </Link>

          {profile && (
            <Link
              to="/cleaner-city/schedule"
              className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-card"
              data-testid="cleaner-city-schedule-link"
            >
              <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <CalendarClock className="text-primary" size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm text-foreground">My commute schedule</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {todaySchedule?.is_paused
                    ? 'Paused'
                    : todaySchedule?.is_working
                      ? `Today ${String(todaySchedule.depart_time || '').slice(0, 5) || '-'} (${todaySchedule.source})`
                      : 'Today off / not set - edit anytime'}
                </p>
              </div>
            </Link>
          )}

          {profile && (
            <div className="grid grid-cols-2 gap-3">
              <Link
                to="/cleaner-city/vehicle"
                className="rounded-2xl border border-border bg-card p-4"
                data-testid="cleaner-city-vehicle-link"
              >
                <Car size={18} className="text-primary mb-2" aria-hidden />
                <p className="text-sm font-semibold text-foreground">My vehicle</p>
                <p className="text-xs text-muted-foreground mt-1">Car or bike + seats</p>
              </Link>
              <Link
                to="/cleaner-city/route"
                className="rounded-2xl border border-border bg-card p-4"
                data-testid="cleaner-city-route-link"
              >
                <Users size={18} className="text-primary mb-2" aria-hidden />
                <p className="text-sm font-semibold text-foreground">Office & pickup</p>
                <p className="text-xs text-muted-foreground mt-1">Map pins for matching</p>
              </Link>
            </div>
          )}

          {profile && (
            <div className="grid grid-cols-2 gap-3">
              <Link
                to="/cleaner-city/circles"
                className="rounded-2xl border border-border bg-card p-4"
                data-testid="cleaner-city-circles-link"
              >
                <Users size={18} className="text-primary mb-2" aria-hidden />
                <p className="text-sm font-semibold text-foreground">Trusted circles</p>
                <p className="text-xs text-muted-foreground mt-1">Ride with people you know</p>
              </Link>
              <Link
                to="/cleaner-city/chat"
                className="rounded-2xl border border-border bg-card p-4"
                data-testid="cleaner-city-chat-link"
              >
                <Users size={18} className="text-primary mb-2" aria-hidden />
                <p className="text-sm font-semibold text-foreground">Chat</p>
                <p className="text-xs text-muted-foreground mt-1">Rides, circles, and ride partners</p>
              </Link>
              <Link
                to="/cleaner-city/safety"
                className="rounded-2xl border border-border bg-card p-4"
                data-testid="cleaner-city-safety-link"
              >
                <Shield size={18} className="text-primary mb-2" aria-hidden />
                <p className="text-sm font-semibold text-foreground">Safety</p>
                <p className="text-xs text-muted-foreground mt-1">Emergency contacts, blocks</p>
              </Link>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Link
              to={ready ? '/cleaner-city/offer' : '/cleaner-city/setup'}
              className={cn(
                'rounded-2xl border border-border bg-card p-4',
                !ready && 'opacity-80',
              )}
              data-testid="cleaner-city-offer-link"
            >
              <Car size={18} className="text-primary mb-2" aria-hidden />
              <p className="text-sm font-semibold text-foreground">Offer a ride</p>
              <p className="text-xs text-muted-foreground mt-1">I have an empty seat</p>
              <p className="text-[10px] text-muted-foreground mt-3">
                {ready ? 'Publish seats for a date' : 'Verify work email first'}
              </p>
            </Link>
            <Link
              to={ready ? '/cleaner-city/find' : '/cleaner-city/setup'}
              className={cn(
                'rounded-2xl border border-border bg-card p-4',
                !ready && 'opacity-80',
              )}
              data-testid="cleaner-city-find-link"
            >
              <Users size={18} className="text-primary mb-2" aria-hidden />
              <p className="text-sm font-semibold text-foreground">Find a ride</p>
              <p className="text-xs text-muted-foreground mt-1">I need a commute</p>
              <p className="text-[10px] text-muted-foreground mt-3">
                {ready ? 'Match by approximate corridor fit' : 'Verify work email first'}
              </p>
            </Link>
          </div>

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
              <p className="text-[11px] text-amber-900">
                Unverified accounts cannot publish or book rides. Open Set up my commute above to finish.
              </p>
            </div>
          )}
        </div>
      </CleanerCityGate>
    </AppLayout>
  );
}
