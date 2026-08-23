import { registerPlugin } from '@capacitor/core';
import type { LiveActivityPlugin } from './definitions';

/**
 * Silent no-op implementation used on web (and as a last-resort Android
 * fallback if the native plugin fails to load).
 */
const noopImplementation: LiveActivityPlugin = {
  startLiveActivity: async () => ({ activityId: 'web-noop' }),
  updateLiveActivity: async () => {},
  endLiveActivity: async () => {},
  getActiveActivities: async () => ({ activities: [] }),
  cleanupStaleActivities: async () => {},
  getNativeBuildFlags: async () => ({ hasTransistorsoftLicense: false, platform: 'web' }),
};

/**
 * Register the LiveActivity plugin.
 *
 * - web: silent no-ops
 * - android/ios: native plugin when registered (MainActivity / iOS bridge);
 *   Capacitor falls back to throwing "not implemented" if missing — callers
 *   in LiveActivityManager already catch and record those errors.
 */
const LiveActivity = registerPlugin<LiveActivityPlugin>('LiveActivity', {
  web: noopImplementation as any,
});

export { LiveActivity, noopImplementation };
export type { LiveActivityPlugin, LiveActivityData, ActiveActivityEntry } from './definitions';
