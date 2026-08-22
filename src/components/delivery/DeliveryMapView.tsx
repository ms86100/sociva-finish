/// <reference types="@types/google.maps" />
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';
import { useTrackingConfig } from '@/hooks/useTrackingConfig';
import {
  ARRIVING_METERS,
  BACKWARD_IGNORE_METERS,
  OFF_ROUTE_REROUTE_METERS,
  buildLongDistancePath,
  buildRouteMetrics,
  haversineMeters,
  headingDelta,
  isLongDistance,
  lerpHeading,
  lookAheadPoint,
  nextDisplayDistance,
  poseAtDistance,
  resolveTrackingPhase,
  snapToRoute,
  splitRouteAtDistance,
  type LatLng,
  type TrackingPhase,
} from '@/lib/delivery-tracking-geometry';
import {
  DASH_ROUTE,
  RECENTER_ICON_SVG,
  ROUTE_BLUE,
  ROUTE_BLUE_MUTED,
  ROUTE_HALO,
  SOCIVA_TRACKING_MAP_STYLE,
  TRACKING_MAP_CSS,
} from '@/lib/delivery-map-style';
import {
  createTrackingOverlays,
  type PinOverlayHandle,
  type VehicleOverlayHandle,
} from '@/components/delivery/delivery-map-overlays';

interface DeliveryMapViewProps {
  riderLat: number;
  riderLng: number;
  destinationLat: number;
  destinationLng: number;
  riderName?: string | null;
  heading?: number | null;
  onRoadEtaChange?: (eta: number | null) => void;
  sellerLat?: number | null;
  sellerLng?: number | null;
  sellerName?: string | null;
  isPickedUp?: boolean;
  tall?: boolean;
  onRouteInfo?: (info: { totalDistance: number; remainingDistance: number }) => void;
  proximityStatus?: string | null;
  distanceMeters?: number | null;
}

type RouteMode = 'road' | 'long-distance';

interface FetchedRoute {
  coords: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
  mode: RouteMode;
}

let cssInjected = false;
function injectTrackingCss() {
  if (cssInjected || typeof document === 'undefined') return;
  if (document.getElementById('sociva-tracking-map-css')) {
    cssInjected = true;
    return;
  }
  const el = document.createElement('style');
  el.id = 'sociva-tracking-map-css';
  el.textContent = TRACKING_MAP_CSS;
  document.head.appendChild(el);
  cssInjected = true;
}

function dashIcons(offsetPx: number): google.maps.IconSequence[] {
  return [{
    icon: {
      path: 'M 0,-1 0,1',
      strokeOpacity: 1,
      strokeColor: DASH_ROUTE,
      strokeWeight: 2.4,
      scale: 2.6,
    },
    offset: `${offsetPx.toFixed(1)}px`,
    repeat: '14px',
  }];
}

let googleDirectionsUnavailable = false;

async function fetchGoogleDirections(from: LatLng, to: LatLng): Promise<FetchedRoute | null> {
  if (googleDirectionsUnavailable || !window.google?.maps?.DirectionsService) return null;
  try {
    const svc = new google.maps.DirectionsService();
    const result = await new Promise<google.maps.DirectionsResult>((resolve, reject) => {
      svc.route(
        {
          origin: from,
          destination: to,
          travelMode: google.maps.TravelMode.DRIVING,
          provideRouteAlternatives: false,
        },
        (res, status) => {
          if (status === google.maps.DirectionsStatus.OK && res) resolve(res);
          else reject(status);
        },
      );
    });
    const route = result.routes?.[0];
    const leg = route?.legs?.[0];
    if (!route || !leg) return null;
    const coords: LatLng[] = [];
    for (const currentLeg of route.legs) {
      for (const step of currentLeg.steps || []) {
        for (const p of step.path || []) {
          coords.push({ lat: p.lat(), lng: p.lng() });
        }
      }
    }
    if (coords.length < 2 && route.overview_path?.length) {
      coords.push(...route.overview_path.map((p) => ({ lat: p.lat(), lng: p.lng() })));
    }
    if (coords.length < 2) return null;
    return {
      coords,
      distanceMeters: route.legs.reduce((sum, item) => sum + (item.distance?.value ?? 0), 0) || Math.round(haversineMeters(from, to)),
      durationSeconds: route.legs.reduce((sum, item) => sum + (item.duration?.value ?? 0), 0) || Math.max(60, Math.round(haversineMeters(from, to) / 6.5)),
      mode: 'road',
    };
  } catch (status) {
    if (status === 'REQUEST_DENIED' || status === google.maps?.DirectionsStatus?.REQUEST_DENIED) {
      googleDirectionsUnavailable = true;
    }
    return null;
  }
}

async function fetchOsrmRoute(from: LatLng, to: LatLng, timeoutMs: number, signal: AbortSignal): Promise<FetchedRoute | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal.addEventListener('abort', onAbort);
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const route = data.routes?.[0];
    if (!route?.geometry?.coordinates?.length) return null;
    return {
      coords: route.geometry.coordinates.map((c: [number, number]) => ({ lat: c[1], lng: c[0] })),
      distanceMeters: Math.round(route.distance ?? haversineMeters(from, to)),
      durationSeconds: Math.round(route.duration ?? haversineMeters(from, to) / 6.5),
      mode: 'road',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', onAbort);
  }
}

function rushAdjustedEtaMinutes(durationSeconds: number): number {
  let etaMin = Math.max(1, Math.ceil(durationSeconds / 60));
  const hour = new Date().getHours();
  const isRushHour = (hour >= 8 && hour <= 10) || (hour >= 17 && hour <= 20);
  etaMin += 2 + (isRushHour ? 3 : 0);
  return etaMin;
}

function MapFallbackCard({
  riderLat, riderLng, destinationLat, destinationLng,
  riderName, roadEtaMinutes, roadDistanceMeters, tall,
  errorType, onRetry,
}: {
  riderLat: number; riderLng: number;
  destinationLat: number; destinationLng: number;
  riderName?: string | null;
  roadEtaMinutes: number | null;
  roadDistanceMeters: number | null;
  tall?: boolean;
  errorType?: string | null;
  onRetry?: () => void;
}) {
  const distText = roadDistanceMeters
    ? roadDistanceMeters < 1000 ? `${roadDistanceMeters}m` : `${(roadDistanceMeters / 1000).toFixed(1)} km`
    : null;
  const mapsUrl = `https://www.google.com/maps/dir/${riderLat},${riderLng}/${destinationLat},${destinationLng}`;
  const mapHeight = tall ? 'min-h-[280px]' : 'min-h-[200px]';

  const getErrorMessage = () => {
    if (errorType === 'AUTH_FAILED') {
      return "Google Maps API key is restricted. Add your app domain to the key's allowed referrers in Google Cloud Console.";
    }
    if (errorType === 'NO_API_KEY') {
      return 'Google Maps API key not configured. Add GOOGLE_MAPS_API_KEY as a project secret.';
    }
    if (errorType === 'SCRIPT_LOAD_FAILED') {
      return 'Failed to load Google Maps. Check your internet connection.';
    }
    return riderName ? `${riderName} is on the way` : 'Your order is on the way';
  };

  return (
    <div className={`rounded-xl border border-border bg-card/80 backdrop-blur-lg p-5 ${mapHeight} flex flex-col items-center justify-center gap-3 shadow-sm`}>
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
        <AlertTriangle size={24} className="text-muted-foreground" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-sm font-semibold text-foreground">Live map unavailable</p>
        <p className="text-xs text-muted-foreground max-w-[280px]">{getErrorMessage()}</p>
      </div>
      {(roadEtaMinutes || distText) && (
        <div className="flex items-center gap-4">
          {roadEtaMinutes && (
            <div className="text-center">
              <p className="text-lg font-bold text-primary">{roadEtaMinutes} min</p>
              <p className="text-[10px] text-muted-foreground">ETA</p>
            </div>
          )}
          {distText && (
            <div className="text-center">
              <p className="text-lg font-bold text-foreground">{distText}</p>
              <p className="text-[10px] text-muted-foreground">Distance</p>
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        {onRetry && (
          <Button variant="outline" size="sm" className="gap-2" onClick={onRetry}>
            <RefreshCw size={14} />
            Retry
          </Button>
        )}
        <Button variant="outline" size="sm" className="gap-2" asChild>
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} />
            Open in Maps
          </a>
        </Button>
      </div>
    </div>
  );
}

export function DeliveryMapView({
  riderLat, riderLng, destinationLat, destinationLng,
  riderName, heading, onRoadEtaChange,
  sellerLat, sellerLng, sellerName,
  isPickedUp = true, tall, onRouteInfo,
  proximityStatus, distanceMeters,
}: DeliveryMapViewProps) {
  const { isLoaded, error: mapsError, retry } = useGoogleMaps();
  const config = useTrackingConfig();

  const mapRef = useRef<google.maps.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const vehicleRef = useRef<VehicleOverlayHandle | null>(null);
  const homeRef = useRef<(PinOverlayHandle & google.maps.OverlayView) | null>(null);
  const storeRef = useRef<(PinOverlayHandle & google.maps.OverlayView) | null>(null);
  const haloPolyRef = useRef<google.maps.Polyline | null>(null);
  const remainingPolyRef = useRef<google.maps.Polyline | null>(null);
  const completedPolyRef = useRef<google.maps.Polyline | null>(null);
  const dashPolyRef = useRef<google.maps.Polyline | null>(null);
  const rafRef = useRef(0);
  const dashOffsetRef = useRef(0);
  const lastPanAtRef = useRef(0);
  const lastPanPosRef = useRef<LatLng | null>(null);
  const initialFitDone = useRef(false);
  const followRef = useRef(true);
  const lastGpsRef = useRef<LatLng>({ lat: riderLat, lng: riderLng });
  const lastRouteFetchAt = useRef<{ from: LatLng; at: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastEtaRef = useRef<number | null>(null);
  const lastRouteInfoRef = useRef<{ total: number; remaining: number } | null>(null);
  const headingRef = useRef<number | null>(heading ?? null);
  const pickedUpRef = useRef(!!isPickedUp);
  const proximityRef = useRef(proximityStatus ?? null);
  const distanceRef = useRef(distanceMeters ?? null);
  const onRouteInfoRef = useRef(onRouteInfo);
  const phaseRef = useRef<TrackingPhase>('moving');

  headingRef.current = heading ?? null;
  pickedUpRef.current = !!isPickedUp;
  proximityRef.current = proximityStatus ?? null;
  distanceRef.current = distanceMeters ?? null;
  onRouteInfoRef.current = onRouteInfo;

  const engineRef = useRef({
    metrics: buildRouteMetrics([]),
    mode: 'road' as RouteMode,
    displayDist: 0,
    targetDist: 0,
    displayHeading: heading ?? 0,
    totalDurationSeconds: 0,
    totalDistanceMeters: 0,
    lastFrame: 0,
    lastPolyDist: -1,
  });

  const [showRecenter, setShowRecenter] = useState(false);
  const [mapAuthFailed, setMapAuthFailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [route, setRoute] = useState<FetchedRoute | null>(null);
  const [phase, setPhase] = useState<TrackingPhase>('moving');
  const [remainingHud, setRemainingHud] = useState<number | null>(null);

  const dest = useMemo(() => asPoint(destinationLat, destinationLng), [destinationLat, destinationLng]);
  const rider = useMemo(() => asPoint(riderLat, riderLng), [riderLat, riderLng]);
  const originLockRef = useRef<LatLng | null>(null);
  if (!originLockRef.current) originLockRef.current = rider;
  const origin = useMemo(
    () => (sellerLat != null && sellerLng != null ? asPoint(sellerLat, sellerLng) : originLockRef.current || rider),
    [sellerLat, sellerLng, rider],
  );

  const roadEtaMinutes = route ? rushAdjustedEtaMinutes(route.durationSeconds) : null;

  useEffect(() => { injectTrackingCss(); }, []);

  const applyRoute = useCallback((fetched: FetchedRoute, gps: LatLng) => {
    const metrics = buildRouteMetrics(fetched.coords);
    const snap = snapToRoute(metrics, gps);
    const engine = engineRef.current;
    const jumped = engine.metrics.total === 0 || Math.abs(snap.distanceAlong - engine.displayDist) > 400;
    engine.metrics = metrics;
    engine.mode = fetched.mode;
    engine.totalDurationSeconds = fetched.durationSeconds;
    engine.totalDistanceMeters = fetched.distanceMeters || metrics.total;
    engine.targetDist = snap.distanceAlong;
    if (jumped) engine.displayDist = snap.distanceAlong;
    const h = headingRef.current;
    if (h != null && !Number.isNaN(h)) engine.displayHeading = h;
    setRoute(fetched);
  }, []);

  const fetchRoute = useCallback(async (from: LatLng, to: LatLng, gps: LatLng, force = false) => {
    if (!force && lastRouteFetchAt.current) {
      const moved = haversineMeters(lastRouteFetchAt.current.from, from);
      if (moved < config.osrm_refetch_threshold_meters && Date.now() - lastRouteFetchAt.current.at < 4000) {
        return;
      }
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    lastRouteFetchAt.current = { from, at: Date.now() };

    const long = isLongDistance(from, to);
    if (long) {
      const coords = buildLongDistancePath(from, to);
      applyRoute({
        coords,
        distanceMeters: Math.round(haversineMeters(from, to)),
        durationSeconds: Math.max(3600, Math.round(haversineMeters(from, to) / 18)),
        mode: 'long-distance',
      }, gps);
      return;
    }

    let fetched = await fetchGoogleDirections(from, to);
    if (!fetched && !controller.signal.aborted) {
      fetched = await fetchOsrmRoute(from, to, config.osrm_timeout_ms, controller.signal);
    }
    if (controller.signal.aborted) return;
    if (!fetched) {
      applyRoute({
        coords: [from, to],
        distanceMeters: Math.round(haversineMeters(from, to)),
        durationSeconds: Math.max(60, Math.round(haversineMeters(from, to) / 6.5)),
        mode: isLongDistance(from, to) ? 'long-distance' : 'road',
      }, gps);
      return;
    }
    applyRoute(fetched, gps);
  }, [applyRoute, config.osrm_refetch_threshold_meters, config.osrm_timeout_ms]);

  // Fetch the visual master route once from pickup → destination.
  // GPS movement snaps onto this geometry; we only refetch if the rider leaves the road.
  useEffect(() => {
    void fetchRoute(origin, dest, lastGpsRef.current, true);
    return () => abortRef.current?.abort();
  }, [origin, dest, fetchRoute]);

  // Snap incoming GPS onto the current route
  useEffect(() => {
    lastGpsRef.current = rider;
    const engine = engineRef.current;
    if (engine.metrics.points.length < 2) return;
    const snap = snapToRoute(engine.metrics, rider);
    if (engine.mode === 'road' && snap.offRouteMeters > OFF_ROUTE_REROUTE_METERS) {
      void fetchRoute(rider, dest, rider, true);
      return;
    }
    if (snap.distanceAlong + BACKWARD_IGNORE_METERS < engine.displayDist) {
      engine.targetDist = engine.displayDist;
    } else {
      engine.targetDist = snap.distanceAlong;
    }
  }, [riderLat, riderLng, dest.lat, dest.lng, fetchRoute]);

  // Notify parent of ETA / remaining
  useEffect(() => {
    if (roadEtaMinutes !== lastEtaRef.current) {
      lastEtaRef.current = roadEtaMinutes;
      onRoadEtaChange?.(roadEtaMinutes);
    }
  }, [roadEtaMinutes, onRoadEtaChange]);

  useEffect(() => {
    if (!isLoaded || !mapContainerRef.current || mapRef.current || mapAuthFailed) return;

    const map = new google.maps.Map(mapContainerRef.current, {
      center: { lat: (riderLat + destinationLat) / 2, lng: (riderLng + destinationLng) / 2 },
      zoom: 14,
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      clickableIcons: false,
      keyboardShortcuts: false,
      styles: SOCIVA_TRACKING_MAP_STYLE,
      isFractionalZoomEnabled: true,
    });

    map.addListener('dragstart', () => {
      followRef.current = false;
      setShowRecenter(true);
    });

    mapRef.current = map;
    setMapReady(true);

    const { VehicleOverlay, PinOverlay } = createTrackingOverlays();

    const home = new PinOverlay(dest, 'home');
    home.setMap(map);
    homeRef.current = home;

    if (sellerLat != null && sellerLng != null) {
      const store = new PinOverlay(asPoint(sellerLat, sellerLng), 'store');
      store.setMap(map);
      storeRef.current = store;
    }

    const vehicle = new VehicleOverlay(rider, heading ?? 0);
    vehicle.setMap(map);
    vehicle.setVisible(!!isPickedUp);
    vehicleRef.current = vehicle;

    haloPolyRef.current = new google.maps.Polyline({
      map,
      path: [],
      strokeColor: ROUTE_HALO,
      strokeOpacity: 0.18,
      strokeWeight: 11,
      geodesic: false,
      zIndex: 2,
      clickable: false,
    });
    remainingPolyRef.current = new google.maps.Polyline({
      map,
      path: [],
      strokeColor: ROUTE_BLUE_MUTED,
      strokeOpacity: 0.9,
      strokeWeight: 6,
      geodesic: false,
      zIndex: 3,
      clickable: false,
    });
    completedPolyRef.current = new google.maps.Polyline({
      map,
      path: [],
      strokeColor: ROUTE_BLUE,
      strokeOpacity: 1,
      strokeWeight: 6.5,
      geodesic: false,
      zIndex: 4,
      clickable: false,
    });
    dashPolyRef.current = new google.maps.Polyline({
      map,
      path: [],
      strokeColor: DASH_ROUTE,
      strokeOpacity: 0,
      strokeWeight: 0,
      geodesic: true,
      zIndex: 3,
      clickable: false,
      icons: dashIcons(0),
    });

    return () => {
      cancelAnimationFrame(rafRef.current);
      vehicleRef.current?.setMap(null);
      homeRef.current?.setMap(null);
      storeRef.current?.setMap(null);
      haloPolyRef.current?.setMap(null);
      remainingPolyRef.current?.setMap(null);
      completedPolyRef.current?.setMap(null);
      dashPolyRef.current?.setMap(null);
      mapRef.current = null;
      vehicleRef.current = null;
      homeRef.current = null;
      storeRef.current = null;
      initialFitDone.current = false;
      setMapReady(false);
    };
    // Map is created once per loaded/auth cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, mapAuthFailed]);

  useEffect(() => {
    homeRef.current?.setPosition(dest);
  }, [destinationLat, destinationLng]);

  useEffect(() => {
    if (sellerLat != null && sellerLng != null) {
      storeRef.current?.setPosition(asPoint(sellerLat, sellerLng));
    }
  }, [sellerLat, sellerLng]);

  useEffect(() => {
    vehicleRef.current?.setVisible(!!isPickedUp);
  }, [isPickedUp]);

  const fitRoute = useCallback((force = false) => {
    const map = mapRef.current;
    const metrics = engineRef.current.metrics;
    if (!map || metrics.points.length === 0) return;

    const bounds = new google.maps.LatLngBounds();
    metrics.points.forEach((p) => bounds.extend(p));
    bounds.extend(dest);
    bounds.extend(lastGpsRef.current);
    if (sellerLat != null && sellerLng != null) bounds.extend({ lat: sellerLat, lng: sellerLng });
    map.fitBounds(bounds, { top: 56, right: 52, bottom: 72, left: 52 });

    google.maps.event.addListenerOnce(map, 'idle', () => {
      const z = map.getZoom();
      if (z == null) return;
      const long = engineRef.current.mode === 'long-distance';
      if (!long && z > 17) map.setZoom(17);
      if (!long && z < 12) map.setZoom(12);
      if (long && z > 8) {
        // keep the national / regional context; don't over-zoom a dashed route
      }
    });
    void force;
  }, [dest, sellerLat, sellerLng]);

  const followCamera = useCallback((vehiclePos: LatLng, remainingMeters: number, currentPhase: TrackingPhase) => {
    const map = mapRef.current;
    if (!map || !followRef.current) return;
    const now = performance.now();
    const lastPos = lastPanPosRef.current;
    const moved = lastPos ? haversineMeters(lastPos, vehiclePos) : Infinity;
    if (!lastPos) {
      lastPanPosRef.current = vehiclePos;
    }
    if (engineRef.current.mode === 'long-distance') {
      if (!initialFitDone.current || moved > 2500) fitRoute(true);
      return;
    }
    if (now - lastPanAtRef.current < (currentPhase === 'arriving' ? 420 : 520) && moved < 14) return;
    lastPanAtRef.current = now;
    lastPanPosRef.current = vehiclePos;

    const look = lookAheadPoint(vehiclePos, dest, currentPhase === 'arriving' ? 0.22 : 0.16);
    map.panTo(look);

    const z = map.getZoom() ?? 14;
    if (currentPhase === 'arriving' && remainingMeters < ARRIVING_METERS && z < 16.2) {
      map.setZoom(16.4);
    } else if (currentPhase === 'moving' && remainingMeters > 2500 && z > 15) {
      map.setZoom(14.4);
    }
  }, [dest, fitRoute]);

  // Animation loop — interpolate along decoded geometry
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    const tick = (now: number) => {
      const engine = engineRef.current;
      const dt = engine.lastFrame ? Math.min(48, now - engine.lastFrame) : 16;
      engine.lastFrame = now;

      if (engine.metrics.points.length >= 2) {
        engine.displayDist = nextDisplayDistance({
          display: engine.displayDist,
          target: engine.targetDist,
          total: engine.metrics.total,
          dtMs: dt,
          durationMs: config.map_animation_duration_ms || 2000,
        });

        // Keep vehicle slightly ahead of the store pin at pickup
        if (sellerLat != null && sellerLng != null && engine.displayDist < 16) {
          const atStore = haversineMeters(poseAtDistance(engine.metrics, engine.displayDist).point, asPoint(sellerLat, sellerLng)) < 18;
          if (atStore) engine.displayDist = Math.min(engine.metrics.total, Math.max(engine.displayDist, 14));
        }

        const pose = poseAtDistance(engine.metrics, engine.displayDist);
        const liveHeading = headingRef.current;
        const gpsHeading = liveHeading != null && !Number.isNaN(liveHeading) ? liveHeading : pose.bearing;
        const headingBlend = Math.abs(headingDelta(engine.displayHeading, gpsHeading)) > 1 ? 0.14 : 0.06;
        engine.displayHeading = lerpHeading(engine.displayHeading, gpsHeading, headingBlend);

        vehicleRef.current?.setPose(pose.point, engine.displayHeading);

        const remainingMeters = Math.max(0, engine.metrics.total - engine.displayDist);
        const nextPhase = resolveTrackingPhase({
          hasVehicle: pickedUpRef.current,
          remainingMeters,
          proximityStatus: proximityRef.current ?? (distanceRef.current != null && distanceRef.current < ARRIVING_METERS ? 'arriving' : null),
        });
        if (nextPhase !== phaseRef.current) {
          phaseRef.current = nextPhase;
          setPhase(nextPhase);
        }
        homeRef.current?.setArriving?.(nextPhase === 'arriving');

        if (Math.abs(engine.displayDist - engine.lastPolyDist) > 3 || engine.lastPolyDist < 0) {
          engine.lastPolyDist = engine.displayDist;
          const split = splitRouteAtDistance(engine.metrics, engine.displayDist);
          if (engine.mode === 'long-distance') {
            haloPolyRef.current?.setPath([]);
            remainingPolyRef.current?.setPath([]);
            completedPolyRef.current?.setPath([]);
            dashPolyRef.current?.setPath(engine.metrics.points);
            dashOffsetRef.current = (dashOffsetRef.current + dt * 0.028) % 14;
            dashPolyRef.current?.setOptions({ icons: dashIcons(dashOffsetRef.current) });
          } else {
            dashPolyRef.current?.setPath([]);
            haloPolyRef.current?.setPath(engine.metrics.points);
            remainingPolyRef.current?.setPath(split.remaining);
            completedPolyRef.current?.setPath(split.completed);
            remainingPolyRef.current?.setOptions({
              strokeWeight: 6,
              strokeColor: ROUTE_BLUE_MUTED,
            });
            completedPolyRef.current?.setOptions({
              strokeWeight: 6,
              strokeColor: ROUTE_BLUE,
            });
          }
        } else if (engine.mode === 'long-distance') {
          dashOffsetRef.current = (dashOffsetRef.current + dt * 0.028) % 14;
          dashPolyRef.current?.setOptions({ icons: dashIcons(dashOffsetRef.current) });
        }

        if (!initialFitDone.current && engine.metrics.total > 0) {
          initialFitDone.current = true;
          fitRoute(true);
        } else {
          followCamera(pose.point, remainingMeters, nextPhase);
        }

        const remainingInfo = Math.round(remainingMeters);
        const totalInfo = Math.round(engine.totalDistanceMeters || engine.metrics.total);
        const prev = lastRouteInfoRef.current;
        if (!prev || prev.total !== totalInfo || Math.abs(prev.remaining - remainingInfo) > 8) {
          lastRouteInfoRef.current = { total: totalInfo, remaining: remainingInfo };
          onRouteInfoRef.current?.({ totalDistance: totalInfo, remainingDistance: remainingInfo });
          setRemainingHud(remainingInfo);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [mapReady, config.map_animation_duration_ms, fitRoute, followCamera, sellerLat, sellerLng]);

  useEffect(() => {
    if (!mapContainerRef.current || !isLoaded) return;
    const observer = new MutationObserver(() => {
      const container = mapContainerRef.current;
      if (!container) return;
      const errorDialog = container.querySelector('.dismissButton') ||
        Array.from(container.querySelectorAll('div')).find((el) =>
          el.textContent?.includes("can't load Google Maps correctly"),
        );
      if (errorDialog) {
        setMapAuthFailed(true);
        observer.disconnect();
      }
    });
    observer.observe(mapContainerRef.current, { childList: true, subtree: true });
    const timeout = setTimeout(() => observer.disconnect(), 10000);
    return () => {
      observer.disconnect();
      clearTimeout(timeout);
    };
  }, [isLoaded]);

  const handleRecenter = useCallback(() => {
    followRef.current = true;
    setShowRecenter(false);
    lastPanAtRef.current = 0;
    if (engineRef.current.mode === 'long-distance') {
      fitRoute(true);
    }
  }, [fitRoute]);

  const handleRetry = useCallback(() => {
    mapRef.current = null;
    initialFitDone.current = false;
    setMapAuthFailed(false);
    retry();
  }, [retry]);

  const mapHeight = tall ? 'h-[min(56vh,520px)]' : 'h-[min(42vh,380px)]';
  const remainingKm = remainingHud != null
    ? remainingHud < 1000
      ? `${remainingHud} m`
      : `${(remainingHud / 1000).toFixed(1)} km`
    : null;

  if (mapsError || mapAuthFailed) {
    return (
      <MapFallbackCard
        riderLat={riderLat}
        riderLng={riderLng}
        destinationLat={destinationLat}
        destinationLng={destinationLng}
        riderName={riderName}
        roadEtaMinutes={roadEtaMinutes}
        roadDistanceMeters={route?.distanceMeters ?? null}
        tall={tall}
        errorType={mapsError || 'AUTH_FAILED'}
        onRetry={handleRetry}
      />
    );
  }

  if (!isLoaded) {
    return (
      <div className={`${mapHeight} bg-muted flex items-center justify-center`}>
        <div className="text-center text-muted-foreground">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
          <p className="text-xs">Loading map...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${mapHeight} relative bg-[#f3f3f1]`}>
      <div ref={mapContainerRef} className="h-full w-full" role="img" aria-label="Live delivery map" />

      {showRecenter && (
        <button
          type="button"
          onClick={handleRecenter}
          className="sociva-recenter absolute top-3 right-3 z-10"
          aria-label="Recenter map on delivery"
          dangerouslySetInnerHTML={{ __html: RECENTER_ICON_SVG }}
        />
      )}

      {(roadEtaMinutes || remainingKm) && (
        <div className="absolute bottom-3 right-3 z-10 bg-white/95 backdrop-blur-md rounded-2xl px-3 py-2 shadow-md border border-black/5">
          <p className="text-sm font-bold text-[#202124] leading-tight">
            {roadEtaMinutes
              ? (roadEtaMinutes > 3 ? `${roadEtaMinutes - 1}–${roadEtaMinutes + 1} min` : `${roadEtaMinutes} min`)
              : 'On the way'}
          </p>
          {remainingKm && (
            <p className="text-[10px] text-[#5f6368] leading-tight mt-0.5">{remainingKm} remaining</p>
          )}
        </div>
      )}

      {phase === 'arriving' && (
        <div className="absolute top-3 left-3 z-10 bg-white/95 backdrop-blur-md rounded-full px-3 py-1.5 shadow-sm border border-black/5">
          <p className="text-[11px] font-semibold text-[#188038]">Arriving now</p>
        </div>
      )}

      <span className="sr-only">{sellerName ? `Pickup at ${sellerName}. ` : ''}{riderName ? `${riderName} is on the way.` : 'Delivery in progress.'}</span>
    </div>
  );
}
