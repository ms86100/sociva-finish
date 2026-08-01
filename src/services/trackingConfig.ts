// @ts-nocheck
/**
 * DB-backed tracking configuration.
 * Loaded once and cached for 10 minutes.
 * Used by services (non-React) — React components use useSystemSettingsRaw directly.
 */
import { loadAppBootstrap } from '@/lib/app-bootstrap';

export interface TrackingConfig {
  gps_max_speed_kmh: number;
  gps_smoothing_factor: number;
  gps_min_movement_meters: number;
  location_interval_moving_ms: number;
  location_interval_idle_ms: number;
  location_speed_threshold_kmh: number;
  location_max_queued_points: number;
  location_stale_threshold_ms: number;
  stalled_soft_threshold_minutes: number;
  stalled_hard_threshold_minutes: number;
  osrm_refetch_threshold_meters: number;
  osrm_timeout_ms: number;
  map_animation_duration_ms: number;
  max_delivery_distance_km: number;
  transit_statuses: string[];
  transit_statuses_la: string[];
  arrival_overlay_distance_meters: number;
  arrival_doorstep_distance_meters: number;
}

const DEFAULTS: TrackingConfig = {
  gps_max_speed_kmh: 120,
  gps_smoothing_factor: 0.7,
  gps_min_movement_meters: 1,
  location_interval_moving_ms: 5000,
  location_interval_idle_ms: 15000,
  location_speed_threshold_kmh: 5,
  location_max_queued_points: 20,
  location_stale_threshold_ms: 120000,
  stalled_soft_threshold_minutes: 1.5,
  stalled_hard_threshold_minutes: 3,
  osrm_refetch_threshold_meters: 80,
  osrm_timeout_ms: 5000,
  map_animation_duration_ms: 2000,
  max_delivery_distance_km: 10,
  transit_statuses: ['picked_up', 'on_the_way', 'at_gate'],
  transit_statuses_la: ['on_the_way', 'picked_up', 'at_gate'],
  arrival_overlay_distance_meters: 200,
  arrival_doorstep_distance_meters: 50,
};

let cached: TrackingConfig | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 10 * 60 * 1000;

// NOTE: these keys all live in system_settings, which now arrives via the
// shared app bootstrap — no dedicated query is needed here any more.


function parseNum(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

function parseJsonArray(val: string | undefined, fallback: string[]): string[] {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

export async function getTrackingConfig(): Promise<TrackingConfig> {
  if (cached && Date.now() < cacheExpiry) return cached;

  try {
    // PERF: reuses the shared bootstrap snapshot instead of its own
    // system_settings round-trip.
    const { sysMap: map } = await loadAppBootstrap();


    cached = {
      gps_max_speed_kmh: parseNum(map.gps_max_speed_kmh, DEFAULTS.gps_max_speed_kmh),
      gps_smoothing_factor: parseNum(map.gps_smoothing_factor, DEFAULTS.gps_smoothing_factor),
      gps_min_movement_meters: parseNum(map.gps_min_movement_meters, DEFAULTS.gps_min_movement_meters),
      location_interval_moving_ms: parseNum(map.location_interval_moving_ms, DEFAULTS.location_interval_moving_ms),
      location_interval_idle_ms: parseNum(map.location_interval_idle_ms, DEFAULTS.location_interval_idle_ms),
      location_speed_threshold_kmh: parseNum(map.location_speed_threshold_kmh, DEFAULTS.location_speed_threshold_kmh),
      location_max_queued_points: parseNum(map.location_max_queued_points, DEFAULTS.location_max_queued_points),
      location_stale_threshold_ms: parseNum(map.location_stale_threshold_ms, DEFAULTS.location_stale_threshold_ms),
      stalled_soft_threshold_minutes: parseNum(map.stalled_soft_threshold_minutes, DEFAULTS.stalled_soft_threshold_minutes),
      stalled_hard_threshold_minutes: parseNum(map.stalled_hard_threshold_minutes, DEFAULTS.stalled_hard_threshold_minutes),
      osrm_refetch_threshold_meters: parseNum(map.osrm_refetch_threshold_meters, DEFAULTS.osrm_refetch_threshold_meters),
      osrm_timeout_ms: parseNum(map.osrm_timeout_ms, DEFAULTS.osrm_timeout_ms),
      map_animation_duration_ms: parseNum(map.map_animation_duration_ms, DEFAULTS.map_animation_duration_ms),
      max_delivery_distance_km: parseNum(map.max_delivery_distance_km, DEFAULTS.max_delivery_distance_km),
      transit_statuses: parseJsonArray(map.transit_statuses, DEFAULTS.transit_statuses),
      transit_statuses_la: parseJsonArray(map.transit_statuses_la, DEFAULTS.transit_statuses_la),
      arrival_overlay_distance_meters: parseNum(map.arrival_overlay_distance_meters, DEFAULTS.arrival_overlay_distance_meters),
      arrival_doorstep_distance_meters: parseNum(map.arrival_doorstep_distance_meters, DEFAULTS.arrival_doorstep_distance_meters),
    };
    cacheExpiry = Date.now() + CACHE_TTL;
  } catch {
    if (!cached) cached = { ...DEFAULTS };
  }

  return cached!;
}

export function invalidateTrackingConfig(): void {
  cached = null;
  cacheExpiry = 0;
}

/** Synchronous access to last loaded config (returns defaults if never loaded) */
export function getTrackingConfigSync(): TrackingConfig {
  return cached ?? DEFAULTS;
}
