import { describe, expect, it } from 'vitest';
import { profileEditOnboardingState } from '@/lib/pending-auth-action';
import { listingPlaceChip } from '@/lib/location-label-resolver';
import { isVersionBelow } from '@/lib/min-app-version';

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
});
