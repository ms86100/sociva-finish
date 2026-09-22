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

/**
 * Ask for location permission on native. Web is a no-op — the browser
 * prompts when getCurrentPosition runs.
 */
export async function requestLocationPermission(): Promise<'granted' | 'denied' | 'prompt'> {
  if (!Capacitor.isNativePlatform()) return 'prompt';

  try {
    const { Geolocation } = await import('@capacitor/geolocation');
    const status = await Geolocation.requestPermissions();
    const loc = status.location || status.coarseLocation;
    if (loc === 'granted') return 'granted';
    if (loc === 'denied') return 'denied';
    return 'prompt';
  } catch {
    return 'denied';
  }
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
    }
    try {
      const { Geolocation } = await import('@capacitor/geolocation');
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 12000,
      });
      return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      if (/permission|denied|authorize/i.test(msg)) {
        throw new LocationError('permission_denied', 'Location permission was denied');
      }
      if (/timeout/i.test(msg)) {
        throw new LocationError('timeout', 'Location request timed out');
      }
      throw new LocationError('unavailable', msg || 'Location is unavailable');
    }
  }

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new LocationError('unavailable', 'Geolocation is not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => reject(mapWebGeoError(err)),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  });
}
