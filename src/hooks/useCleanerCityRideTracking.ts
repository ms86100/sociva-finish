// @ts-nocheck
import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';
import {
  enqueueLocation,
  flushLocationOutbox,
} from '@/lib/cleaner-city/locationOutbox';
import {
  refreshAndroidCommuteTracking,
  requestAndroidBackgroundLocationUpgrade,
  rideTrackingHonestyCopy,
  rideTrackingPlatformMode,
  startAndroidCommuteTracking,
  stopAndroidCommuteTracking,
  type RideTrackingPlatformMode,
} from '@/lib/cleaner-city/commuteTracking';
import {
  getCurrentPosition,
  requestBackgroundLocationPermission,
  requestLocationPermission,
} from '@/lib/native-location';

const TICK_MS = 10_000;
const HEALTH_MS = 20_000;
const STALE_MS = 35_000;
const ANDROID_TOKEN_REFRESH_MS = 4 * 60_000;

export type RideTrackingStatus = {
  active: boolean;
  platformMode: RideTrackingPlatformMode;
  backgroundSupported: boolean;
  permissionDenied: boolean;
  trackingPaused: boolean;
  lastSentAt: number | null;
  honestyCopy: string;
};

type PublishFn = (sample: {
  ride_id: string;
  latitude: number;
  longitude: number;
  accuracy_meters?: number | null;
}) => Promise<void>;

/**
 * Cross-device Cleaner City live location for an active ride.
 * - Android: foreground watch + CommuteTrackingService FGS
 * - iOS: foreground watch + interval (no UIBackgroundModes location)
 * - Web: watch + interval + screen wake lock while tab visible
 */
export function useCleanerCityRideTracking(
  rideId: string | null | undefined,
  enabled: boolean,
  publish: PublishFn,
) {
  const mode = rideTrackingPlatformMode();
  const [status, setStatus] = useState<RideTrackingStatus>({
    active: false,
    platformMode: mode,
    backgroundSupported: mode === 'android_fgs',
    permissionDenied: false,
    trackingPaused: false,
    lastSentAt: null,
    honestyCopy: rideTrackingHonestyCopy(mode, false),
  });

  const publishRef = useRef(publish);
  publishRef.current = publish;
  const lastSentRef = useRef(0);
  const watchIdRef = useRef<string | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!enabled || !rideId) {
      setStatus((s) => ({
        ...s,
        active: false,
        trackingPaused: false,
        honestyCopy: rideTrackingHonestyCopy(mode, false),
      }));
      return;
    }

    let cancelled = false;
    let tickTimer: ReturnType<typeof setInterval> | null = null;
    let healthTimer: ReturnType<typeof setInterval> | null = null;
    let tokenTimer: ReturnType<typeof setInterval> | null = null;
    let removeAppListener: (() => void) | undefined;

    const markSent = () => {
      lastSentRef.current = Date.now();
      if (!cancelled) {
        setStatus((s) => ({
          ...s,
          active: true,
          trackingPaused: false,
          lastSentAt: lastSentRef.current,
          permissionDenied: false,
        }));
      }
    };

    const sendSample = async (sample: {
      ride_id: string;
      latitude: number;
      longitude: number;
      accuracy_meters?: number | null;
    }) => {
      await publishRef.current(sample);
      markSent();
    };

    const queueSample = (sample: {
      ride_id: string;
      latitude: number;
      longitude: number;
    }) => {
      enqueueLocation({
        ...sample,
        recorded_at: new Date().toISOString(),
      });
    };

    const tick = async () => {
      try {
        await flushLocationOutbox(async (queued) => {
          await sendSample({
            ride_id: queued.ride_id,
            latitude: queued.latitude,
            longitude: queued.longitude,
          });
        });
        const pos = await getCurrentPosition({ requestPermission: true });
        if (cancelled) return;
        await sendSample({
          ride_id: rideId,
          latitude: pos.latitude,
          longitude: pos.longitude,
        });
      } catch {
        try {
          const pos = await getCurrentPosition({ requestPermission: false });
          if (cancelled) return;
          queueSample({
            ride_id: rideId,
            latitude: pos.latitude,
            longitude: pos.longitude,
          });
        } catch {
          if (!cancelled) {
            setStatus((s) => ({ ...s, trackingPaused: true }));
          }
        }
      }
    };

    const clearNativeWatch = async () => {
      if (!watchIdRef.current) return;
      const id = watchIdRef.current;
      watchIdRef.current = null;
      try {
        const { Geolocation } = await import('@capacitor/geolocation');
        await Geolocation.clearWatch({ id });
      } catch {
        /* ignore */
      }
    };

    const startNativeWatch = async () => {
      if (!Capacitor.isNativePlatform()) return;
      try {
        const { Geolocation } = await import('@capacitor/geolocation');
        await clearNativeWatch();
        const id = await Geolocation.watchPosition(
          { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 },
          (pos, err) => {
            if (cancelled || err || !pos?.coords) {
              if (!cancelled && err) {
                setStatus((s) => ({ ...s, trackingPaused: true }));
              }
              return;
            }
            void sendSample({
              ride_id: rideId,
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy_meters: pos.coords.accuracy ?? null,
            }).catch(() => {
              queueSample({
                ride_id: rideId,
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
              });
            });
          },
        );
        watchIdRef.current = id || null;
      } catch {
        // Interval tick remains the fallback.
      }
    };

    const startWebWatch = () => {
      if (Capacitor.isNativePlatform() || !navigator.geolocation) return;
      const id = navigator.geolocation.watchPosition(
        (pos) => {
          if (cancelled) return;
          void sendSample({
            ride_id: rideId,
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy_meters: pos.coords.accuracy ?? null,
          }).catch(() => {
            queueSample({
              ride_id: rideId,
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            });
          });
        },
        () => {
          if (!cancelled) setStatus((s) => ({ ...s, trackingPaused: true }));
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
      );
      watchIdRef.current = String(id);
    };

    const releaseWakeLock = async () => {
      try {
        await wakeLockRef.current?.release?.();
      } catch {
        /* ignore */
      }
      wakeLockRef.current = null;
    };

    const requestWakeLock = async () => {
      if (!('wakeLock' in navigator)) return;
      if (document.visibilityState !== 'visible') return;
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      } catch {
        /* ignore */
      }
    };

    const bootstrap = async () => {
      const fg = await requestLocationPermission();
      if (cancelled) return;
      if (fg === 'denied') {
        setStatus((s) => ({
          ...s,
          active: false,
          permissionDenied: true,
          honestyCopy: 'Location permission is off. Enable it to share the live map with your partner.',
        }));
        return;
      }

      let bgSupported = false;
      if (Capacitor.getPlatform() === 'android') {
        const upgrade = await requestAndroidBackgroundLocationUpgrade();
        bgSupported = upgrade.status === 'granted';
        if (!bgSupported) {
          const legacy = await requestBackgroundLocationPermission();
          bgSupported = legacy.backgroundSupported && legacy.result === 'granted';
        }
        try {
          await startAndroidCommuteTracking(rideId);
        } catch {
          /* page watch still runs */
        }
      } else if (Capacitor.isNativePlatform()) {
        const legacy = await requestBackgroundLocationPermission();
        bgSupported = false; // iOS build intentionally has no location background mode
        void legacy;
      }

      if (cancelled) return;
      setStatus((s) => ({
        ...s,
        active: true,
        backgroundSupported: bgSupported,
        permissionDenied: false,
        honestyCopy: rideTrackingHonestyCopy(mode, bgSupported),
      }));

      if (Capacitor.isNativePlatform()) {
        await startNativeWatch();
      } else {
        startWebWatch();
        await requestWakeLock();
      }

      await tick();
      tickTimer = setInterval(() => {
        void tick();
      }, TICK_MS);

      healthTimer = setInterval(() => {
        if (cancelled) return;
        if (lastSentRef.current > 0 && Date.now() - lastSentRef.current > STALE_MS) {
          setStatus((s) => ({ ...s, trackingPaused: true }));
          void tick();
        }
      }, HEALTH_MS);

      if (Capacitor.getPlatform() === 'android') {
        tokenTimer = setInterval(() => {
          void refreshAndroidCommuteTracking(rideId).catch(() => {});
        }, ANDROID_TOKEN_REFRESH_MS);

        const { data: authSub } = supabase.auth.onAuthStateChange(() => {
          void refreshAndroidCommuteTracking(rideId).catch(() => {});
        });
        removeAppListener = () => authSub.subscription.unsubscribe();
      }
    };

    void bootstrap();

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void tick();
        void requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    let removeCapApp: (() => void) | undefined;
    if (Capacitor.isNativePlatform()) {
      import('@capacitor/app')
        .then(({ App }) =>
          App.addListener('appStateChange', ({ isActive }) => {
            if (isActive) void tick();
          }),
        )
        .then((sub) => {
          removeCapApp = () => sub.remove();
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      if (tickTimer) clearInterval(tickTimer);
      if (healthTimer) clearInterval(healthTimer);
      if (tokenTimer) clearInterval(tokenTimer);
      document.removeEventListener('visibilitychange', onVisible);
      removeAppListener?.();
      removeCapApp?.();
      void releaseWakeLock();
      if (watchIdRef.current && !Capacitor.isNativePlatform()) {
        try {
          navigator.geolocation.clearWatch(Number(watchIdRef.current));
        } catch {
          /* ignore */
        }
        watchIdRef.current = null;
      } else {
        void clearNativeWatch();
      }
      void stopAndroidCommuteTracking();
    };
  }, [enabled, rideId, mode]);

  return status;
}
