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
};

const LiveActivity = registerPlugin<CommuteTrackingBridge>('LiveActivity');

export async function startAndroidCommuteTracking(rideId: string) {
  if (Capacitor.getPlatform() !== 'android') return;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token || !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return;
  await LiveActivity.startCommuteTracking({
    ride_id: rideId,
    access_token: token,
    supabase_url: SUPABASE_URL,
    anon_key: SUPABASE_PUBLISHABLE_KEY,
  });
}

export async function stopAndroidCommuteTracking() {
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    await LiveActivity.stopCommuteTracking();
  } catch {
    // The page watch still publishes while the screen is open.
  }
}
