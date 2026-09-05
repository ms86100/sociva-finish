import { describe, expect, it } from 'vitest';
import { scoreSearchHit, selectSearchResultsForDisplay } from '@/lib/searchRanking';

const jhol = {
  product_name: 'Veg Jhol Momos (Fried 4pcs)',
  seller_name: 'Mountain High Studio Cafe',
  category: 'momos',
  is_same_society: true,
  distance_km: 0.4,
};

const guitar = {
  product_name: 'Ram Ramdev Acoustic & Electrical Guitar',
  seller_name: 'Ramdev Music',
  category: 'hobbies',
  is_same_society: false,
  distance_km: 3,
};

const paneer = {
  product_name: 'Paneer Tikka',
  seller_name: 'Home Kitchen',
  category: 'home_food',
  is_same_society: true,
  distance_km: 0.2,
};

describe('search ranking', () => {
  it('scores a spaced phrase above a collapsed misspelling of an unrelated item', () => {
    expect(scoreSearchHit('jhol momo', jhol)).toBeGreaterThan(scoreSearchHit('jhol momo', guitar));
    expect(scoreSearchHit('jholmomo', jhol)).toBeGreaterThan(scoreSearchHit('jholmomo', paneer));
  });

  it('treats collapsed queries as a match for spaced product names', () => {
    expect(scoreSearchHit('jholmomo', jhol)).toBeGreaterThanOrEqual(82);
  });

  it('caps a long weak tail while keeping strong matches visible', () => {
    const items = [
      jhol,
      ...Array.from({ length: 20 }, (_, i) => ({
        product_name: `Momo combo ${i}`,
        seller_name: 'Other cafe',
        category: 'snacks',
        description: 'generic platter with momo mention',
        is_same_society: false,
        distance_km: 8,
      })),
    ];
    const selected = selectSearchResultsForDisplay('jhol momo', items, true);
    expect(selected.preview[0].product_name).toContain('Jhol Momos');
    expect(selected.preview.length).toBeLessThan(selected.items.length);
    expect(selected.hiddenCount).toBeGreaterThan(0);
  });

  it('keeps a small set of real text matches', () => {
    const selected = selectSearchResultsForDisplay('jhol momo', [jhol, paneer], true);
    expect(selected.hiddenCount).toBe(0);
    expect(selected.preview.map((item) => item.product_name)).toEqual(['Veg Jhol Momos (Fried 4pcs)']);
  });

  it('returns empty for unmatched typed queries instead of nearby browse rows', () => {
    const selected = selectSearchResultsForDisplay('somethingxyz123noMatch', [jhol, paneer], true);
    expect(selected.items).toHaveLength(0);
    expect(selected.preview).toHaveLength(0);
    expect(scoreSearchHit('somethingxyz123noMatch', jhol)).toBe(0);
  });
});
