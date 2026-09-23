// @ts-nocheck
/**
 * Single source of truth for permission UX — reads OS + installation lifecycle.
 * All Permission Center surfaces consume this hook (not divergent local guesses).
 */
import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { usePushNotifications } from '@/contexts/PushNotificationContext';
import {
  mapGeoToLocationState,
  mapPushReceiveToNotificationState,
  syncInstallationPermissions,
  syncOsPermissionsFromDevice,
  type LocationPermissionState,
  type NotificationPermissionState,
} from '@/lib/installation';
import { setPushStage } from '@/lib/pushPermissionStage';
import {
  notifNeedsAttention as computeNotifNeedsAttention,
  shouldDeferPostLoginPermissionSheet,
  shouldShowLocSoftPrompt,
  shouldShowNotifSoftPrompt,
} from '@/lib/permission-prompt-rules';

const NOTIF_COOLDOWN_KEY = 'sociva_notif_prompt_dismissed_until';
const LOC_COOLDOWN_KEY = 'sociva_loc_prompt_dismissed_until';
const POST_LOGIN_SHEET_KEY = 'sociva_post_login_permission_sheet';
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function readCooldown(key: string): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    return Date.now() < Number(raw);
  } catch {
    return false;
  }
}

function writeCooldown(key: string) {
  try {
    localStorage.setItem(key, String(Date.now() + COOLDOWN_MS));
  } catch {
    // ignore
  }
}

function clearCooldown(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function usePermissionLifecycle() {
  const { permissionStatus, token, requestFullPermission } = usePushNotifications();
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermissionState>('unknown');
  const [locationPermission, setLocationPermission] =
    useState<LocationPermissionState>('unknown');
  const [notifCooldown, setNotifCooldown] = useState(() => readCooldown(NOTIF_COOLDOWN_KEY));
  const [locCooldown, setLocCooldown] = useState(() => readCooldown(LOC_COOLDOWN_KEY));
  const [refreshing, setRefreshing] = useState(false);

  const refreshFromOs = useCallback(async () => {
    setRefreshing(true);
    try {
      let notif: NotificationPermissionState = 'unknown';
      let loc: LocationPermissionState = 'unknown';

      const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
        Promise.race([
          p,
          new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
        ]);

      if (Capacitor.isNativePlatform()) {
        try {
          const { PushNotifications } = await import('@capacitor/push-notifications');
          const push = await withTimeout(
            PushNotifications.checkPermissions(),
            3000,
            { receive: 'prompt' } as any,
          );
          notif = mapPushReceiveToNotificationState(push.receive);
        } catch {
          notif = mapPushReceiveToNotificationState(permissionStatus);
        }
        try {
          const { Geolocation } = await import('@capacitor/geolocation');
          const geo = await withTimeout(
            Geolocation.checkPermissions(),
            3000,
            { location: 'prompt', coarseLocation: 'prompt' } as any,
          );
          loc = mapGeoToLocationState(geo.location || geo.coarseLocation);
        } catch {
          loc = 'unknown';
        }
      } else {
        notif = 'unknown';
        if (typeof navigator !== 'undefined' && 'permissions' in navigator) {
          try {
            const result = await (navigator as any).permissions.query({ name: 'geolocation' });
            loc = mapGeoToLocationState(
              result.state === 'granted' ? 'granted' : result.state === 'denied' ? 'denied' : 'prompt',
            );
          } catch {
            loc = 'not_requested';
          }
        } else {
          loc = 'not_requested';
        }
      }

      setNotificationPermission(notif);
      setLocationPermission(loc);
      setNotifCooldown(readCooldown(NOTIF_COOLDOWN_KEY));
      setLocCooldown(readCooldown(LOC_COOLDOWN_KEY));
      // Never block UI refresh on network/RPC
      void syncInstallationPermissions({
        notificationPermission: notif,
        locationPermission: loc,
      });
    } finally {
      setRefreshing(false);
    }
  }, [permissionStatus]);

  useEffect(() => {
    void refreshFromOs();
  }, [refreshFromOs]);

  // Keep in sync when push hook updates
  useEffect(() => {
    if (permissionStatus === 'granted' || !!token) {
      setNotificationPermission('enabled');
      clearCooldown(NOTIF_COOLDOWN_KEY);
      setNotifCooldown(false);
    } else if (permissionStatus === 'denied') {
      setNotificationPermission('denied');
    } else if (permissionStatus === 'prompt') {
      setNotificationPermission((prev) => (prev === 'enabled' ? prev : 'not_requested'));
    }
  }, [permissionStatus, token]);

  useEffect(() => {
    let remove: (() => void) | undefined;
    (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const handle = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) void refreshFromOs();
        });
        remove = () => handle.remove();
      } catch {
        // web
      }
    })();
    return () => remove?.();
  }, [refreshFromOs]);

  const dismissNotifPrompt = useCallback(() => {
    writeCooldown(NOTIF_COOLDOWN_KEY);
    setNotifCooldown(true);
    void setPushStage('deferred');
  }, []);

  const dismissLocPrompt = useCallback(() => {
    writeCooldown(LOC_COOLDOWN_KEY);
    setLocCooldown(true);
  }, []);

  const dismissAll = useCallback(() => {
    dismissNotifPrompt();
    dismissLocPrompt();
  }, [dismissNotifPrompt, dismissLocPrompt]);

  const enableNotifications = useCallback(async (): Promise<'granted' | 'denied' | 'settings'> => {
    if (notificationPermission === 'denied') return 'settings';
    if (!Capacitor.isNativePlatform()) return 'denied';
    // Never block OS prompt on Preferences
    void setPushStage('full');

    // Never hang the Enable button on token registration or installation RPC.
    const timed = <T,>(p: Promise<T>, ms: number) =>
      Promise.race([
        p.then((v) => ({ ok: true as const, v })).catch(() => ({ ok: false as const, v: null })),
        new Promise<{ ok: false; v: null }>((resolve) =>
          setTimeout(() => resolve({ ok: false, v: null }), ms),
        ),
      ]);

    await timed(requestFullPermission(), 12000);

    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const result = await PushNotifications.checkPermissions();
      const mapped = mapPushReceiveToNotificationState(result.receive);
      setNotificationPermission(mapped);
      // Fire-and-forget lifecycle sync — must not block UI
      void syncInstallationPermissions({ notificationPermission: mapped });
      if (mapped === 'enabled') {
        clearCooldown(NOTIF_COOLDOWN_KEY);
        setNotifCooldown(false);
        return 'granted';
      }
      // Denied or still prompt/not_requested after request → Settings path
      return 'settings';
    } catch {
      return 'settings';
    }
  }, [notificationPermission, requestFullPermission]);

  const enableLocation = useCallback(async (): Promise<'granted' | 'denied' | 'settings'> => {
    if (locationPermission === 'denied' || locationPermission === 'restricted') {
      return 'settings';
    }
    try {
      const { requestLocationPermission, getCurrentPosition, isLocationError } = await import(
        '@/lib/native-location'
      );

      if (Capacitor.isNativePlatform()) {
        const perm = await requestLocationPermission();
        if (perm === 'denied') {
          setLocationPermission('denied');
          void syncInstallationPermissions({ locationPermission: 'denied' });
          return 'settings';
        }
        // OS granted (or still prompt → try position). Mark enabled as soon as OS allows
        // so the home banner dismisses even if GPS fix times out.
        if (perm === 'granted') {
          setLocationPermission('enabled');
          clearCooldown(LOC_COOLDOWN_KEY);
          setLocCooldown(false);
          void syncInstallationPermissions({ locationPermission: 'enabled' });
          try {
            await getCurrentPosition({ requestPermission: false });
          } catch {
            // Permission is enough for soft-prompt UX; browsing pin can be set later.
          }
          return 'granted';
        }
      }

      await getCurrentPosition({ requestPermission: true });
      setLocationPermission('enabled');
      clearCooldown(LOC_COOLDOWN_KEY);
      setLocCooldown(false);
      void syncInstallationPermissions({ locationPermission: 'enabled' });
      return 'granted';
    } catch (err) {
      const { isLocationError: isLocErr } = await import('@/lib/native-location');
      if (isLocErr(err) && err.code === 'permission_denied') {
        setLocationPermission('denied');
        void syncInstallationPermissions({ locationPermission: 'denied' });
        return 'settings';
      }
      return 'denied';
    }
  }, [locationPermission]);

  const notifNeedsAttention = computeNotifNeedsAttention({
    isNative: Capacitor.isNativePlatform(),
    notificationPermission,
    hasToken: !!token,
  });

  const locNeedsAttention =
    locationPermission === 'not_requested' ||
    locationPermission === 'denied' ||
    locationPermission === 'restricted';

  const showNotifSoftPrompt = shouldShowNotifSoftPrompt({
    isNative: Capacitor.isNativePlatform(),
    notificationPermission,
    hasToken: !!token,
    notifCooldown,
  });

  const showLocSoftPrompt = shouldShowLocSoftPrompt({
    locationPermission,
    locCooldown,
    refreshing,
  });

  const showPermissionCenter =
    Capacitor.isNativePlatform() &&
    (showNotifSoftPrompt || showLocSoftPrompt || notifNeedsAttention || locNeedsAttention);

  return {
    notificationPermission,
    locationPermission,
    notifNeedsAttention,
    locNeedsAttention,
    showNotifSoftPrompt,
    showLocSoftPrompt,
    showPermissionCenter,
    notifCooldown,
    locCooldown,
    refreshing,
    refreshFromOs,
    dismissNotifPrompt,
    dismissLocPrompt,
    dismissAll,
    enableNotifications,
    enableLocation,
    syncOsPermissionsFromDevice,
  };
}

export function peekPostLoginPermissionSheet(): boolean {
  try {
    return sessionStorage.getItem(POST_LOGIN_SHEET_KEY) === '1';
  } catch {
    return false;
  }
}

export function consumePostLoginPermissionSheet(): boolean {
  try {
    if (sessionStorage.getItem(POST_LOGIN_SHEET_KEY) === '1') {
      sessionStorage.removeItem(POST_LOGIN_SHEET_KEY);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export function markPostLoginPermissionSheet() {
  try {
    sessionStorage.setItem(POST_LOGIN_SHEET_KEY, '1');
  } catch {
    // ignore
  }
}

export { shouldDeferPostLoginPermissionSheet } from '@/lib/permission-prompt-rules';
