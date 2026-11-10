// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { CleanerCityChrome } from '@/components/cleaner-city/CleanerCityChrome';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { CleanerCityPinPicker } from '@/components/cleaner-city/CleanerCityPinPicker';
import { cc } from '@/components/cleaner-city/ui/ccTheme';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useCleanerCityProfile,
  useCleanerCityVehicles,
  useCleanerCityWorkVerification,
  useCommuteTemplates,
  useMyPublications,
  usePublishExtraTrip,
} from '@/hooks/queries/useCleanerCity';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';
import { DEFAULT_COMMUTE_TIMEZONE } from '@/lib/cleaner-city/constants';
import { fetchDrivingRouteAlternativesDetailed } from '@/lib/cleaner-city/routing';
import { cn } from '@/lib/utils';

type Pin = { lat: number; lng: number; label: string };

function todayIso(tz = DEFAULT_COMMUTE_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export default function CleanerCityExtraTripPage() {
  const navigate = useNavigate();
  const { data: profile } = useCleanerCityProfile();
  const { data: verification } = useCleanerCityWorkVerification();
  const { data: vehicles = [] } = useCleanerCityVehicles();
  const { data: templates = [] } = useCommuteTemplates();
  const publishExtra = usePublishExtraTrip();
  const { isLoaded } = useGoogleMaps();

  const tz = profile?.timezone || DEFAULT_COMMUTE_TIMEZONE;
  const today = todayIso(tz);
  const { data: publications = [] } = useMyPublications(today);

  const homePin = useMemo(() => {
    const t = templates.find(
      (row) =>
        typeof row.pickup_latitude === 'number' &&
        typeof row.pickup_longitude === 'number',
    );
    if (!t) return null;
    return {
      lat: Number(t.pickup_latitude),
      lng: Number(t.pickup_longitude),
      label: t.pickup_label || 'Home',
    } as Pin;
  }, [templates]);

  const activeVehicles = vehicles.filter((v) => v.is_active);
  const [vehicleId, setVehicleId] = useState('');
  const [travelDate, setTravelDate] = useState(today);
  const [departTime, setDepartTime] = useState('11:00');
  const [seats, setSeats] = useState(1);
  const [origin, setOrigin] = useState<Pin | null>(null);
  const [dest, setDest] = useState<Pin | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!vehicleId && activeVehicles[0]?.id) setVehicleId(activeVehicles[0].id);
  }, [activeVehicles, vehicleId]);

  useEffect(() => {
    if (!origin && homePin) setOrigin(homePin);
  }, [homePin, origin]);

  const selected = activeVehicles.find((v) => v.id === vehicleId) || activeVehicles[0] || null;
  const ready =
    !!profile &&
    verification?.status === 'verified' &&
    !profile.is_paused &&
    (profile.role === 'host' || profile.role === 'both');

  const overlappingCommute = useMemo(() => {
    const [hh, mm] = departTime.split(':').map(Number);
    const target = (hh || 0) * 60 + (mm || 0);
    return publications.filter((p) => {
      if (p.travel_date !== travelDate) return false;
      if ((p.trip_kind || 'commute') !== 'commute') return false;
      if (!['draft', 'published', 'full'].includes(p.status)) return false;
      const parts = String(p.depart_time || '').slice(0, 5).split(':').map(Number);
      const mins = (parts[0] || 0) * 60 + (parts[1] || 0);
      return Math.abs(mins - target) <= 30;
    });
  }, [publications, travelDate, departTime]);

  const publish = async () => {
    if (!ready) {
      toast.error('Finish host setup first');
      return;
    }
    if (!selected) {
      toast.error('Add a vehicle first');
      return;
    }
    if (!origin || !dest) {
      toast.error('Set pickup and destination');
      return;
    }
    if (overlappingCommute.length > 0) {
      toast.error('Cancel your overlapping commute seat first (within 30 minutes)');
      return;
    }
    if (!isLoaded) {
      toast.error('Maps is still loading');
      return;
    }
    setBusy(true);
    try {
      const routeResult = await fetchDrivingRouteAlternativesDetailed(
        { lat: origin.lat, lng: origin.lng },
        { lat: dest.lat, lng: dest.lng },
      );
      const chosen = routeResult.alternatives?.[0];
      if (!chosen?.polyline) {
        toast.error('Could not build a driving road');
        return;
      }
      const pub = await publishExtra.mutateAsync({
        vehicle_id: selected.id,
        travel_date: travelDate,
        depart_time: departTime,
        seats_available: Math.min(seats, selected.seat_capacity),
        route_polyline: chosen.polyline,
        origin_lat: origin.lat,
        origin_lng: origin.lng,
        dest_lat: dest.lat,
        dest_lng: dest.lng,
        origin_label: origin.label,
        dest_label: dest.label,
        route_distance_meters: chosen.distanceMeters,
        route_duration_seconds: chosen.durationSeconds,
      });
      toast.success('Extra trip is live');
      navigate('/cleaner-city/offer', {
        replace: true,
        state: {
          notice: 'Extra trip published. Guests can find it when their path overlaps.',
          justPublishedId: pub.id,
          tab: 'rides',
        },
      });
    } catch (e: any) {
      toast.error(e?.message || 'Could not publish Extra trip');
    } finally {
      setBusy(false);
    }
  };

  return (
    <CleanerCityChrome
      headerTitle="Extra trip"
      className={cc.bg}
      backTo="/cleaner-city/offer"
      backLabel="Offer"
    >
      <CleanerCityGate>
        <div className={cn(cc.page, 'pb-8')} data-testid="cleaner-city-extra-trip-page">
          <p className="text-[14px] text-muted-foreground">
            Going somewhere else? Publish only when your office commute for that leave window is off
            or cancelled.
          </p>

          {overlappingCommute.length > 0 ? (
            <div
              className="rounded-2xl border border-amber-500/30 bg-amber-50 px-4 py-3 text-sm text-amber-950"
              data-testid="cleaner-city-extra-overlap-warning"
            >
              You still have a commute seat around this time. Cancel it on Offer or mark the day off
              first.
              <Link
                to="/cleaner-city/offer"
                className={cn('ml-1 font-semibold underline', cc.forestText)}
              >
                Open Offer
              </Link>
            </div>
          ) : null}

          <section className={cn(cc.card, 'space-y-3 p-4')}>
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                value={travelDate}
                min={today}
                onChange={(e) => setTravelDate(e.target.value)}
                className="mt-1"
                data-testid="cleaner-city-extra-date"
              />
            </div>
            <div>
              <Label>Leave time</Label>
              <Input
                type="time"
                value={departTime}
                onChange={(e) => setDepartTime(e.target.value)}
                className="mt-1"
                data-testid="cleaner-city-extra-time"
              />
            </div>
            <div>
              <Label>Seats</Label>
              <Input
                type="number"
                min={1}
                max={selected?.seat_capacity || 3}
                value={seats}
                onChange={(e) => setSeats(Math.max(1, Number(e.target.value) || 1))}
                className="mt-1"
                data-testid="cleaner-city-extra-seats"
              />
            </div>
            {activeVehicles.length > 0 ? (
              <div>
                <Label>Vehicle</Label>
                <select
                  className="mt-1 h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm"
                  value={selected?.id || ''}
                  onChange={(e) => setVehicleId(e.target.value)}
                  data-testid="cleaner-city-extra-vehicle"
                >
                  {activeVehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {[v.color, v.make, v.registration_number].filter(Boolean).join(' ') ||
                        'Vehicle'}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <Link to="/cleaner-city/vehicle" className={cn('text-sm font-semibold', cc.forestText)}>
                Add a vehicle first
              </Link>
            )}
          </section>

          <CleanerCityPinPicker
            title="Pickup"
            hint="Usually your home pin"
            value={origin}
            onChange={setOrigin}
            testId="cleaner-city-extra-origin"
          />

          <CleanerCityPinPicker
            title="Destination"
            hint="Where you are going instead of office"
            value={dest}
            onChange={setDest}
            testId="cleaner-city-extra-dest"
          />

          <button
            type="button"
            className={cn(cc.primaryBtn, 'w-full')}
            disabled={busy || publishExtra.isPending || overlappingCommute.length > 0}
            onClick={() => void publish()}
            data-testid="cleaner-city-extra-publish"
          >
            {busy || publishExtra.isPending ? 'Publishing...' : 'Publish Extra trip'}
          </button>
        </div>
      </CleanerCityGate>
    </CleanerCityChrome>
  );
}
