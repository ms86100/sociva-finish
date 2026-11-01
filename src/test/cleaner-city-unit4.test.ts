import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20261102130000_cleaner_city_unit4_vehicles.sql'),
  'utf8',
);
const vehiclePage = fs.readFileSync(
  path.resolve(process.cwd(), 'src/pages/cleaner-city/CleanerCityVehiclePage.tsx'),
  'utf8',
);
const offerPage = fs.readFileSync(
  path.resolve(process.cwd(), 'src/pages/cleaner-city/CleanerCityOfferPage.tsx'),
  'utf8',
);

describe('A Cleaner City Unit 4 host/vehicle contracts', () => {
  it('enforces bike seat capacity of exactly 1', () => {
    expect(migration).toContain('Bike passenger seat capacity must be exactly 1');
    expect(migration).toContain("p_vehicle_type NOT IN ('car', 'bike')");
    expect(vehiclePage).toContain('Bike passenger seats are capped at 1');
  });

  it('blocks publish without verified email, host role, or valid seats', () => {
    expect(migration).toContain('cleaner_city_assert_host_access');
    expect(migration).toContain('Active vehicle required to publish a ride');
    expect(migration).toContain('Cannot publish more seats than vehicle capacity');
    expect(migration).toContain('cleaner_city_require_verified_commuter');
    expect(offerPage).toContain('Capacity cannot exceed your vehicle');
  });

  it('records vehicle documents without claiming admin verification', () => {
    expect(migration).toContain('vehicle_documents');
    expect(migration).toContain('cleaner_city_upsert_vehicle_document');
    expect(vehiclePage).toContain('Admin verification comes later');
  });
});
