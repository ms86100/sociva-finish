// @ts-nocheck
import { Capacitor } from '@capacitor/core';

export interface Position {
  latitude: number;
  longitude: number;
}

export type LocationErrorCode = 'permission_denied' | 'unavailable' | 'timeout';

export class LocationError extends Error {
  code: LocationErrorCode;
  constructor(code: LocationErrorCode, message: string) {
    super(message);
    this.name = 'LocationError';
    this.code = code;
  }
}

export function isLocationError(err: unknown): err is LocationError {
  return err instanceof LocationError || (err as any)?.name === 'LocationError';
}

export type LocationPermissionResult = 'granted' | 'denied' | 'prompt' | 'unavailable';

function isGranted(state: string | undefined): boolean {
  return state === 'granted';
}

/**
 * Ask for foreground location on native. Web is a no-op - the browser
 * prompts when getCurrentPosition runs.
 *
 * Fine or coarse "granted" is enough. "denied" is returned only when both
 * are denied. A thrown plugin error (GPS off, activity not ready) is
 * "unavailable", not a refusal. Background location is not requested here.
 */
export async function requestLocationPermission(): Promise<LocationPermissionResult> {
  if (!Capacitor.isNativePlatform()) return 'prompt';

  try {
    const { Geolocation } = await import('@capacitor/geolocation');
    const status = await Geolocation.requestPermissions({
      permissions: ['location', 'coarseLocation'],
    });
    if (isGranted(status.location) || isGranted(status.coarseLocation)) return 'granted';
    const fineDenied = status.location === 'denied';
    const coarseDenied = status.coarseLocation === 'denied';
    if (fineDenied && (coarseDenied || !status.coarseLocation)) return 'denied';
    if (coarseDenied && !status.location) return 'denied';
    return 'prompt';
  } catch {
    return 'unavailable';
  }
}

export function locationFailureCopy(err: unknown): {
  title: string;
  description: string;
  openSettings: boolean;
} {
  if (isLocationError(err) && err.code === 'permission_denied') {
    return {
      title: 'Location permission denied',
      description: 'Select your location manually instead.',
      openSettings: true,
    };
  }
  if (isLocationError(err) && err.code === 'timeout') {
    return {
      title: 'Location timed out',
      description: 'Turn location on and try again, or pick a place manually.',
      openSettings: false,
    };
  }
  if (isLocationError(err) && err.code === 'unavailable') {
    const off = /turned off|disabled|location services/i.test(err.message);
    if (off) {
      return {
        title: 'Location is turned off',
        description: 'Turn on location in your phone settings, or select a place manually.',
        openSettings: false,
      };
    }
  }
  return {
    title: 'Could not detect location',
    description: 'Try again, or select your location manually.',
    openSettings: false,
  };
}

function mapNativeGeoError(err: any): LocationError {
  const msg = String(err?.message || err || '');
  if (/permission|denied|authorize/i.test(msg)) {
    return new LocationError('permission_denied', 'Location permission was denied');
  }
  if (/timeout/i.test(msg)) {
    return new LocationError('timeout', 'Location request timed out');
  }
  if (/disabled|location services/i.test(msg)) {
    return new LocationError('unavailable', 'Location is turned off');
  }
  return new LocationError('unavailable', msg || 'Location is unavailable');
}

function mapWebGeoError(err: GeolocationPositionError): LocationError {
  if (err.code === err.PERMISSION_DENIED) {
    return new LocationError('permission_denied', 'Location permission was denied');
  }
  if (err.code === err.TIMEOUT) {
    return new LocationError('timeout', 'Location request timed out');
  }
  return new LocationError('unavailable', 'Location is unavailable');
}

/**
 * Get current position using native Geolocation on iOS/Android,
 * falling back to the browser API on web.
 */
export async function getCurrentPosition(options?: {
  requestPermission?: boolean;
}): Promise<Position> {
  const requestPermission = options?.requestPermission !== false;

  if (Capacitor.isNativePlatform()) {
    if (requestPermission) {
      const perm = await requestLocationPermission();
      if (perm === 'denied') {
        throw new LocationError('permission_denied', 'Location permission was denied');
      }
      if (perm === 'unavailable') {
        throw new LocationError('unavailable', 'Location is turned off');
      }
    }
    const { Geolocation } = await import('@capacitor/geolocation');
    const read = (highAccuracy: boolean) =>
      Geolocation.getCurrentPosition({
        enableHighAccuracy: highAccuracy,
        timeout: highAccuracy ? 12000 : 15000,
        maximumAge: highAccuracy ? 0 : 60000,
      });
    try {
      const pos = await read(true);
      return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    } catch (err: any) {
      const mapped = mapNativeGeoError(err);
      if (mapped.code === 'permission_denied') throw mapped;
      try {
        const pos = await read(false);
        return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      } catch (retryErr: any) {
        throw mapNativeGeoError(retryErr);
      }
    }
  }

  const readWeb = (highAccuracy: boolean) =>
    new Promise<Position>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new LocationError('unavailable', 'Geolocation is not supported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        (err) => reject(mapWebGeoError(err)),
        {
          enableHighAccuracy: highAccuracy,
          timeout: highAccuracy ? 12000 : 15000,
          maximumAge: highAccuracy ? 0 : 60000,
        },
      );
    });

  try {
    return await readWeb(true);
  } catch (err) {
    if (isLocationError(err) && err.code === 'permission_denied') throw err;
    return readWeb(false);
  }
}
