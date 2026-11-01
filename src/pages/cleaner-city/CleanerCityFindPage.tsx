// @ts-nocheck
import { useEffect, useState } from 'react';
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
  useCompleteRide,
  useFindMatches,
  useGenerateRideOtp,
  useMyRides,
  useOfficeLocations,
  useRequestRide,
  useRespondRideRequest,
  useStartRide,
  type MatchResult,
} from '@/hooks/queries/useCleanerCity';
import {
  CLEANER_CITY_DIRECTIONS,
  DEFAULT_COMMUTE_TIMEZONE,
} from '@/lib/cleaner-city/constants';
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

export default function CleanerCityFindPage() {
  const { user } = useAuth();
  const { data: profile } = useCleanerCityProfile();
  const { data: verification } = useCleanerCityWorkVerification();
  const { data: offices = [] } = useOfficeLocations();
  const { data: rides = [] } = useMyRides();
  const findMatches = useFindMatches();
  const requestRide = useRequestRide();
  const respond = useRespondRideRequest();
  const cancelRide = useCancelRide();
  const generateOtp = useGenerateRideOtp();
  const startRide = useStartRide();
  const completeRide = useCompleteRide();

  const tz = profile?.timezone || DEFAULT_COMMUTE_TIMEZONE;
  const today = todayIso(tz);
  const [date, setDate] = useState(today);
  const [direction, setDirection] = useState('to_office');
  const [departTime, setDepartTime] = useState('08:30');
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [otpByRide, setOtpByRide] = useState<Record<string, string>>({});
  const [otpInput, setOtpInput] = useState<Record<string, string>>({});

  const ready = !!profile && verification?.status === 'verified' && !profile.is_paused;
  const office = offices.find((o) => o.is_primary) || offices[0] || null;

  useEffect(() => {
    if (ready) search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = async () => {
    if (!ready) {
      toast.error('Verify work email first');
      return;
    }
    try {
      const res = await findMatches.mutateAsync({
        date,
        direction,
        depart_time: departTime,
        guest_pickup_lat: null,
        guest_pickup_lng: null,
        guest_dest_lat: office?.latitude ?? null,
        guest_dest_lng: office?.longitude ?? null,
      });
      setMatches(res.matches || []);
      if (!(res.matches || []).length) toast.message('No matches yet for this date');
    } catch (e: any) {
      toast.error(e?.message || 'Could not find matches');
    }
  };

  const request = async (publicationId: string) => {
    try {
      await requestRide.mutateAsync({ publication_id: publicationId });
      toast.success('Request sent - seat held pending host response');
      search();
    } catch (e: any) {
      toast.error(e?.message || 'Could not request ride');
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
            <Button onClick={search} disabled={findMatches.isPending || !ready} data-testid="cleaner-city-find-search">
              Search matches
            </Button>
          </div>

          <div className="space-y-2">
            {matches.map((m) => (
              <div key={m.publication_id} className="rounded-2xl border border-border bg-card p-3">
                <p className="text-sm font-semibold">
                  {String(m.depart_time).slice(0, 5)} · {m.vehicle_type}
                  {m.vehicle_color ? ` · ${m.vehicle_color}` : ''}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {m.origin_label} → {m.destination_label}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {m.seats_available} seat{m.seats_available === 1 ? '' : 's'} · score {m.score}
                  {m.estimated_detour_minutes != null
                    ? ` · ~${m.estimated_detour_minutes} min detour`
                    : ''}
                  {m.host_company ? ` · ${m.host_company}` : ''}
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
            ))}
            {!findMatches.isPending && matches.length === 0 && (
              <p className="text-xs text-muted-foreground">No matches shown yet.</p>
            )}
          </div>

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
