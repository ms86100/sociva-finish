// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import {
  CleanerCityActiveMissionCard,
  CleanerCityActiveMissionDock,
} from '@/components/cleaner-city/CleanerCityActiveMissionCard';
import { CleanerCityMatchCard } from '@/components/cleaner-city/CleanerCityMatchCard';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useCancelRide,
  useCleanerCityProfile,
  useCleanerCityWorkVerification,
  useCommuteTemplates,
  useCompleteRide,
  useEffectiveSchedule,
  useFindMatches,
  useGenerateRideOtp,
  useJoinWaitlist,
  useLeaveWaitlist,
  useMyRides,
  useMyWaitlist,
  useOfficeLocations,
  useRequestRide,
  useRespondRideRequest,
  useStartRide,
  useSuggestReplacements,
  type MatchResult,
} from '@/hooks/queries/useCleanerCity';
import {
  CLEANER_CITY_DIRECTIONS,
  DEFAULT_COMMUTE_TIMEZONE,
} from '@/lib/cleaner-city/constants';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';

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

/** Next Mon-Fri date including today when today is a weekday. */
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

function personInitials(name?: string | null) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export default function CleanerCityFindPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const arrivalState = (location.state as {
    notice?: string;
    openHosting?: boolean;
    justPublishedId?: string;
  } | null) || {};
  const arrivalNotice = arrivalState.notice || '';
  const [hostingFocus, setHostingFocus] = useState(!!arrivalState.openHosting);
  const { data: profile } = useCleanerCityProfile();
  const { data: verification } = useCleanerCityWorkVerification();
  const { data: offices = [] } = useOfficeLocations();
  const { data: templates = [] } = useCommuteTemplates();
  const { data: rides = [], refetch: refetchRides } = useMyRides();
  const { data: waitlist = [] } = useMyWaitlist();
  const findMatches = useFindMatches();
  const requestRide = useRequestRide();
  const respond = useRespondRideRequest();
  const cancelRide = useCancelRide();
  const generateOtp = useGenerateRideOtp();
  const startRide = useStartRide();
  const completeRide = useCompleteRide();
  const joinWaitlist = useJoinWaitlist();
  const leaveWaitlist = useLeaveWaitlist();
  const suggestReplacements = useSuggestReplacements();

  const tz = profile?.timezone || DEFAULT_COMMUTE_TIMEZONE;
  const today = todayIso(tz);
  const defaultDate = nextWorkdayIso(tz);
  const [date, setDate] = useState(defaultDate);
  const [direction, setDirection] = useState('to_office');
  const [departTime, setDepartTime] = useState('08:30');
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [otpByRide, setOtpByRide] = useState<Record<string, string>>({});
  const [otpInput, setOtpInput] = useState<Record<string, string>>({});
  const [alternatives, setAlternatives] = useState<MatchResult[]>([]);
  const [alternativesForRide, setAlternativesForRide] = useState<string | null>(null);
  const [hostingOpen, setHostingOpen] = useState(false);
  const [requestedPubId, setRequestedPubId] = useState<string | null>(null);
  const [requestingPubId, setRequestingPubId] = useState<string | null>(null);

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
    } catch (e: any) {
      toast.error(e?.message || 'Could not find rides');
    }
  };

  useEffect(() => {
    if (ready && hasPickup) void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hasPickup, date, direction, departTime]);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`cleaner-city-find-rides-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rides', filter: `host_user_id=eq.${user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['cleaner-city-rides', user.id] });
          toast.message('Seat request update', {
            description: 'A neighbour just changed a ride on your hosting list.',
          });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rides', filter: `guest_user_id=eq.${user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['cleaner-city-rides', user.id] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);

  const ACTIVE_GUEST = ['requested', 'confirmed', 'pickup_pending', 'started', 'safety_incident'];

  const openExistingGuestRide = async (hint?: { travelDate?: string; direction?: string }) => {
    const travelDate = hint?.travelDate || date;
    const dir = hint?.direction || direction;
    const pick = (list: typeof rides) =>
      list.find(
        (r) =>
          r.guest_user_id === user?.id &&
          r.travel_date === travelDate &&
          (!r.direction || r.direction === dir) &&
          ACTIVE_GUEST.includes(r.status),
      ) ||
      list.find(
        (r) =>
          r.guest_user_id === user?.id &&
          r.travel_date === travelDate &&
          ACTIVE_GUEST.includes(r.status),
      ) ||
      list.find(
        (r) => r.guest_user_id === user?.id && ACTIVE_GUEST.includes(r.status),
      );

    let existing = pick(rides);
    if (!existing?.id) {
      const refreshed = await refetchRides();
      existing = pick(refreshed.data || []);
    }

    // Last resort: ask the DB directly (list can lag after a just-created request).
    if (!existing?.id && user?.id) {
      const { data: row } = await supabase
        .from('rides')
        .select(
          'id, publication_id, society_id, host_user_id, guest_user_id, travel_date, status, request_expires_at, pickup_deadline_at, meeting_point_label',
        )
        .eq('guest_user_id', user.id)
        .in('status', ACTIVE_GUEST)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (row?.id) existing = row as (typeof rides)[number];
    }

    if (existing?.id) {
      navigate(`/cleaner-city/ride/${existing.id}`, {
        state: {
          notice: 'This is your active ride - one seat per date and direction.',
          seededRide: existing,
        },
      });
      return existing;
    }
    document.getElementById('cleaner-city-active-ride-banner')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
    document.getElementById('cleaner-city-your-rides')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
    return null;
  };

  const request = async (publicationId: string) => {
    setRequestingPubId(publicationId);
    try {
      const ride = await requestRide.mutateAsync({
        publication_id: publicationId,
        guest_pickup_lat: guestCoords.pickup_lat,
        guest_pickup_lng: guestCoords.pickup_lng,
        guest_dest_lat: guestCoords.dest_lat,
        guest_dest_lng: guestCoords.dest_lng,
      });
      setRequestedPubId(publicationId);
      toast.success('Ping sent - host will see Accept / Decline instantly');
      void search();
      if (ride?.id) {
        navigate(`/cleaner-city/ride/${ride.id}`, {
          state: {
            notice: 'Request sent. Seat held until the host accepts or declines.',
            seededRide: ride,
          },
          replace: false,
        });
      }
    } catch (e: any) {
      const msg = String(e?.message || e?.error_description || e?.details || 'Could not request ride');
      if (/already have an active ride/i.test(msg) || /already have an open request/i.test(msg)) {
        const existing = await openExistingGuestRide({ travelDate: date, direction });
        if (existing?.id) {
          toast.message('You already have a ride', {
            description: 'Opened your live mission - cancel there if you want another seat.',
            action: {
              label: 'Open again',
              onClick: () =>
                navigate(`/cleaner-city/ride/${existing.id}`, {
                  state: { seededRide: existing },
                }),
            },
          });
        } else {
          toast.error('You already have a ride, but it could not be loaded. Pull to refresh Find.');
        }
      } else {
        toast.error(msg);
      }
    } finally {
      setRequestingPubId(null);
    }
  };

  const myWaitlistEntry = waitlist.find(
    (w) => w.travel_date === date && w.direction === direction && w.status === 'open',
  );

  const joinTheWaitlist = async () => {
    if (!hasPickup) {
      navigate('/cleaner-city/route', {
        state: { notice: 'Pin a pickup near home before joining the waitlist.' },
      });
      return;
    }
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
      toast.success('Added to waitlist - we will notify you when a seat opens');
    } catch (e: any) {
      toast.error(e?.message || 'Could not join waitlist');
    }
  };

  const leaveTheWaitlist = async () => {
    try {
      await leaveWaitlist.mutateAsync({ date, direction });
      toast.success('Left the waitlist');
    } catch (e: any) {
      toast.error(e?.message || 'Could not leave waitlist');
    }
  };

  const incoming = rides.filter(
    (r) => r.host_user_id === user?.id && r.status === 'requested',
  );
  const guestRides = rides.filter(
    (r) => r.guest_user_id === user?.id && ACTIVE_GUEST.includes(r.status),
  );
  // Always surface any open guest ride (not only the Find date filter) so the
  // "already have an active ride" rule is visible and openable.
  const activeGuestRide =
    guestRides.find((r) => r.travel_date === date && (!r.direction || r.direction === direction)) ||
    guestRides.find((r) => r.travel_date === date) ||
    guestRides[0] ||
    null;
  const hostRides = rides.filter(
    (r) =>
      r.host_user_id === user?.id &&
      ['requested', 'confirmed', 'pickup_pending', 'started'].includes(r.status),
  );
  const hasHosting = incoming.length > 0 || hostRides.length > 0;

  useEffect(() => {
    if (hasHosting || hostingFocus) setHostingOpen(true);
  }, [hasHosting, hostingFocus]);

  useEffect(() => {
    if (!arrivalState.openHosting) return;
    setHostingFocus(true);
    setHostingOpen(true);
    const t = window.setTimeout(() => {
      document.getElementById('cleaner-city-sticky-hosting')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 120);
    // Keep notice; drop openHosting so back/refresh does not keep forcing scroll.
    navigate(location.pathname, {
      replace: true,
      state: arrivalNotice ? { notice: arrivalNotice } : {},
    });
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- consume openHosting once on arrival
  }, []);

  const showOtp = async (rideId: string) => {
    try {
      const res = await generateOtp.mutateAsync(rideId);
      setOtpByRide((prev) => ({ ...prev, [rideId]: res.otp }));
      toast.success(`Pickup OTP: ${res.otp}`);
    } catch (e: any) {
      toast.error(e?.message || 'Could not generate OTP');
    }
  };

  return (
    <AppLayout headerTitle="Find a ride">
      <CleanerCityGate>
        <div
          className={cn(
            'mx-auto flex w-full max-w-lg flex-col gap-5 px-4 pt-4',
            activeGuestRide ? 'pb-36' : 'pb-24',
          )}
          data-testid="cleaner-city-find-page"
        >
          {arrivalNotice && (
            <div className="rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm leading-relaxed">
              {arrivalNotice}
            </div>
          )}

          {(incoming.length > 0 || hostingFocus) && (
            <div
              id="cleaner-city-sticky-hosting"
              className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-3 sticky top-2 z-20 backdrop-blur-sm"
              data-testid="cleaner-city-sticky-hosting"
            >
              <div>
                <p className="text-sm font-semibold">
                  {incoming.length > 0
                    ? `${incoming.length} seat request${incoming.length === 1 ? '' : 's'} waiting`
                    : 'Hosting is live'}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {incoming.length > 0
                    ? 'Accept or decline - guests are waiting'
                    : 'When a neighbour requests a seat, Accept shows here'}
                </p>
              </div>
              {incoming.map((r) => {
                const guestName = r.guest_name || 'Neighbour';
                const guestFlat = String(r.guest_flat || '').trim();
                return (
                  <div
                    key={r.id}
                    className="rounded-xl border border-border bg-card p-3 space-y-2"
                    data-testid="cleaner-city-incoming-request"
                  >
                    <div className="flex items-center gap-2.5">
                      <Avatar className="h-10 w-10">
                        {r.guest_avatar_url ? (
                          <AvatarImage src={r.guest_avatar_url} alt={guestName} className="object-cover" />
                        ) : null}
                        <AvatarFallback className="bg-primary/15 text-xs font-bold text-primary">
                          {personInitials(guestName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{guestName}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {[guestFlat ? `Flat ${guestFlat}` : null, r.travel_date]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        className="h-11 font-semibold"
                        disabled={respond.isPending}
                        data-testid="cleaner-city-sticky-accept"
                        onClick={async () => {
                          try {
                            await respond.mutateAsync({ ride_id: r.id, accept: true });
                            toast.success('Accepted - opening ride');
                            navigate(`/cleaner-city/ride/${r.id}`, {
                              state: { notice: 'Guest accepted. Set a meeting point when ready.' },
                            });
                          } catch (e: any) {
                            toast.error(e?.message || 'Failed');
                          }
                        }}
                      >
                        Accept
                      </Button>
                      <Button
                        className="h-11 font-semibold"
                        variant="outline"
                        disabled={respond.isPending}
                        data-testid="cleaner-city-sticky-decline"
                        onClick={async () => {
                          try {
                            await respond.mutateAsync({ ride_id: r.id, accept: false });
                            toast.success('Declined');
                          } catch (e: any) {
                            toast.error(e?.message || 'Failed');
                          }
                        }}
                      >
                        Decline
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!ready && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950 text-sm">
              Complete{' '}
              <Link to="/cleaner-city/setup" className="font-semibold underline">
                set up + work email
              </Link>{' '}
              to discover rides.
            </div>
          )}

          {ready && !hasPickup && (
            <div
              className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950 text-sm"
              data-testid="cleaner-city-find-missing-pickup"
            >
              No pickup pin saved for this day yet. Add one on{' '}
              <Link to="/cleaner-city/route" className="font-semibold underline">
                Office & pickup
              </Link>{' '}
              before searching.
            </div>
          )}

          {activeGuestRide ? (
            <div id="cleaner-city-active-ride-banner" className="space-y-2">
              <CleanerCityActiveMissionCard
                ride={activeGuestRide}
                myUserId={user?.id}
                todayIso={today}
              />
              {['requested', 'confirmed', 'pickup_pending'].includes(activeGuestRide.status) ? (
                <Button
                  className="h-11 w-full font-semibold"
                  variant="outline"
                  data-testid="cleaner-city-open-active-ride"
                  onClick={async () => {
                    try {
                      await cancelRide.mutateAsync({ ride_id: activeGuestRide.id });
                      toast.success('Cancelled - you can request another seat');
                      void refetchRides();
                      void search();
                    } catch (e: any) {
                      toast.error(e?.message || 'Could not cancel');
                    }
                  }}
                >
                  Cancel this seat to request another
                </Button>
              ) : null}
              {activeGuestRide.travel_date !== date ||
              (activeGuestRide.direction && activeGuestRide.direction !== direction) ? (
                <p className="text-[11px] text-muted-foreground px-1">
                  You already hold a seat for {activeGuestRide.travel_date}
                  {activeGuestRide.direction
                    ? ` · ${activeGuestRide.direction === 'to_home' ? 'to home' : 'to office'}`
                    : ''}
                  . Cancel it above before requesting another for this filter.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold">People going your way</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pick a date and leave time - we refresh the list for you.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date</Label>
                <Input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <Label>Leave around</Label>
                <Input type="time" value={departTime} onChange={(e) => setDepartTime(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {CLEANER_CITY_DIRECTIONS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => setDirection(d.value)}
                  className={cn(
                    'rounded-xl border px-3 py-2 text-sm font-semibold',
                    direction === d.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border',
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {guestRides.length > 0 && (
            <div
              id="cleaner-city-your-rides"
              className="rounded-2xl border border-border bg-card p-4 space-y-3"
              data-testid="cleaner-city-your-rides"
            >
              <div>
                <p className="text-sm font-semibold">Your rides</p>
                <p className="text-[11px] text-muted-foreground">
                  Seats you asked for - open one for status and meeting point
                </p>
              </div>
              {guestRides.map((r) => (
                <div key={r.id} className="rounded-xl border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar className="h-10 w-10">
                        {r.host_avatar_url ? (
                          <AvatarImage
                            src={r.host_avatar_url}
                            alt={r.host_name || 'Host'}
                            className="object-cover"
                          />
                        ) : null}
                        <AvatarFallback className="bg-primary/15 text-xs font-bold text-primary">
                          {personInitials(r.host_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <Link
                          to={`/cleaner-city/ride/${r.id}`}
                          className="text-sm font-semibold text-foreground hover:text-primary"
                        >
                          {r.host_name || 'Host'} · {String(r.status).replace(/_/g, ' ')}
                        </Link>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {[
                            r.host_company || null,
                            r.host_flat ? `Flat ${r.host_flat}` : null,
                            r.travel_date,
                            r.depart_time ? `leaves ${String(r.depart_time).slice(0, 5)}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() =>
                        navigate(`/cleaner-city/ride/${r.id}`, {
                          state: { seededRide: r },
                        })
                      }
                    >
                      Open
                    </Button>
                  </div>
                  {['requested', 'confirmed', 'pickup_pending'].includes(r.status) && (
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
                            setAlternativesForRide(r.id);
                          } catch {
                            // Alternatives are a courtesy
                          }
                          void refetchRides();
                          void search();
                        } catch (e: any) {
                          toast.error(e?.message || 'Failed');
                        }
                      }}
                    >
                      Cancel seat
                    </Button>
                  )}
                  {r.status === 'pickup_pending' && (
                    <div className="space-y-1">
                      {!r.meeting_point_label ? (
                        <p className="text-[11px] text-amber-700 dark:text-amber-300">
                          Start locked until a meeting point is set on the ride page.
                        </p>
                      ) : null}
                      <div className="flex gap-2 items-center">
                        <Input
                          className="h-9"
                          placeholder="Enter OTP"
                          value={otpInput[r.id] || ''}
                          onChange={(e) =>
                            setOtpInput((prev) => ({ ...prev, [r.id]: e.target.value }))
                          }
                        />
                        <Button
                          size="sm"
                          disabled={!r.meeting_point_label}
                          onClick={async () => {
                            if (!r.meeting_point_label) {
                              toast.error('Set a meeting point on the ride page first');
                              return;
                            }
                            try {
                              await startRide.mutateAsync({
                                ride_id: r.id,
                                otp: otpInput[r.id] || '',
                              });
                              toast.success('Ride started');
                            } catch (e: any) {
                              toast.error(e?.message || 'Invalid OTP');
                            }
                          }}
                        >
                          Start
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Riders on your route</p>
              {findMatches.isPending ? (
                <span className="text-[11px] text-muted-foreground">Updating…</span>
              ) : null}
            </div>

            {activeGuestRide ? (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Requesting another seat is locked until you cancel your active ride above.
              </p>
            ) : null}

            {matches.map((m) => (
              <CleanerCityMatchCard
                key={m.publication_id}
                match={m}
                requesting={requestingPubId === m.publication_id}
                justRequested={requestedPubId === m.publication_id}
                locked={!!activeGuestRide}
                onRequest={() => {
                  if (activeGuestRide) {
                    toast.message('You already have a ride', {
                      description: 'Open your live mission, or cancel that seat first.',
                      action: {
                        label: 'Open ride',
                        onClick: () =>
                          navigate(`/cleaner-city/ride/${activeGuestRide.id}`, {
                            state: { seededRide: activeGuestRide },
                          }),
                      },
                    });
                    document
                      .getElementById('cleaner-city-active-ride-banner')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    return;
                  }
                  request(m.publication_id);
                }}
              />
            ))}

            {!findMatches.isPending && hasSearched && matches.length === 0 && (
              <div
                className="rounded-2xl border border-border bg-card p-5 text-center space-y-3"
                data-testid="cleaner-city-find-empty"
              >
                <p className="text-sm font-semibold">No seats yet - try another time or Offer a ride</p>
                <Link to="/cleaner-city/offer">
                  <Button size="sm" className="font-semibold">
                    Offer a ride
                  </Button>
                </Link>
                {hasPickup &&
                  (myWaitlistEntry ? (
                    <div className="pt-1">
                      <p className="text-xs text-muted-foreground mb-2">
                        You are on the waitlist for this date and direction.
                      </p>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={leaveTheWaitlist}
                        disabled={leaveWaitlist.isPending}
                        data-testid="cleaner-city-leave-waitlist"
                      >
                        Leave waitlist
                      </Button>
                    </div>
                  ) : (
                    <div className="pt-1">
                      <p className="text-xs text-muted-foreground mb-2">
                        We will notify you when a neighbour publishes seats.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={joinTheWaitlist}
                        disabled={joinWaitlist.isPending}
                        data-testid="cleaner-city-join-waitlist"
                      >
                        Join waitlist
                      </Button>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {alternatives.length > 0 && (
            <div
              className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-2"
              data-testid="cleaner-city-cancel-alternatives"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Alternatives after cancel</p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAlternatives([]);
                    setAlternativesForRide(null);
                  }}
                >
                  Dismiss
                </Button>
              </div>
              {alternatives.map((m) => (
                <div
                  key={`${alternativesForRide}-${m.publication_id}`}
                  className="rounded-xl border border-border bg-card p-3"
                >
                  <p className="text-sm font-semibold">
                    {String(m.depart_time).slice(0, 5)} · {m.origin_label} → {m.destination_label}
                  </p>
                  <Button
                    className="mt-2 w-full"
                    size="sm"
                    onClick={() => {
                      request(m.publication_id);
                      setAlternatives([]);
                      setAlternativesForRide(null);
                    }}
                    disabled={requestRide.isPending}
                  >
                    Request seat
                  </Button>
                </div>
              ))}
            </div>
          )}

          {hasHosting && (
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-left"
                onClick={() => setHostingOpen((v) => !v)}
                data-testid="cleaner-city-hosting-toggle"
              >
                <div>
                  <p className="text-sm font-semibold">Hosting</p>
                  <p className="text-[11px] text-muted-foreground">
                    Pickup code and finish for rides you host
                  </p>
                </div>
                <ChevronDown
                  size={16}
                  className={cn('text-muted-foreground transition-transform', hostingOpen && 'rotate-180')}
                />
              </button>

              {hostingOpen && (
                <div className="border-t border-border px-4 py-4 space-y-4">
                  {incoming.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Seat requests stay pinned at the top for Accept.
                    </p>
                  )}

                  {hostRides.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Your hosted rides
                      </p>
                      {hostRides.map((r) => (
                        <div key={r.id} className="rounded-xl border border-border p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <Link
                                to={`/cleaner-city/ride/${r.id}`}
                                className="text-sm font-semibold text-foreground hover:text-primary"
                              >
                                {r.travel_date} · {r.status}
                              </Link>
                              <p className="text-[11px] text-muted-foreground">You are host</p>
                              {otpByRide[r.id] && (
                                <p className="text-xs font-semibold text-primary mt-1">
                                  OTP {otpByRide[r.id]}
                                </p>
                              )}
                            </div>
                            {['requested', 'confirmed', 'pickup_pending'].includes(r.status) && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={async () => {
                                  try {
                                    await cancelRide.mutateAsync({ ride_id: r.id });
                                    toast.success('Cancelled');
                                  } catch (e: any) {
                                    toast.error(e?.message || 'Failed');
                                  }
                                }}
                              >
                                Cancel
                              </Button>
                            )}
                          </div>
                          {['confirmed', 'pickup_pending'].includes(r.status) && (
                            <Button size="sm" variant="outline" onClick={() => showOtp(r.id)}>
                              Generate pickup OTP
                            </Button>
                          )}
                          {r.status === 'pickup_pending' && (
                            <div className="space-y-1">
                              {!r.meeting_point_label ? (
                                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                                  Start locked until a meeting point is set on the ride page.
                                </p>
                              ) : null}
                              <div className="flex gap-2 items-center">
                                <Input
                                  className="h-9"
                                  placeholder="Enter OTP"
                                  value={otpInput[r.id] || ''}
                                  onChange={(e) =>
                                    setOtpInput((prev) => ({ ...prev, [r.id]: e.target.value }))
                                  }
                                />
                                <Button
                                  size="sm"
                                  disabled={!r.meeting_point_label}
                                  onClick={async () => {
                                    if (!r.meeting_point_label) {
                                      toast.error('Set a meeting point on the ride page first');
                                      return;
                                    }
                                    try {
                                      await startRide.mutateAsync({
                                        ride_id: r.id,
                                        otp: otpInput[r.id] || '',
                                      });
                                      toast.success('Ride started');
                                    } catch (e: any) {
                                      toast.error(e?.message || 'Invalid OTP');
                                    }
                                  }}
                                >
                                  Start
                                </Button>
                              </div>
                            </div>
                          )}
                          {r.status === 'started' && (
                            <Button
                              size="sm"
                              onClick={async () => {
                                try {
                                  await completeRide.mutateAsync(r.id);
                                  toast.success('Ride completed');
                                } catch (e: any) {
                                  toast.error(e?.message || 'Could not complete');
                                }
                              }}
                            >
                              Complete ride
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeGuestRide ? (
            <CleanerCityActiveMissionDock ride={activeGuestRide} myUserId={user?.id} />
          ) : null}
        </div>
      </CleanerCityGate>
    </AppLayout>
  );
}
