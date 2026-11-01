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
  useCancelPublication,
  useCleanerCityProfile,
  useCleanerCityVehicles,
  useCleanerCityWorkVerification,
  useCommuteTemplates,
  useEffectiveSchedule,
  useMyPublications,
  useOfficeLocations,
  usePublishCommute,
  useStoreRouteGeometry,
} from '@/hooks/queries/useCleanerCity';
import {
  CLEANER_CITY_DIRECTIONS,
  DEFAULT_COMMUTE_TIMEZONE,
} from '@/lib/cleaner-city/constants';
import { fetchDrivingRoute } from '@/lib/cleaner-city/routing';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';
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

export default function CleanerCityOfferPage() {
  const { data: profile } = useCleanerCityProfile();
  const { data: verification } = useCleanerCityWorkVerification();
  const { data: vehicles = [] } = useCleanerCityVehicles();
  const { data: offices = [] } = useOfficeLocations();
  const { data: templates = [] } = useCommuteTemplates();
  const publish = usePublishCommute();
  const cancelPub = useCancelPublication();
  const storeRoute = useStoreRouteGeometry();
  const { isLoaded } = useGoogleMaps();

  const tz = profile?.timezone || DEFAULT_COMMUTE_TIMEZONE;
  const today = todayIso(tz);
  const { data: publications = [] } = useMyPublications(today);

  const activeVehicles = useMemo(() => vehicles.filter((v) => v.is_active), [vehicles]);
  const [vehicleId, setVehicleId] = useState('');
  const [travelDate, setTravelDate] = useState(today);
  const [direction, setDirection] = useState('to_office');
  const [departTime, setDepartTime] = useState('08:30');
  const [seats, setSeats] = useState(1);

  const { data: daySchedule } = useEffectiveSchedule(travelDate);
  const selected = activeVehicles.find((v) => v.id === vehicleId) || null;
  const ready =
    !!profile &&
    verification?.status === 'verified' &&
    !profile.is_paused &&
    (profile.role === 'host' || profile.role === 'both');

  const office = offices.find((o) => o.is_primary) || offices[0] || null;
  const weekday = weekdayOf(travelDate);
  const weekdayTemplate = templates.find((t) => t.weekday === weekday) || null;
  const pickupLat = daySchedule?.pickup_latitude ?? weekdayTemplate?.pickup_latitude ?? null;
  const pickupLng = daySchedule?.pickup_longitude ?? weekdayTemplate?.pickup_longitude ?? null;
  const hasOffice = office?.latitude != null && office?.longitude != null;
  const hasPickup = pickupLat != null && pickupLng != null;
  const pinsReady = hasOffice && hasPickup;

  useEffect(() => {
    if (!vehicleId && activeVehicles[0]?.id) setVehicleId(activeVehicles[0].id);
  }, [activeVehicles, vehicleId]);

  useEffect(() => {
    if (!selected) return;
    setSeats(Math.min(seats, selected.seat_capacity) || selected.seat_capacity);
  }, [selected?.id]);

  useEffect(() => {
    if (!daySchedule?.is_working) return;
    if (direction === 'to_office' && daySchedule.depart_time) {
      setDepartTime(String(daySchedule.depart_time).slice(0, 5));
    }
    if (direction === 'to_home' && daySchedule.return_time) {
      setDepartTime(String(daySchedule.return_time).slice(0, 5));
    }
  }, [daySchedule?.date, daySchedule?.depart_time, daySchedule?.return_time, direction]);

  const publishRide = async () => {
    if (!ready) {
      toast.error('Verify work email and host role first');
      return;
    }
    if (!vehicleId) {
      toast.error('Add an active vehicle first');
      return;
    }
    if (!pinsReady) {
      toast.error(
        'Set your office and pickup pins first - open Office & pickup to add them',
      );
      return;
    }
    try {
      const origin =
        direction === 'to_office'
          ? { lat: pickupLat, lng: pickupLng }
          : { lat: office.latitude, lng: office.longitude };
      const destination =
        direction === 'to_office'
          ? { lat: office.latitude, lng: office.longitude }
          : { lat: pickupLat, lng: pickupLng };

      const pub = await publish.mutateAsync({
        vehicle_id: vehicleId,
        travel_date: travelDate,
        direction,
        depart_time: departTime,
        seats_available: seats,
      });

      if (isLoaded) {
        try {
          const route = await fetchDrivingRoute(origin, destination);
          await storeRoute.mutateAsync({
            publication_id: pub.id,
            route_polyline: route.polyline,
            origin_latitude: origin.lat,
            origin_longitude: origin.lng,
            destination_latitude: destination.lat,
            destination_longitude: destination.lng,
            origin_label:
              direction === 'to_office'
                ? selected?.preferred_pickup_label || weekdayTemplate?.pickup_label || 'Pickup corridor'
                : office.label || 'Office',
            destination_label:
              direction === 'to_office'
                ? office.label || 'Office'
                : selected?.preferred_drop_label || weekdayTemplate?.pickup_label || 'Home corridor',
            route_distance_meters: route.distanceMeters,
            route_duration_seconds: route.durationSeconds,
            route_provider: route.provider,
          });
        } catch {
          // Route cache is optional for publish success - pins already exist and are real
        }
      }

      toast.success('Ride published');
    } catch (e: any) {
      toast.error(e?.message || 'Could not publish');
    }
  };

  const cancel = async (id: string) => {
    try {
      await cancelPub.mutateAsync(id);
      toast.success('Publication cancelled');
    } catch (e: any) {
      toast.error(e?.message || 'Could not cancel');
    }
  };

  return (
    <AppLayout headerTitle="Offer a ride">
      <CleanerCityGate>
        <div className="p-4 pb-24 space-y-4" data-testid="cleaner-city-offer-page">
          {!ready && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950 text-sm">
              Complete{' '}
              <Link to="/cleaner-city/setup" className="font-semibold underline">
                set up + work email
              </Link>
              , set role to Host/Both, and add a{' '}
              <Link to="/cleaner-city/vehicle" className="font-semibold underline">
                vehicle
              </Link>{' '}
              before publishing.
            </div>
          )}

          {ready && !pinsReady && (
            <div
              className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950 text-sm"
              data-testid="cleaner-city-offer-missing-pins"
            >
              {!hasOffice && !hasPickup
                ? 'Office and pickup pins are missing. '
                : !hasOffice
                  ? 'Office pin is missing. '
                  : 'Pickup pin for this day is missing. '}
              Add{' '}
              <Link to="/cleaner-city/route" className="font-semibold underline">
                them on Office &amp; pickup
              </Link>{' '}
              before publishing.
            </div>
          )}

          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <p className="text-sm font-semibold">Publish seats</p>
            <p className="text-xs text-muted-foreground">
              Capacity cannot exceed your vehicle. Unverified hosts cannot publish.
            </p>

            <div>
              <Label>Vehicle</Label>
              <select
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
                data-testid="cleaner-city-offer-vehicle"
              >
                {activeVehicles.length === 0 && <option value="">No active vehicle</option>}
                {activeVehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.vehicle_type.toUpperCase()} · {v.registration_number} · {v.seat_capacity} seats
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date</Label>
                <Input
                  type="date"
                  value={travelDate}
                  min={today}
                  onChange={(e) => setTravelDate(e.target.value)}
                />
              </div>
              <div>
                <Label>Depart</Label>
                <Input
                  type="time"
                  value={departTime}
                  onChange={(e) => setDepartTime(e.target.value)}
                />
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

            <div>
              <Label>Seats available</Label>
              <Input
                type="number"
                min={1}
                max={selected?.seat_capacity || 1}
                value={seats}
                onChange={(e) => setSeats(Number(e.target.value))}
                data-testid="cleaner-city-offer-seats"
              />
              {selected && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Max {selected.seat_capacity} for this {selected.vehicle_type}
                </p>
              )}
            </div>

            {daySchedule && (
              <p className="text-xs text-muted-foreground">
                Schedule for {travelDate}:{' '}
                {daySchedule.is_paused
                  ? 'paused'
                  : daySchedule.is_working
                    ? `working (${daySchedule.source})`
                    : 'not commuting'}
              </p>
            )}

            <Button
              onClick={publishRide}
              disabled={publish.isPending || !ready || !pinsReady}
              data-testid="cleaner-city-offer-publish"
            >
              Publish ride
            </Button>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold">My publications</p>
            {publications.length === 0 && (
              <p className="text-xs text-muted-foreground">No upcoming publications yet.</p>
            )}
            {publications.map((p) => (
              <div
                key={p.id}
                className="rounded-2xl border border-border bg-card p-3 flex items-start justify-between gap-3"
              >
                <div>
                  <p className="text-sm font-semibold">
                    {p.travel_date} · {String(p.depart_time).slice(0, 5)} · {p.direction.replace('_', ' ')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {p.seats_available}/{p.seats_total} seats · {p.status}
                    {p.route_polyline ? ' · route cached' : ''}
                  </p>
                </div>
                {['draft', 'published', 'full'].includes(p.status) && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => cancel(p.id)}>
                    Cancel
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      </CleanerCityGate>
    </AppLayout>
  );
}
