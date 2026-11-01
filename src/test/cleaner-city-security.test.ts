import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20261102090000_cleaner_city_foundation.sql'),
  'utf8',
);

const rollback = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/rollbacks/20261102090000_cleaner_city_foundation.rollback.sql'),
  'utf8',
);

describe('A Cleaner City foundation migration contracts', () => {
  it('registers cleaner_city feature without auto-enabling all packages', () => {
    expect(migration).toContain("  'cleaner_city',");
    expect(migration).toContain("'/cleaner-city'");
    expect(migration).toContain('ON CONFLICT (feature_key)');
    expect(migration).not.toContain('INSERT INTO public.feature_package_items');
  });

  it('enables PostGIS and stores geography points', () => {
    expect(migration).toContain('CREATE EXTENSION IF NOT EXISTS postgis');
    expect(migration).toContain('extensions.geography(Point, 4326)');
  });

  it('creates neighbour graph and C-ready match scope helper', () => {
    expect(migration).toContain('society_neighbours');
    expect(migration).toContain('cleaner_city_settings');
    expect(migration).toContain("match_scope IN ('same_society', 'neighbours', 'city')");
    expect(migration).toContain('cleaner_city_allowed_society_ids');
    expect(migration).toContain("v_scope = 'same_society'");
    expect(migration).toContain("v_scope = 'city'");
    expect(migration).toContain('-- neighbours (default)');
  });

  it('keeps office locations owner-private (Cross-society access denied)', () => {
    expect(migration).toContain('office_locations');
    expect(migration).toContain('Cross-society access denied');
    expect(migration).toMatch(/office_locations_select[\s\S]*user_id = auth\.uid\(\)/);
  });

  it('gates writes with cleaner_city feature flag', () => {
    expect(migration).toContain("can_access_feature(public.get_user_society_id(auth.uid()), 'cleaner_city')");
    expect(migration).toContain('AS RESTRICTIVE');
  });

  it('supports cars and bikes with bike seat cap', () => {
    expect(migration).toContain("vehicle_type IN ('car', 'bike')");
    expect(migration).toContain('vehicles_bike_seat_cap');
  });

  it('stubs fuel cost share ledger without settlement UX', () => {
    expect(migration).toContain('ride_cost_shares');
    expect(migration).toContain("'proposed', 'accepted', 'declined', 'settled'");
  });

  it('provides a rollback that drops cleaner_city tables and feature row', () => {
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.cleaner_city_allowed_society_ids');
    expect(rollback).toContain('DROP TABLE IF EXISTS public.commute_profiles');
    expect(rollback).toContain("feature_key = 'cleaner_city'");
  });
});

describe('A Cleaner City Unit 1 privacy copy', () => {
  it('hub does not claim live matching or employment verification', () => {
    const hub = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/cleaner-city/CleanerCityPage.tsx'),
      'utf8',
    );
    expect(hub).not.toMatch(/employment independently verified/i);
    expect(hub).not.toMatch(/live match/i);
    expect(hub).toMatch(/Set up my commute|Verify work email first|Participation gate/);
  });
});
