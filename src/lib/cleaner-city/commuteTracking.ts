import { Capacitor, registerPlugin } from '@capacitor/core';
import { supabase, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/integrations/supabase/client';

type CommuteTrackingBridge = {
  startCommuteTracking(options: {
    ride_id: string;
    access_token: string;
    supabase_url: string;
    anon_key: string;
  }): Promise<void>;
  stopCommuteTracking(): Promise<void>;
  updateCommuteTracking?(options: {
    ride_id: string;
    access_token: string;
    supabase_url: string;
    anon_key: string;
  }): Promise<void>;
  requestBackgroundLocation?(): Promise<{ status: string; detail?: string }>;
};

const LiveActivity = registerPlugin<CommuteTrackingBridge>('LiveActivity');

async function authPayload(rideId: string) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token || !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null;
  return {
    ride_id: rideId,
    access_token: token,
    supabase_url: SUPABASE_URL,
    anon_key: SUPABASE_PUBLISHABLE_KEY,
  };
}

/** Android FGS that keeps posting GPS while the screen is off / app minimized. */
export async function startAndroidCommuteTracking(rideId: string) {
  if (Capacitor.getPlatform() !== 'android') return false;
  const payload = await authPayload(rideId);
  if (!payload) return false;
  await LiveActivity.startCommuteTracking(payload);
  return true;
}

export async function refreshAndroidCommuteTracking(rideId: string) {
  if (Capacitor.getPlatform() !== 'android') return false;
  const payload = await authPayload(rideId);
  if (!payload) return false;
  if (typeof LiveActivity.updateCommuteTracking === 'function') {
    await LiveActivity.updateCommuteTracking(payload);
  } else {
    await LiveActivity.startCommuteTracking(payload);
  }
  return true;
}

export async function stopAndroidCommuteTracking() {
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    await LiveActivity.stopCommuteTracking();
  } catch {
    // Page watch still publishes while the screen is open.
  }
}

/**
 * Best-effort Android "Allow all the time" upgrade.
 * iOS never gets UIBackgroundModes location (App Store 2.5.4).
 */
export async function requestAndroidBackgroundLocationUpgrade(): Promise<{
  status: string;
  detail?: string;
}> {
  if (Capacitor.getPlatform() !== 'android') {
    return { status: 'unsupported', detail: Capacitor.getPlatform() };
  }
  try {
    const result = await LiveActivity.requestBackgroundLocation?.();
    return {
      status: result?.status || 'unknown',
      detail: result?.detail,
    };
  } catch (err: any) {
    return { status: 'error', detail: err?.message || 'failed' };
  }
}

export type RideTrackingPlatformMode =
  | 'android_fgs'
  | 'ios_foreground'
  | 'web_foreground'
  | 'unsupported';

export function rideTrackingPlatformMode(): RideTrackingPlatformMode {
  const platform = Capacitor.getPlatform();
  if (platform === 'android') return 'android_fgs';
  if (platform === 'ios') return 'ios_foreground';
  if (platform === 'web') return 'web_foreground';
  return 'unsupported';
}

export function rideTrackingHonestyCopy(mode: RideTrackingPlatformMode, bgGranted: boolean) {
  if (mode === 'android_fgs') {
    return bgGranted
      ? 'Android is sharing this ride in the background with a persistent notification.'
      : 'Android keeps sharing while Sociva stays in memory. For best results allow location all the time, or keep the app nearby.';
  }
  if (mode === 'ios_foreground') {
    return 'On iPhone, keep Sociva in the foreground for a steady live map. Background location is not available on iOS for this build.';
  }
  if (mode === 'web_foreground') {
    return 'In the browser, keep this tab visible. Closing or sleeping the tab pauses live sharing.';
  }
  return 'Keep Sociva open for the steadiest live map.';
}
