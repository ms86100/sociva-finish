import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  formatVehicleTitle,
  hostTierLabel,
  matchFitPercent,
  matchReasonChips,
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

  it('wires find enrichment RPC and plate UI', () => {
    const hook = readFileSync(resolve(process.cwd(), 'src/hooks/queries/useCleanerCity.ts'), 'utf8');
    expect(hook).toContain('cleaner_city_publication_vehicle_cards');
    expect(hook).toContain('vehicle_registration');
    const migration = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/20261102262000_cleaner_city_match_vehicle_card.sql',
      ),
      'utf8',
    );
    expect(migration).toContain('vehicle_registration');
  });
});
