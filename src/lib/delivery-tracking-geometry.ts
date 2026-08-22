/**
 * Delivery tracking geometry — snap, interpolate, and pose a vehicle
 * along decoded route coordinates (never linear lat/lng teleport).
 */

export type LatLng = { lat: number; lng: number };

export function asPoint(lat: number, lng: number): LatLng {
  return { lat, lng };
}

/** Force route polyline to start/end exactly at pickup + delivery pins. */
export function anchorRouteToPins(path: LatLng[], start: LatLng, end: LatLng): LatLng[] {
  if (path.length < 2) return [start, end];
  const anchored = path.slice();
  anchored[0] = { ...start };
  anchored[anchored.length - 1] = { ...end };
  return anchored;
}

export const LONG_DISTANCE_METERS = 40_000;
export const ARRIVING_METERS = 220;
export const OFF_ROUTE_REROUTE_METERS = 150;
export const BACKWARD_IGNORE_METERS = 18;

export type TrackingPhase = 'confirmed' | 'moving' | 'arriving';

export interface RouteMetrics {
  points: LatLng[];
  /** Cumulative distance at each vertex, meters. Same length as points. */
  cumulative: number[];
  total: number;
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Bearing in degrees clockwise from north (0–360). */
export function bearingDegrees(from: LatLng, to: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(from.lat);
  const φ2 = toRad(to.lat);
  const Δλ = toRad(to.lng - from.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Shortest signed heading delta in (−180, 180]. */
export function headingDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

export function lerpHeading(from: number, to: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return (from + headingDelta(from, to) * clamped + 360) % 360;
}

export function lerpLatLng(a: LatLng, b: LatLng, t: number): LatLng {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    lat: a.lat + (b.lat - a.lat) * clamped,
    lng: a.lng + (b.lng - a.lng) * clamped,
  };
}

export function buildRouteMetrics(points: LatLng[]): RouteMetrics {
  if (points.length === 0) return { points: [], cumulative: [], total: 0 };
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + haversineMeters(points[i - 1], points[i]));
  }
  return { points, cumulative, total: cumulative[cumulative.length - 1] };
}

function projectOntoSegment(p: LatLng, a: LatLng, b: LatLng): { point: LatLng; t: number; dist: number } {
  const ax = a.lng;
  const ay = a.lat;
  const bx = b.lng;
  const by = b.lat;
  const px = p.lng;
  const py = p.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const point = { lat: ay + dy * t, lng: ax + dx * t };
  return { point, t, dist: haversineMeters(p, point) };
}

/** Nearest location on the polyline, plus meters traveled from the start. */
export function snapToRoute(metrics: RouteMetrics, point: LatLng): {
  point: LatLng;
  distanceAlong: number;
  offRouteMeters: number;
  segmentIndex: number;
  bearing: number;
} {
  if (metrics.points.length === 0) {
    return { point, distanceAlong: 0, offRouteMeters: 0, segmentIndex: 0, bearing: 0 };
  }
  if (metrics.points.length === 1) {
    return {
      point: metrics.points[0],
      distanceAlong: 0,
      offRouteMeters: haversineMeters(point, metrics.points[0]),
      segmentIndex: 0,
      bearing: 0,
    };
  }

  let best = {
    point: metrics.points[0],
    distanceAlong: 0,
    offRouteMeters: Infinity,
    segmentIndex: 0,
    bearing: 0,
  };

  for (let i = 0; i < metrics.points.length - 1; i++) {
    const a = metrics.points[i];
    const b = metrics.points[i + 1];
    const proj = projectOntoSegment(point, a, b);
    if (proj.dist < best.offRouteMeters) {
      const segLen = metrics.cumulative[i + 1] - metrics.cumulative[i];
      best = {
        point: proj.point,
        distanceAlong: metrics.cumulative[i] + segLen * proj.t,
        offRouteMeters: proj.dist,
        segmentIndex: i,
        bearing: bearingDegrees(a, b),
      };
    }
  }

  return best;
}

export function poseAtDistance(metrics: RouteMetrics, distanceAlong: number): {
  point: LatLng;
  bearing: number;
  progress: number;
} {
  if (metrics.points.length === 0) {
    return { point: { lat: 0, lng: 0 }, bearing: 0, progress: 0 };
  }
  if (metrics.points.length === 1 || metrics.total <= 0) {
    return { point: metrics.points[0], bearing: 0, progress: 0 };
  }

  const d = Math.max(0, Math.min(metrics.total, distanceAlong));
  let i = 0;
  while (i < metrics.cumulative.length - 2 && metrics.cumulative[i + 1] < d) i++;

  const a = metrics.points[i];
  const b = metrics.points[i + 1];
  const segStart = metrics.cumulative[i];
  const segLen = metrics.cumulative[i + 1] - segStart;
  const t = segLen <= 0 ? 0 : (d - segStart) / segLen;

  return {
    point: lerpLatLng(a, b, t),
    bearing: bearingDegrees(a, b),
    progress: d / metrics.total,
  };
}

export function splitRouteAtDistance(metrics: RouteMetrics, distanceAlong: number): {
  completed: LatLng[];
  remaining: LatLng[];
} {
  if (metrics.points.length === 0) return { completed: [], remaining: [] };
  const pose = poseAtDistance(metrics, distanceAlong);
  if (metrics.points.length === 1) {
    return { completed: [metrics.points[0]], remaining: [metrics.points[0]] };
  }

  let i = 0;
  while (i < metrics.cumulative.length - 2 && metrics.cumulative[i + 1] < distanceAlong) i++;

  const completed = [...metrics.points.slice(0, i + 1), pose.point];
  const remaining = [pose.point, ...metrics.points.slice(i + 1)];
  return { completed, remaining };
}

/**
 * Gentle curved path for long-distance deliveries (not road-snapped).
 * Matches the “Kolkata → Delhi” dashed-arc look.
 */
export function buildLongDistancePath(a: LatLng, b: LatLng, samples = 56): LatLng[] {
  const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const span = Math.hypot(dx, dy) || 1;
  const bulge = 0.14;
  const ctrl = {
    lat: mid.lat - (dx / span) * span * bulge,
    lng: mid.lng + (dy / span) * span * bulge,
  };

  const pts: LatLng[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const u = 1 - t;
    pts.push({
      lat: u * u * a.lat + 2 * u * t * ctrl.lat + t * t * b.lat,
      lng: u * u * a.lng + 2 * u * t * ctrl.lng + t * t * b.lng,
    });
  }
  return pts;
}

export function isLongDistance(origin: LatLng, dest: LatLng, threshold = LONG_DISTANCE_METERS): boolean {
  return haversineMeters(origin, dest) >= threshold;
}

export function resolveTrackingPhase(args: {
  hasVehicle: boolean;
  remainingMeters: number | null;
  proximityStatus?: string | null;
}): TrackingPhase {
  if (!args.hasVehicle) return 'confirmed';
  const doorstep = args.proximityStatus === 'at_doorstep' || args.proximityStatus === 'arriving';
  if (doorstep) return 'arriving';
  if (args.remainingMeters != null && args.remainingMeters <= ARRIVING_METERS) return 'arriving';
  return 'moving';
}

/**
 * Advance displayed distance toward a snapped GPS target without reversing
 * for small GPS jitter, and without overshooting the route end.
 */
export function nextDisplayDistance(args: {
  display: number;
  target: number;
  total: number;
  dtMs: number;
  durationMs: number;
  maxSpeedMps?: number;
}): number {
  const { display, target, total, dtMs, durationMs } = args;
  const cappedTarget = Math.max(0, Math.min(total, target));
  const delta = cappedTarget - display;

  if (delta < 0 && Math.abs(delta) < BACKWARD_IGNORE_METERS) return display;
  if (delta <= 0) {
    // Genuine reroute / backtrack — ease back slowly
    const step = Math.min(Math.abs(delta), (Math.abs(delta) / Math.max(durationMs, 1)) * dtMs);
    return Math.max(0, display - step);
  }

  const durationStep = (delta / Math.max(durationMs, 1)) * dtMs;
  const speedCap = (args.maxSpeedMps ?? 28) * (dtMs / 1000);
  const step = Math.min(delta, Math.max(durationStep, 0), Math.max(speedCap, 0.4));
  return Math.min(total, display + step);
}

export function lookAheadPoint(vehicle: LatLng, dest: LatLng, fraction: number): LatLng {
  return lerpLatLng(vehicle, dest, Math.max(0, Math.min(0.45, fraction)));
}
