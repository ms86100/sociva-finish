// @ts-nocheck
/**
 * GPS noise filter with teleport rejection and exponential smoothing.
 * Inspired by Kalman-lite approaches used in delivery tracking apps.
 * All thresholds are DB-backed via trackingConfig.
 */
import { getTrackingConfigSync } from '@/services/trackingConfig';

interface GPSPoint {
  latitude: number;
  longitude: number;
  speed_kmh: number | null;
  heading: number | null;
  recorded_at: string;
}

interface FilterState {
  lastAccepted: GPSPoint | null;
  smoothedLat: number | null;
  smoothedLng: number | null;
}

/** Haversine distance in meters */
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Filter a new GPS point against previous state.
 * Returns null if the point should be rejected (teleport), or
 * a smoothed point if accepted.
 */
export function filterGPSPoint(
  point: GPSPoint,
  state: FilterState
): { accepted: boolean; filtered: GPSPoint; newState: FilterState } {
  const config = getTrackingConfigSync();
  const { lastAccepted, smoothedLat, smoothedLng } = state;

  // First point — accept as-is
  if (!lastAccepted || smoothedLat == null || smoothedLng == null) {
    return {
      accepted: true,
      filtered: point,
      newState: {
        lastAccepted: point,
        smoothedLat: point.latitude,
        smoothedLng: point.longitude,
      },
    };
  }

  const distMeters = haversine(
    lastAccepted.latitude,
    lastAccepted.longitude,
    point.latitude,
    point.longitude
  );

  // Micro-jitter rejection
  if (distMeters < config.gps_min_movement_meters) {
    return {
      accepted: false,
      filtered: { ...point, latitude: smoothedLat, longitude: smoothedLng },
      newState: state,
    };
  }

  // Bug 4 fix: Reject out-of-order points (timeDiff <= 0)
  const timeDiffMs =
    new Date(point.recorded_at).getTime() -
    new Date(lastAccepted.recorded_at).getTime();
  if (timeDiffMs <= 0) {
    return {
      accepted: false,
      filtered: { ...point, latitude: smoothedLat, longitude: smoothedLng },
      newState: state,
    };
  }

  // Teleport rejection: compute implied speed
  const impliedSpeedKmh = (distMeters / 1000) / (timeDiffMs / 3600000);
  if (impliedSpeedKmh > config.gps_max_speed_kmh) {
    return {
      accepted: false,
      filtered: { ...point, latitude: smoothedLat, longitude: smoothedLng },
      newState: state,
    };
  }

  // Exponential smoothing
  const sf = config.gps_smoothing_factor;
  const newSmoothedLat = sf * point.latitude + (1 - sf) * smoothedLat;
  const newSmoothedLng = sf * point.longitude + (1 - sf) * smoothedLng;

  const filtered: GPSPoint = {
    ...point,
    latitude: newSmoothedLat,
    longitude: newSmoothedLng,
  };

  return {
    accepted: true,
    filtered,
    newState: {
      lastAccepted: point,
      smoothedLat: newSmoothedLat,
      smoothedLng: newSmoothedLng,
    },
  };
}

export type { GPSPoint, FilterState };
