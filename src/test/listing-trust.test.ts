import { describe, expect, it } from 'vitest';
import {
  listingStoreChip,
  listingTrustLabel,
  listingTrustShowsStar,
} from '@/lib/listing-trust';

describe('listingTrustLabel', () => {
  it('hides naked 5.0 stars when reviews are too few', () => {
    expect(listingTrustShowsStar({ rating: 5, reviews: 1 })).toBe(false);
    expect(listingTrustLabel({ rating: 5, reviews: 1, completedOrders: 2 })).toBe('2 orders');
  });

  it('shows star with review count once trust threshold is met', () => {
    expect(listingTrustShowsStar({ rating: 4.6, reviews: 3 })).toBe(true);
    expect(listingTrustLabel({ rating: 4.6, reviews: 3 })).toBe('4.6 (3)');
  });

  it('labels brand-new kitchens without inventing ratings', () => {
    expect(listingTrustLabel({ rating: 5, reviews: 0, completedOrders: 0 })).toBe('New kitchen');
  });
});

describe('listingStoreChip', () => {
  it('shortens Mountain High Studio Cafe for tight cards', () => {
    expect(listingStoreChip('Mountain High Studio Cafe')).toBe('Mountain High');
  });
});
