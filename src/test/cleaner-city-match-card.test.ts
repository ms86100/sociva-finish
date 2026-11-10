import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  formatFuelShareRupees,
  formatTripMeters,
  formatVehicleTitle,
  hostTierLabel,
  matchFitPercent,
  matchReasonChips,
  pickupWindowLabel,
  tripLegsFromMatch,
  vehicleKindLabel,
} from '@/lib/cleaner-city/matchCopy';

describe('Cleaner City match card game UX helpers', () => {
  it('labels 2-wheeler vs 4-wheeler and builds vehicle title', () => {
    expect(vehicleKindLabel('bike')).toBe('2-wheeler');
    expect(vehicleKindLabel('car')).toBe('4-wheeler');
    expect(
      formatVehicleTitle({
        vehicle_type: 'car',
        vehicle_color: 'White',
        vehicle_make: 'Hyundai',
        vehicle_model: 'i20',
      }),
    ).toBe('4-wheeler · White Hyundai i20');
  });

  it('tiers hosts and clamps match power', () => {
    expect(hostTierLabel(0)).toBe('New host');
    expect(hostTierLabel(6)).toBe('Regular');
    expect(hostTierLabel(25)).toBe('Pro host');
    expect(matchFitPercent(120)).toBe(98);
    expect(matchFitPercent(40)).toBe(40);
  });

  it('returns short reason chips', () => {
    expect(matchReasonChips(['departure_within_window', 'seats_available', 'shared_circle'])).toEqual(
      ['Leaves near your time', 'Seats open', 'Trusted circle'],
    );
  });

  it('formats trip strip distances, fuel share, and pickup window', () => {
    expect(formatTripMeters(40)).toBe('40 m');
    expect(formatTripMeters(12400)).toBe('12.4 km');
    expect(formatFuelShareRupees(9200)).toBe(92);
    expect(pickupWindowLabel('08:15', 5)).toBe('08:10 - 08:20');
    const legs = tripLegsFromMatch({
      pickup_walk_meters: 40,
      route_distance_meters: 12400,
      reasons: ['destination_near_host_end'],
    });
    expect(legs.walkPickup).toBe(40);
    expect(legs.drive).toBe(12400);
    expect(legs.walkDrop).toBeGreaterThan(0);
  });

  it('wires find enrichment RPC, plate UI, and Hopr-style request card', () => {
    const hook = readFileSync(resolve(process.cwd(), 'src/hooks/queries/useCleanerCity.ts'), 'utf8');
    expect(hook).toContain('cleaner_city_publication_vehicle_cards');
    expect(hook).toContain('vehicle_registration');
    expect(hook).toContain('route_distance_meters');
    const card = readFileSync(
      resolve(process.cwd(), 'src/components/cleaner-city/CleanerCityMatchCard.tsx'),
      'utf8',
    );
    expect(card).toContain('cleaner-city-request-seat');
    expect(card).toContain('Request seat');
    expect(card).toContain('cleaner-city-match-trip-strip');
    expect(card).toContain('Pickup by');
    expect(card).toContain('Good route match');
    expect(card).toContain('cleaner-city-match-fit');
    const migration = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/20261102271000_cleaner_city_match_card_route_enrich.sql',
      ),
      'utf8',
    );
    expect(migration).toContain('route_distance_meters');
  });
});
