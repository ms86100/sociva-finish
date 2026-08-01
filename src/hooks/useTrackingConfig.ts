// @ts-nocheck
/**
 * React hook wrapper for tracking config from system_settings.
 * Loads once and caches for 10 minutes via React Query.
 */
import { useQuery } from '@tanstack/react-query';
import { getTrackingConfig, type TrackingConfig } from '@/services/trackingConfig';
import { jitteredStaleTime } from '@/lib/query-utils';

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
  transit_statuses_la: ['en_route', 'on_the_way', 'picked_up'],
  arrival_overlay_distance_meters: 200,
  arrival_doorstep_distance_meters: 50,
};

export function useTrackingConfig(): TrackingConfig {
  const { data } = useQuery({
    queryKey: ['tracking-config'],
    queryFn: getTrackingConfig,
    staleTime: jitteredStaleTime(30 * 60 * 1000),
  });
  return data ?? DEFAULTS;
}
