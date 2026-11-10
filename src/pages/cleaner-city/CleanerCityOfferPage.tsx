// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Bike,
  Calendar,
  Car,
  Check,
  Clock,
  MapPin,
  MapPinned,
  Minus,
  Navigation,
  Plus,
  Shield,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { CleanerCityChrome } from '@/components/cleaner-city/CleanerCityChrome';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { CleanerCityPinPicker } from '@/components/cleaner-city/CleanerCityPinPicker';
import { CleanerCityPlaySwitch } from '@/components/cleaner-city/CleanerCityPlaySwitch';
import { CleanerCityRoutePreview } from '@/components/cleaner-city/CleanerCityRoutePreview';
import { CleanerCityRouteSetupPanel } from '@/components/cleaner-city/CleanerCityRouteSetupPanel';
import { CleanerCityWeeklyPlanCard } from '@/components/cleaner-city/CleanerCityWeeklyPlanCard';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HostOfferRideCard } from '@/components/cleaner-city/HostOfferRideCard';
import {
  useCancelPublication,
  useCleanerCityProfile,
  useCleanerCityVehicles,
  useCleanerCityWorkVerification,
  useCommuteTemplates,
  useEffectiveSchedule,
  useEmergencyContacts,
  useMyPublications,
  useMyRides,
  useOfficeLocations,
  usePublicationStops,
  usePublishCommute,
  preferredRouteFromProfile,
  useSetPreferredRoute,
  useSetPublicationDropOrder,
  useSetPublicationStop,
  useStoreRouteGeometry,
} from '@/hooks/queries/useCleanerCity';
import {
  CLEANER_CITY_DIRECTIONS,
  DEFAULT_COMMUTE_TIMEZONE,
} from '@/lib/cleaner-city/constants';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import {
  fetchDrivingRoute,
  fetchDrivingRouteAlternatives,
  isPublishableRouteGeometry,
  loadPreferredRoute,
  openGoogleMapsDirections,
  planDropSequence,
  preferredRouteMatchesPins,
  savePreferredRoute,
  type DropSequenceResult,
  type RouteAlternative,
} from '@/lib/cleaner-city/routing';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';
import {
  equalRouteFuelShare,
  estimateGuestSharePaise,
  formatFuelRupeesFromPaise,
  FUEL_DEFAULT_PETROL_PAISE_PER_LITRE,
  FUEL_MILEAGE_KM_PER_LITRE,
} from '@/lib/cleaner-city/fuelShare';
import { cn } from '@/lib/utils';

type OfferTab = 'vehicle' | 'route' | 'week' | 'publish' | 'rides' | 'stops';

const OFFER_TAB_ORDER: Array<{ id: OfferTab; label: string }> = [
  { id: 'vehicle', label: 'Vehicle' },
  { id: 'route', label: 'Route' },
  { id: 'week', label: 'My week' },
  { id: 'publish', label: 'This ride' },
  { id: 'rides', label: 'My rides' },
];

function formatLeaveLabel(hhmm: string) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return hhmm;
  let h = Number(m[1]);
  const min = m[2];
  const ap = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${min} ${ap}`;
}

function formatOfferDateLabel(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const label = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return iso === todayIso ? `Today, ${label}` : label;
}

type StopPin = { lat: number; lng: number; label: string; address?: string };

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

export default function CleanerCityOfferPage() {
  const { user } = useAuth();
  const { data: profile } = useCleanerCityProfile();
  const { data: verification } = useCleanerCityWorkVerification();
  const { data: vehicles = [] } = useCleanerCityVehicles();
  const { data: offices = [] } = useOfficeLocations();
  const { data: templates = [] } = useCommuteTemplates();
  const { data: myRides = [] } = useMyRides();
  const { data: emergencyContacts = [] } = useEmergencyContacts();
  const hasVerifiedEmergency = emergencyContacts.some((c) => c.verified_at);
  const publish = usePublishCommute();
  const navigate = useNavigate();
  const location = useLocation();
  const arrivalState = (location.state as {
    notice?: string;
    tab?: OfferTab;
    focusPublicationId?: string;
    justPublishedId?: string;
  } | null) || {};
  const arrivalNotice = arrivalState.notice || '';
  const setStop = useSetPublicationStop();
  const cancelPub = useCancelPublication();
  const storeRoute = useStoreRouteGeometry();
  const setPreferredRoute = useSetPreferredRoute();
  const setDropOrder = useSetPublicationDropOrder();
  const { isLoaded } = useGoogleMaps();

  const tz = profile?.timezone || DEFAULT_COMMUTE_TIMEZONE;
  const today = todayIso(tz);
  const defaultDate = nextWorkdayIso(tz);
  const { data: publications = [] } = useMyPublications(today);

  const [tab, setTab] = useState<OfferTab>(() => {
    const t = arrivalState.tab;
    if (
      t === 'rides' ||
      t === 'stops' ||
      t === 'publish' ||
      t === 'week' ||
      t === 'vehicle' ||
      t === 'route'
    ) {
      return t;
    }
    return 'vehicle';
  });
  const [tabBootstrapped, setTabBootstrapped] = useState(!!arrivalState.tab);
  const [vehicleId, setVehicleId] = useState('');
  const [vehicleKind, setVehicleKind] = useState<'bike' | 'car'>('car');
  const [travelDate, setTravelDate] = useState(defaultDate);
  const [direction, setDirection] = useState('to_office');
  const [departTime, setDepartTime] = useState('08:30');
  const [seats, setSeats] = useState(1);
  const [stopPubId, setStopPubId] = useState('');
  const [stopSeq, setStopSeq] = useState(1);
  const [stopPin, setStopPin] = useState<StopPin | null>(null);
  const [justPublishedId, setJustPublishedId] = useState<string | null>(
    arrivalState.justPublishedId || arrivalState.focusPublicationId || null,
  );
  const [focusPublicationId, setFocusPublicationId] = useState<string | null>(
    arrivalState.focusPublicationId || null,
  );
  const [publishAlts, setPublishAlts] = useState<RouteAlternative[]>([]);
  const [publishRouteId, setPublishRouteId] = useState<string | null>(null);
  const [needRoutePick, setNeedRoutePick] = useState(false);
  const [dropPlan, setDropPlan] = useState<DropSequenceResult | null>(null);
  const [offlineConfirm, setOfflineConfirm] = useState(false);
  const [petrolPaise, setPetrolPaise] = useState(FUEL_DEFAULT_PETROL_PAISE_PER_LITRE);

  const activeVehicles = useMemo(() => vehicles.filter((v) => v.is_active), [vehicles]);
  const kindVehicles = useMemo(
    () => activeVehicles.filter((v) => v.vehicle_type === vehicleKind),
    [activeVehicles, vehicleKind],
  );
  const vehicleById = useMemo(
    () => Object.fromEntries(vehicles.map((v) => [v.id, v])),
    [vehicles],
  );
  const hostGuestsByPublication = useMemo(() => {
    const map: Record<string, typeof myRides> = {};
    for (const ride of myRides) {
      if (!ride.publication_id || ride.host_user_id !== user?.id) continue;
      if (!['requested', 'confirmed', 'pickup_pending', 'started'].includes(ride.status)) {
        continue;
      }
      (map[ride.publication_id] ||= []).push(ride);
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) => {
        const order = ['started', 'pickup_pending', 'confirmed', 'requested'];
        return order.indexOf(a.status) - order.indexOf(b.status);
      });
    }
    return map;
  }, [myRides, user?.id]);

  const { data: savedStops = [] } = usePublicationStops(stopPubId || null);
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
  const hasRoads = !!(
    preferredRouteFromProfile(profile, 'to_office') &&
    preferredRouteFromProfile(profile, 'to_home')
  );
  const canPublishDay = !!daySchedule?.is_working && !daySchedule?.is_paused;
  const pickupLabel =
    weekdayTemplate?.pickup_label ||
    selected?.preferred_pickup_label ||
    'Home gate';
  const officeLabel = office?.label || 'Office';
  const usualRoad = preferredRouteFromProfile(
    profile,
    direction === 'to_home' ? 'to_home' : 'to_office',
  );
  const weekConfigured = templates.some(
    (t) => t.weekday >= 1 && t.weekday <= 5 && !!t.depart_time,
  );
  const hasVehicle = !!vehicleId && activeVehicles.some((v) => v.id === vehicleId);
  const fuelEstimate = useMemo(() => {
    const meters = usualRoad?.distanceMeters || 12000;
    const guestPaise = estimateGuestSharePaise({
      distanceMeters: meters,
      petrolPaisePerLitre: petrolPaise,
      seatsTotal: Math.max(2, (seats || 1) + 1),
    });
    const equal = equalRouteFuelShare({
      distanceMeters: meters,
      petrolPaisePerLitre: petrolPaise,
      guestIds: Array.from({ length: Math.max(1, seats) }, (_, i) => `g${i}`),
    });
    return {
      guestRs: formatFuelRupeesFromPaise(guestPaise) ?? 0,
      totalRs: formatFuelRupeesFromPaise(equal.totalFuelPaise) ?? 0,
      perKmRs: formatFuelRupeesFromPaise(equal.fuelPaisePerKm) ?? 12,
    };
  }, [usualRoad?.distanceMeters, petrolPaise, seats]);
  const filledStopSlots = useMemo(() => {
    const set = new Set(savedStops.map((s) => s.seq));
    return set;
  }, [savedStops]);

  useEffect(() => {
    if (activeVehicles.length === 0) return;
    const preferBike = activeVehicles.some((v) => v.vehicle_type === 'bike');
    const preferCar = activeVehicles.some((v) => v.vehicle_type === 'car');
    if (vehicleKind === 'bike' && !preferBike && preferCar) setVehicleKind('car');
    if (vehicleKind === 'car' && !preferCar && preferBike) setVehicleKind('bike');
  }, [activeVehicles, vehicleKind]);

  useEffect(() => {
    if (kindVehicles.some((v) => v.id === vehicleId)) return;
    setVehicleId(kindVehicles[0]?.id || '');
  }, [kindVehicles, vehicleId]);

  useEffect(() => {
    if (!selected) return;
    setSeats(Math.min(seats, selected.seat_capacity) || selected.seat_capacity);
  }, [selected?.id]);

  useEffect(() => {
    if (tabBootstrapped) return;
    if (!hasVehicle) {
      setTab('vehicle');
    } else if (!pinsReady) {
      setTab('route');
    } else if (!weekConfigured) {
      setTab('week');
    } else {
      setTab('publish');
    }
    setTabBootstrapped(true);
  }, [tabBootstrapped, hasVehicle, pinsReady, weekConfigured]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('cleaner_city_get_fuel_public_config');
        if (error || cancelled || !data) return;
        const paise = Number((data as { petrol_paise_per_litre?: number }).petrol_paise_per_litre);
        if (Number.isFinite(paise) && paise > 0) setPetrolPaise(paise);
      } catch {
        /* keep default */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!daySchedule?.is_working) return;
    if (direction === 'to_office' && daySchedule.depart_time) {
      setDepartTime(String(daySchedule.depart_time).slice(0, 5));
    }
    if (direction === 'to_home' && daySchedule.return_time) {
      setDepartTime(String(daySchedule.return_time).slice(0, 5));
    }
  }, [daySchedule?.date, daySchedule?.depart_time, daySchedule?.return_time, direction]);

  useEffect(() => {
    if (!stopPubId && publications[0]?.id) setStopPubId(publications[0].id);
  }, [publications, stopPubId]);

  useEffect(() => {
    if (justPublishedId) {
      setStopPubId(justPublishedId);
    }
  }, [justPublishedId]);

  useEffect(() => {
    const existing = savedStops.find((s) => s.seq === stopSeq);
    if (existing) {
      setStopPin({
        lat: existing.latitude,
        lng: existing.longitude,
        label: existing.label,
      });
    } else {
      setStopPin(null);
    }
  }, [stopSeq, stopPubId, savedStops]);

  const selectedPub = publications.find((p) => p.id === stopPubId) || null;

  useEffect(() => {
    if (savedStops.length < 1 || !selectedPub || !isLoaded) {
      setDropPlan(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      const origin =
        selectedPub.direction === 'to_home'
          ? office
            ? { lat: office.latitude, lng: office.longitude }
            : null
          : pickupLat != null && pickupLng != null
            ? { lat: pickupLat, lng: pickupLng }
            : null;
      const destination =
        selectedPub.direction === 'to_home'
          ? pickupLat != null && pickupLng != null
            ? { lat: pickupLat, lng: pickupLng }
            : null
          : office
            ? { lat: office.latitude, lng: office.longitude }
            : null;
      if (!origin || !destination) {
        setDropPlan(null);
        return;
      }
      try {
        const plan = await planDropSequence({
          origin,
          destination,
          stops: savedStops.map((s) => ({
            id: s.id,
            label: s.label,
            lat: s.latitude,
            lng: s.longitude,
          })),
        });
        if (cancelled) return;
        setDropPlan(plan);
        if (selectedPub?.id && plan.ordered.length >= 1) {
          try {
            await setDropOrder.mutateAsync({
              publication_id: selectedPub.id,
              drop_order: {
                provider: plan.provider,
                distanceMeters: plan.distanceMeters,
                durationSeconds: plan.durationSeconds,
                polyline: plan.polyline,
                ordered: plan.ordered,
                savedAt: new Date().toISOString(),
              },
            });
          } catch {
            // Best-effort persist
          }
        }
      } catch {
        if (!cancelled) setDropPlan(null);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    savedStops,
    selectedPub?.id,
    selectedPub?.direction,
    isLoaded,
    office?.latitude,
    office?.longitude,
    pickupLat,
    pickupLng,
  ]);

  const persistPreferred = async (
    alt: RouteAlternative,
    routeOrigin: { lat: number; lng: number },
    routeDest: { lat: number; lng: number },
    routeDirection: 'to_office' | 'to_home',
  ) => {
    const payload = {
      polyline: alt.polyline,
      distanceMeters: alt.distanceMeters,
      durationSeconds: alt.durationSeconds,
      summary: alt.summary,
      originLat: routeOrigin.lat,
      originLng: routeOrigin.lng,
      destLat: routeDest.lat,
      destLng: routeDest.lng,
      savedAt: new Date().toISOString(),
    };
    if (user?.id) savePreferredRoute(user.id, payload, routeDirection);
    try {
      await setPreferredRoute.mutateAsync({
        polyline: payload.polyline,
        distanceMeters: payload.distanceMeters,
        durationSeconds: payload.durationSeconds,
        summary: payload.summary,
        originLat: payload.originLat,
        originLng: payload.originLng,
        destLat: payload.destLat,
        destLng: payload.destLng,
        direction: routeDirection,
      });
    } catch {
      // localStorage already written - DB sync best-effort
    }
  };

  const resolvePublishRoute = async (
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
  ): Promise<RouteAlternative | null> => {
    const routeDirection = (direction === 'to_home' ? 'to_home' : 'to_office') as
      | 'to_office'
      | 'to_home';

    const fromProfile = preferredRouteFromProfile(profile, routeDirection);
    const fromLocal = loadPreferredRoute(user?.id, routeDirection);
    const preferred = fromProfile || fromLocal;

    if (preferredRouteMatchesPins(preferred, origin, destination)) {
      return {
        id: 'preferred',
        polyline: preferred!.polyline,
        distanceMeters: preferred!.distanceMeters,
        durationSeconds: preferred!.durationSeconds,
        summary: preferred!.summary || 'Saved road',
        provider: 'google',
        path: [],
      };
    }

    if (publishRouteId && publishAlts.length) {
      const picked = publishAlts.find((a) => a.id === publishRouteId);
      if (picked) return picked;
    }

    if (!isLoaded) {
      if (offlineConfirm) {
        const fallback = await fetchDrivingRoute(origin, destination);
        toast.message('Publishing with approximate path - Maps was offline');
        return {
          id: 'offline-approx',
          polyline: fallback.polyline,
          distanceMeters: fallback.distanceMeters,
          durationSeconds: fallback.durationSeconds,
          summary: fallback.summary || 'Approximate path',
          provider: fallback.provider,
          path: fallback.path,
        };
      }
      toast.error('Maps is still loading - wait, or confirm approximate path below');
      return null;
    }

    try {
      const alts = await fetchDrivingRouteAlternatives(origin, destination);
      if (alts.length === 0) {
        const fallback = await fetchDrivingRoute(origin, destination);
        toast.message('Using approximate path - Google returned no alternatives');
        return {
          id: 'fallback-0',
          polyline: fallback.polyline,
          distanceMeters: fallback.distanceMeters,
          durationSeconds: fallback.durationSeconds,
          summary: fallback.summary || 'Approximate path',
          provider: fallback.provider,
          path: fallback.path,
        };
      }
      if (alts.length === 1) return alts[0];

      setPublishAlts(alts);
      setNeedRoutePick(true);
      setPublishRouteId(null);
      toast.message('Tap a route card to publish on that road');
      return null;
    } catch (e: any) {
      toast.error(e?.message || 'Could not load driving routes - try again');
      return null;
    }
  };

  const publishRide = async (forcedRoute?: RouteAlternative | null) => {
    if (!ready) {
      toast.error('Verify work email and host role first');
      return;
    }
    if (!vehicleId) {
      toast.error('Add an active vehicle first');
      return;
    }
    if (!pinsReady) {
      toast.error('Add home and office pins on Route, then publish');
      setTab('route');
      return;
    }
    if (selected && seats > selected.seat_capacity) {
      toast.error('Capacity cannot exceed your vehicle');
      return;
    }
    if (!canPublishDay) {
      toast.message('This date looks off on your week plan - publishing this one trip anyway');
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

      const chosen = forcedRoute || (await resolvePublishRoute(origin, destination));
      if (!chosen) {
        return;
      }
      const geometryOk = isPublishableRouteGeometry({
        polyline: chosen.polyline,
        path: chosen.path,
        provider: chosen.provider,
        origin,
        destination,
      });
      if (!geometryOk.ok) {
        toast.error(geometryOk.reason);
        return;
      }

      const pub = await publish.mutateAsync({
        vehicle_id: vehicleId,
        travel_date: travelDate,
        direction,
        depart_time: departTime,
        seats_available: seats,
        route_polyline: chosen.polyline,
      });

      try {
        await storeRoute.mutateAsync({
          publication_id: pub.id,
          route_polyline: chosen.polyline,
          origin_latitude: origin.lat,
          origin_longitude: origin.lng,
          destination_latitude: destination.lat,
          destination_longitude: destination.lng,
          origin_label:
            direction === 'to_office'
              ? selected?.preferred_pickup_label || weekdayTemplate?.pickup_label || 'Pickup area'
              : office.label || 'Office',
          destination_label:
            direction === 'to_office'
              ? office.label || 'Office'
              : selected?.preferred_drop_label || weekdayTemplate?.pickup_label || 'Home area',
          route_distance_meters: chosen.distanceMeters,
          route_duration_seconds: chosen.durationSeconds,
          route_provider: chosen.provider,
        });
        await persistPreferred(
          chosen,
          origin,
          destination,
          direction === 'to_home' ? 'to_home' : 'to_office',
        );
      } catch (storeErr: any) {
        // Geometry store is required for matching/fuel - roll back live inventory.
        try {
          await cancelPub.mutateAsync(pub.id);
        } catch {
          /* best-effort cancel */
        }
        throw new Error(
          storeErr?.message ||
            'Could not save the driving road on this offer - rebuild the usual road and publish again',
        );
      }

      setNeedRoutePick(false);
      setPublishAlts([]);
      setPublishRouteId(null);
      setJustPublishedId(pub.id);
      toast.success('Seats are live');
      navigate('/cleaner-city/find', {
        state: {
          openHosting: true,
          notice: 'Seats published. Accept requests from the Hosting card at the top.',
          justPublishedId: pub.id,
        },
      });
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

  const saveExtraStop = async () => {
    if (!stopPubId) {
      toast.error('Publish a ride first, then add a matching pin if needed');
      setTab('publish');
      return;
    }
    if (
      !stopPin ||
      !stopPin.label.trim() ||
      !Number.isFinite(stopPin.lat) ||
      !Number.isFinite(stopPin.lng)
    ) {
      toast.error('Search or move the blue pin onto the extra office gate');
      return;
    }
    try {
      await setStop.mutateAsync({
        publication_id: stopPubId,
        seq: stopSeq,
        label: stopPin.label.trim(),
        latitude: stopPin.lat,
        longitude: stopPin.lng,
      });
      toast.success(`Stop ${stopSeq} saved`);
      const nextEmpty = [1, 2, 3, 4, 5].find((n) => n !== stopSeq && !filledStopSlots.has(n));
      if (nextEmpty) setStopSeq(nextEmpty);
    } catch (e: any) {
      toast.error(e?.message || 'Could not save stop');
    }
  };

  const maxSeats = selected?.seat_capacity || (vehicleKind === 'bike' ? 1 : 3);

  return (
    <CleanerCityChrome headerTitle="Play · Offer">
      <CleanerCityGate>
        <div
          className="mx-auto flex w-full max-w-lg flex-col gap-5 px-4 pb-28 pt-4"
          data-testid="cleaner-city-offer-page"
        >
          {arrivalNotice ? (
            <div className="rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm leading-relaxed">
              {arrivalNotice}
            </div>
          ) : null}

          <CleanerCityPlaySwitch mode="offer" hasPins={pinsReady} hasRoads={hasRoads} />

          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Offer a ride</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Share your everyday route and split the journey.
            </p>
          </div>

          {!ready ? (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed">
              Complete{' '}
              <Link to="/cleaner-city/setup" className="font-semibold text-primary underline">
                set up + work email
              </Link>
              , host role, and a{' '}
              <Link to="/cleaner-city/vehicle" className="font-semibold text-primary underline">
                vehicle
              </Link>{' '}
              before publishing.
            </div>
          ) : null}

          {ready && !hasVerifiedEmergency ? (
            <div
              className="rounded-2xl border border-border bg-muted/30 px-4 py-3 text-sm leading-relaxed text-muted-foreground"
              data-testid="cleaner-city-offer-emergency-gate"
            >
              Optional:{' '}
              <Link to="/cleaner-city/safety" className="font-semibold text-emerald-900 underline">
                add an emergency contact
              </Link>{' '}
              in You - Safety for SOS. Not required to publish.
            </div>
          ) : null}

          <Tabs value={tab} onValueChange={(v) => setTab(v as OfferTab)} className="w-full">
            <div className="overflow-x-auto">
              <nav
                className="flex min-w-max gap-1 border-b border-border"
                data-testid="cleaner-city-offer-tabs"
              >
                {OFFER_TAB_ORDER.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={cn(
                      'shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors',
                      tab === item.id
                        ? 'border-emerald-600 text-emerald-800'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            </div>

            <TabsContent value="vehicle" className="mt-5 focus-visible:outline-none space-y-4">
              <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div>
                  <p className="text-sm font-extrabold">1. Vehicle</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Required before you can publish empty seats.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Vehicle type
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setVehicleKind('bike')}
                      className={cn(
                        'flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold',
                        vehicleKind === 'bike'
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                          : 'border-border',
                      )}
                    >
                      <Bike className="h-4 w-4" />
                      Two-wheeler
                    </button>
                    <button
                      type="button"
                      onClick={() => setVehicleKind('car')}
                      className={cn(
                        'flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold',
                        vehicleKind === 'car'
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                          : 'border-border',
                      )}
                    >
                      <Car className="h-4 w-4" />
                      Four-wheeler
                    </button>
                  </div>
                  <select
                    className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
                    value={vehicleId}
                    onChange={(e) => setVehicleId(e.target.value)}
                    data-testid="cleaner-city-offer-vehicle"
                  >
                    {kindVehicles.length === 0 && <option value="">No active vehicle</option>}
                    {kindVehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.vehicle_type.toUpperCase()} · {v.registration_number} · {v.seat_capacity}{' '}
                        seats
                      </option>
                    ))}
                  </select>
                  {kindVehicles.length === 0 ? (
                    <Button asChild className="h-11 bg-emerald-800 font-semibold hover:bg-emerald-900">
                      <Link to="/cleaner-city/vehicle">Add a vehicle</Link>
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      className="h-11 bg-emerald-800 font-semibold hover:bg-emerald-900"
                      onClick={() => setTab(pinsReady ? (weekConfigured ? 'publish' : 'week') : 'route')}
                    >
                      Continue
                    </Button>
                  )}
                </div>
              </section>
            </TabsContent>

            <TabsContent value="route" className="mt-5 focus-visible:outline-none space-y-4">
              <section
                className="rounded-2xl border border-border bg-card p-4 shadow-sm"
                data-testid="cleaner-city-offer-missing-pins"
              >
                <p className="mb-3 text-sm font-extrabold">2. Home, office, usual road</p>
                <CleanerCityRouteSetupPanel
                  compact
                  quiet
                  onSaved={(info) => {
                    if (info?.officeDone && info?.pickupDone) {
                      setTab(weekConfigured ? 'publish' : 'week');
                    }
                  }}
                />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Full map on{' '}
                  <Link to="/cleaner-city/route" className="font-semibold text-emerald-900">
                    Route
                  </Link>
                  .
                </p>
              </section>
            </TabsContent>

            <TabsContent value="publish" className="mt-5 focus-visible:outline-none">
              <div className="flex flex-col gap-4">
              {!hasVehicle ? (
                <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
                  Add a vehicle first.{' '}
                  <button type="button" className="font-semibold text-emerald-900" onClick={() => setTab('vehicle')}>
                    Open Vehicle
                  </button>
                </div>
              ) : null}
              {!pinsReady ? (
                <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
                  Set home and office on Route first.{' '}
                  <button type="button" className="font-semibold text-emerald-900" onClick={() => setTab('route')}>
                    Open Route
                  </button>
                </div>
              ) : null}
              <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-2 text-base font-extrabold">
                      <Sparkles size={16} className="text-emerald-700" />
                      This ride
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      One leave-time. Neighbours on your corridor can request a seat.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="rounded-xl border border-border bg-background px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Pickup location
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <MapPin className="h-4 w-4 shrink-0 text-emerald-700" />
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold">{pickupLabel}</p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-background px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Office destination
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <Navigation className="h-4 w-4 shrink-0 text-emerald-700" />
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold">{officeLabel}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="text-left text-xs font-semibold text-emerald-900"
                    onClick={() => setTab('route')}
                  >
                    Change home, office, or road
                  </button>
                </div>

                <div className="rounded-xl border border-border bg-muted/20 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Selected route
                  </p>
                  <p className="mt-2 text-sm font-medium leading-relaxed">
                    {pickupLabel} to {officeLabel}
                  </p>
                  {usualRoad ? (
                    <p
                      className="mt-2 inline-flex max-w-full items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-900"
                      data-testid="cleaner-city-offer-usual-route"
                    >
                      {usualRoad.summary || 'Usual road'}
                      {usualRoad.distanceMeters
                        ? ` · ${(usualRoad.distanceMeters / 1000).toFixed(1)} km`
                        : ''}
                      {usualRoad.durationSeconds
                        ? ` · ~${Math.max(1, Math.round(usualRoad.durationSeconds / 60))} min`
                        : ''}
                    </p>
                  ) : (
                    <button
                      type="button"
                      className="mt-2 text-[11px] font-semibold text-emerald-900"
                      data-testid="cleaner-city-offer-set-route"
                      onClick={() => setTab('route')}
                    >
                      Pick your usual road
                    </button>
                  )}
                </div>

                <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-900/70">
                        Using your week
                      </p>
                      <p className="mt-0.5 text-xs text-emerald-950">
                        Defaults from My week · change date or leave time below for this ride only
                      </p>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 text-xs font-semibold text-emerald-900"
                      onClick={() => setTab('week')}
                    >
                      Edit week
                    </button>
                  </div>
                </div>

                <div
                  className="space-y-3 rounded-xl border border-border bg-background p-3"
                  data-testid="cleaner-city-offer-this-ride"
                >
                  <p className="text-sm font-extrabold">When are you leaving?</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Date
                      </Label>
                      <div className="relative">
                        <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="date"
                          value={travelDate}
                          min={today}
                          onChange={(e) => setTravelDate(e.target.value)}
                          className="h-11 pl-9"
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {formatOfferDateLabel(travelDate)}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Leave at
                      </Label>
                      <div className="relative">
                        <Clock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="time"
                          value={departTime}
                          onChange={(e) => setDepartTime(e.target.value)}
                          className="h-11 pl-9"
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {formatLeaveLabel(departTime)} - this ride only
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {CLEANER_CITY_DIRECTIONS.map((d) => (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => {
                          setDirection(d.value);
                          if (d.value === 'to_home' && daySchedule?.return_time) {
                            setDepartTime(String(daySchedule.return_time).slice(0, 5));
                          } else if (d.value === 'to_office' && daySchedule?.depart_time) {
                            setDepartTime(String(daySchedule.depart_time).slice(0, 5));
                          }
                        }}
                        className={cn(
                          'rounded-xl border px-3 py-3 text-sm font-semibold',
                          direction === d.value
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                            : 'border-border bg-background',
                        )}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Available seats
                  </Label>
                  <div
                    className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2"
                    data-testid="cleaner-city-offer-seats"
                  >
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 rounded-full"
                      disabled={seats <= 1}
                      onClick={() => setSeats((n) => Math.max(1, n - 1))}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <p className="text-sm font-semibold">
                      {seats} seat{seats === 1 ? '' : 's'}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 rounded-full"
                      disabled={seats >= maxSeats}
                      onClick={() => {
                        if (seats + 1 > maxSeats) {
                          toast.error('Capacity cannot exceed your vehicle');
                          return;
                        }
                        setSeats((n) => Math.min(maxSeats, n + 1));
                      }}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  {selected ? (
                    <p className="text-[11px] text-muted-foreground">
                      Max {selected.seat_capacity} for this {selected.vehicle_type}. Capacity cannot
                      exceed your vehicle.
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1.5 rounded-xl border border-border bg-background px-3 py-3">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Estimated fuel share / guest
                  </Label>
                  <p className="text-lg font-extrabold text-emerald-900">
                    ₹{fuelEstimate.guestRs}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Automatic share from road distance · petrol ₹
                    {(petrolPaise / 100).toFixed(0)}/L · {FUEL_MILEAGE_KM_PER_LITRE} km/L · about ₹
                    {fuelEstimate.perKmRs}/km. Journey total about ₹{fuelEstimate.totalRs} split with
                    you. No markup. You cannot edit this amount.
                  </p>
                </div>

                <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2.5 text-sm text-emerald-950">
                  <Shield className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className="text-xs leading-relaxed">
                    Your phone number stays private until you accept a booking.
                  </p>
                </div>

                {needRoutePick && publishAlts.length > 1 ? (
                  <div
                    className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3"
                    data-testid="cleaner-city-offer-route-pick"
                  >
                    <p className="text-sm font-semibold">Which road will you take?</p>
                    <p className="text-xs text-muted-foreground">
                      Google found more than one path - tap a card to publish on that road.
                    </p>
                    {publishAlts.map((alt) => {
                      const mins = Math.round(alt.durationSeconds / 60);
                      const km = (alt.distanceMeters / 1000).toFixed(1);
                      const selectedAlt = publishRouteId === alt.id;
                      return (
                        <button
                          key={alt.id}
                          type="button"
                          disabled={publish.isPending}
                          onClick={() => {
                            setPublishRouteId(alt.id);
                            void publishRide(alt);
                          }}
                          className={cn(
                            'w-full rounded-xl border px-3 py-2.5 text-left',
                            selectedAlt
                              ? 'border-primary bg-primary/10'
                              : 'border-border bg-card',
                          )}
                          data-testid="cleaner-city-offer-route-alt"
                        >
                          <p className="flex items-center gap-1.5 text-sm font-semibold">
                            {selectedAlt ? <Check size={14} className="text-primary" /> : null}
                            {alt.summary}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            ~{mins} min · {km} km · tap to publish
                          </p>
                        </button>
                      );
                    })}
                    {publishRouteId ? (
                      <CleanerCityRoutePreview
                        path={publishAlts.find((a) => a.id === publishRouteId)?.path}
                        polyline={publishAlts.find((a) => a.id === publishRouteId)?.polyline}
                        testId="cleaner-city-offer-route-preview"
                      />
                    ) : null}
                  </div>
                ) : null}

                {!isLoaded ? (
                  <label
                    className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-3"
                    data-testid="cleaner-city-offer-offline-confirm"
                  >
                    <Checkbox
                      checked={offlineConfirm}
                      onCheckedChange={(v) => setOfflineConfirm(v === true)}
                      className="mt-0.5"
                    />
                    <span className="text-xs leading-relaxed">
                      Maps is still loading. I confirm publishing with an approximate path if Google
                      is unavailable.
                    </span>
                  </label>
                ) : null}

                {needRoutePick && publishAlts.length > 1 ? null : (
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-12 font-semibold"
                      onClick={() => {
                        toast.message('Kept on Offer - come back when you are ready to publish');
                        navigate('/cleaner-city');
                      }}
                    >
                      Save for later
                    </Button>
                    <Button
                      className="h-12 gap-1.5 bg-emerald-800 text-base font-semibold hover:bg-emerald-900"
                      onClick={() => void publishRide()}
                      disabled={
                        publish.isPending ||
                        !ready ||
                        !pinsReady ||
                        (!isLoaded && !offlineConfirm)
                      }
                      data-testid="cleaner-city-offer-publish"
                    >
                      {!isLoaded && !offlineConfirm ? 'Waiting for Maps...' : 'Publish ride'}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </section>
              </div>
            </TabsContent>

            <TabsContent value="week" className="mt-5 focus-visible:outline-none">
              <div className="flex flex-col gap-5">
                <div className="rounded-2xl border border-border bg-card px-5 py-5 shadow-sm">
                  <p className="text-sm font-extrabold">3. My week</p>
                  <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                    Office days, leave home, and leave office. Tap a day off for WFH. This ride
                    starts from these defaults - you can still change one leave-time there without
                    rewriting your week.
                  </p>
                </div>
                <CleanerCityWeeklyPlanCard
                  onSaved={(info) => {
                    if (direction === 'to_home') setDepartTime(info.returnTime);
                    else setDepartTime(info.depart);
                    toast.message('Week saved - open This ride to publish');
                  }}
                />
                <Button
                  type="button"
                  className="h-11 w-full bg-emerald-800 font-semibold hover:bg-emerald-900"
                  onClick={() => setTab('publish')}
                >
                  Continue to this ride
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="rides" className="mt-6 focus-visible:outline-none">
              <div className="flex flex-col gap-6">
                <div className="rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm leading-relaxed">
                  <p className="font-semibold text-foreground">My rides = your seat offers</p>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                    Each card is one leave-time you published. Guests appear with name, flat,
                    status, meeting point, and pickup/drop pins after they request or you accept.
                  </p>
                </div>

                {publications.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center">
                    <p className="text-sm font-semibold">No live rides yet</p>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Publish seats on the Publish tab first.
                    </p>
                    <Button type="button" className="mt-4" onClick={() => setTab('publish')}>
                      Go to publish
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3" data-testid="cleaner-city-offer-rides-board">
                    {publications.map((p) => (
                      <HostOfferRideCard
                        key={p.id}
                        publication={p}
                        vehicle={p.vehicle_id ? vehicleById[p.vehicle_id] : null}
                        guests={hostGuestsByPublication[p.id] || []}
                        todayIso={today}
                        focused={focusPublicationId === p.id || justPublishedId === p.id}
                        onCancel={() => cancel(p.id)}
                        cancelPending={cancelPub.isPending}
                      />
                    ))}
                  </div>
                )}

                {publications.length > 0 ? (
                  <button
                    type="button"
                    className="py-1 text-center text-sm font-semibold text-primary"
                    onClick={() => setTab('stops')}
                  >
                    Optional match pin (not guest drops)
                  </button>
                ) : null}
              </div>
            </TabsContent>

            <TabsContent value="stops" className="mt-6 focus-visible:outline-none">
              <div className="flex flex-col gap-6" data-testid="cleaner-city-extra-stops">
                <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
                  <div className="flex items-start gap-2">
                    <MapPinned size={18} className="mt-0.5 shrink-0 text-primary" />
                    <div>
                      <h2 className="text-base font-semibold">Optional matching pins</h2>
                      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                        Not for accepted guest drops. Guests pin their own destination when they
                        request, and Active Ride builds the drop order automatically. Use this only
                        if you also pass a second office corridor so Find can match guests near that
                        pin. Search or move the blue pin - no typed coordinates.
                      </p>
                    </div>
                  </div>

                  {publications.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
                      <p className="text-sm font-semibold">Publish a ride first</p>
                      <Button type="button" className="mt-3" onClick={() => setTab('publish')}>
                        Go to publish
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-col gap-2">
                        <Label>Which ride?</Label>
                        <select
                          className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
                          value={stopPubId}
                          onChange={(e) => setStopPubId(e.target.value)}
                        >
                          {publications.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.travel_date} · {String(p.depart_time).slice(0, 5)} ·{' '}
                              {p.direction.replace('_', ' ')}
                            </option>
                          ))}
                        </select>
                        {selectedPub ? (
                          <p className="text-[11px] text-muted-foreground">
                            Main route: {selectedPub.origin_label || 'Pickup'} to{' '}
                            {selectedPub.destination_label || 'Office'}
                          </p>
                        ) : null}
                      </div>

                      <div>
                        <p className="mb-2 text-xs font-semibold text-muted-foreground">
                          Stop slots ({filledStopSlots.size}/5 filled)
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {[1, 2, 3, 4, 5].map((n) => {
                            const filled = filledStopSlots.has(n);
                            return (
                              <button
                                key={n}
                                type="button"
                                className={cn(
                                  'inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold',
                                  stopSeq === n && 'border-primary bg-primary/10 text-primary',
                                  stopSeq !== n && filled && 'border-emerald-500/40 text-foreground',
                                  stopSeq !== n && !filled && 'border-border text-muted-foreground',
                                )}
                                onClick={() => setStopSeq(n)}
                              >
                                {filled ? <Check size={11} className="text-emerald-500" /> : null}
                                Stop {n}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <CleanerCityPinPicker
                        title={`Pin for stop ${stopSeq}`}
                        hint="Search the office or society gate, then fine-tune with the blue pin"
                        value={stopPin}
                        onChange={setStopPin}
                        testId="cleaner-city-stop-pin"
                      />

                      <Button
                        type="button"
                        className="h-12 w-full font-semibold"
                        disabled={setStop.isPending}
                        onClick={saveExtraStop}
                      >
                        Save stop {stopSeq}
                      </Button>
                    </>
                  )}
                </section>

                {savedStops.length > 0 ? (
                  <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
                    <h2 className="text-sm font-semibold">Saved on this ride</h2>
                    {savedStops.map((s) => (
                      <div
                        key={s.id}
                        className="rounded-xl border border-border px-3.5 py-3 text-xs"
                      >
                        <p className="font-semibold">
                          Stop {s.seq} · {s.label}
                        </p>
                        <p className="mt-0.5 text-muted-foreground">Pinned on map</p>
                      </div>
                    ))}
                  </section>
                ) : null}

                {dropPlan && dropPlan.ordered.length >= 1 ? (
                  <section
                    className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-5"
                    data-testid="cleaner-city-drop-order-preview"
                  >
                    <div>
                      <h2 className="text-sm font-semibold">Match-pin visit order</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Optional corridor pins only - accepted guest drops are ordered on Active Ride
                        {dropPlan.durationSeconds
                          ? ` · ~${Math.round(dropPlan.durationSeconds / 60)} min total`
                          : ''}
                      </p>
                    </div>
                    {dropPlan.ordered.map((stop) => (
                      <div
                        key={stop.id}
                        className="rounded-xl border border-border bg-card px-3.5 py-3 text-sm"
                      >
                        <p className="font-semibold">
                          Drop {stop.dropIndex} · {stop.label}
                        </p>
                      </div>
                    ))}
                    {selectedPub && pinsReady ? (
                      <Button
                        type="button"
                        className="h-11 w-full font-semibold"
                        onClick={() => {
                          const origin =
                            selectedPub.direction === 'to_home'
                              ? { lat: office!.latitude, lng: office!.longitude }
                              : { lat: pickupLat!, lng: pickupLng! };
                          const destination =
                            selectedPub.direction === 'to_home'
                              ? { lat: pickupLat!, lng: pickupLng! }
                              : { lat: office!.latitude, lng: office!.longitude };
                          openGoogleMapsDirections({
                            origin,
                            destination,
                            waypoints: dropPlan.ordered.map((s) => ({
                              lat: s.lat,
                              lng: s.lng,
                            })),
                          });
                        }}
                      >
                        Open in Google Maps
                      </Button>
                    ) : null}
                  </section>
                ) : null}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </CleanerCityGate>
    </CleanerCityChrome>
  );
}
