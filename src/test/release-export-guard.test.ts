import { describe, expect, it } from 'vitest';
import { profileEditOnboardingState } from '@/lib/pending-auth-action';
import { listingPlaceChip } from '@/lib/location-label-resolver';
import { isVersionBelow, minimumVersionFor } from '@/lib/min-app-version';

describe('release export guard', () => {
  it('exports the symbols the production bundle imports', () => {
    expect(typeof profileEditOnboardingState).toBe('function');
    expect(typeof listingPlaceChip).toBe('function');
    expect(listingPlaceChip('Shriram Greenfield Phase-2, Tower H')).toBe('Shriram Greenfield');
    expect(profileEditOnboardingState({ itemCount: 1 }).returnTo).toBe('/cart');
  });

  it('minimum version stays off until an admin sets one', () => {
    expect(isVersionBelow('2.0.60', '')).toBe(false);
    expect(isVersionBelow('2.0.60', '   ')).toBe(false);
    expect(isVersionBelow('2.0.59', '2.0.60')).toBe(true);
    expect(isVersionBelow('2.0.60', '2.0.60')).toBe(false);
    expect(isVersionBelow('2.1.0', '2.0.60')).toBe(false);
  });

  it('never blocks the website and lets each phone platform have its own minimum', () => {
    const mins = { shared: '2026.1012.0', android: '2.0.72', ios: '2026.1011.1430' };
    expect(minimumVersionFor('web', mins)).toBe('');
    expect(minimumVersionFor('android', mins)).toBe('2.0.72');
    expect(minimumVersionFor('ios', mins)).toBe('2026.1011.1430');
    expect(minimumVersionFor('android', { shared: ' 2.0.70 ', android: '  ' })).toBe('2.0.70');
    expect(minimumVersionFor('ios', {})).toBe('');

    // Installs that only read the shared minimum: one value above every old iOS build blocks both old platforms.
    expect(isVersionBelow('2.0.71', mins.shared)).toBe(true);
    expect(isVersionBelow('2026.1009.1200', mins.shared)).toBe(true);
    // New installs read their own platform minimum and pass.
    expect(isVersionBelow('2.0.72', minimumVersionFor('android', mins))).toBe(false);
    expect(isVersionBelow('2026.1011.1430', minimumVersionFor('ios', mins))).toBe(false);
  });
});
