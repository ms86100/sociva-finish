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
import { formatMatchReasons } from '@/lib/cleaner-city/matchCopy';
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

function weekdayOf(dateIso: string): number {
  // Matches Postgres EXTRACT(DOW): 0 Sunday ... 6 Saturday
  return new Date(`${dateIso}T12:00:00`).getDay();
}

function formatFuel(paise: number | null | undefined): string | null {
  if (paise == null) return null;
  return `~₹${Math.round(paise / 100)}`;
}

export default function CleanerCityFindPage() {
  const { user } = useAuth();
  const { data: profile } = useCleanerCityProfile();
  const { data: verification } = useCleanerCityWorkVerification();
  const { data: offices = [] } = useOfficeLocations();
  const { data: templates = [] } = useCommuteTemplates();
  const { data: rides = [] } = useMyRides();
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
  const [date, setDate] = useState(today);
  const [direction, setDirection] = useState('to_office');
  const [departTime, setDepartTime] = useState('08:30');
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [otpByRide, setOtpByRide] = useState<Record<string, string>>({});
  const [otpInput, setOtpInput] = useState<Record<string, string>>({});
  const [alternatives, setAlternatives] = useState<MatchResult[]>([]);
  const [alternativesForRide, setAlternativesForRide] = useState<string | null>(null);

  const { data: schedule } = useEffectiveSchedule(date);

  const ready = !!profile && verification?.status === 'verified' && !profile.is_paused;
  const office = offices.find((o) => o.is_primary) || offices[0] || null;

  const weekday = weekdayOf(date);
  const weekdayTemplate = templates.find((t) => t.weekday === weekday) || null;

  const pickupLat = schedule?.pickup_latitude ?? weekdayTemplate?.pickup_latitude ?? null;
  const pickupLng = schedule?.pickup_longitude ?? weekdayTemplate?.pickup_longitude ?? null;
  const hasPickup = pickupLat != null && pickupLng != null;

  // Guest pickup/destination swap based on direction: to_office goes pickup -> office,
  // to_home goes office -> pickup.
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

  useEffect(() => {
    if (ready && hasPickup) search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hasPickup]);

  const search = async () => {
    if (!ready) {
      toast.error('Verify work email first');
      return;
    }
    if (!hasPickup) {
      toast.error('Set a pickup pin for this day first - open Office & pickup to add it');
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
      toast.error(e?.message || 'Could not find matches');
    }
  };

  const request = async (publicationId: string) => {
    try {
      await requestRide.mutateAsync({
        publication_id: publicationId,
        guest_pickup_lat: guestCoords.pickup_lat,
        guest_pickup_lng: guestCoords.pickup_lng,
        guest_dest_lat: guestCoords.dest_lat,
        guest_dest_lng: guestCoords.dest_lng,
      });
      toast.success('Request sent - seat held pending host response');
      search();
    } catch (e: any) {
      toast.error(e?.message || 'Could not request ride');
    }
  };

  const myWaitlistEntry = waitlist.find(
    (w) => w.travel_date === date && w.direction === direction && w.status === 'open',
  );

  const joinTheWaitlist = async () => {
    if (!hasPickup) {
      toast.error('Set a pickup pin for this day first - open Office & pickup to add it');
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
  const mine = rides.filter(
    (r) =>
      (r.host_user_id === user?.id || r.guest_user_id === user?.id) &&
      ['requested', 'confirmed', 'pickup_pending', 'started'].includes(r.status),
  );

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
        <div className="p-4 pb-24 space-y-4" data-testid="cleaner-city-find-page">
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

          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <p className="text-sm font-semibold">Match search</p>
            <p className="text-xs text-muted-foreground">
              Same society + neighbours. Corridor labels only until a ride is confirmed.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date</Label>
                <Input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <Label>Depart around</Label>
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
            <Button
              onClick={search}
              disabled={findMatches.isPending || !ready}
              data-testid="cleaner-city-find-search"
            >
              Search matches
            </Button>
          </div>

          <div className="space-y-2">
            {matches.map((m) => {
              const fuel = formatFuel(m.estimated_fuel_paise);
              return (
                <div key={m.publication_id} className="rounded-2xl border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">
                      {String(m.depart_time).slice(0, 5)} · {m.vehicle_type}
                      {m.vehicle_color ? ` · ${m.vehicle_color}` : ''}
                    </p>
                    {m.shared_circle && (
                      <span
                        className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary"
                        data-testid="cleaner-city-shared-circle-badge"
                      >
                        In your circle
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {m.origin_label} → {m.destination_label}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {m.seats_available} seat{m.seats_available === 1 ? '' : 's'}
                    {m.estimated_detour_minutes != null
                      ? ` · ~${m.estimated_detour_minutes} min detour`
                      : ''}
                    {m.host_company ? ` · ${m.host_company}` : ''}
                    {fuel ? ` · ${fuel} fuel` : ''}
                  </p>
                  {(m.host_avg_stars != null || m.host_rating_count != null) && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {m.host_avg_stars != null ? `${m.host_avg_stars.toFixed(1)} stars` : 'No ratings yet'}
                      {m.host_rating_count != null ? ` (${m.host_rating_count} rides)` : ''}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {formatMatchReasons(m.reason_labels || m.reasons)}
                  </p>
                  <Button
                    className="mt-2"
                    size="sm"
                    onClick={() => request(m.publication_id)}
                    disabled={requestRide.isPending}
                  >
                    Request seat
                  </Button>
                </div>
              );
            })}
            {!findMatches.isPending && hasSearched && matches.length === 0 && (
              <div
                className="rounded-2xl border border-border bg-card p-4 text-center space-y-2"
                data-testid="cleaner-city-find-empty"
              >
                <p className="text-sm font-semibold">No seats yet - try another time or Offer a ride</p>
                <Link to="/cleaner-city/offer">
                  <Button size="sm" variant="outline" className="mt-1">
                    Offer a ride
                  </Button>
                </Link>
                {hasPickup && (
                  myWaitlistEntry ? (
                    <div className="pt-2">
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
                    <div className="pt-2">
                      <p className="text-xs text-muted-foreground mb-2">
                        We will notify you the moment a neighbour publishes seats.
                      </p>
                      <Button
                        size="sm"
                        onClick={joinTheWaitlist}
                        disabled={joinWaitlist.isPending}
                        data-testid="cleaner-city-join-waitlist"
                      >
                        Join waitlist
                      </Button>
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          {alternatives.length > 0 && (
            <div
              className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-2"
              data-testid="cleaner-city-cancel-alternatives"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Alternatives for your cancelled ride</p>
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
                    {String(m.depart_time).slice(0, 5)} · {m.vehicle_type}
                    {m.vehicle_color ? ` · ${m.vehicle_color}` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {m.origin_label} → {m.destination_label}
                  </p>
                  <Button
                    className="mt-2"
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

          {incoming.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Incoming requests</p>
              {incoming.map((r) => (
                <div key={r.id} className="rounded-2xl border border-border bg-card p-3 flex gap-2">
                  <div className="flex-1">
                    <p className="text-sm font-semibold">{r.travel_date}</p>
                    <p className="text-xs text-muted-foreground">Status: {r.status}</p>
                  </div>
                  <Button
                    size="sm"
                    onClick={async () => {
                      try {
                        await respond.mutateAsync({ ride_id: r.id, accept: true });
                        toast.success('Accepted');
                      } catch (e: any) {
                        toast.error(e?.message || 'Failed');
                      }
                    }}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await respond.mutateAsync({ ride_id: r.id, accept: false });
                        toast.success('Rejected');
                      } catch (e: any) {
                        toast.error(e?.message || 'Failed');
                      }
                    }}
                  >
                    Decline
                  </Button>
                </div>
              ))}
            </div>
          )}

          {mine.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">My open rides</p>
              {mine.map((r) => (
                <div key={r.id} className="rounded-2xl border border-border bg-card p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <Link
                        to={`/cleaner-city/ride/${r.id}`}
                        className="text-sm font-semibold text-foreground hover:text-primary"
                      >
                        {r.travel_date} · {r.status}
                      </Link>
                      <p className="text-[11px] text-muted-foreground">
                        {r.host_user_id === user?.id ? 'You are host' : 'You are guest'} · open ride
                      </p>
                      {otpByRide[r.id] && (
                        <p className="text-xs font-semibold text-primary mt-1">OTP {otpByRide[r.id]}</p>
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
                            try {
                              const res = await suggestReplacements.mutateAsync(r.id);
                              setAlternatives(res.alternatives || []);
                              setAlternativesForRide(r.id);
                            } catch {
                              // Alternatives are a courtesy - cancel already succeeded
                            }
                          } catch (e: any) {
                            toast.error(e?.message || 'Failed');
                          }
                        }}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                  {r.host_user_id === user?.id && ['confirmed', 'pickup_pending'].includes(r.status) && (
                    <Button size="sm" variant="outline" onClick={() => showOtp(r.id)}>
                      Generate pickup OTP
                    </Button>
                  )}
                  {r.status === 'pickup_pending' && (
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
                        onClick={async () => {
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
                  )}
                  {r.host_user_id === user?.id && r.status === 'started' && (
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
      </CleanerCityGate>
    </AppLayout>
  );
}
