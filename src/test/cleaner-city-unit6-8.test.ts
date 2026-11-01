import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const u6 = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20261102150000_cleaner_city_unit6_matching.sql'),
  'utf8',
);
const u7 = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20261102160000_cleaner_city_unit7_booking.sql'),
  'utf8',
);
const u8 = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20261102170000_cleaner_city_unit8_lifecycle.sql'),
  'utf8',
);
const findPage = fs.readFileSync(
  path.resolve(process.cwd(), 'src/pages/cleaner-city/CleanerCityFindPage.tsx'),
  'utf8',
);

describe('A Cleaner City Units 6-8 contracts', () => {
  it('matches by society scope + detour, not same-office-only (5B)', () => {
    expect(u6).toContain('cleaner_city_find_matches');
    expect(u6).toContain('cleaner_city_allowed_society_ids');
    expect(u6).toContain('destination_along_route_candidate');
    expect(u6).toContain('not same-office-only');
    expect(findPage).toContain('Corridor labels only until a ride is confirmed');
  });

  it('holds seats on request and releases on reject/cancel', () => {
    expect(u7).toContain('cleaner_city_request_ride');
    expect(u7).toContain('seats_available = seats_available - 1');
    expect(u7).toContain('cleaner_city_respond_ride_request');
    expect(u7).toContain('seats_available = least(seats_total, seats_available + 1)');
    expect(u7).toContain('cleaner_city_cancel_ride');
  });

  it('owns start/complete on the server via OTP', () => {
    expect(u8).toContain('cleaner_city_generate_ride_otp');
    expect(u8).toContain('cleaner_city_start_ride');
    expect(u8).toContain('cleaner_city_complete_ride');
    expect(u8).toContain('Clients never mark started/completed locally');
    expect(u8).toContain('Too many OTP attempts');
  });
});
