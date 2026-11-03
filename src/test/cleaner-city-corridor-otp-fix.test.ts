import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { formatMatchReason } from '@/lib/cleaner-city/matchCopy';

function read(rel: string) {
  return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

const migration = read(
  'supabase/migrations/20261103170000_cleaner_city_corridor_match_otp_fixture.sql',
);
const rideActions = read('src/components/cleaner-city/ride/RidePrimaryActions.tsx');
const findPage = read('src/pages/cleaner-city/CleanerCityFindPage.tsx');
const missionCopy = read('src/lib/cleaner-city/rideMissionCopy.ts');

describe('GC-01/02 corridor matching + passenger OTP', () => {
  it('projects points onto polyline and gates by corridor + sequence', () => {
    expect(migration).toContain('cleaner_city_project_point_on_polyline');
    expect(migration).toContain('pickup_on_route_corridor');
    expect(migration).toContain('pickup_before_drop');
    expect(migration).toContain("matching_mode', 'polyline_corridor'");
    expect(migration).toContain('Driving route polyline is required to publish a ride');
  });

  it('does not hard-gate pickup against host origin alone', () => {
    expect(migration).not.toMatch(
      /v_pickup_dev_m := public\.cleaner_city_haversine_meters\(\s*p_guest_pickup_lat,\s*p_guest_pickup_lng,\s*v_host_origin_lat/,
    );
  });

  it('flips OTP to passenger-held generate and host start', () => {
    expect(migration).toContain('Only the passenger can generate the pickup OTP');
    expect(migration).toContain('Only the rider can start the trip with the passenger OTP');
    expect(rideActions).toContain('cleaner-city-passenger-otp-display');
    expect(rideActions).toContain('cleaner-city-host-otp-input');
    expect(findPage).toContain('Show to rider');
    expect(findPage).toContain('Passenger code');
    expect(missionCopy).toContain('Ask your passenger for the 6-digit code');
  });

  it('keeps work-email test fixture service_role and @sociva.test only', () => {
    expect(migration).toContain('cleaner_city_test_verify_work_email');
    expect(migration).toContain('@sociva.test');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.cleaner_city_test_verify_work_email(uuid, text) TO service_role');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.cleaner_city_test_verify_work_email(uuid, text) FROM authenticated',
    );
  });

  it('exposes corridor reason labels', () => {
    expect(formatMatchReason('pickup_on_route_corridor')).toBe('Pickup on their route');
    expect(formatMatchReason('drop_on_route_corridor')).toBe('Drop on their route');
    expect(formatMatchReason('pickup_before_drop')).toBe('Stops in order');
  });
});
