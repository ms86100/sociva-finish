// @ts-nocheck
import { useState, useRef, useCallback, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getTrackingConfig, type TrackingConfig } from '@/services/trackingConfig';
import { showFeedback } from '@/components/FeedbackPopupProvider';
import { shouldUseTransistorsoftBackgroundGeo, refreshNativeLocationEngineFlags } from '@/lib/native-location-engine';

interface TrackingState {
  isTracking: boolean;
  permissionDenied: boolean;
  permissionLevel: 'unknown' | 'always' | 'when_in_use' | 'denied';
  lastSentAt: number | null;
  trackingPaused: boolean;
}

interface QueuedLocationPayload {
  assignment_id: string;
  latitude: number;
  longitude: number;
  speed_kmh: number | null;
  heading: number | null;
  accuracy_meters: number | null;
}

const HEALTH_CHECK_INTERVAL_MS = 20_000;
const STALE_THRESHOLD_MS = 30_000;

export function useBackgroundLocationTracking(assignmentId: string | null) {
  const [state, setState] = useState<TrackingState>({
    isTracking: false,
    permissionDenied: false,
    permissionLevel: 'unknown',
    lastSentAt: null,
    trackingPaused: false,
  });

  const watchIdRef = useRef<string | number | null>(null);
  const lastSentRef = useRef<number>(0);
  const lastSpeedRef = useRef<number>(0);
  const mountedRef = useRef(true);
  const queueRef = useRef<QueuedLocationPayload[]>([]);
  const flushingRef = useRef(false);
  const configRef = useRef<TrackingConfig | null>(null);
  const healthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bgGeoRef = useRef<any>(null);
  const capacitorGeoRef = useRef<any>(null);
  const stopTrackingRef = useRef<(() => void) | null>(null);
  const startingRef = useRef(false);
  const isNative = Capacitor.isNativePlatform();
  const [useTransistorsoft, setUseTransistorsoft] = useState(() => shouldUseTransistorsoftBackgroundGeo());

  useEffect(() => {
    mountedRef.current = true;
    getTrackingConfig().then(c => { configRef.current = c; });
    if (Capacitor.getPlatform() === 'android') {
      refreshNativeLocationEngineFlags().then(() => {
        if (mountedRef.current) setUseTransistorsoft(shouldUseTransistorsoftBackgroundGeo());
      });
    }
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ─── Network layer ───────────────────────────────────────

  const postLocation = useCallback(async (payload: QueuedLocationPayload) => {
    const { data, error } = await supabase.functions.invoke('update-delivery-location', {
      body: payload,
    });
    // Check for terminal signal (server returns 200 with { terminal: true })
    if (data && typeof data === 'object' && data.terminal) {
      console.log('[LocationTracking] Delivery terminal — auto-stopping');
      throw new Error('DELIVERY_TERMINAL');
    }
    // Handle 429 rate limit — wait and signal caller to slow down
    if (error) {
      let errorBody: any = null;
      try {
        errorBody = typeof error === 'object' && error.context ? await error.context.json?.() : null;
      } catch { /* ignore */ }
      const msg = errorBody?.error || (typeof data === 'object' ? data?.error : '') || '';
      if (msg === 'Rate limited' || msg === 'Rate limited') {
        const retryMs = errorBody?.retry_after_ms || data?.retry_after_ms || 2500;
        console.log(`[LocationTracking] Rate limited — waiting ${retryMs}ms`);
        await new Promise(r => setTimeout(r, retryMs));
        throw new Error('RATE_LIMITED');
      }
      if (msg === 'Delivery is no longer active') {
        console.log('[LocationTracking] Delivery terminal — auto-stopping');
        throw new Error('DELIVERY_TERMINAL');
      }
    }
  }, []);

  const flushQueue = useCallback(async () => {
    if (flushingRef.current || queueRef.current.length === 0) return;
    flushingRef.current = true;
    try {
      const maxQueued = configRef.current?.location_max_queued_points ?? 20;
      if (queueRef.current.length > maxQueued) {
        queueRef.current = queueRef.current.slice(-maxQueued);
      }
      while (queueRef.current.length > 0) {
        const nextPayload = queueRef.current[0];
        try {
          await postLocation(nextPayload);
        } catch (err: any) {
          if (err?.message === 'RATE_LIMITED') {
            // Stop flushing — will retry on next location update or online event
            console.log('[LocationTracking] Queue flush paused due to rate limit');
            break;
          }
          throw err;
        }
        queueRef.current.shift();
        const now = Date.now();
        lastSentRef.current = now;
        if (mountedRef.current) setState(s => ({ ...s, lastSentAt: now, trackingPaused: false }));
        // Throttle between consecutive queue sends to respect server 2s rate limit
        if (queueRef.current.length > 0) {
          await new Promise(r => setTimeout(r, 2500));
        }
      }
    } catch (error: any) {
      if (error?.message !== 'DELIVERY_TERMINAL') {
        console.error('[LocationTracking] Queue flush failed:', error);
      }
    } finally {
      flushingRef.current = false;
    }
  }, [postLocation]);

  const enqueueLocation = useCallback((payload: QueuedLocationPayload) => {
    const maxQueued = configRef.current?.location_max_queued_points ?? 20;
    queueRef.current.push(payload);
    if (queueRef.current.length > maxQueued) {
      queueRef.current = queueRef.current.slice(-maxQueued);
    }
  }, []);

  const sendLocation = useCallback(async (
    lat: number, lng: number, speed: number | null,
    heading: number | null, accuracy: number | null,
  ) => {
    if (!assignmentId) return;

    const cfg = configRef.current;
    const speedKmh = speed != null ? speed * 3.6 : 0;
    lastSpeedRef.current = speedKmh;

    const now = Date.now();
    const speedThreshold = cfg?.location_speed_threshold_kmh ?? 5;
    const interval = speedKmh > speedThreshold
      ? (cfg?.location_interval_moving_ms ?? 5000)
      : (cfg?.location_interval_idle_ms ?? 15000);
    if (now - lastSentRef.current < interval) return;

    const payload: QueuedLocationPayload = {
      assignment_id: assignmentId,
      latitude: lat, longitude: lng,
      speed_kmh: speedKmh > 0 ? speedKmh : null,
      heading, accuracy_meters: accuracy,
    };

    try {
      await flushQueue();
      await postLocation(payload);
      lastSentRef.current = Date.now();
      if (mountedRef.current) setState(s => ({ ...s, lastSentAt: Date.now(), trackingPaused: false }));
    } catch (err: any) {
      if (err?.message === 'DELIVERY_TERMINAL') {
        stopTrackingRef.current?.();
        return;
      }
      if (err?.message === 'RATE_LIMITED') {
        // Don't queue — the point was too soon, just skip
        console.log('[LocationTracking] Skipping point due to rate limit');
        return;
      }
      console.error('[LocationTracking] Send failed, queueing point:', err);
      enqueueLocation(payload);
    }
  }, [assignmentId, enqueueLocation, flushQueue, postLocation]);

  // ─── Health watchdog ────────────────────────────────────

  const attemptRecovery = useCallback(async () => {
    if (!isNative) return;
    try {
      if (bgGeoRef.current) {
        const BG = bgGeoRef.current;
        const pos = await BG.getCurrentPosition({ extras: { recovery: true } });
        if (pos && pos.coords) {
          sendLocation(
            pos.coords.latitude, pos.coords.longitude,
            pos.coords.speed, pos.coords.heading, pos.coords.accuracy,
          );
          console.log('[LocationTracking] Recovery position obtained');
          return;
        }
      }
      if (capacitorGeoRef.current) {
        const pos = await capacitorGeoRef.current.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 15000,
        });
        if (pos?.coords) {
          sendLocation(
            pos.coords.latitude, pos.coords.longitude,
            pos.coords.speed ?? null, pos.coords.heading ?? null, pos.coords.accuracy ?? null,
          );
          console.log('[LocationTracking] Capacitor recovery position obtained');
        }
      }
    } catch (err) {
      console.error('[LocationTracking] Recovery getCurrentPosition failed:', err);
      if (mountedRef.current) {
        setState(s => ({ ...s, trackingPaused: true }));
        toast.error('Location updates paused — keep the app open to resume', { id: 'tracking-paused', duration: 8000 });
      }
    }
  }, [isNative, sendLocation]);

  const startHealthCheck = useCallback(() => {
    if (healthTimerRef.current) clearInterval(healthTimerRef.current);
    healthTimerRef.current = setInterval(() => {
      if (!mountedRef.current) return;
      const gap = Date.now() - lastSentRef.current;
      if (gap > STALE_THRESHOLD_MS && lastSentRef.current > 0) {
        console.warn(`[LocationTracking] No update for ${Math.round(gap / 1000)}s — attempting recovery`);
        attemptRecovery();
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }, [attemptRecovery]);

  const stopHealthCheck = useCallback(() => {
    if (healthTimerRef.current) {
      clearInterval(healthTimerRef.current);
      healthTimerRef.current = null;
    }
  }, []);

  // ─── Android Capacitor Geolocation (no Transistorsoft license toast) ───

  const upgradeAndroidBackgroundPermission = useCallback(async () => {
    if (Capacitor.getPlatform() !== 'android') return 'when_in_use' as const;
    try {
      const { LiveActivity } = await import('@/plugins/live-activity');
      const result = await LiveActivity.requestBackgroundLocation?.();
      const status = result?.status || '';
      if (status === 'granted') return 'always' as const;
      if (status === 'opened_settings') {
        toast.info('In Location permission, choose “Allow all the time” so tracking continues when minimized.', {
          id: 'bg-loc-settings',
          duration: 12000,
        });
      }
    } catch (err) {
      console.warn('[LocationTracking] Background location upgrade failed:', err);
    }
    return 'when_in_use' as const;
  }, []);

  const startAndroidCapacitorTracking = useCallback(async () => {
    try {
      const { Geolocation } = await import('@capacitor/geolocation');
      capacitorGeoRef.current = Geolocation;

      const permStatus = await Geolocation.checkPermissions();
      if (permStatus.location === 'prompt' || permStatus.location === 'prompt-with-rationale') {
        const requested = await Geolocation.requestPermissions();
        if (requested.location === 'denied') {
          setState(s => ({ ...s, permissionDenied: true, permissionLevel: 'denied' }));
          toast.error('Location permission denied. Enable it in device settings.', { duration: 8000 });
          return;
        }
      } else if (permStatus.location === 'denied') {
        setState(s => ({ ...s, permissionDenied: true, permissionLevel: 'denied' }));
        toast.error('Location permission denied. Enable it in device settings.', { duration: 8000 });
        return;
      }

      if (watchIdRef.current != null) {
        try {
          await Geolocation.clearWatch({ id: String(watchIdRef.current) });
        } catch { /* noop */ }
        watchIdRef.current = null;
      }

      const watchId = await Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 },
        (position, err) => {
          if (err) {
            console.error('[LocationTracking] Capacitor watch error:', err);
            return;
          }
          if (!position?.coords) return;
          sendLocation(
            position.coords.latitude,
            position.coords.longitude,
            position.coords.speed ?? null,
            position.coords.heading ?? null,
            position.coords.accuracy ?? null,
          );
        },
      );

      watchIdRef.current = watchId;

      // Keep a foreground notification so Android is less aggressive about killing GPS.
      try {
        if (assignmentId) {
          const { LiveActivity } = await import('@/plugins/live-activity');
          await LiveActivity.startLiveActivity({
            entity_type: 'delivery',
            entity_id: assignmentId,
            workflow_status: 'Sharing location',
            eta_minutes: null,
            driver_distance: null,
            driver_name: null,
            vehicle_type: null,
            progress_stage: 'GPS live',
            progress_percent: null,
            seller_name: null,
            item_count: null,
            order_short_id: null,
            seller_logo_url: null,
          });
        }
      } catch (notifyErr) {
        console.warn('[LocationTracking] Live delivery notification start failed:', notifyErr);
      }

      const level = await upgradeAndroidBackgroundPermission();
      if (mountedRef.current) {
        setState(s => ({
          ...s,
          isTracking: true,
          permissionDenied: false,
          permissionLevel: level,
        }));
      }
      startHealthCheck();
      toast.success('Location sharing started', { id: 'loc-started', duration: 4000 });
      console.log('[LocationTracking] Android Capacitor Geolocation tracking started (Transistorsoft skipped — no license toast)');
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[LocationTracking] Android Capacitor tracking failed:', errMsg, err);
      toast.error(`Location error: ${errMsg || 'Unknown failure'}`, { duration: 8000 });
    }
  }, [assignmentId, sendLocation, startHealthCheck, upgradeAndroidBackgroundPermission]);

  // ─── Native background geolocation (Transistorsoft — iOS / licensed Android) ─────

  const startNativeTracking = useCallback(async () => {
    try {
      // Pre-flight: Request location permission via Capacitor Geolocation plugin first
      // This ensures the iOS permission dialog is shown to the user before BackgroundGeolocation starts
      try {
        const { Geolocation } = await import('@capacitor/geolocation');
        const permStatus = await Geolocation.checkPermissions();
        console.log('[LocationTracking] Pre-flight permission status:', permStatus.location);
        if (permStatus.location === 'prompt' || permStatus.location === 'prompt-with-rationale') {
          console.log('[LocationTracking] Requesting location permission via Capacitor...');
          const requested = await Geolocation.requestPermissions();
          console.log('[LocationTracking] Permission result:', requested.location);
          if (requested.location === 'denied') {
            setState(s => ({ ...s, permissionDenied: true, permissionLevel: 'denied' }));
            toast.error('Location permission denied. Enable it in device settings.', { duration: 8000 });
            return;
          }
        } else if (permStatus.location === 'denied') {
          setState(s => ({ ...s, permissionDenied: true, permissionLevel: 'denied' }));
          toast.error('Location permission denied. Enable it in device settings.', { duration: 8000 });
          return;
        }
      } catch (preflightErr) {
        console.warn('[LocationTracking] Pre-flight permission check failed, continuing with BG plugin:', preflightErr);
      }

      const BackgroundGeolocation = (await import('@transistorsoft/capacitor-background-geolocation')).default;
      bgGeoRef.current = BackgroundGeolocation;

      await BackgroundGeolocation.ready({
        desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
        distanceFilter: 10,
        stopOnTerminate: true,
        startOnBoot: false,
        preventSuspend: false,
        heartbeatInterval: 60,
        isMoving: true,
        stopTimeout: 3,
        desiredOdometerAccuracy: 20,
        activityType: BackgroundGeolocation.ACTIVITY_TYPE_AUTOMOTIVE_NAVIGATION,
        showsBackgroundLocationIndicator: true,
        stationaryRadius: 25,
        // ACTIVITY_RECOGNITION is stripped for Play Health policy — do not require motion APIs.
        disableMotionActivityUpdates: true,
        disableStopDetection: true,
        locationAuthorizationRequest: 'Always',
        debug: false,
        logLevel: BackgroundGeolocation.LOG_LEVEL_WARNING,
      });

      // Listen for location updates
      BackgroundGeolocation.onLocation((location) => {
        if (!location.coords) return;
        sendLocation(
          location.coords.latitude, location.coords.longitude,
          location.coords.speed, location.coords.heading, location.coords.accuracy,
        );
      }, (error) => {
        console.error('[LocationTracking] onLocation error:', error);
      });

      // Listen for provider/permission changes
      BackgroundGeolocation.onProviderChange((event) => {
        console.log('[LocationTracking] Provider change:', event);
        if (mountedRef.current) {
          const level = event.accuracyAuthorization === 0 ? 'always' :
            event.status === 3 ? 'always' :
            event.status === 2 ? 'when_in_use' :
            event.status === 0 ? 'denied' : 'unknown';
          setState(s => ({ ...s, permissionLevel: level, permissionDenied: level === 'denied' }));
        }
      });

      // Start tracking
      const bgState = await BackgroundGeolocation.start();
      console.log('[LocationTracking] Native tracking started:', bgState.enabled);

      // Request "Always" permission upgrade
      try {
        await BackgroundGeolocation.requestPermission();
        const providerState = await BackgroundGeolocation.getProviderState();
        const level = providerState.status === 3 ? 'always' :
          providerState.status === 2 ? 'when_in_use' :
          providerState.status === 0 ? 'denied' : 'unknown';
        if (mountedRef.current) {
          setState(s => ({
            ...s,
            isTracking: true,
            permissionDenied: level === 'denied',
            permissionLevel: level,
          }));
        }
        if (level === 'denied') {
          toast.error('Location permission denied. Enable it in device settings.');
          return;
        }
        if (level === 'when_in_use') {
          toast.info('For uninterrupted tracking, enable "Always" in Settings → Location', {
            id: 'perm-upgrade',
            duration: 10000,
          });
        }
      } catch {
        // Permission request failed, tracking may still work with WhenInUse
        if (mountedRef.current) {
          setState(s => ({ ...s, isTracking: true, permissionLevel: 'when_in_use' }));
        }
      }

      startHealthCheck();
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[LocationTracking] Native tracking setup failed:', errMsg, err);
      // Fall back to Capacitor GPS instead of failing silently (common without license / motion APIs).
      if (Capacitor.getPlatform() === 'android') {
        console.warn('[LocationTracking] Falling back to Capacitor Geolocation after Transistorsoft failure:', errMsg);
        await startAndroidCapacitorTracking();
        return;
      }
      toast.error(`Location error: ${errMsg || 'Unknown failure'}`, { duration: 8000 });
    }
  }, [sendLocation, startHealthCheck, startAndroidCapacitorTracking]);

  // ─── Auto-restart on resume (Gap 2: background kill recovery) ───

  useEffect(() => {
    if (!isNative || !useTransistorsoft || !state.isTracking) return;

    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const listener = await App.addListener('appStateChange', async ({ isActive }) => {
          if (!isActive || !bgGeoRef.current || !mountedRef.current) return;
          try {
            const providerState = await bgGeoRef.current.getProviderState();
            if (!providerState.enabled) {
              console.log('[LocationTracking] Detected stopped tracking on resume — restarting');
              await bgGeoRef.current.start();
              await flushQueue();
              showFeedback({
        title: 'Tracking resumed',
        variant: 'success',
      });
              if (mountedRef.current) setState(s => ({ ...s, trackingPaused: false }));
            }
          } catch (err) {
            console.error('[LocationTracking] Resume restart failed:', err);
          }
        });
        cleanup = () => listener.remove();
      } catch {
        // Capacitor App plugin not available
      }
    })();

    return () => cleanup?.();
  }, [isNative, useTransistorsoft, state.isTracking, flushQueue]);

  // ─── Web fallback ──────────────────────────────────────

  const startWebTracking = useCallback(() => {
    if (!navigator.geolocation) {
      toast.error('Geolocation not supported in this browser.');
      return;
    }

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        sendLocation(
          pos.coords.latitude, pos.coords.longitude,
          pos.coords.speed, pos.coords.heading, pos.coords.accuracy,
        );
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setState(s => ({ ...s, permissionDenied: true, permissionLevel: 'denied' }));
          toast.error('Location permission denied.');
        }
      },
      { enableHighAccuracy: true },
    );
    watchIdRef.current = id;
    setState(s => ({ ...s, isTracking: true, permissionDenied: false, permissionLevel: 'always' }));
    startHealthCheck();
  }, [sendLocation, startHealthCheck]);

  // ─── Public API ────────────────────────────────────────

  const startTracking = useCallback(async () => {
    if (state.isTracking || startingRef.current) return;
    if (!assignmentId) {
      console.warn('[LocationTracking] startTracking ignored — no delivery assignment id yet');
      toast.error('Delivery assignment not ready yet. Open the order again and tap Start Sharing.', {
        id: 'loc-no-assignment',
        duration: 8000,
      });
      return;
    }
    startingRef.current = true;

    try {
      let useTs = useTransistorsoft;
      if (Capacitor.getPlatform() === 'android') {
        await refreshNativeLocationEngineFlags();
        useTs = shouldUseTransistorsoftBackgroundGeo();
        if (useTs !== useTransistorsoft) setUseTransistorsoft(useTs);
      }

      if (isNative && useTs) {
        try {
          await startNativeTracking();
        } catch (firstErr) {
          // Single retry after 1s for transient native bridge readiness issues
          console.warn('[LocationTracking] First attempt failed, retrying in 1s...', firstErr);
          await new Promise(r => setTimeout(r, 1000));
          await startNativeTracking();
        }
      } else if (isNative) {
        // Android without Transistorsoft license: Capacitor Geolocation only.
        await startAndroidCapacitorTracking();
      } else {
        startWebTracking();
      }
    } finally {
      startingRef.current = false;
    }
  }, [
    assignmentId,
    isNative,
    useTransistorsoft,
    startNativeTracking,
    startAndroidCapacitorTracking,
    startWebTracking,
    state.isTracking,
  ]);

  const stopTracking = useCallback(async () => {
    stopHealthCheck();

    if (isNative && bgGeoRef.current) {
      try {
        await bgGeoRef.current.stop();
        await bgGeoRef.current.removeListeners();
      } catch {
        // noop
      }
      bgGeoRef.current = null;
    }

    if (watchIdRef.current != null) {
      if (capacitorGeoRef.current) {
        try {
          await capacitorGeoRef.current.clearWatch({ id: String(watchIdRef.current) });
        } catch {
          // noop
        }
      } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current as number);
      }
      watchIdRef.current = null;
    }
    capacitorGeoRef.current = null;

    if (isNative && Capacitor.getPlatform() === 'android') {
      try {
        const { LiveActivity } = await import('@/plugins/live-activity');
        const active = await LiveActivity.getActiveActivities();
        for (const entry of active?.activities || []) {
          await LiveActivity.endLiveActivity({ activityId: entry.activityId });
        }
      } catch {
        // noop
      }
    }

    if (mountedRef.current) {
      setState(s => ({ ...s, isTracking: false, trackingPaused: false }));
    }
  }, [isNative, stopHealthCheck]);

  // Keep stopTrackingRef in sync so sendLocation can call it without circular deps
  useEffect(() => {
    stopTrackingRef.current = stopTracking;
  }, [stopTracking]);

  // ─── Auto-stop when assignmentId becomes null ──────────
  useEffect(() => {
    if (!assignmentId && state.isTracking) {
      stopTracking();
    }
  }, [assignmentId, state.isTracking, stopTracking]);

  // ─── Flush queue on reconnect ──────────────────────────

  useEffect(() => {
    const handleOnline = () => { flushQueue(); };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [flushQueue]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { stopTracking(); };
  }, [stopTracking]);

  return {
    isTracking: state.isTracking,
    permissionDenied: state.permissionDenied,
    permissionLevel: state.permissionLevel,
    lastSentAt: state.lastSentAt,
    trackingPaused: state.trackingPaused,
    startTracking,
    stopTracking,
  };
}
