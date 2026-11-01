import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { formatMatchReason, formatMatchReasons } from '@/lib/cleaner-city/matchCopy';

const findPage = fs.readFileSync(
  path.resolve(process.cwd(), 'src/pages/cleaner-city/CleanerCityFindPage.tsx'),
  'utf8',
);
const offerPage = fs.readFileSync(
  path.resolve(process.cwd(), 'src/pages/cleaner-city/CleanerCityOfferPage.tsx'),
  'utf8',
);
const hubPage = fs.readFileSync(
  path.resolve(process.cwd(), 'src/pages/cleaner-city/CleanerCityPage.tsx'),
  'utf8',
);
const hookFile = fs.readFileSync(
  path.resolve(process.cwd(), 'src/hooks/queries/useCleanerCity.ts'),
  'utf8',
);

describe('A Cleaner City Phase 0 formatMatchReasons helper', () => {
  it('maps known reason codes to human copy', () => {
    expect(formatMatchReason('pickup_within_corridor')).toBe('Pickup near your usual spot');
    expect(formatMatchReason('overlap_proxy_ok')).toBe(
      'Approximate corridor fit (straight-line estimate)',
    );
  });

  it('humanizes unknown reason codes instead of throwing', () => {
    expect(formatMatchReason('some_new_reason')).toBe('Some New Reason');
  });

  it('joins multiple reasons into one readable string', () => {
    const result = formatMatchReasons(['pickup_within_corridor', 'overlap_proxy_ok']);
    expect(result).toBe(
      'Pickup near your usual spot - Approximate corridor fit (straight-line estimate)',
    );
  });

  it('falls back to placeholder copy for empty reasons', () => {
    expect(formatMatchReasons([])).toBe('Match details pending');
    expect(formatMatchReasons(undefined as unknown as string[])).toBe('Match details pending');
  });

  it('never contains an em dash or en dash', () => {
    const sample = formatMatchReasons(['pickup_within_corridor', 'destination_coords_missing']);
    expect(sample).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('A Cleaner City Phase 0 Find/Offer page fixes', () => {
  it('Find page requires real guest pickup coordinates and never hardcodes Bangalore', () => {
    expect(findPage).toContain('guest_pickup_lat');
    expect(findPage).toContain('guest_pickup_lng');
    expect(findPage).not.toContain('12.9716');
    expect(findPage).not.toContain('77.5946');
  });

  it('Find page loads effective schedule and commute templates for pickup fallback', () => {
    expect(findPage).toContain('useEffectiveSchedule');
    expect(findPage).toContain('useCommuteTemplates');
  });

  it('Find page blocks search and links to the route page when pickup is missing', () => {
    expect(findPage).toContain('/cleaner-city/route');
    expect(findPage).toContain('hasPickup');
  });

  it('Find page shows the improved empty state copy', () => {
    expect(findPage).toContain('No seats yet - try another time or Offer a ride');
  });

  it('Find page shows human reasons via formatMatchReasons', () => {
    expect(findPage).toContain('formatMatchReasons');
  });

  it('Offer page never falls back to hardcoded Bangalore coordinates', () => {
    expect(offerPage).not.toContain('12.9716');
    expect(offerPage).not.toContain('77.5946');
  });

  it('Offer page requires office and pickup pins before publish and links to route page', () => {
    expect(offerPage).toContain('pinsReady');
    expect(offerPage).toContain('/cleaner-city/route');
  });

  it('Offer page disables publish until pins exist', () => {
    expect(offerPage).toContain('disabled={publish.isPending || !ready || !pinsReady}');
  });
});

describe('A Cleaner City Phase 0 hub active ride card', () => {
  it('hub shows an active ride card wired to useMyRides', () => {
    expect(hubPage).toContain('useMyRides');
    expect(hubPage).toContain('/cleaner-city/ride/');
    expect(hubPage).toContain('activeRide');
  });
});

describe('A Cleaner City Phase 0 hook contracts', () => {
  it('commute templates select pickup coordinates for matching fallback', () => {
    expect(hookFile).toContain('pickup_latitude, pickup_longitude');
  });

  it('MatchResult type exposes optional host rating and fuel estimate fields', () => {
    expect(hookFile).toContain('host_avg_stars');
    expect(hookFile).toContain('host_rating_count');
    expect(hookFile).toContain('estimated_fuel_paise');
    expect(hookFile).toContain('reason_labels');
  });

  it('EffectiveSchedule type exposes optional pickup coordinates', () => {
    expect(hookFile).toMatch(/EffectiveSchedule = \{[\s\S]*pickup_latitude\?: number \| null;/);
  });
});
