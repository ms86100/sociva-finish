import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20261102140000_cleaner_city_unit5_maps.sql'),
  'utf8',
);
const routing = fs.readFileSync(
  path.resolve(process.cwd(), 'src/lib/cleaner-city/routing.ts'),
  'utf8',
);
const routePage = fs.readFileSync(
  path.resolve(process.cwd(), 'src/pages/cleaner-city/CleanerCityRoutePage.tsx'),
  'utf8',
);

describe('A Cleaner City Unit 5 maps/routing contracts', () => {
  it('stores office pins privately and caches route geometry', () => {
    expect(migration).toContain('cleaner_city_upsert_office_location');
    expect(migration).toContain('cleaner_city_store_route_geometry');
    expect(routePage).toContain('Exact office stays owner-private');
  });

  it('provides Google Directions abstraction with haversine fallback', () => {
    expect(routing).toContain('fetchDrivingRoute');
    expect(routing).toContain('estimateDetourMinutes');
    expect(routing).toContain('haversine_fallback');
    expect(routing).toContain('encodePolyline');
    expect(migration).toContain('cleaner_city_estimate_detour_minutes');
  });

  it('exposes initial detour thresholds used by matching', () => {
    expect(routing).toContain('maxDetourMinutes: 15');
    expect(routing).toContain('minRouteOverlapPct: 65');
  });
});
