import { describe, expect, it } from 'vitest';
import { emptyTasteBrowseState, productMatchesTasteBrowse } from '@/lib/food-taste';

describe('productMatchesTasteBrowse', () => {
  const dessert = { name: 'Cakes', tags: ['course:dessert'], is_veg: true };
  const rajma = { name: 'Rajma', tags: ['cuisine:north_indian', 'course:main'], cuisine_type: 'north_indian', is_veg: true };

  it('keeps every item when no taste is selected', () => {
    expect(productMatchesTasteBrowse(dessert, emptyTasteBrowseState())).toBe(true);
    expect(productMatchesTasteBrowse(rajma, emptyTasteBrowseState())).toBe(true);
  });

  it('narrows to dessert without treating veg as a cuisine', () => {
    expect(productMatchesTasteBrowse(dessert, { ...emptyTasteBrowseState(), course: 'dessert' })).toBe(true);
    expect(productMatchesTasteBrowse(rajma, { ...emptyTasteBrowseState(), course: 'dessert' })).toBe(false);
  });

  it('stacks veg with a cuisine mood', () => {
    const selected = { ...emptyTasteBrowseState(), cuisine: 'north_indian' as const, veg: true };
    expect(productMatchesTasteBrowse(rajma, selected)).toBe(true);
    expect(productMatchesTasteBrowse({ ...rajma, is_veg: false }, selected)).toBe(false);
  });
});
