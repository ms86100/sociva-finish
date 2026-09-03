import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  isScheduledFulfillmentLocked,
  isScheduledFulfillmentStatus,
  isDueForPreparation,
  isUpcomingScheduled,
  canAcceptScheduledEarly,
  toScheduledDateParam,
} from '@/lib/scheduled-orders';
import {
  shouldUseTransistorsoftBackgroundGeo,
  getAndroidTransistorsoftLicensedCache,
} from '@/lib/native-location-engine';

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
);
const patchScript = readFileSync(
  resolve(__dirname, '../../scripts/patch-android-builds.cjs'),
  'utf8',
);
const engine = readFileSync(
  resolve(__dirname, '../lib/native-location-engine.ts'),
  'utf8',
);
const hook = readFileSync(
  resolve(__dirname, '../hooks/useBackgroundLocationTracking.ts'),
  'utf8',
);
const mainActivity = readFileSync(
  resolve(__dirname, '../../android/app/src/main/java/app/sociva/community/MainActivity.java'),
  'utf8',
);
const codemagic = readFileSync(resolve(__dirname, '../../codemagic.yaml'), 'utf8');
const migration = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20260823054521_scheduled_fulfillment_window_guard.sql'),
  'utf8',
);
const reminders = readFileSync(
  resolve(__dirname, '../../supabase/functions/send-scheduled-order-reminders/index.ts'),
  'utf8',
);

describe('Android location dependency compatibility', () => {
  it('uses the Capacitor 8 compatible Transistorsoft generation', () => {
    expect(packageJson.dependencies['@transistorsoft/capacitor-background-geolocation'])
      .toMatch(/^\^9\./);
  });

  it('supports the remote Maven layout used by Transistorsoft 9', () => {
    expect(patchScript).toMatch(/Transistorsoft Google Play Services 21 compatibility/);
    expect(patchScript).toMatch(/tslocationmanager-gms20/);
    expect(patchScript).toMatch(/maven\.transistorsoft\.com/);
  });

  it('gates Android Transistorsoft on BuildConfig license flag', () => {
    expect(engine).toMatch(/refreshNativeLocationEngineFlags/);
    expect(engine).toMatch(/hasTransistorsoftLicense/);
    expect(hook).toMatch(/refreshNativeLocationEngineFlags/);
    expect(hook).toMatch(/startAndroidCapacitorTracking/);
  });

  it('injects Transistorsoft license from Codemagic env', () => {
    expect(codemagic).toMatch(/TRANSISTORSOFT_LICENSE/);
    expect(codemagic).toMatch(/transistorsoft\.properties/);
    expect(codemagic).toMatch(/TSLocationManagerLicense/);
    expect(codemagic).toMatch(/patch-ios-podfile/);
    expect(codemagic).not.toMatch(/cat > Podfile/);
    expect(codemagic).toMatch(/NSMotionUsageDescription/);
  });

  it('replaces license toast with branded Sociva status pill', () => {
    expect(mainActivity).toMatch(/Sociva is ready/);
    expect(mainActivity).toMatch(/sociva_status_pill/);
    expect(mainActivity).toMatch(/license validation/);
  });

  it('defaults sync selector off Android until licensed cache is warm', () => {
    // Without Capacitor native platform, should be false
    expect(shouldUseTransistorsoftBackgroundGeo()).toBe(false);
    expect(getAndroidTransistorsoftLicensedCache()).toBeNull();
  });
});

describe('Scheduled fulfillment window (client rules)', () => {
  const futureOrder = {
    id: 'a',
    status: 'accepted',
    scheduled_date: '2099-06-15',
    scheduled_time_start: '18:00',
    scheduled_fulfillment_at: '2099-06-15T18:00:00+05:30',
    preparation_start_at: '2099-06-15T17:00:00+05:30',
  };

  const dueOrder = {
    ...futureOrder,
    scheduled_date: '2020-01-01',
    scheduled_fulfillment_at: '2020-01-01T18:00:00+05:30',
    preparation_start_at: '2020-01-01T17:00:00+05:30',
  };

  it('locks fulfillment before preparation_start_at', () => {
    expect(isScheduledFulfillmentLocked(futureOrder)).toBe(true);
    expect(isUpcomingScheduled(futureOrder)).toBe(true);
    expect(isDueForPreparation(futureOrder)).toBe(false);
  });

  it('unlocks fulfillment at/after preparation_start_at', () => {
    expect(isScheduledFulfillmentLocked(dueOrder)).toBe(false);
    expect(isDueForPreparation(dueOrder)).toBe(true);
  });

  it('allows early accept while locking preparing/transit statuses', () => {
    expect(canAcceptScheduledEarly({ ...futureOrder, status: 'placed' })).toBe(true);
    expect(isScheduledFulfillmentStatus('preparing')).toBe(true);
    expect(isScheduledFulfillmentStatus('picked_up')).toBe(true);
    expect(isScheduledFulfillmentStatus('accepted')).toBe(false);
    expect(isScheduledFulfillmentStatus('confirmed')).toBe(false);
  });

  it('uses local calendar day for scheduled date params (no UTC rollback)', () => {
    const d = new Date(2026, 7, 23, 0, 30, 0); // local Aug 23
    expect(toScheduledDateParam(d)).toBe('2026-08-23');
  });
});

describe('Scheduled fulfillment zero-regression cert (source)', () => {
  it('DB migration blocks fulfilment before preparation_start_at', () => {
    expect(migration).toMatch(/Scheduled fulfillment opens/);
    expect(migration).toMatch(/preparation_start_at/);
    expect(migration).toMatch(/'preparing'/);
    expect(migration).toMatch(/'picked_up'/);
  });

  it('prep reminder fires only at/after unlock window', () => {
    expect(reminders).toMatch(/Start preparing now/);
    expect(reminders).toMatch(/ms >= 0 && ms <= 20/);
    expect(reminders).toMatch(/fulfill it like an instant order/i);
  });

  it('seller board UI surfaces due-now vs upcoming backlog', () => {
    const panel = readFileSync(
      resolve(__dirname, '../components/seller/UpcomingScheduledPanel.tsx'),
      'utf8',
    );
    expect(panel).toMatch(/Due now/);
    expect(panel).toMatch(/Scheduled backlog/);
    expect(panel).toMatch(/dueNow/);
  });

  it('order detail suppresses fulfilment CTAs while awaiting prep', () => {
    const detail = readFileSync(
      resolve(__dirname, '../hooks/useOrderDetail.ts'),
      'utf8',
    );
    expect(detail).toMatch(/isScheduledFulfillmentLocked/);
    expect(detail).toMatch(/isScheduledFulfillmentStatus/);
  });
});

describe('GPS regression matrix (source contracts)', () => {
  it('documents cold-start branded pill instead of black license toast', () => {
    expect(mainActivity).toMatch(/Setting up a smooth experience/);
    expect(mainActivity).toMatch(/Sociva is ready/);
  });

  it('stops tracking path exists for terminal assignment clear', () => {
    expect(hook).toMatch(/stopTracking/);
    expect(hook).toMatch(/assignmentId becomes null|!assignmentId && state\.isTracking/);
  });

  it('Android Capacitor fallback only when unlicensed', () => {
    expect(hook).toMatch(/without Transistorsoft license|startAndroidCapacitorTracking|startCapacitorGeolocationTracking/);
    expect(engine).toMatch(/androidLicensedCache === true/);
  });

  it('falls back to Capacitor Geolocation on iOS when Transistorsoft is unimplemented', () => {
    expect(hook).toMatch(/Falling back to Capacitor Geolocation after Transistorsoft failure/);
    expect(hook).toMatch(/androidBackgroundUpgrade: platform === 'android'/);
    expect(hook).not.toMatch(/Location error: \$\{errMsg/);
  });
});
