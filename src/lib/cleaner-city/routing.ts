/// <reference types="@types/google.maps" />

export type LatLng = { lat: number; lng: number };

export type RouteResult = {
  polyline: string;
  distanceMeters: number;
  durationSeconds: number;
  provider: 'google' | 'haversine_fallback';
  path: LatLng[];
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

function pathFromDirections(result: google.maps.DirectionsResult): LatLng[] {
  const route = result.routes?.[0];
  if (!route?.overview_path?.length) return [];
  return route.overview_path.map((p) => ({ lat: p.lat(), lng: p.lng() }));
}

function totalsFromDirections(result: google.maps.DirectionsResult) {
  const legs = result.routes?.[0]?.legs || [];
  let distanceMeters = 0;
  let durationSeconds = 0;
  for (const leg of legs) {
    distanceMeters += leg.distance?.value || 0;
    durationSeconds += leg.duration?.value || 0;
  }
  return { distanceMeters, durationSeconds };
}

/**
 * Google Directions abstraction for A Cleaner City.
 * Falls back to a straight-line polyline when Directions is unavailable.
 */
export async function fetchDrivingRoute(
  origin: LatLng,
  destination: LatLng,
  waypoints: LatLng[] = [],
): Promise<RouteResult> {
  if (typeof window === 'undefined' || !window.google?.maps?.DirectionsService) {
    const path = [origin, ...waypoints, destination];
    let meters = 0;
    for (let i = 1; i < path.length; i++) meters += haversineMeters(path[i - 1], path[i]);
    return {
      polyline: encodePolyline(path),
      distanceMeters: Math.round(meters),
      durationSeconds: Math.round(meters / ((25 * 1000) / 3600)),
      provider: 'haversine_fallback',
      path,
    };
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
          optimizeWaypoints: false,
        },
        (res, status) => {
          if (status === google.maps.DirectionsStatus.OK && res) resolve(res);
          else reject(new Error(String(status)));
        },
      );
    });

    const path = pathFromDirections(result);
    const { distanceMeters, durationSeconds } = totalsFromDirections(result);
    const polyline =
      result.routes?.[0]?.overview_polyline || encodePolyline(path);

    return {
      polyline,
      distanceMeters,
      durationSeconds,
      provider: 'google',
      path,
    };
  } catch {
    const path = [origin, ...waypoints, destination];
    let meters = 0;
    for (let i = 1; i < path.length; i++) meters += haversineMeters(path[i - 1], path[i]);
    return {
      polyline: encodePolyline(path),
      distanceMeters: Math.round(meters),
      durationSeconds: Math.round(meters / ((25 * 1000) / 3600)),
      provider: 'haversine_fallback',
      path,
    };
  }
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
