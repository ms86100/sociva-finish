/**
 * Native GPS engine selection for delivery tracking.
 *
 * Transistorsoft requires a paid license for applicationId `app.sociva.community`.
 * Android BuildConfig.HAS_TRANSISTORSOFT_LICENSE is exposed via LiveActivity.getNativeBuildFlags.
 * - iOS: Transistorsoft when the native plugin is linked (Codemagic Podfile);
 *   Capacitor Geolocation fallback if the plugin is missing or init fails
 * - Android licensed: Transistorsoft (real-time background GPS)
 * - Android unlicensed / debug: Capacitor Geolocation only (no license toast)
 */
import { Capacitor } from '@capacitor/core';

let androidLicensedCache: boolean | null = null;
let probePromise: Promise<void> | null = null;

export function getAndroidTransistorsoftLicensedCache(): boolean | null {
  return androidLicensedCache;
}

/** Probe native BuildConfig once; safe to call repeatedly. */
export async function refreshNativeLocationEngineFlags(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    androidLicensedCache = false;
    return false;
  }
  if (!probePromise) {
    probePromise = (async () => {
      try {
        const { LiveActivity } = await import('@/plugins/live-activity');
        const flags = await (LiveActivity as any).getNativeBuildFlags?.();
        androidLicensedCache = !!flags?.hasTransistorsoftLicense;
      } catch {
        androidLicensedCache = false;
      }
    })();
  }
  await probePromise;
  return androidLicensedCache === true;
}

/**
 * Sync selector used by the tracking hook.
 * Call refreshNativeLocationEngineFlags() before startTracking on Android so the
 * cache is warm; until then Android defaults to Capacitor (safe / no toast).
 */
export function shouldUseTransistorsoftBackgroundGeo(): boolean {
  if (!Capacitor.isNativePlatform()) return false;
  if (Capacitor.getPlatform() === 'ios') return true;
  if (Capacitor.getPlatform() === 'android') {
    return androidLicensedCache === true;
  }
  return false;
}
