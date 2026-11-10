// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { CleanerCityChrome } from '@/components/cleaner-city/CleanerCityChrome';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import {
  CleanerCityActiveMissionCard,
  CleanerCityActiveMissionDock,
} from '@/components/cleaner-city/CleanerCityActiveMissionCard';
import { CleanerCityMatchCard } from '@/components/cleaner-city/CleanerCityMatchCard';
import { CleanerCityEditRideDrawer } from '@/components/cleaner-city/CleanerCityEditRideDrawer';
import { CleanerCityChangeRouteDrawer } from '@/components/cleaner-city/CleanerCityChangeRouteDrawer';
import { cc } from '@/components/cleaner-city/ui/ccTheme';
import { Button } from '@/components/ui/button';
import { ArrowUpDown, Calendar, Clock, Flag, MapPin, Settings2 } from 'lucide-react';
import {
  preferredRouteFromProfile,
  useCancelRide,
  useCleanerCityProfile,
  useCleanerCityWorkVerification,
  useCommuteTemplates,
  useEffectiveSchedule,
  useFindMatches,
  useJoinWaitlist,
  useLeaveWaitlist,
  useMyActiveGuestRide,
  useMyRides,
  useEmergencyContacts,
  useMyWaitlist,
  useOfficeLocations,
  useRequestRide,
  useSuggestReplacements,
  type MatchResult,
} from '@/hooks/queries/useCleanerCity';
import { DEFAULT_COMMUTE_TIMEZONE } from '@/lib/cleaner-city/constants';
import { setCleanerCityIntent } from '@/lib/cleaner-city/intent';
import { rideStatusLabel } from '@/lib/cleaner-city/rideMissionCopy';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

function todayIso(tz = DEFAULT_COMMUTE_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDaysIso(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function nextWorkdayIso(tz = DEFAULT_COMMUTE_TIMEZONE) {
  let d = todayIso(tz);
  for (let i = 0; i < 8; i++) {
    const dow = new Date(`${d}T12:00:00`).getDay();
    if (dow >= 1 && dow <= 5) return d;
    d = addDaysIso(d, 1);
  }
  return todayIso(tz);
}

function weekdayOf(dateIso: string): number {
  return new Date(`${dateIso}T12:00:00`).getDay();
}

const ACTIVE_GUEST = ['requested', 'confirmed', 'pickup_pending', 'started', 'safety_incident'];

export default function CleanerCityFindPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const arrivalState = (location.state as {
    notice?: string;
    travelDate?: string;
    direction?: string;
    departTime?: string;
    openFindGuests?: boolean;
  } | null) || {};

  const { data: profile, isLoading: profileLoading } = useCleanerCityProfile();
  const { data: verification, isLoading: verificationLoading } = useCleanerCityWorkVerification();
  const { data: offices = [], isLoading: officesLoading } = useOfficeLocations();
  const { data: templates = [] } = useCommuteTemplates();
  const { data: rides = [], refetch: refetchRides } = useMyRides();
  const { data: waitlist = [] } = useMyWaitlist();
  const { data: emergencyContacts = [] } = useEmergencyContacts();
  const { data: rpcActiveGuest, refetch: refetchActiveGuest } = useMyActiveGuestRide();
  const findMatches = useFindMatches();
  const requestRide = useRequestRide();
  const cancelRide = useCancelRide();
  const joinWaitlist = useJoinWaitlist();
  const leaveWaitlist = useLeaveWaitlist();
  const suggestReplacements = useSuggestReplacements();
  const hasVerifiedEmergency = emergencyContacts.some((c) => c.verified_at);

  useEffect(() => {
    if (arrivalState.openFindGuests) {
      navigate('/cleaner-city/offer', { replace: true, state: location.state });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (profileLoading || verificationLoading || officesLoading) return;
    if (!profile || verification?.status !== 'verified') {
      navigate('/cleaner-city/setup', { replace: true });
      return;
    }
    const hasOffice = offices.some(
      (o) => typeof o.latitude === 'number' && typeof o.longitude === 'number',
    );
    if (!hasOffice) {
      navigate('/cleaner-city/setup', { replace: true, state: { step: 3 } });
    }
  }, [
    profile,
    verification?.status,
    offices,
    profileLoading,
    verificationLoading,
    officesLoading,
    navigate,
  ]);

  const tz = profile?.timezone || DEFAULT_COMMUTE_TIMEZONE;
  const today = todayIso(tz);
  const [date, setDate] = useState(arrivalState.travelDate || nextWorkdayIso(tz));
  const [direction, setDirection] = useState(
    arrivalState.direction === 'to_home' ? 'to_home' : 'to_office',
  );
  const [departTime, setDepartTime] = useState(
    String(arrivalState.departTime || '08:30').slice(0, 5),
  );
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const commuteMatches = useMemo(
    () => matches.filter((m) => (m.trip_kind || 'commute') !== 'extra'),
    [matches],
  );
  const extraMatches = useMemo(
    () => matches.filter((m) => m.trip_kind === 'extra'),
    [matches],
  );
  const [hasSearched, setHasSearched] = useState(false);
  const [requestingPubId, setRequestingPubId] = useState<string | null>(null);
  const [editRideOpen, setEditRideOpen] = useState(false);
  const [changeRouteOpen, setChangeRouteOpen] = useState(false);
  const [changeRouteDir, setChangeRouteDir] = useState<'to_office' | 'to_home'>('to_office');
  const [alternatives, setAlternatives] = useState<MatchResult[]>([]);

  const { data: schedule } = useEffectiveSchedule(date);
  const ready = !!profile && verification?.status === 'verified' && !profile.is_paused;
  const office = offices.find((o) => o.is_primary) || offices[0] || null;
  const weekday = weekdayOf(date);
  const weekdayTemplate = templates.find((t) => t.weekday === weekday) || null;
  const pickupLat = schedule?.pickup_latitude ?? weekdayTemplate?.pickup_latitude ?? null;
  const pickupLng = schedule?.pickup_longitude ?? weekdayTemplate?.pickup_longitude ?? null;
  const hasPickup = pickupLat != null && pickupLng != null;

  const guestCoords = useMemo(() => {
    const officeLat = office?.latitude ?? null;
    const officeLng = office?.longitude ?? null;
    if (direction === 'to_home') {
      return {
        pickup_lat: officeLat,
        pickup_lng: officeLng,
        dest_lat: pickupLat,
        dest_lng: pickupLng,
      };
    }
    return {
      pickup_lat: pickupLat,
      pickup_lng: pickupLng,
      dest_lat: officeLat,
      dest_lng: officeLng,
    };
  }, [direction, office?.latitude, office?.longitude, pickupLat, pickupLng]);

  const search = async () => {
    if (!ready) {
      navigate('/cleaner-city/setup', {
        state: { notice: 'Verify your work email before searching for a ride.' },
      });
      return;
    }
    if (!hasPickup) {
      navigate('/cleaner-city/route', {
        state: { notice: 'Pin a pickup near home before searching.' },
      });
      return;
    }
    try {
      setCleanerCityIntent('guest');
      const res = await findMatches.mutateAsync({
        date,
        direction,
        depart_time: departTime,
        guest_pickup_lat: guestCoords.pickup_lat,
        guest_pickup_lng: guestCoords.pickup_lng,
        guest_dest_lat: guestCoords.dest_lat,
        guest_dest_lng: guestCoords.dest_lng,
      });
      setMatches(res.matches || []);
      setHasSearched(true);
    } catch {
      toast.error('Could not find rides. Please try again.');
    }
  };

  useEffect(() => {
    if (ready && hasPickup) void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hasPickup, date, direction, departTime]);

  const guestRides = rides.filter(
    (r) => r.guest_user_id === user?.id && ACTIVE_GUEST.includes(r.status),
  );
  const activeGuestRide = useMemo(() => {
    const fromList =
      guestRides.find(
        (r) =>
          r.travel_date === date && (!r.direction || r.direction === direction),
      ) ||
      guestRides.find((r) => r.travel_date === date) ||
      guestRides[0] ||
      null;
    if (fromList?.id) return fromList;
    if (rpcActiveGuest?.id) {
      return rides.find((r) => r.id === rpcActiveGuest.id) || rpcActiveGuest;
    }
    return null;
  }, [guestRides, date, direction, rpcActiveGuest, rides]);

  const myWaitlistEntry = waitlist.find(
    (w) => (w.travel_date || w.date) === date && w.direction === direction,
  );

  const requestSeat = async (publicationId: string) => {
    setRequestingPubId(publicationId);
    try {
      const ride = await requestRide.mutateAsync({
        publication_id: publicationId,
        guest_pickup_lat: guestCoords.pickup_lat,
        guest_pickup_lng: guestCoords.pickup_lng,
        guest_dest_lat: guestCoords.dest_lat,
        guest_dest_lng: guestCoords.dest_lng,
      });
      toast.success('Seat requested');
      if (ride?.id) {
        navigate(`/cleaner-city/ride/${ride.id}`, { state: { seededRide: ride } });
      } else {
        void refetchRides();
      }
    } catch (e: any) {
      toast.error(e?.message || 'Could not request seat');
    } finally {
      setRequestingPubId(null);
    }
  };

  const joinTheWaitlist = async () => {
    try {
      await joinWaitlist.mutateAsync({
        date,
        direction,
        depart_time: departTime,
        pickup_lat: guestCoords.pickup_lat,
        pickup_lng: guestCoords.pickup_lng,
        dest_lat: guestCoords.dest_lat,
        dest_lng: guestCoords.dest_lng,
      });
      toast.success('Joined waitlist');
    } catch (e: any) {
      toast.error(e?.message || 'Could not join waitlist');
    }
  };

  const leaveTheWaitlist = async () => {
    try {
      await leaveWaitlist.mutateAsync({
        date,
        direction,
      });
      toast.success('Left waitlist');
    } catch (e: any) {
      toast.error(e?.message || 'Could not leave waitlist');
    }
  };

  const pickupLabel =
    direction === 'to_home'
      ? office?.label || 'Office'
      : weekdayTemplate?.pickup_label || 'Home';
  const dropLabel =
    direction === 'to_home'
      ? weekdayTemplate?.pickup_label || 'Home'
      : office?.label || 'Office';

  return (
    <CleanerCityChrome headerTitle="Find" className={cc.bg}>
      <CleanerCityGate>
        <div
          className={cn(cc.page, activeGuestRide ? 'pb-36' : 'pb-28')}
          data-testid="cleaner-city-find-page"
        >
          <header className="text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0F3D2E]">
              Sociva Cleaner City
            </p>
          </header>

          {arrivalState.notice ? (
            <div className={cn(cc.card, 'px-4 py-3 text-sm')}>{arrivalState.notice}</div>
          ) : null}

          {activeGuestRide ? (
            <div
              id="cleaner-city-active-ride-banner"
              className="space-y-2"
              data-testid="cleaner-city-find-active-ride"
            >
              <CleanerCityActiveMissionCard
                ride={activeGuestRide}
                myUserId={user?.id}
                todayIso={today}
              />
              <Button
                className={cn(cc.primaryBtn, 'w-full')}
                data-testid="cleaner-city-open-active-ride"
                onClick={() =>
                  navigate(`/cleaner-city/ride/${activeGuestRide.id}`, {
                    state: { seededRide: activeGuestRide },
                  })
                }
              >
                {['confirmed', 'pickup_pending'].includes(activeGuestRide.status)
                  ? 'Open ride for pickup code'
                  : 'Open ride'}
              </Button>
            </div>
          ) : null}

          <section
            className={cn(cc.card, 'space-y-3 p-4')}
            data-testid="cleaner-city-find-filters"
            id="cleaner-city-find-filters"
          >
            <div>
              <h1 className="text-[18px] font-bold tracking-tight text-[#0F3D2E]">
                FIND A SEAT
              </h1>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Share rides. Save fuel. Clean our city.
              </p>
            </div>
            <div className="relative space-y-2">
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl border border-black/5 bg-[#F7F5F1] px-3 py-2.5 text-left"
                onClick={() => {
                  setChangeRouteDir(direction === 'to_home' ? 'to_home' : 'to_office');
                  setChangeRouteOpen(true);
                }}
              >
                <MapPin className="h-4 w-4 text-[#0F3D2E]" />
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground">Pickup</p>
                  <p className="truncate text-[14px] font-semibold">{pickupLabel}</p>
                </div>
              </button>
              <div className="pointer-events-none absolute left-1/2 top-1/2 z-[1] -translate-x-1/2 -translate-y-1/2">
                <button
                  type="button"
                  className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border border-[#0F3D2E]/20 bg-white text-[#0F3D2E] shadow-sm active:scale-95"
                  aria-label="Switch pickup and destination"
                  data-testid="cleaner-city-find-swap-direction"
                  onClick={() => {
                    setDirection((d) => (d === 'to_home' ? 'to_office' : 'to_home'));
                  }}
                >
                  <ArrowUpDown className="h-4 w-4" />
                </button>
              </div>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl border border-black/5 bg-[#F7F5F1] px-3 py-2.5 text-left"
                onClick={() => {
                  setChangeRouteDir(direction === 'to_home' ? 'to_home' : 'to_office');
                  setChangeRouteOpen(true);
                }}
              >
                <Flag className="h-4 w-4 text-[#0F3D2E]" />
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground">Destination</p>
                  <p className="truncate text-[14px] font-semibold">{dropLabel}</p>
                </div>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="flex items-center gap-2 rounded-xl border border-black/5 bg-[#F7F5F1] px-3 py-2.5 text-left"
                onClick={() => setEditRideOpen(true)}
                data-testid="cleaner-city-find-change-time"
              >
                <Calendar className="h-4 w-4 text-[#0F3D2E]" />
                <div>
                  <p className="text-[11px] text-muted-foreground">Date</p>
                  <p className="text-[13px] font-semibold">
                    {date === today ? 'Today' : 'Tomorrow'}
                  </p>
                </div>
              </button>
              <button
                type="button"
                className="flex items-center gap-2 rounded-xl border border-black/5 bg-[#F7F5F1] px-3 py-2.5 text-left"
                onClick={() => setEditRideOpen(true)}
              >
                <Clock className="h-4 w-4 text-[#0F3D2E]" />
                <div>
                  <p className="text-[11px] text-muted-foreground">Time</p>
                  <p className="text-[13px] font-semibold">{departTime}</p>
                </div>
              </button>
            </div>
            <p
              className="truncate text-[11px] text-muted-foreground"
              data-testid="cleaner-city-find-usual-route"
            >
              {preferredRouteFromProfile(
                profile,
                direction === 'to_home' ? 'to_home' : 'to_office',
              )?.summary || 'Usual road'}
            </p>
            <button
              type="button"
              className={cn(cc.secondaryBtn, 'w-full text-[13px]')}
              onClick={() => void search()}
              disabled={findMatches.isPending}
              data-testid="cleaner-city-find-search"
            >
              <Settings2 className="h-4 w-4" />
              {findMatches.isPending ? 'Searching…' : 'Refine search'}
            </button>
          </section>

          <div className="flex flex-wrap gap-2">
            <span className={cc.pillActive}>Society neighbours</span>
          </div>
          <p className="sr-only">Corridor labels only until a ride is confirmed</p>

          {ready && !hasVerifiedEmergency ? (
            <p className="px-0.5 text-[12px] text-muted-foreground">
              Tip: add an emergency contact anytime in You → Safety
            </p>
          ) : null}

          {!ready ? (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-50/80 p-4 text-sm">
              Complete{' '}
              <Link to="/cleaner-city/setup" className="font-semibold underline">
                setup and work email
              </Link>{' '}
              to discover rides.
            </div>
          ) : null}

          {ready && !hasPickup ? (
            <div
              className="rounded-2xl border border-amber-500/30 bg-amber-50/80 p-4 text-sm"
              data-testid="cleaner-city-find-missing-pickup"
            >
              Set your commute pins and usual roads first.{' '}
              <Link to="/cleaner-city/route" className="font-semibold underline">
                Set your route
              </Link>{' '}
              before searching.
            </div>
          ) : null}

          {guestRides.length > 0 ? (
            <section
              id="cleaner-city-seat-requests"
              className="space-y-3 rounded-2xl border border-border bg-card p-4"
              data-testid="cleaner-city-seat-requests"
            >
              <p className="text-[15px] font-semibold">Your seat requests</p>
              {guestRides.map((r) => (
                <div key={r.id} className="rounded-xl border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        to={`/cleaner-city/ride/${r.id}`}
                        className="text-sm font-semibold hover:text-emerald-800"
                      >
                        {r.host_name || 'Host'} · {rideStatusLabel(r.status)}
                      </Link>
                      <p className="text-[12px] text-muted-foreground">
                        {[r.travel_date, r.depart_time ? String(r.depart_time).slice(0, 5) : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      className="rounded-xl bg-emerald-800 text-white hover:bg-emerald-900"
                      onClick={() =>
                        navigate(`/cleaner-city/ride/${r.id}`, { state: { seededRide: r } })
                      }
                    >
                      Open
                    </Button>
                  </div>
                  {['requested', 'confirmed', 'pickup_pending'].includes(r.status) ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full"
                      onClick={async () => {
                        try {
                          await cancelRide.mutateAsync({ ride_id: r.id });
                          toast.success('Cancelled');
                          try {
                            const res = await suggestReplacements.mutateAsync(r.id);
                            setAlternatives(res.alternatives || []);
                          } catch {
                            // courtesy
                          }
                          void refetchRides();
                          void refetchActiveGuest();
                          void search();
                        } catch {
                          toast.error('Something went wrong. Please try again.');
                        }
                      }}
                    >
                      Cancel seat
                    </Button>
                  ) : null}
                </div>
              ))}
            </section>
          ) : null}

          <section
            className="space-y-3"
            id="cleaner-city-match-results"
            data-testid="cleaner-city-match-results"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[14px] font-semibold">
                {hasSearched
                  ? `${commuteMatches.length} commute ride${commuteMatches.length === 1 ? '' : 's'}`
                  : 'Available rides'}
              </p>
              {findMatches.isPending ? (
                <span className="text-[12px] text-muted-foreground">Updating…</span>
              ) : (
                <span className="text-[12px] text-muted-foreground">Near your route</span>
              )}
            </div>

            {commuteMatches.map((m) => (
              <CleanerCityMatchCard
                key={m.publication_id}
                match={m}
                requesting={requestingPubId === m.publication_id}
                locked={!!activeGuestRide}
                onOpenDetails={() =>
                  navigate('/cleaner-city/match', {
                    state: {
                      match: m,
                      publicationId: m.publication_id,
                      guestPickup:
                        pickupLat != null && pickupLng != null
                          ? { lat: Number(pickupLat), lng: Number(pickupLng) }
                          : undefined,
                      guestDest:
                        office?.latitude != null && office?.longitude != null
                          ? {
                              lat: Number(office.latitude),
                              lng: Number(office.longitude),
                            }
                          : undefined,
                    },
                  })
                }
                onRequest={() => {
                  if (activeGuestRide) {
                    toast.message('You already have a ride', {
                      description: 'Open it, or cancel that seat first.',
                    });
                    return;
                  }
                  void requestSeat(m.publication_id);
                }}
              />
            ))}

            {extraMatches.length > 0 ? (
              <div className="space-y-3 pt-2" data-testid="cleaner-city-extra-matches">
                <p className="text-[14px] font-semibold">
                  Extra trips · {extraMatches.length}
                </p>
                <p className="text-[12px] text-muted-foreground">
                  Hosts going somewhere else, not their usual office commute.
                </p>
                {extraMatches.map((m) => (
                  <CleanerCityMatchCard
                    key={m.publication_id}
                    match={m}
                    requesting={requestingPubId === m.publication_id}
                    locked={!!activeGuestRide}
                    onOpenDetails={() =>
                      navigate('/cleaner-city/match', {
                        state: {
                          match: m,
                          publicationId: m.publication_id,
                          guestPickup:
                            guestCoords.pickup_lat != null && guestCoords.pickup_lng != null
                              ? {
                                  lat: Number(guestCoords.pickup_lat),
                                  lng: Number(guestCoords.pickup_lng),
                                }
                              : undefined,
                          guestDest:
                            guestCoords.dest_lat != null && guestCoords.dest_lng != null
                              ? {
                                  lat: Number(guestCoords.dest_lat),
                                  lng: Number(guestCoords.dest_lng),
                                }
                              : undefined,
                        },
                      })
                    }
                    onRequest={() => {
                      if (activeGuestRide) {
                        toast.message('You already have a ride', {
                          description: 'Open it, or cancel that seat first.',
                        });
                        return;
                      }
                      void requestSeat(m.publication_id);
                    }}
                  />
                ))}
              </div>
            ) : null}

            {!findMatches.isPending && hasSearched && matches.length === 0 ? (
              <div
                className="space-y-3 rounded-2xl border border-border bg-card p-5 text-center"
                data-testid="cleaner-city-find-empty"
              >
                <p className="text-[15px] font-semibold">No rides on this road yet</p>
                <p className="sr-only">No hosts on this leg yet</p>
                <p className="sr-only">No neighbour seats for this slot yet</p>
                <p className="text-[13px] text-muted-foreground">
                  Try another leave time, join the waitlist, or offer a seat yourself.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    className={cn(cc.secondaryBtn, 'px-4')}
                    onClick={() => setEditRideOpen(true)}
                  >
                    Change time
                  </button>
                  <button
                    type="button"
                    className={cn(cc.primaryBtn, 'px-4')}
                    data-testid="cleaner-city-offer-link"
                    onClick={() => navigate('/cleaner-city/offer')}
                  >
                    Offer a seat
                  </button>
                </div>
                {hasPickup ? (
                  myWaitlistEntry ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={leaveTheWaitlist}
                      disabled={leaveWaitlist.isPending}
                      data-testid="cleaner-city-leave-waitlist"
                    >
                      Leave waitlist
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={joinTheWaitlist}
                      disabled={joinWaitlist.isPending}
                      data-testid="cleaner-city-join-waitlist"
                    >
                      Join waitlist
                    </Button>
                  )
                ) : null}
              </div>
            ) : null}
          </section>

          {alternatives.length > 0 ? (
            <section
              className="space-y-2 rounded-2xl border border-emerald-800/20 bg-emerald-50/50 p-4"
              data-testid="cleaner-city-cancel-alternatives"
            >
              <p className="text-[15px] font-semibold">Other rides nearby</p>
              {alternatives.map((m) => (
                <div
                  key={m.publication_id}
                  className="rounded-xl border border-border bg-card p-3"
                >
                  <p className="text-sm font-semibold">
                    {String(m.depart_time).slice(0, 5)} · {m.origin_label} to {m.destination_label}
                  </p>
                  <Button
                    className="mt-2 w-full rounded-xl bg-emerald-800 text-white hover:bg-emerald-900"
                    size="sm"
                    onClick={() => {
                      void requestSeat(m.publication_id);
                      setAlternatives([]);
                    }}
                  >
                    Request seat
                  </Button>
                </div>
              ))}
            </section>
          ) : null}

          {activeGuestRide ? (
            <CleanerCityActiveMissionDock ride={activeGuestRide} myUserId={user?.id} />
          ) : null}

          <CleanerCityEditRideDrawer
            open={editRideOpen}
            onOpenChange={setEditRideOpen}
            date={date}
            direction={direction === 'to_home' ? 'to_home' : 'to_office'}
            homeLabel={weekdayTemplate?.pickup_label || 'Home'}
            officeLabel={office?.label || 'Office'}
            departTime={String(schedule?.depart_time || departTime || '08:30').slice(0, 5)}
            returnTime={String(schedule?.return_time || '18:30').slice(0, 5)}
            isWorking={!!schedule?.is_working && !schedule?.is_paused}
            note={schedule?.note}
            title="Change time"
            onConfirmed={({ direction: nextDir, leaveTime }) => {
              setDirection(nextDir);
              setDepartTime(leaveTime);
            }}
            onRequestChangeRoute={(dir) => {
              setEditRideOpen(false);
              setChangeRouteDir(dir);
              setChangeRouteOpen(true);
            }}
          />

          <CleanerCityChangeRouteDrawer
            open={changeRouteOpen}
            onOpenChange={setChangeRouteOpen}
            date={date}
            direction={changeRouteDir}
            home={
              pickupLat != null && pickupLng != null
                ? {
                    lat: Number(pickupLat),
                    lng: Number(pickupLng),
                    label: weekdayTemplate?.pickup_label || 'Home',
                  }
                : null
            }
            office={
              office?.latitude != null && office?.longitude != null
                ? {
                    lat: Number(office.latitude),
                    lng: Number(office.longitude),
                    label: office.label || 'Office',
                  }
                : null
            }
            homeLabel={weekdayTemplate?.pickup_label || 'Home'}
            officeLabel={office?.label || 'Office'}
            ensureIfGoing={false}
          />
        </div>
      </CleanerCityGate>
    </CleanerCityChrome>
  );
}
