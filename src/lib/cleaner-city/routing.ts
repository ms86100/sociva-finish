/// <reference types="@types/google.maps" />

export type LatLng = { lat: number; lng: number };

export type RouteProvider = 'google' | 'osrm' | 'haversine_fallback';

export type RouteResult = {
  polyline: string;
  distanceMeters: number;
  durationSeconds: number;
  provider: RouteProvider;
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
  provider: RouteProvider;
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
  provider: RouteProvider;
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

type GoogleRoutesLib = {
  Route: {
    computeRoutes: (request: Record<string, unknown>) => Promise<{
      routes?: Array<{
        path?: Array<{ lat: number; lng: number } | google.maps.LatLng>;
        distanceMeters?: number;
        durationMillis?: number;
        description?: string;
        optimizedIntermediateWaypointIndices?: number[];
      }>;
    }>;
  };
};

async function loadGoogleRoutesLib(): Promise<GoogleRoutesLib | null> {
  if (typeof window === 'undefined' || !window.google?.maps) return null;
  try {
    const lib = (await google.maps.importLibrary('routes')) as GoogleRoutesLib;
    if (lib?.Route?.computeRoutes) return lib;
  } catch {
    // Routes library unavailable - caller may fall back to legacy Directions.
  }
  return null;
}

function pathFromGoogleRoutePath(
  path: Array<{ lat: number; lng: number } | google.maps.LatLng> | undefined,
): LatLng[] {
  if (!path?.length) return [];
  return path
    .map((p) => {
      if (!p) return null;
      if (typeof (p as google.maps.LatLng).lat === 'function') {
        const ll = p as google.maps.LatLng;
        return { lat: ll.lat(), lng: ll.lng() };
      }
      const lit = p as {
        lat?: number;
        lng?: number;
        latitude?: number;
        longitude?: number;
      };
      const lat = Number(lit.lat ?? lit.latitude);
      const lng = Number(lit.lng ?? lit.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng };
    })
    .filter((p): p is LatLng => !!p);
}

async function requestRoutesApi(
  origin: LatLng,
  destination: LatLng,
  options?: {
    alternatives?: boolean;
    waypoints?: LatLng[];
    optimizeWaypoints?: boolean;
  },
): Promise<{ alternatives: RouteAlternative[]; status: string; waypointOrder?: number[] }> {
  const lib = await loadGoogleRoutesLib();
  if (!lib) return { alternatives: [], status: 'NO_ROUTES_LIBRARY' };

  try {
    const waypoints = options?.waypoints || [];
    const { routes } = await lib.Route.computeRoutes({
      origin: { lat: origin.lat, lng: origin.lng },
      destination: { lat: destination.lat, lng: destination.lng },
      travelMode: 'DRIVING',
      computeAlternativeRoutes: !!options?.alternatives && waypoints.length === 0,
      optimizeWaypointOrder: !!options?.optimizeWaypoints && waypoints.length > 1,
      intermediates: waypoints.map((w) => ({ lat: w.lat, lng: w.lng })),
      fields: [
        'path',
        'distanceMeters',
        'durationMillis',
        'description',
        'optimizedIntermediateWaypointIndices',
      ],
    });

    if (!routes?.length) return { alternatives: [], status: 'ZERO_RESULTS' };

    // Google returns up to ~3 alternatives when computeAlternativeRoutes is on.
    const alternatives = routes.slice(0, 4).map((route, index) => {
      const path = pathFromGoogleRoutePath(route.path);
      const distanceMeters = Math.round(route.distanceMeters || 0);
      const durationSeconds = Math.max(
        1,
        Math.round((route.durationMillis || distanceMeters / ((25 * 1000) / 3600) * 1000) / 1000),
      );
      const summary = route.description
        ? `via ${route.description}`
        : index === 0
          ? 'Usual Google road'
          : `Google road ${index + 1}`;
      return {
        id: `groute-${index}-${summary}`,
        polyline: encodePolyline(path),
        distanceMeters,
        durationSeconds,
        summary,
        provider: 'google' as const,
        path,
      };
    });

    return {
      alternatives,
      status: 'OK',
      waypointOrder: routes[0]?.optimizedIntermediateWaypointIndices,
    };
  } catch (e: any) {
    const msg = String(e?.message || e || 'ROUTES_FAILED');
    if (/REQUEST_DENIED|PERMISSION|API[_ ]?key|not enabled|PERMISSION_DENIED/i.test(msg)) {
      return { alternatives: [], status: 'REQUEST_DENIED' };
    }
    return { alternatives: [], status: msg.slice(0, 80) || 'ROUTES_FAILED' };
  }
}

/**
 * Google Routes abstraction for A Cleaner City.
 * Prefers Routes API, then legacy DirectionsService, then straight-line fallback.
 */
export async function fetchDrivingRoute(
  origin: LatLng,
  destination: LatLng,
  waypoints: LatLng[] = [],
  options?: { optimizeWaypoints?: boolean },
): Promise<RouteResult> {
  const optimize = !!options?.optimizeWaypoints && waypoints.length > 1;

  const routesApi = await requestRoutesApi(origin, destination, {
    waypoints,
    optimizeWaypoints: optimize,
  });
  if (routesApi.alternatives[0]) {
    const first = routesApi.alternatives[0];
    return {
      polyline: first.polyline,
      distanceMeters: first.distanceMeters,
      durationSeconds: first.durationSeconds,
      provider: 'google',
      path: first.path,
      summary: first.summary,
      waypointOrder:
        routesApi.waypointOrder?.length === waypoints.length
          ? routesApi.waypointOrder
          : waypoints.map((_, i) => i),
    };
  }

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

export type RouteAlternativesResult = {
  alternatives: RouteAlternative[];
  status: string;
  googleOk: boolean;
  message?: string;
};

function directionsStatusMessage(status: string): string {
  const s = String(status || '');
  if (s === 'REQUEST_DENIED') {
    return 'Google Routes is blocked for this API key - enable Routes API, allow this site origin on the key, then tap Retry.';
  }
  if (s === 'OVER_QUERY_LIMIT') {
    return 'Google Routes quota hit - wait a minute, then tap Retry.';
  }
  if (s === 'ZERO_RESULTS') {
    return 'Google found no driving path between these pins - nudge a pin closer to a road, then retry.';
  }
  if (s === 'NOT_FOUND') {
    return 'Google could not resolve one of the pins - re-save home or office, then retry.';
  }
  if (s === 'NO_DIRECTIONS_SERVICE' || s === 'NO_ROUTES_LIBRARY') {
    return 'Google Maps Routes is not loaded yet - wait for Maps, then tap Retry.';
  }
  if (s === 'UNKNOWN_ERROR' || s === 'MAX_WAYPOINTS_EXCEEDED') {
    return `Google Routes failed (${s}) - tap Retry in a moment.`;
  }
  return `Google Routes unavailable (${s || 'no status'}). Tap Retry.`;
}

async function requestDirections(
  origin: LatLng,
  destination: LatLng,
  provideAlternatives: boolean,
): Promise<{ result?: google.maps.DirectionsResult; status: string }> {
  const svc = new google.maps.DirectionsService();
  return new Promise((resolve) => {
    svc.route(
      {
        origin: { lat: origin.lat, lng: origin.lng },
        destination: { lat: destination.lat, lng: destination.lng },
        travelMode: google.maps.TravelMode.DRIVING,
        provideRouteAlternatives: provideAlternatives,
        unitSystem: google.maps.UnitSystem.METRIC,
      },
      (res, status) => {
        resolve({
          result: status === google.maps.DirectionsStatus.OK && res ? res : undefined,
          status: String(status),
        });
      },
    );
  });
}

function alternativesFromRoutes(routes: google.maps.DirectionsRoute[]): RouteAlternative[] {
  return routes.slice(0, 4).map((route, index) => {
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
}

/** Keep distinct corridors - skip near-duplicate polylines from dual Google APIs. */
function mergeUniqueRouteAlternatives(
  primary: RouteAlternative[],
  extra: RouteAlternative[],
): RouteAlternative[] {
  const out = [...primary];
  for (const cand of extra) {
    const mid = cand.path[Math.floor(cand.path.length / 2)];
    const quarter = cand.path[Math.floor(cand.path.length / 4)];
    const duplicate = out.some((existing) => {
      const sameLabel =
        !!existing.summary &&
        !!cand.summary &&
        existing.summary.toLowerCase() === cand.summary.toLowerCase() &&
        Math.abs(existing.distanceMeters - cand.distanceMeters) < 250;
      if (sameLabel) return true;
      if (!mid || existing.path.length < 2) return false;
      const em = existing.path[Math.floor(existing.path.length / 2)];
      const eq = existing.path[Math.floor(existing.path.length / 4)];
      const midClose = haversineMeters(mid, em) < 500;
      const quarterClose = !quarter || !eq || haversineMeters(quarter, eq) < 600;
      const distClose =
        Math.abs(existing.distanceMeters - cand.distanceMeters) <
        Math.max(500, existing.distanceMeters * 0.08);
      const timeClose =
        Math.abs(existing.durationSeconds - cand.durationSeconds) <
        Math.max(90, existing.durationSeconds * 0.08);
      return midClose && quarterClose && distClose && timeClose;
    });
    if (!duplicate) out.push(cand);
  }
  return out;
}

/** Up to 3 Google driving alternatives between the same pins. */
export async function fetchDrivingRouteAlternatives(
  origin: LatLng,
  destination: LatLng,
): Promise<RouteAlternative[]> {
  const packed = await fetchDrivingRouteAlternativesDetailed(origin, destination);
  return packed.alternatives;
}

async function fetchOsrmRouteAlternatives(
  origin: LatLng,
  destination: LatLng,
): Promise<RouteAlternative[]> {
  if (typeof fetch !== 'function') return [];
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url =
    `https://router.project-osrm.org/route/v1/driving/${coords}` +
    '?overview=full&geometries=polyline&alternatives=true&steps=false';
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    code?: string;
    routes?: Array<{
      distance?: number;
      duration?: number;
      geometry?: string;
    }>;
  };
  if (data.code !== 'Ok' || !data.routes?.length) return [];
  return data.routes.slice(0, 3).map((route, index) => {
    const polyline = route.geometry || '';
    const path = polyline ? decodePolyline(polyline) : [origin, destination];
    return {
      id: `osrm-${index}`,
      polyline: polyline || encodePolyline(path),
      distanceMeters: Math.round(route.distance || 0),
      durationSeconds: Math.round(route.duration || 0),
      summary: index === 0 ? 'Usual road' : `Alt road ${index + 1}`,
      provider: 'osrm' as const,
      path,
    };
  });
}

/** Same as fetchDrivingRouteAlternatives, with status for honest UI + retry. */
export async function fetchDrivingRouteAlternativesDetailed(
  origin: LatLng,
  destination: LatLng,
): Promise<RouteAlternativesResult> {
  let status = 'NO_ROUTES_LIBRARY';

  // 1) Routes API (current Google product)
  const routesApi = await requestRoutesApi(origin, destination, { alternatives: true });
  status = routesApi.status;
  let googleAlts = routesApi.alternatives;

  // 2) Also pull legacy Directions alternatives and merge unique paths (max coverage).
  if (typeof window !== 'undefined' && window.google?.maps?.DirectionsService) {
    let { result, status: dirStatus } = await requestDirections(origin, destination, true);
    if (!result && dirStatus !== 'OK') {
      const retry = await requestDirections(origin, destination, false);
      result = retry.result;
      dirStatus = retry.status;
    }
    if (!googleAlts.length) status = dirStatus;
    if (result?.routes?.length) {
      const legacy = alternativesFromRoutes(result.routes);
      googleAlts = mergeUniqueRouteAlternatives(googleAlts, legacy);
      if (googleAlts.length) status = 'OK';
    }
  }

  if (googleAlts.length) {
    return {
      alternatives: googleAlts.slice(0, 4),
      status: 'OK',
      googleOk: true,
    };
  }

  // 3) OpenStreetMap roads while Google is blocked / unavailable
  try {
    const osrmAlts = await fetchOsrmRouteAlternatives(origin, destination);
    if (osrmAlts.length) {
      return {
        alternatives: osrmAlts,
        status: status === 'OK' ? 'OSRM_OK' : status,
        googleOk: false,
        message:
          status === 'REQUEST_DENIED'
            ? 'Google Routes is blocked on this API key - showing OpenStreetMap roads instead. Enable Routes API on the key, then tap Retry.'
            : 'Showing OpenStreetMap roads while Google Routes is unavailable.',
      };
    }
  } catch {
    // fall through to straight-line approx
  }

  const fallback = haversineRoute(origin, destination);
  return {
    alternatives: [
      {
        id: 'approx-0',
        polyline: fallback.polyline,
        distanceMeters: fallback.distanceMeters,
        durationSeconds: fallback.durationSeconds,
        summary: fallback.summary || 'Approximate path',
        provider: 'haversine_fallback',
        path: fallback.path,
      },
    ],
    status,
    googleOk: false,
    message: directionsStatusMessage(status),
  };
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
