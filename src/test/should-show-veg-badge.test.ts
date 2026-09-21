import { describe, expect, it } from 'vitest';
import { shouldShowVegBadge } from '@/lib/food-facets';

describe('shouldShowVegBadge', () => {
  it('hides badge when is_veg is null', () => {
    expect(shouldShowVegBadge(null, { showVegToggle: true, parentGroup: 'food_beverages' })).toBe(false);
  });

  it('hides badge for non-food even if is_veg is true', () => {
    expect(shouldShowVegBadge(true, { parentGroup: 'fashion', showVegToggle: false, category: 'clothing' })).toBe(false);
  });

  it('shows badge for food with explicit veg flag', () => {
    expect(shouldShowVegBadge(true, { parentGroup: 'food_beverages', showVegToggle: true, category: 'home_food' })).toBe(true);
    expect(shouldShowVegBadge(false, { parentGroup: 'food_beverages', showVegToggle: true, category: 'home_food' })).toBe(true);
  });

  it('never shows for pet_food', () => {
    expect(shouldShowVegBadge(true, { parentGroup: 'pets', category: 'pet_food', showVegToggle: false })).toBe(false);
  });
});
