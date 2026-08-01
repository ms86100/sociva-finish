// @ts-nocheck
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { filterGPSPoint, type FilterState } from '@/lib/gps-filter';
import { getTrackingConfig, getTrackingConfigSync } from '@/services/trackingConfig';

interface RiderLocation {
  latitude: number;
  longitude: number;
  speed_kmh: number | null;
  heading: number | null;
  recorded_at: string;
}

export interface DeliveryTrackingState {
  riderLocation: RiderLocation | null;
  eta: number | null;
  distance: number | null;
  status: string | null;
  riderName: string | null;
  riderPhone: string | null;
  riderPhotoUrl: string | null;
  lastLocationAt: string | null;
  isLoading: boolean;
  isLocationStale: boolean;
  proximityStatus: string | null;
}

/** Polling intervals in ms */
const POLL_TRANSIT_MS = 10_000;
const POLL_IDLE_MS = 30_000;
const POLL_DEGRADED_MS = 5_000;

/**
 * Fetches assignment data and returns parsed state fields.
 */
async function fetchAssignment(assignmentId: string) {
  const { data } = await supabase
    .from('delivery_assignments')
    .select('id, status, rider_name, rider_phone, rider_photo_url, eta_minutes, distance_meters, last_location_lat, last_location_lng, last_location_at, proximity_status')
    .eq('id', assignmentId)
    .maybeSingle();
  return data;
}

function buildLocationFromData(data: any): RiderLocation | null {
  if (!data.last_location_lat || !data.last_location_lng) return null;
  return {
    latitude: data.last_location_lat,
    longitude: data.last_location_lng,
    speed_kmh: null,
    heading: null,
    recorded_at: data.last_location_at || new Date().toISOString(),
  };
}

export function useDeliveryTracking(assignmentId: string | null | undefined, isInTransitOverride?: boolean): DeliveryTrackingState {
  const [state, setState] = useState<DeliveryTrackingState>({
    riderLocation: null,
    eta: null,
    distance: null,
    status: null,
    riderName: null,
    riderPhone: null,
    riderPhotoUrl: null,
    lastLocationAt: null,
    isLoading: true,
    isLocationStale: false,
    proximityStatus: null,
  });

  const gpsFilterState = useRef<FilterState>({
    lastAccepted: null,
    smoothedLat: null,
    smoothedLng: null,
  });

  // Track last realtime event time to skip redundant polls
  const lastRealtimeAt = useRef<number>(0);
  // Track channel health
  const channelDegraded = useRef(false);
  // Bug 15 fix: dedup guard for location timestamps
  const seenLocationTimestamps = useRef(new Set<string>());
  // Bug 10 fix: track current status for adaptive polling
  const currentStatusRef = useRef<string | null>(null);

  // Pre-load config
  useEffect(() => {
    getTrackingConfig().catch(() => {});
  }, []);

  // Staleness checker
  useEffect(() => {
    // Bug 7 fix: check staleness every 15s instead of 30s
    const interval = setInterval(() => {
      setState((prev) => {
        if (!prev.lastLocationAt) {
          return prev.status && !prev.isLocationStale ? { ...prev, isLocationStale: true } : prev;
        }
        const threshold = getTrackingConfigSync().location_stale_threshold_ms;
        const stale = Date.now() - new Date(prev.lastLocationAt).getTime() > threshold;
        return stale !== prev.isLocationStale ? { ...prev, isLocationStale: stale } : prev;
      });
    }, 15_000);
    return () => clearInterval(interval);
  }, []);

  /**
   * Apply fetched data to state, only if newer than current.
   * Returns true if state was updated.
   */
  const applyFetchedData = useCallback((data: any) => {
    // Bug 15 fix: dedup by timestamp
    const ts = data.last_location_at;
    if (ts && seenLocationTimestamps.current.has(ts)) {
      // Still update non-location fields
      setState((prev) => ({
        ...prev,
        status: data.status ?? prev.status,
        riderName: data.rider_name ?? prev.riderName,
        riderPhone: data.rider_phone ?? prev.riderPhone,
        riderPhotoUrl: data.rider_photo_url ?? prev.riderPhotoUrl,
        eta: data.eta_minutes ?? prev.eta,
        distance: data.distance_meters ?? prev.distance,
        proximityStatus: data.proximity_status ?? prev.proximityStatus,
        isLoading: false,
      }));
      return;
    }
    if (ts) {
      seenLocationTimestamps.current.add(ts);
      // Keep set bounded
      if (seenLocationTimestamps.current.size > 100) {
        const entries = Array.from(seenLocationTimestamps.current);
        seenLocationTimestamps.current = new Set(entries.slice(-50));
      }
    }

    const loc = buildLocationFromData(data);
    if (loc) {
      const result = filterGPSPoint(loc, gpsFilterState.current);
      gpsFilterState.current = result.newState;
      loc.latitude = result.filtered.latitude;
      loc.longitude = result.filtered.longitude;
    }

    // Bug 10 fix: track current status
    if (data.status) currentStatusRef.current = data.status;

    setState((prev) => {
      const incomingAt = data.last_location_at;
      const currentAt = prev.lastLocationAt;
      const isNewer = !currentAt || (incomingAt && new Date(incomingAt).getTime() > new Date(currentAt).getTime());

      return {
        ...prev,
        status: data.status ?? prev.status,
        riderName: data.rider_name ?? prev.riderName,
        riderPhone: data.rider_phone ?? prev.riderPhone,
        riderPhotoUrl: data.rider_photo_url ?? prev.riderPhotoUrl,
        eta: data.eta_minutes ?? prev.eta,
        distance: data.distance_meters ?? prev.distance,
        lastLocationAt: isNewer ? (data.last_location_at ?? prev.lastLocationAt) : prev.lastLocationAt,
        proximityStatus: data.proximity_status ?? prev.proximityStatus,
        riderLocation: isNewer && loc ? loc : prev.riderLocation,
        isLoading: false,
        isLocationStale: isNewer ? false : prev.isLocationStale,
      };
    });
  }, []);

  useEffect(() => {
    if (!assignmentId) {
      setState((prev) => ({ ...prev, isLoading: false }));
      return;
    }

    gpsFilterState.current = { lastAccepted: null, smoothedLat: null, smoothedLng: null };
    channelDegraded.current = false;
    lastRealtimeAt.current = 0;

    // ─── Initial fetch ───
    (async () => {
      const data = await fetchAssignment(assignmentId);
      if (!data) {
        setState((prev) => ({ ...prev, isLoading: false }));
        return;
      }
      applyFetchedData(data);
    })();

    // ─── Adaptive polling fallback ───
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const schedulePoll = () => {
      if (pollTimer) clearTimeout(pollTimer);

      const getInterval = () => {
        if (channelDegraded.current) return POLL_DEGRADED_MS;
        // Use workflow-derived isInTransit when available, fallback to system_settings
        if (isInTransitOverride != null) {
          return isInTransitOverride ? POLL_TRANSIT_MS : POLL_IDLE_MS;
        }
        const transitStatuses = new Set(getTrackingConfigSync().transit_statuses);
        if (currentStatusRef.current && !transitStatuses.has(currentStatusRef.current)) {
          return POLL_IDLE_MS;
        }
        return POLL_TRANSIT_MS;
      };

      pollTimer = setTimeout(async () => {
        // Skip poll if we received a realtime event very recently
        if (Date.now() - lastRealtimeAt.current < 3_000) {
          schedulePoll();
          return;
        }

        try {
          const data = await fetchAssignment(assignmentId);
          if (data) applyFetchedData(data);
        } catch (err) {
          console.warn('[DeliveryTracking] Poll failed:', err);
        }
        schedulePoll();
      }, getInterval());
    };

    schedulePoll();

    // ─── Visibility change: immediate poll on foreground resume ───
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Immediate poll when app comes to foreground
        fetchAssignment(assignmentId).then((data) => {
          if (data) applyFetchedData(data);
        }).catch(() => {});
        // Reset poll timer
        schedulePoll();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // ─── Realtime channels ───
    const assignmentChannel = supabase
      .channel(`tracking-assignment-${assignmentId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'delivery_assignments',
        filter: `id=eq.${assignmentId}`,
      }, (payload) => {
        lastRealtimeAt.current = Date.now();
        channelDegraded.current = false;
        const d = payload.new as any;
        setState((prev) => {
          const incomingRecordedAt = d.last_location_at || null;
          const currentRecordedAt = prev.riderLocation?.recorded_at || prev.lastLocationAt || null;
          const shouldReplaceLocation = Boolean(
            d.last_location_lat &&
            d.last_location_lng &&
            (!currentRecordedAt || (incomingRecordedAt && new Date(incomingRecordedAt).getTime() > new Date(currentRecordedAt).getTime()))
          );

          let filteredLocation = prev.riderLocation;
          if (shouldReplaceLocation) {
            const rawPoint: RiderLocation = {
              latitude: d.last_location_lat,
              longitude: d.last_location_lng,
              speed_kmh: prev.riderLocation?.speed_kmh ?? null,
              heading: prev.riderLocation?.heading ?? null,
              recorded_at: d.last_location_at || new Date().toISOString(),
            };
            const result = filterGPSPoint(rawPoint, gpsFilterState.current);
            gpsFilterState.current = result.newState;
            filteredLocation = {
              ...rawPoint,
              latitude: result.filtered.latitude,
              longitude: result.filtered.longitude,
            };
          }

          return {
            ...prev,
            status: d.status ?? prev.status,
            riderName: d.rider_name ?? prev.riderName,
            riderPhone: d.rider_phone ?? prev.riderPhone,
            riderPhotoUrl: d.rider_photo_url ?? prev.riderPhotoUrl,
            eta: d.eta_minutes ?? prev.eta,
            distance: d.distance_meters ?? prev.distance,
            lastLocationAt: d.last_location_at ?? prev.lastLocationAt,
            proximityStatus: d.proximity_status ?? prev.proximityStatus,
            riderLocation: filteredLocation,
          };
        });
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[DeliveryTracking] Assignment channel degraded:', status);
          channelDegraded.current = true;
          schedulePoll(); // Accelerate polling
        } else if (status === 'SUBSCRIBED') {
          channelDegraded.current = false;
        }
      });

    const locationChannel = supabase
      .channel(`tracking-location-${assignmentId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'delivery_locations',
        filter: `assignment_id=eq.${assignmentId}`,
      }, (payload) => {
        lastRealtimeAt.current = Date.now();
        channelDegraded.current = false;
        const loc = payload.new as any;

        // Bug 15 fix: dedup by recorded_at
        const ts = loc.recorded_at;
        if (ts && seenLocationTimestamps.current.has(ts)) return;
        if (ts) {
          seenLocationTimestamps.current.add(ts);
          if (seenLocationTimestamps.current.size > 100) {
            const entries = Array.from(seenLocationTimestamps.current);
            seenLocationTimestamps.current = new Set(entries.slice(-50));
          }
        }

        const rawPoint: RiderLocation = {
          latitude: loc.latitude,
          longitude: loc.longitude,
          speed_kmh: loc.speed_kmh,
          heading: loc.heading,
          recorded_at: loc.recorded_at,
        };

        const result = filterGPSPoint(rawPoint, gpsFilterState.current);
        gpsFilterState.current = result.newState;

        setState((prev) => ({
          ...prev,
          riderLocation: {
            ...rawPoint,
            latitude: result.filtered.latitude,
            longitude: result.filtered.longitude,
          },
          lastLocationAt: loc.recorded_at,
          isLocationStale: false,
        }));
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[DeliveryTracking] Location channel degraded:', status);
          channelDegraded.current = true;
          schedulePoll();
        } else if (status === 'SUBSCRIBED') {
          channelDegraded.current = false;
        }
      });

    return () => {
      if (pollTimer) clearTimeout(pollTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      supabase.removeChannel(assignmentChannel);
      supabase.removeChannel(locationChannel);
    };
  }, [assignmentId, applyFetchedData]);

  return state;
}
