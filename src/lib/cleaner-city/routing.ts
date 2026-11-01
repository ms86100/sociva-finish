/// <reference types="@types/google.maps" />

export type LatLng = { lat: number; lng: number };

export type RouteResult = {
  polyline: string;
  distanceMeters: number;
  durationSeconds: number;
  provider: 'google' | 'haversine_fallback';
  path: LatLng[];
  summary?: string;
  waypointOrder?: number[];
};

export type RouteAlternative = {
  id: string;
  polyline: string;
  distanceMeters: number;
  durationSeconds: number;
  summary: string;
  provider: 'google' | 'haversine_fallback';
  path: LatLng[];
};

export type DropStop = {
  id: string;
  label: string;
  lat: number;
  lng: number;
};

export type DropSequenceResult = {
  ordered: Array<DropStop & { dropIndex: number }>;
  distanceMeters: number;
  durationSeconds: number;
  provider: 'google' | 'haversine_fallback';
  polyline: string;
};

export type DetourResult = {
  ok: boolean;
  method: 'google_directions' | 'haversine_fallback';
  estimatedDetourMinutes: number;
  directDurationSeconds?: number;
  viaDurationSeconds?: number;
  reason?: string;
};

/** Haversine distance in meters (no Maps dependency). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function estimateDetourMinutesFallback(
  hostOrigin: LatLng,
  hostDest: LatLng,
  guestPickup: LatLng,
  guestDest: LatLng,
  avgSpeedKmh = 25,
): DetourResult {
  const direct = haversineMeters(hostOrigin, hostDest);
  const via =
    haversineMeters(hostOrigin, guestPickup) +
    haversineMeters(guestPickup, guestDest) +
    haversineMeters(guestDest, hostDest);
  const extra = Math.max(0, via - direct);
  const speedMps = (Math.max(avgSpeedKmh, 5) * 1000) / 3600;
  const minutes = extra / speedMps / 60;
  return {
    ok: true,
    method: 'haversine_fallback',
    estimatedDetourMinutes: Math.round(minutes * 10) / 10,
    directDurationSeconds: Math.round(direct / speedMps),
    viaDurationSeconds: Math.round(via / speedMps),
  };
}

function pathFromRoute(route: google.maps.DirectionsRoute): LatLng[] {
  if (!route?.overview_path?.length) return [];
  return route.overview_path.map((p) => ({ lat: p.lat(), lng: p.lng() }));
}

function totalsFromRoute(route: google.maps.DirectionsRoute) {
  const legs = route?.legs || [];
  let distanceMeters = 0;
  let durationSeconds = 0;
  for (const leg of legs) {
    distanceMeters += leg.distance?.value || 0;
    durationSeconds += leg.duration?.value || 0;
  }
  return { distanceMeters, durationSeconds };
}

function haversineRoute(
  origin: LatLng,
  destination: LatLng,
  waypoints: LatLng[] = [],
): RouteResult {
  const path = [origin, ...waypoints, destination];
  let meters = 0;
  for (let i = 1; i < path.length; i++) meters += haversineMeters(path[i - 1], path[i]);
  return {
    polyline: encodePolyline(path),
    distanceMeters: Math.round(meters),
    durationSeconds: Math.round(meters / ((25 * 1000) / 3600)),
    provider: 'haversine_fallback',
    path,
    summary: 'Approximate straight path',
    waypointOrder: waypoints.map((_, i) => i),
  };
}

/**
 * Google Directions abstraction for A Cleaner City.
 * Falls back to a straight-line polyline when Directions is unavailable.
 */
export async function fetchDrivingRoute(
  origin: LatLng,
  destination: LatLng,
  waypoints: LatLng[] = [],
  options?: { optimizeWaypoints?: boolean },
): Promise<RouteResult> {
  const optimize = !!options?.optimizeWaypoints && waypoints.length > 1;

  if (typeof window === 'undefined' || !window.google?.maps?.DirectionsService) {
    return haversineRoute(origin, destination, waypoints);
  }

  const svc = new google.maps.DirectionsService();
  try {
    const result = await new Promise<google.maps.DirectionsResult>((resolve, reject) => {
      svc.route(
        {
          origin,
          destination,
          waypoints: waypoints.map((w) => ({ location: w, stopover: true })),
          travelMode: google.maps.TravelMode.DRIVING,
          optimizeWaypoints: optimize,
        },
        (res, status) => {
          if (status === google.maps.DirectionsStatus.OK && res) resolve(res);
          else reject(new Error(String(status)));
        },
      );
    });

    const route = result.routes?.[0];
    if (!route) return haversineRoute(origin, destination, waypoints);

    const path = pathFromRoute(route);
    const { distanceMeters, durationSeconds } = totalsFromRoute(route);
    const polyline = route.overview_polyline || encodePolyline(path);
    const waypointOrder =
      optimize && Array.isArray(route.waypoint_order)
        ? [...route.waypoint_order]
        : waypoints.map((_, i) => i);

    return {
      polyline,
      distanceMeters,
      durationSeconds,
      provider: 'google',
      path,
      summary: route.summary || 'Driving route',
      waypointOrder,
    };
  } catch {
    return haversineRoute(origin, destination, waypoints);
  }
}

/** Up to 3 Google driving alternatives between the same pins. */
export async function fetchDrivingRouteAlternatives(
  origin: LatLng,
  destination: LatLng,
): Promise<RouteAlternative[]> {
  if (typeof window === 'undefined' || !window.google?.maps?.DirectionsService) {
    const fallback = haversineRoute(origin, destination);
    return [
      {
        id: 'approx-0',
        polyline: fallback.polyline,
        distanceMeters: fallback.distanceMeters,
        durationSeconds: fallback.durationSeconds,
        summary: fallback.summary || 'Approximate path',
        provider: 'haversine_fallback',
        path: fallback.path,
      },
    ];
  }

  const svc = new google.maps.DirectionsService();
  try {
    const result = await new Promise<google.maps.DirectionsResult>((resolve, reject) => {
      svc.route(
        {
          origin,
          destination,
          travelMode: google.maps.TravelMode.DRIVING,
          provideRouteAlternatives: true,
        },
        (res, status) => {
          if (status === google.maps.DirectionsStatus.OK && res) resolve(res);
          else reject(new Error(String(status)));
        },
      );
    });

    const routes = (result.routes || []).slice(0, 3);
    if (routes.length === 0) {
      const fallback = haversineRoute(origin, destination);
      return [
        {
          id: 'approx-0',
          polyline: fallback.polyline,
          distanceMeters: fallback.distanceMeters,
          durationSeconds: fallback.durationSeconds,
          summary: fallback.summary || 'Approximate path',
          provider: 'haversine_fallback',
          path: fallback.path,
        },
      ];
    }

    return routes.map((route, index) => {
      const path = pathFromRoute(route);
      const { distanceMeters, durationSeconds } = totalsFromRoute(route);
      return {
        id: `alt-${index}-${route.summary || index}`,
        polyline: route.overview_polyline || encodePolyline(path),
        distanceMeters,
        durationSeconds,
        summary: route.summary ? `via ${route.summary}` : `Route ${index + 1}`,
        provider: 'google' as const,
        path,
      };
    });
  } catch {
    const fallback = haversineRoute(origin, destination);
    return [
      {
        id: 'approx-0',
        polyline: fallback.polyline,
        distanceMeters: fallback.distanceMeters,
        durationSeconds: fallback.durationSeconds,
        summary: fallback.summary || 'Approximate path',
        provider: 'haversine_fallback',
        path: fallback.path,
      },
    ];
  }
}

/**
 * Google-optimized drop/visit order for multi-stop rides.
 * Origin = start, destination = final end, stops = guests or extra offices in between.
 */
export async function planDropSequence(input: {
  origin: LatLng;
  destination: LatLng;
  stops: DropStop[];
}): Promise<DropSequenceResult> {
  const { origin, destination, stops } = input;
  if (stops.length === 0) {
    const direct = await fetchDrivingRoute(origin, destination);
    return {
      ordered: [],
      distanceMeters: direct.distanceMeters,
      durationSeconds: direct.durationSeconds,
      provider: direct.provider,
      polyline: direct.polyline,
    };
  }

  if (stops.length === 1) {
    const route = await fetchDrivingRoute(origin, destination, [
      { lat: stops[0].lat, lng: stops[0].lng },
    ]);
    return {
      ordered: [{ ...stops[0], dropIndex: 1 }],
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      provider: route.provider,
      polyline: route.polyline,
    };
  }

  const waypoints = stops.map((s) => ({ lat: s.lat, lng: s.lng }));
  const route = await fetchDrivingRoute(origin, destination, waypoints, {
    optimizeWaypoints: true,
  });
  // Google waypoint_order when available; otherwise nearest-neighbor (haversine
  // identity order is not an optimized drop sequence).
  const order =
    route.provider === 'google' && route.waypointOrder?.length === stops.length
      ? route.waypointOrder
      : nearestNeighborOrder(origin, stops);

  const ordered = order.map((stopIdx, i) => ({
    ...stops[stopIdx],
    dropIndex: i + 1,
  }));

  return {
    ordered,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    provider: route.provider,
    polyline: route.polyline,
  };
}

function nearestNeighborOrder(origin: LatLng, stops: DropStop[]): number[] {
  const remaining = stops.map((_, i) => i);
  const order: number[] = [];
  let cursor = origin;
  while (remaining.length) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const s = stops[remaining[i]];
      const d = haversineMeters(cursor, { lat: s.lat, lng: s.lng });
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    const picked = remaining.splice(best, 1)[0];
    order.push(picked);
    cursor = { lat: stops[picked].lat, lng: stops[picked].lng };
  }
  return order;
}

export async function estimateDetourMinutes(
  hostOrigin: LatLng,
  hostDest: LatLng,
  guestPickup: LatLng,
  guestDest: LatLng,
): Promise<DetourResult> {
  if (!window.google?.maps?.DirectionsService) {
    return estimateDetourMinutesFallback(hostOrigin, hostDest, guestPickup, guestDest);
  }

  try {
    const [direct, via] = await Promise.all([
      fetchDrivingRoute(hostOrigin, hostDest),
      fetchDrivingRoute(hostOrigin, hostDest, [guestPickup, guestDest]),
    ]);
    const extraSeconds = Math.max(0, via.durationSeconds - direct.durationSeconds);
    return {
      ok: true,
      method: 'google_directions',
      estimatedDetourMinutes: Math.round((extraSeconds / 60) * 10) / 10,
      directDurationSeconds: direct.durationSeconds,
      viaDurationSeconds: via.durationSeconds,
    };
  } catch {
    return estimateDetourMinutesFallback(hostOrigin, hostDest, guestPickup, guestDest);
  }
}

export type PreferredRouteStore = {
  polyline: string;
  distanceMeters: number;
  durationSeconds: number;
  summary: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  savedAt: string;
};

export function preferredRouteStorageKey(
  userId: string,
  direction: 'to_office' | 'to_home' = 'to_office',
) {
  const suffix = direction === 'to_home' ? '_home' : '';
  return `cleaner_city_preferred_route_${userId}${suffix}`;
}

export function loadPreferredRoute(
  userId: string | null | undefined,
  direction: 'to_office' | 'to_home' = 'to_office',
): PreferredRouteStore | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(preferredRouteStorageKey(userId, direction));
    if (!raw) return null;
    return JSON.parse(raw) as PreferredRouteStore;
  } catch {
    return null;
  }
}

export function savePreferredRoute(
  userId: string,
  route: PreferredRouteStore,
  direction: 'to_office' | 'to_home' = 'to_office',
) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(preferredRouteStorageKey(userId, direction), JSON.stringify(route));
  } catch {
    // ignore quota
  }
}

export function preferredRouteMatchesPins(
  stored: PreferredRouteStore | null,
  origin: LatLng,
  destination: LatLng,
  tolerance = 0.0008,
): boolean {
  if (!stored) return false;
  return (
    Math.abs(stored.originLat - origin.lat) < tolerance &&
    Math.abs(stored.originLng - origin.lng) < tolerance &&
    Math.abs(stored.destLat - destination.lat) < tolerance &&
    Math.abs(stored.destLng - destination.lng) < tolerance &&
    !!stored.polyline
  );
}

/**
 * Google Maps directions deep link for multi-stop driving.
 * Origin -> waypoints (optimized order already applied by caller) -> destination.
 */
export function buildGoogleMapsDirectionsUrl(input: {
  origin: LatLng;
  destination: LatLng;
  waypoints?: LatLng[];
}): string {
  const { origin, destination, waypoints = [] } = input;
  const params = new URLSearchParams({
    api: '1',
    travelmode: 'driving',
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
  });
  if (waypoints.length) {
    params.set(
      'waypoints',
      waypoints.map((w) => `${w.lat},${w.lng}`).join('|'),
    );
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function openGoogleMapsDirections(input: {
  origin: LatLng;
  destination: LatLng;
  waypoints?: LatLng[];
}) {
  const url = buildGoogleMapsDirectionsUrl(input);
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  return url;
}

/** Google Encoded Polyline Algorithm Format (encode). */
export function encodePolyline(path: LatLng[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let result = '';

  const encodeSigned = (num: number) => {
    let s = num << 1;
    if (num < 0) s = ~s;
    let out = '';
    while (s >= 0x20) {
      out += String.fromCharCode((0x20 | (s & 0x1f)) + 63);
      s >>= 5;
    }
    out += String.fromCharCode(s + 63);
    return out;
  };

  for (const p of path) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    result += encodeSigned(lat - lastLat);
    result += encodeSigned(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return result;
}

export function decodePolyline(encoded: string): LatLng[] {
  const path: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    path.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return path;
}

export const CLEANER_CITY_ROUTE_THRESHOLDS = {
  pickupDeviationKm: 1.5,
  destinationDeviationKm: 2,
  departureDifferenceMinutes: 30,
  maxDetourMinutes: 15,
  minRouteOverlapPct: 65,
} as const;
