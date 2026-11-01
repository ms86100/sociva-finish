import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canOpenDispute,
  canShowRideSos,
  canShowTripShare,
  formatStraightLineDistance,
  rideNextHint,
} from '@/lib/cleaner-city/rideMissionCopy';

const root = process.cwd();
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('Cleaner City ride safety + OTP product rules', () => {
  it('shows SOS at pickup/started, Trip share only after start', () => {
    expect(canShowRideSos('requested')).toBe(false);
    expect(canShowRideSos('confirmed')).toBe(false);
    expect(canShowRideSos('pickup_pending')).toBe(true);
    expect(canShowRideSos('started')).toBe(true);
    expect(canShowTripShare('pickup_pending')).toBe(false);
    expect(canShowTripShare('started')).toBe(true);
    expect(canOpenDispute('started')).toBe(false);
    expect(canOpenDispute('completed')).toBe(true);
  });

  it('formats map distance for the dotted path label', () => {
    expect(formatStraightLineDistance(420)).toBe('420 m');
    expect(formatStraightLineDistance(2400)).toBe('2.4 km');
  });

  it('host OTP UX shows code; guest enters - no host confirm field', () => {
    const actions = read('src/components/cleaner-city/ride/RidePrimaryActions.tsx');
    expect(actions).toContain('Show this code to your guest');
    expect(actions).toContain('cleaner-city-host-otp-display');
    expect(actions).toContain('cleaner-city-guest-otp-input');
    expect(actions).not.toContain('Confirm OTP to start');
    expect(rideNextHint('pickup_pending', true)).toContain('Show the code');
    expect(rideNextHint('pickup_pending', false)).toContain('6-digit');
  });

  it('dispute copy is consumer-friendly and appeal notifies via migration', () => {
    const ride = read('src/pages/cleaner-city/CleanerCityRidePage.tsx');
    expect(ride).toContain('Report a problem');
    expect(ride).toContain('Tell my side');
    expect(ride).toContain('Under review');
    const migration = read(
      'supabase/migrations/20261102261000_cleaner_city_dispute_appeal_notify.sql',
    );
    expect(migration).toContain('You already reported this');
    expect(migration).toContain('cc_dispute_admin_');
    expect(migration).toContain('cc_dispute_appeal_');
  });

  it('live map draws a dotted path and distance', () => {
    const ride = read('src/pages/cleaner-city/CleanerCityRidePage.tsx');
    expect(ride).toContain('haversineMeters');
    expect(ride).toContain('google.maps.Polyline');
    expect(ride).toContain('cleaner-city-map-distance');
  });
});
