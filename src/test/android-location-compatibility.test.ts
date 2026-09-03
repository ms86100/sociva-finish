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
  it('does not require Transistorsoft in the shipped Android binary', () => {
    expect(patchScript).toMatch(/stripNativeTransistorsoft/);
    expect(patchScript).toMatch(/stripTransistorsoftFromNativeGradle/);
    expect(codemagic).toMatch(/Transistorsoft must not be registered/);
    expect(codemagic).toMatch(/Transistorsoft iOS pod must not be present/);
  });

  it('never enables the Transistorsoft JS engine', () => {
    expect(engine).toMatch(/shouldUseTransistorsoftBackgroundGeo/);
    expect(engine).toMatch(/return false/);
    expect(hook).not.toMatch(/@transistorsoft\/capacitor-background-geolocation/);
    expect(hook).not.toMatch(/BackgroundGeolocation\.ready/);
    expect(hook).toMatch(/startCapacitorGeolocationTracking/);
  });

  it('does not inject a Transistorsoft license in Codemagic', () => {
    expect(codemagic).toMatch(/patch-ios-podfile/);
    expect(codemagic).not.toMatch(/cat > Podfile/);
    expect(codemagic).not.toMatch(/TSLocationManagerLicense/);
    expect(codemagic).not.toMatch(/transistorsoft\.properties/);
    expect(codemagic).toMatch(/NSMotionUsageDescription/);
  });

  it('does not intercept license toasts or show a launch pill', () => {
    expect(mainActivity).not.toMatch(/Sociva is ready/);
    expect(mainActivity).not.toMatch(/sociva_status_pill/);
    expect(mainActivity).not.toMatch(/license validation/i);
    expect(mainActivity).toMatch(/registerPlugin\(LiveActivityPlugin\.class\)/);
  });

  it('keeps the Transistorsoft selector permanently off', () => {
    expect(shouldUseTransistorsoftBackgroundGeo()).toBe(false);
    expect(getAndroidTransistorsoftLicensedCache()).toBe(false);
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
  it('does not show a launch toast or branded status pill', () => {
    expect(mainActivity).not.toMatch(/Setting up a smooth experience/);
    expect(mainActivity).not.toMatch(/Sociva is ready/);
    expect(mainActivity).not.toMatch(/LICENSE VALIDATION/);
  });

  it('stops tracking path exists for terminal assignment clear', () => {
    expect(hook).toMatch(/stopTracking/);
    expect(hook).toMatch(/assignmentId becomes null|!assignmentId && state\.isTracking/);
  });

  it('uses Capacitor Geolocation for native seller sharing', () => {
    expect(hook).toMatch(/startCapacitorGeolocationTracking/);
    expect(hook).toMatch(/androidBackgroundUpgrade: Capacitor.getPlatform\(\) === 'android'/);
    expect(hook).not.toMatch(/@transistorsoft\/capacitor-background-geolocation/);
    expect(engine).not.toMatch(/androidLicensedCache === true/);
  });

  it('never calls BackgroundGeolocation.ready', () => {
    expect(hook).not.toMatch(/BackgroundGeolocation\.ready/);
    expect(hook).not.toMatch(/Falling back to Capacitor Geolocation after Transistorsoft failure/);
    expect(hook).not.toMatch(/Location error: \$\{errMsg/);
  });
});
