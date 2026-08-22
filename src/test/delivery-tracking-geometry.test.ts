import { describe, expect, it } from 'vitest';
import {
  ARRIVING_METERS,
  BACKWARD_IGNORE_METERS,
  LONG_DISTANCE_METERS,
  bearingDegrees,
  buildLongDistancePath,
  buildRouteMetrics,
  haversineMeters,
  headingDelta,
  isLongDistance,
  lerpHeading,
  lerpLatLng,
  lookAheadPoint,
  nextDisplayDistance,
  poseAtDistance,
  resolveTrackingPhase,
  snapToRoute,
  splitRouteAtDistance,
} from '@/lib/delivery-tracking-geometry';

const origin = { lat: 12.9716, lng: 77.5946 };
const dest = { lat: 13.0016, lng: 77.6346 };

describe('delivery tracking geometry', () => {
  it('builds cumulative distances along a polyline', () => {
    const mid = lerpLatLng(origin, dest, 0.5);
    const metrics = buildRouteMetrics([origin, mid, dest]);
    expect(metrics.points).toHaveLength(3);
    expect(metrics.cumulative[0]).toBe(0);
    expect(metrics.total).toBeGreaterThan(1000);
    expect(metrics.cumulative[2]).toBeCloseTo(metrics.total, 6);
  });

  it('snaps a nearby GPS point onto the nearest route segment', () => {
    const metrics = buildRouteMetrics([origin, dest]);
    const off = { lat: origin.lat + 0.0004, lng: origin.lng + 0.0001 };
    const snap = snapToRoute(metrics, off);
    expect(snap.offRouteMeters).toBeLessThan(80);
    expect(snap.distanceAlong).toBeGreaterThanOrEqual(0);
    expect(snap.distanceAlong).toBeLessThan(metrics.total);
  });

  it('interpolates vehicle pose along decoded geometry, not a straight A→B jump', () => {
    const bend = { lat: origin.lat + 0.008, lng: origin.lng - 0.004 };
    const metrics = buildRouteMetrics([origin, bend, dest]);
    const start = poseAtDistance(metrics, 0);
    const mid = poseAtDistance(metrics, metrics.total * 0.5);
    const linearMid = lerpLatLng(origin, dest, 0.5);

    expect(start.point.lat).toBeCloseTo(origin.lat, 6);
    expect(haversineMeters(mid.point, linearMid)).toBeGreaterThan(80);
    expect(mid.bearing).toBeGreaterThanOrEqual(0);
    expect(mid.bearing).toBeLessThan(360);
  });

  it('splits completed vs remaining around the vehicle', () => {
    const metrics = buildRouteMetrics([origin, dest]);
    const { completed, remaining } = splitRouteAtDistance(metrics, metrics.total * 0.4);
    expect(completed.length).toBeGreaterThanOrEqual(2);
    expect(remaining.length).toBeGreaterThanOrEqual(2);
    expect(completed[0]).toEqual(origin);
    expect(remaining[remaining.length - 1]).toEqual(dest);
  });

  it('smooths heading instead of snapping 30° → 140°', () => {
    const stepped = [];
    let heading = 30;
    for (let i = 0; i < 8; i++) {
      heading = lerpHeading(heading, 140, 0.2);
      stepped.push(heading);
    }
    expect(stepped[0]).toBeGreaterThan(30);
    expect(stepped[0]).toBeLessThan(60);
    expect(stepped[stepped.length - 1]).toBeGreaterThan(90);
    expect(Math.abs(headingDelta(30, 140))).toBe(110);
  });

  it('ignores tiny backward GPS jitter while advancing toward the target', () => {
    const total = 1000;
    const forward = nextDisplayDistance({
      display: 400,
      target: 480,
      total,
      dtMs: 16,
      durationMs: 2000,
    });
    expect(forward).toBeGreaterThan(400);
    expect(forward).toBeLessThan(480);

    const jitter = nextDisplayDistance({
      display: 400,
      target: 400 - (BACKWARD_IGNORE_METERS - 2),
      total,
      dtMs: 16,
      durationMs: 2000,
    });
    expect(jitter).toBe(400);
  });

  it('uses a curved dashed path for long-distance deliveries', () => {
    const kolkata = { lat: 22.5726, lng: 88.3639 };
    const jaipur = { lat: 26.9124, lng: 75.7873 };
    expect(haversineMeters(kolkata, jaipur)).toBeGreaterThan(LONG_DISTANCE_METERS);
    expect(isLongDistance(kolkata, jaipur)).toBe(true);

    const path = buildLongDistancePath(kolkata, jaipur, 40);
    expect(path.length).toBe(41);
    const mid = path[20];
    const linearMid = lerpLatLng(kolkata, jaipur, 0.5);
    expect(haversineMeters(mid, linearMid)).toBeGreaterThan(20_000);
  });

  it('resolves confirmed / moving / arriving phases', () => {
    expect(resolveTrackingPhase({ hasVehicle: false, remainingMeters: 2000 })).toBe('confirmed');
    expect(resolveTrackingPhase({ hasVehicle: true, remainingMeters: 1800 })).toBe('moving');
    expect(resolveTrackingPhase({ hasVehicle: true, remainingMeters: ARRIVING_METERS - 10 })).toBe('arriving');
    expect(resolveTrackingPhase({ hasVehicle: true, remainingMeters: 900, proximityStatus: 'arriving' })).toBe('arriving');
  });

  it('places the camera look-ahead toward the destination, not on the vehicle center', () => {
    const look = lookAheadPoint(origin, dest, 0.16);
    expect(haversineMeters(origin, look)).toBeGreaterThan(10);
    expect(haversineMeters(look, dest)).toBeLessThan(haversineMeters(origin, dest));
  });

  it('computes north-ish bearing for northbound travel', () => {
    const bearing = bearingDegrees(origin, { lat: origin.lat + 0.01, lng: origin.lng });
    expect(Math.min(bearing, 360 - bearing)).toBeLessThan(8);
  });
});
