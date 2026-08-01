import { registerPlugin } from '@capacitor/core';
import type { LiveActivityPlugin } from './definitions';

/**
 * Register the LiveActivity plugin.
 *
 * On web the plugin degrades to silent no-ops so calling code
 * never needs platform guards.
 */
const LiveActivity = registerPlugin<LiveActivityPlugin>('LiveActivity', {
  web: {
    startLiveActivity: async () => ({ activityId: 'web-noop' }),
    updateLiveActivity: async () => {},
    endLiveActivity: async () => {},
    getActiveActivities: async () => ({ activities: [] }),
    cleanupStaleActivities: async () => {},
  } as any,
});

export { LiveActivity };
export type { LiveActivityPlugin, LiveActivityData, ActiveActivityEntry } from './definitions';
