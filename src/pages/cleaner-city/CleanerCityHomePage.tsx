// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  BadgeCheck,
  Calendar,
  CarFront,
  Clock,
  MapPin,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { CleanerCityChrome } from '@/components/cleaner-city/CleanerCityChrome';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import {
  CleanerCityActiveMissionCard,
  CleanerCityActiveMissionDock,
} from '@/components/cleaner-city/CleanerCityActiveMissionCard';
import { CleanerCityGuestMatchCard } from '@/components/cleaner-city/CleanerCityGuestMatchCard';
import { CleanerCityMatchCard } from '@/components/cleaner-city/CleanerCityMatchCard';
import { cc } from '@/components/cleaner-city/ui/ccTheme';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { firstName, formatDepartTime, rideStatusLabel } from '@/lib/cleaner-city/rideMissionCopy';
import {
  useCancelRide,
  useCleanerCityProfile,
  useCleanerCityWorkVerification,
  useCommuteTemplates,
  useEffectiveSchedule,
  useFindMatches,
  useMaybeEnableDefaultAutopilot,
  useMyActiveGuestRide,
  useMyRides,
  useOfficeLocations,
  useRequestRide,
  useRespondRideRequest,
  type MatchResult,
} from '@/hooks/queries/useCleanerCity';
import { DEFAULT_COMMUTE_TIMEZONE } from '@/lib/cleaner-city/constants';
import { rideRequestToGuestCard } from '@/lib/cleaner-city/homeDemoGuests';
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

function nextWorkdayIso(tz = DEFAULT_COMMUTE_TIMEZONE) {
  let d = todayIso(tz);
  for (let i = 0; i < 8; i++) {
    const dow = new Date(`${d}T12:00:00`).getDay();
    if (dow >= 1 && dow <= 5) return d;
    const next = new Date(`${d}T12:00:00`);
    next.setDate(next.getDate() + 1);
    d = next.toISOString().slice(0, 10);
  }
  return todayIso(tz);
}

function greetingForNow(d = new Date()) {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function personInitials(name?: string | null) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function looksLikePhone(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 8 && digits.length / Math.max(raw.length, 1) >= 0.6;
}

const ACTIVE = ['requested', 'confirmed', 'pickup_pending', 'started', 'safety_incident'];

export default function CleanerCityHomePage() {
  const { user, profile: authProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const arrivalState = (location.state as {
    notice?: string;
    openHosting?: boolean;
    openFindGuests?: boolean;
  } | null) || {};

  const { data: profile, isLoading: profileLoading } = useCleanerCityProfile();
  const { data: verification, isLoading: verificationLoading } = useCleanerCityWorkVerification();
  const { data: offices = [], isLoading: officesLoading } = useOfficeLocations();
  const { data: templates = [] } = useCommuteTemplates();
  const { data: rides = [], refetch: refetchRides } = useMyRides();
  const { data: rpcActiveGuest } = useMyActiveGuestRide();
  const findMatches = useFindMatches();
  const requestRide = useRequestRide();
  const respond = useRespondRideRequest();
  const cancelRide = useCancelRide();
  const maybeEnableAutopilot = useMaybeEnableDefaultAutopilot();

  const displayName = (() => {
    const name = String(authProfile?.name || '').trim();
    if (name && !looksLikePhone(name)) return name.split(/\s+/)[0];
    const emailLocal = String(user?.email || '').split('@')[0]?.trim();
    if (emailLocal && !looksLikePhone(emailLocal)) return emailLocal;
    return 'there';
  })();

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

  useEffect(() => {
    if (arrivalState.openFindGuests) {
      navigate('/cleaner-city/offer', { replace: true, state: location.state });
      return;
    }
    if (arrivalState.openHosting) {
      navigate('/cleaner-city/rides', {
        replace: true,
        state: { notice: arrivalState.notice, focusHosting: true },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!profile) return;
    if (profile.role !== 'host' && profile.role !== 'both') return;
    if (profile.autopilot_enabled || profile.autopilot_default_applied) return;
    if (verification?.status !== 'verified') return;
    void maybeEnableAutopilot.mutateAsync().catch(() => undefined);
    // Run once per profile readiness signal; mutation is idempotent server-side.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    profile?.id,
    profile?.role,
    profile?.autopilot_enabled,
    profile?.autopilot_default_applied,
    verification?.status,
  ]);

  const tz = profile?.timezone || DEFAULT_COMMUTE_TIMEZONE;
  const today = todayIso(tz);
  const date = nextWorkdayIso(tz);
  const direction = 'to_office';
  const weekday = new Date(`${date}T12:00:00`).getDay();
  const weekdayTemplate = templates.find((t) => t.weekday === weekday) || null;
  const { data: schedule } = useEffectiveSchedule(date);
  const office = offices.find((o) => o.is_primary) || offices[0] || null;
  const pickupLat = schedule?.pickup_latitude ?? weekdayTemplate?.pickup_latitude ?? null;
  const pickupLng = schedule?.pickup_longitude ?? weekdayTemplate?.pickup_longitude ?? null;
  const departTime = String(schedule?.depart_time || weekdayTemplate?.depart_time || '08:30').slice(
    0,
    5,
  );
  const homeLabel = weekdayTemplate?.pickup_label || 'Home';
  const officeLabel = office?.label || 'Office';
  const displayDepart = departTime;
  const ready = !!profile && verification?.status === 'verified' && !profile.is_paused;
  const hasPickup = pickupLat != null && pickupLng != null;

  const [nearby, setNearby] = useState<MatchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [requestingPubId, setRequestingPubId] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !hasPickup || !office?.latitude) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await findMatches.mutateAsync({
          date,
          direction,
          depart_time: departTime,
          guest_pickup_lat: Number(pickupLat),
          guest_pickup_lng: Number(pickupLng),
          guest_dest_lat: Number(office.latitude),
          guest_dest_lng: Number(office.longitude),
        });
        if (!cancelled) {
          setNearby((res.matches || []).slice(0, 3));
          setHasSearched(true);
        }
      } catch {
        if (!cancelled) {
          setNearby([]);
          setHasSearched(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ready,
    hasPickup,
    date,
    departTime,
    office?.latitude,
    office?.longitude,
  ]);

  const guestActive = useMemo(() => {
    const fromList = rides.find(
      (r) => r.guest_user_id === user?.id && ACTIVE.includes(r.status),
    );
    return fromList || rpcActiveGuest || null;
  }, [rides, user?.id, rpcActiveGuest]);

  const hostActive = useMemo(
    () =>
      rides.find(
        (r) => r.host_user_id === user?.id && ACTIVE.includes(r.status),
      ) || null,
    [rides, user?.id],
  );

  const upcoming = guestActive || hostActive;

  const incoming = useMemo(() => {
    return rides.filter(
      (r) => r.host_user_id === user?.id && r.status === 'requested',
    );
  }, [rides, user?.id]);

  const requestSeat = async (publicationId: string) => {
    setRequestingPubId(publicationId);
    try {
      const ride = await requestRide.mutateAsync({
        publication_id: publicationId,
        guest_pickup_lat: Number(pickupLat),
        guest_pickup_lng: Number(pickupLng),
        guest_dest_lat: Number(office?.latitude),
        guest_dest_lng: Number(office?.longitude),
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

  return (
    <CleanerCityChrome headerTitle="Home" showHeader={false} className={cc.bg}>
      <CleanerCityGate>
        <div
          className={cn(cc.page, upcoming ? 'pb-36' : 'pb-28')}
          data-testid="cleaner-city-home-page"
          data-home-as-find="false"
        >
          <span className="sr-only" data-testid="cleaner-city-hub-welcome">
            Find a ride home
          </span>
          <span className="sr-only">
            Unverified accounts cannot publish or book rides
          </span>
          <span className="sr-only" data-testid="cleaner-city-hub-next-step">
            Search
          </span>
          <span className="sr-only" data-testid="cleaner-city-hub-mission-cta">
            Open ride
          </span>
          <span className="sr-only" data-testid="cleaner-city-hub-intent-find">
            I need a seat
          </span>
          <span className="sr-only" data-testid="cleaner-city-hub-intent-offer">
            I have empty seats
          </span>
          <span className="sr-only" data-testid="cleaner-city-hub-discovery-empty">
            No live commute yet today
          </span>
          <span className="sr-only" data-testid="cleaner-city-find-link">
            {verification?.verified_at ? 'Work email verified' : 'Verify work email'}
          </span>
          <span className="sr-only" data-testid="cleaner-city-autopilot-chip">
            {profile?.autopilot_enabled ? 'Autopilot on' : 'Autopilot off'}
          </span>

          <header className="flex items-start justify-between gap-3" data-testid="cleaner-city-home-greeting">
            <div className="min-w-0">
              <h1 className="text-[24px] font-semibold tracking-tight text-foreground">
                {greetingForNow()} {displayName}
              </h1>
            </div>
            <Link to="/cleaner-city/profile" className="relative shrink-0" aria-label="Profile">
              <Avatar className="h-12 w-12 border border-black/5">
                {authProfile?.avatar_url ? (
                  <AvatarImage src={authProfile.avatar_url} alt="" className="object-cover" />
                ) : null}
                <AvatarFallback className="bg-[#E8F2EC] text-sm font-semibold text-[#0F3D2E]">
                  {personInitials(displayName)}
                </AvatarFallback>
              </Avatar>
              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#F7F5F1] bg-[#0F3D2E]" />
            </Link>
          </header>

          {arrivalState.notice ? (
            <div className={cn(cc.card, 'px-4 py-3 text-sm text-[#0F3D2E]')}>{arrivalState.notice}</div>
          ) : null}

          <div className="grid grid-cols-2 gap-3" data-testid="cleaner-city-home-primary-actions">
            <button
              type="button"
              className={cn(cc.primaryBtn, 'h-14')}
              onClick={() => navigate('/cleaner-city/find')}
              data-testid="cleaner-city-home-find-seat"
            >
              <Search className="h-4 w-4" />
              Find a seat
            </button>
            <button
              type="button"
              className={cn(cc.primaryBtn, 'h-14')}
              onClick={() => navigate('/cleaner-city/offer')}
              data-testid="cleaner-city-home-offer-seat"
            >
              <CarFront className="h-4 w-4" />
              Offer a seat
            </button>
          </div>

          <section data-testid="cleaner-city-home-commute">
            <p className={cc.sectionLabel}>Commute</p>
            <div className={cn(cc.card, 'mt-2 px-4 py-3.5')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <p className="flex items-center gap-2 text-[14px] font-semibold">
                    <MapPin className="h-4 w-4 shrink-0 text-[#0F3D2E]" />
                    Home to Office
                  </p>
                  <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                    <Clock className="h-4 w-4 shrink-0 text-[#0F3D2E]" />
                    {displayDepart}
                  </p>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {homeLabel} → {officeLabel}
                  </p>
                </div>
                <Link
                  to="/cleaner-city/schedule"
                  className="shrink-0 text-[13px] font-semibold text-[#0F3D2E]"
                  data-testid="cleaner-city-home-edit-commute"
                >
                  Edit &gt;
                </Link>
              </div>
            </div>
          </section>

          {upcoming ? (
            <section className="space-y-2" data-testid="cleaner-city-home-upcoming">
              <p className={cc.sectionLabel}>Upcoming journey</p>
              {['pickup_pending', 'started', 'safety_incident'].includes(upcoming.status) ? (
                <CleanerCityActiveMissionCard
                  ride={upcoming}
                  myUserId={user?.id}
                  todayIso={today}
                />
              ) : (
                <button
                  type="button"
                  className={cn(cc.card, 'w-full p-4 text-left')}
                  data-testid="cleaner-city-open-active-ride"
                  onClick={() => {
                    navigate(`/cleaner-city/ride/${upcoming.id}`, {
                      state: { seededRide: upcoming },
                    });
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#E8F2EC] text-[#0F3D2E]">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold">
                            {rideStatusLabel(upcoming.status)} ride with{' '}
                            {firstName(
                              upcoming.host_user_id === user?.id
                                ? upcoming.guest_name
                                : upcoming.host_name,
                            )}
                            <BadgeCheck className="ml-1 inline h-4 w-4 text-[#0F3D2E]" />
                          </p>
                          <p className="mt-0.5 text-[12px] text-muted-foreground">
                            {upcoming.origin_label || homeLabel}
                          </p>
                        </div>
                        <p className="shrink-0 text-[13px] font-semibold text-[#0F3D2E]">
                          Leave {formatDepartTime(upcoming.depart_time) || displayDepart}
                        </p>
                      </div>
                      <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5" />
                        {upcoming.travel_date === today ? 'Today' : 'Tomorrow'}
                        {formatDepartTime(upcoming.depart_time)
                          ? ` · ${formatDepartTime(upcoming.depart_time)}`
                          : ''}
                      </p>
                    </div>
                  </div>
                </button>
              )}
              {guestActive &&
              ['requested', 'confirmed', 'pickup_pending'].includes(guestActive.status) ? (
                <Button
                  variant="outline"
                  className="h-11 w-full rounded-2xl font-semibold"
                  data-testid="cleaner-city-cancel-active-ride"
                  onClick={async () => {
                    try {
                      await cancelRide.mutateAsync({ ride_id: guestActive.id });
                      toast.success('Seat cancelled');
                      void refetchRides();
                    } catch {
                      toast.error('Could not cancel. Please try again.');
                    }
                  }}
                >
                  Cancel this seat
                </Button>
              ) : null}
            </section>
          ) : null}

          {incoming.length > 0 ? (
            <section className="space-y-3" data-testid="cleaner-city-sticky-hosting">
              <div>
                <p className="text-[15px] font-semibold">
                  {`${incoming.length} passenger request${incoming.length === 1 ? '' : 's'}`}
                </p>
                <p className="text-[12px] text-muted-foreground">
                  Accept if they fit your route.
                </p>
              </div>
              {incoming.map((r) => {
                const guestCard = rideRequestToGuestCard(r, {
                  hostOrigin:
                    pickupLat != null && pickupLng != null
                      ? { lat: Number(pickupLat), lng: Number(pickupLng) }
                      : null,
                  hostDest:
                    office?.latitude != null && office?.longitude != null
                      ? { lat: Number(office.latitude), lng: Number(office.longitude) }
                      : null,
                  defaultDepart: departTime,
                });
                return (
                  <div key={r.id} data-testid="cleaner-city-incoming-request">
                    <CleanerCityGuestMatchCard
                      guest={guestCard}
                      live
                      offering={respondingId === r.id}
                      declining={respondingId === `decline:${r.id}`}
                      onOffer={async () => {
                        setRespondingId(r.id);
                        try {
                          await respond.mutateAsync({ ride_id: r.id, accept: true });
                          toast.success('Seat accepted');
                          navigate(`/cleaner-city/ride/${r.id}`, { state: { seededRide: r } });
                        } catch {
                          toast.error('Could not accept. Please try again.');
                        } finally {
                          setRespondingId(null);
                        }
                      }}
                      onDecline={async () => {
                        setRespondingId(`decline:${r.id}`);
                        try {
                          await respond.mutateAsync({ ride_id: r.id, accept: false });
                          toast.success('Declined');
                          void refetchRides();
                        } catch {
                          toast.error('Could not decline. Please try again.');
                        } finally {
                          setRespondingId(null);
                        }
                      }}
                    />
                  </div>
                );
              })}
            </section>
          ) : null}

          <section className="space-y-3" data-testid="cleaner-city-match-results">
            <div className="flex items-center justify-between gap-2 px-0.5">
              <p className={cc.sectionLabel}>Nearby matches</p>
              <Link
                to="/cleaner-city/find"
                className="text-[13px] font-semibold text-[#0F3D2E]"
              >
                See all
              </Link>
            </div>

            {!hasPickup ? (
              <div
                className="rounded-2xl border border-amber-500/30 bg-amber-50/80 p-4 text-sm text-amber-950"
                data-testid="cleaner-city-find-missing-pickup"
              >
                Add your home and office pins before searching.{' '}
                <Link to="/cleaner-city/route" className="font-semibold underline">
                  Set route
                </Link>
              </div>
            ) : null}

            {nearby.map((m) => (
              <CleanerCityMatchCard
                key={m.publication_id}
                match={m}
                compact
                requesting={requestingPubId === m.publication_id}
                locked={!!guestActive}
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
                  if (guestActive) {
                    toast.message('You already have a ride', {
                      description: 'Open it, or cancel that seat first.',
                    });
                    return;
                  }
                  void requestSeat(m.publication_id);
                }}
              />
            ))}

            {hasSearched && nearby.length === 0 && hasPickup ? (
              <div
                className="rounded-2xl border border-border bg-card p-5 text-center space-y-3"
                data-testid="cleaner-city-find-empty"
                data-home-empty="cleaner-city-home-empty-live"
              >
                <span className="sr-only" data-testid="cleaner-city-home-empty-live">
                  Waiting on live neighbour offers
                </span>
                <p className="text-[15px] font-semibold">No rides on your road yet</p>
                <p className="text-[13px] text-muted-foreground">
                  Try a different time on Find, or offer a seat for neighbours going your way.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button
                    className="rounded-xl bg-emerald-800 font-semibold text-white hover:bg-emerald-900"
                    onClick={() => navigate('/cleaner-city/find')}
                  >
                    Open Find
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-xl font-semibold"
                    data-testid="cleaner-city-offer-link"
                    onClick={() => navigate('/cleaner-city/offer')}
                  >
                    Offer a seat
                  </Button>
                </div>
              </div>
            ) : null}

            {findMatches.isPending && nearby.length === 0 ? (
              <p className="px-1 text-[13px] text-muted-foreground">Looking for neighbours...</p>
            ) : null}
          </section>

          {upcoming ? (
            <CleanerCityActiveMissionDock ride={upcoming} myUserId={user?.id} />
          ) : null}
        </div>
      </CleanerCityGate>
    </CleanerCityChrome>
  );
}
