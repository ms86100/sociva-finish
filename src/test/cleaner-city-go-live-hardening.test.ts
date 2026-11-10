import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { resolveNotificationRoute } from '@/lib/notification-routes';

function readSrc(rel: string) {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

describe('Cleaner City go-live hardening', () => {
  it('routes Cleaner City notifications into the module', () => {
    expect(
      resolveNotificationRoute('cleaner_city_ride_request', { ride_id: 'ride-1' }),
    ).toBe('/cleaner-city/ride/ride-1');
    expect(resolveNotificationRoute('cleaner_city_ride_update', {})).toBe('/cleaner-city');
    expect(
      resolveNotificationRoute('cleaner_city_waitlist', {
        reference_path: '/cleaner-city/find',
      }),
    ).toBe('/cleaner-city');
  });

  it('Offer publish rolls back if route geometry store fails', () => {
    const offer = readSrc('src/pages/cleaner-city/CleanerCityOfferPage.tsx');
    expect(offer).toContain('isPublishableRouteGeometry');
    expect(offer).toContain('cancelPub.mutateAsync(pub.id)');
    expect(offer).toContain('Could not save the driving road on this offer');
  });

  it('Ride call panel uses LiveKit voip caps then relay_call fallback', () => {
    const ride = readSrc('src/pages/cleaner-city/CleanerCityRidePage.tsx');
    expect(ride).toContain('fetchVoipCapabilities');
    expect(ride).toContain('can_place_calls');
    expect(ride).toContain('useRequestMaskedCall');
    expect(ride).toContain('relay_call');
    expect(ride).toContain('cleaner-city-relay-call');
  });

  it('Find empty state distinguishes missing pins from empty inventory', () => {
    const find = readSrc('src/pages/cleaner-city/CleanerCityFindPage.tsx');
    expect(find).toContain('No neighbour seats for this slot yet');
    expect(find).toContain('Set your commute pins and usual roads first');
  });

  it('PWA JS runtime cache bumped for Cleaner City deploy recovery', () => {
    const vite = readSrc('vite.config.ts');
    expect(vite).toContain('js-runtime-v3');
    expect(vite).not.toContain('js-runtime-v2');
  });

  it('go-live SQL migration asserts publish and autopilot preferred road', () => {
    const mig = readSrc(
      'supabase/migrations/20261110170000_cleaner_city_go_live_hardening.sql',
    );
    expect(mig).toContain('cleaner_city_assert_publishable_polyline');
    expect(mig).toContain('preferred_route_polyline');
    expect(mig).toContain('cleaner_city_rides_fuel_snapshot_trigger');
    expect(mig).toContain('Tower H gate');
  });
});
