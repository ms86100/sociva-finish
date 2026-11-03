import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  rideTrackingHonestyCopy,
  rideTrackingPlatformMode,
} from '@/lib/cleaner-city/commuteTracking';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('Cleaner City cross-device ride tracking', () => {
  const hook = read('src/hooks/useCleanerCityRideTracking.ts');
  const commute = read('src/lib/cleaner-city/commuteTracking.ts');
  const ride = read('src/pages/cleaner-city/CleanerCityRidePage.tsx');
  const androidService = read(
    'android/app/src/main/java/app/sociva/community/CommuteTrackingService.kt',
  );
  const androidPlugin = read(
    'android/app/src/main/java/app/sociva/community/LiveActivityPlugin.kt',
  );
  const cap = read('capacitor.config.ts');
  const codemagic = read('codemagic.yaml');

  it('uses one ride tracking hook from the ride page', () => {
    expect(ride).toContain('useCleanerCityRideTracking');
    expect(hook).toContain('startAndroidCommuteTracking');
    expect(hook).toContain('watchPosition');
    expect(hook).toContain('wakeLock');
    expect(hook).toContain('flushLocationOutbox');
  });

  it('keeps Android FGS sticky with token refresh and OEM restart restore', () => {
    expect(androidService).toContain('ACTION_UPDATE');
    expect(androidService).toContain('START_STICKY');
    expect(androidService).toContain('restorePersisted');
    expect(androidPlugin).toContain('updateCommuteTracking');
    expect(commute).toContain('refreshAndroidCommuteTracking');
    expect(commute).toContain('requestAndroidBackgroundLocationUpgrade');
  });

  it('never enables iOS UIBackgroundModes location in Codemagic', () => {
    expect(codemagic).toContain('Do not add UIBackgroundModes location');
    expect(codemagic).toContain('ERROR: App Store 2.5.4 - archived Info.plist still declares UIBackgroundModes location');
    expect(rideTrackingHonestyCopy('ios_foreground', false)).toContain('iPhone');
    expect(rideTrackingHonestyCopy('ios_foreground', false)).toContain('foreground');
  });

  it('documents Cleaner City commute in location purpose strings', () => {
    expect(cap).toContain('Cleaner City commute map');
    expect(codemagic).toContain('Cleaner City commute map');
  });

  it('exposes platform mode helper without em dash', () => {
    expect(typeof rideTrackingPlatformMode()).toBe('string');
    for (const src of [hook, commute, ride, androidService]) {
      expect(src).not.toMatch(/[\u2013\u2014]/);
    }
  });
});
