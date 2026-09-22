// @ts-nocheck
/**
 * Installation lifecycle service — Phase 1 foundation.
 *
 * app_installations = who/what installed Sociva + OS permission states (analytics/lifecycle)
 * device_tokens     = how we deliver push (unchanged delivery source of truth)
 *
 * Location permission is independent of login and of the browsing pin/address.
 */
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';

export type NotificationPermissionState = 'enabled' | 'denied' | 'not_requested' | 'unknown';
export type LocationPermissionState =
  | 'enabled'
  | 'denied'
  | 'not_requested'
  | 'restricted'
  | 'unknown';

export type InstallationPlatform = 'ios' | 'android' | 'web';

const INSTALLATION_ID_KEY = 'sociva_installation_id';

let cachedInstallationId: string | null = null;
let ensurePromise: Promise<string> | null = null;

function newInstallationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `inst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

async function getPreferences() {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    return Preferences;
  } catch {
    return null;
  }
}

function readWebFallback(): string | null {
  try {
    return localStorage.getItem(INSTALLATION_ID_KEY);
  } catch {
    return null;
  }
}

function writeWebFallback(id: string) {
  try {
    localStorage.setItem(INSTALLATION_ID_KEY, id);
  } catch {
    // ignore
  }
}

/**
 * Stable per-device installation id. Never rotates on logout.
 */
export async function getOrCreateInstallationId(): Promise<string> {
  if (cachedInstallationId) return cachedInstallationId;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    // Web / vitest: Preferences plugin is unimplemented — use localStorage only.
    if (!Capacitor.isNativePlatform()) {
      const webExisting = readWebFallback();
      if (webExisting && webExisting.length >= 8) {
        cachedInstallationId = webExisting;
        return webExisting;
      }
      const id = newInstallationId();
      cachedInstallationId = id;
      writeWebFallback(id);
      return id;
    }

    const prefs = await getPreferences();
    if (prefs) {
      try {
        // Preferences can hang on some native builds — never block permission UX.
        const got = await Promise.race([
          prefs.get({ key: INSTALLATION_ID_KEY }),
          new Promise<{ value: null }>((resolve) =>
            setTimeout(() => resolve({ value: null }), 1500),
          ),
        ]);
        const value = got?.value;
        if (value && value.length >= 8) {
          cachedInstallationId = value;
          writeWebFallback(value);
          return value;
        }
      } catch {
        // fall through
      }
    }

    const webExisting = readWebFallback();
    if (webExisting && webExisting.length >= 8) {
      cachedInstallationId = webExisting;
      if (prefs) {
        try {
          await prefs.set({ key: INSTALLATION_ID_KEY, value: webExisting });
        } catch {
          // ignore
        }
      }
      return webExisting;
    }

    const id = newInstallationId();
    cachedInstallationId = id;
    writeWebFallback(id);
    if (prefs) {
      try {
        await Promise.race([
          prefs.set({ key: INSTALLATION_ID_KEY, value: id }),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
      } catch {
        // ignore
      }
    }
    return id;
  })();

  try {
    return await ensurePromise;
  } finally {
    ensurePromise = null;
  }
}

export function getInstallationPlatform(): InstallationPlatform {
  const p = Capacitor.getPlatform();
  if (p === 'ios' || p === 'android') return p;
  return 'web';
}

/** Map Capacitor push receive status → lifecycle enum. */
export function mapPushReceiveToNotificationState(
  receive: string | null | undefined,
): NotificationPermissionState {
  if (receive === 'granted') return 'enabled';
  if (receive === 'denied') return 'denied';
  if (receive === 'prompt' || receive === 'prompt-with-rationale') return 'not_requested';
  return 'unknown';
}

/** Map Capacitor geolocation status → lifecycle enum. */
export function mapGeoToLocationState(
  status: string | null | undefined,
): LocationPermissionState {
  if (status === 'granted') return 'enabled';
  if (status === 'denied') return 'denied';
  if (status === 'prompt' || status === 'prompt-with-rationale') return 'not_requested';
  if (status === 'limited' || status === 'restricted') return 'restricted';
  return 'unknown';
}

export type SyncInstallationOptions = {
  notificationPermission?: NotificationPermissionState | null;
  locationPermission?: LocationPermissionState | null;
  pushToken?: string | null;
  apnsToken?: string | null;
  /** When true and session exists, also set user_id = auth.uid() */
  claimUser?: boolean;
};

/**
 * Upsert installation row. Null permission fields leave existing DB values unchanged.
 * Never rotates installation_id.
 */
export async function syncInstallationPermissions(
  options: SyncInstallationOptions = {},
): Promise<{ installationId: string; ok: boolean; error?: string }> {
  const installationId = await getOrCreateInstallationId();
  const platform = getInstallationPlatform();

  try {
    const { error } = await supabase.rpc('upsert_app_installation', {
      p_installation_id: installationId,
      p_platform: platform,
      p_notification_permission: options.notificationPermission ?? null,
      p_location_permission: options.locationPermission ?? null,
      p_push_token: options.pushToken ?? null,
      p_apns_token: options.apnsToken ?? null,
      p_claim_user: !!options.claimUser,
    });

    if (error) {
      console.warn('[Installation] upsert failed:', error.message);
      return { installationId, ok: false, error: error.message };
    }
    return { installationId, ok: true };
  } catch (err: any) {
    console.warn('[Installation] upsert error:', err);
    return { installationId, ok: false, error: String(err?.message || err) };
  }
}

/** Login: associate this physical install with the authenticated user. */
export async function claimInstallationToUser(): Promise<boolean> {
  const installationId = await getOrCreateInstallationId();
  try {
    const { error } = await supabase.rpc('claim_app_installation', {
      p_installation_id: installationId,
    });
    if (error) {
      console.warn('[Installation] claim failed:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Installation] claim error:', err);
    return false;
  }
}

/**
 * Logout: clear user_id on this install only.
 * Keeps installation_id, permission enums, and mirrored tokens for reclaim.
 */
export async function releaseInstallationUser(): Promise<boolean> {
  const installationId = await getOrCreateInstallationId();
  try {
    const { error } = await supabase.rpc('release_app_installation_user', {
      p_installation_id: installationId,
    });
    if (error) {
      console.warn('[Installation] release failed:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Installation] release error:', err);
    return false;
  }
}

/** After device_tokens claim — stamp installation_id for analytics join (delivery unchanged). */
export async function stampDeviceTokenInstallation(fcmToken: string): Promise<void> {
  if (!fcmToken) return;
  const installationId = await getOrCreateInstallationId();
  try {
    await supabase.rpc('stamp_device_token_installation', {
      p_token: fcmToken,
      p_installation_id: installationId,
    });
  } catch (err) {
    console.warn('[Installation] stamp token failed:', err);
  }
}

/**
 * Read current OS permission states (native) and sync to app_installations.
 * Safe no-op-ish on web (location may still prompt later; notif = unknown/web).
 */
export async function syncOsPermissionsFromDevice(options?: {
  claimUser?: boolean;
}): Promise<void> {
  let notificationPermission: NotificationPermissionState = 'unknown';
  let locationPermission: LocationPermissionState = 'unknown';

  if (Capacitor.isNativePlatform()) {
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const push = await PushNotifications.checkPermissions();
      notificationPermission = mapPushReceiveToNotificationState(push.receive);
    } catch {
      notificationPermission = 'unknown';
    }

    try {
      const { Geolocation } = await import('@capacitor/geolocation');
      const geo = await Geolocation.checkPermissions();
      locationPermission = mapGeoToLocationState(geo.location || geo.coarseLocation);
    } catch {
      locationPermission = 'unknown';
    }
  } else {
    // Web: notifications typically unavailable in this app shell
    notificationPermission = 'unknown';
    if (typeof navigator !== 'undefined' && 'permissions' in navigator) {
      try {
        const result = await (navigator as any).permissions.query({ name: 'geolocation' });
        if (result.state === 'granted') locationPermission = 'enabled';
        else if (result.state === 'denied') locationPermission = 'denied';
        else locationPermission = 'not_requested';
      } catch {
        locationPermission = 'not_requested';
      }
    } else {
      locationPermission = 'not_requested';
    }
  }

  await syncInstallationPermissions({
    notificationPermission,
    locationPermission,
    claimUser: options?.claimUser,
  });
}

/** Test helper — clear in-memory cache only (does not wipe Preferences). */
export function __resetInstallationIdCacheForTests() {
  cachedInstallationId = null;
  ensurePromise = null;
}
