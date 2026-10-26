import { describe, expect, it } from 'vitest';
import {
  CURATED_CATEGORY_ART,
  CURATED_CUISINE_ART,
  CURATED_MEAL_ART,
  guidedKitchenCountLabel,
  resolveFoodChipArt,
} from '@/lib/food-chip-art';

describe('food chip art', () => {
  it('falls back to curated breakfast art when live photos are spent', () => {
    const used = new Set<string>(['https://img/taken.jpg']);
    expect(resolveFoodChipArt(null, { meal: 'breakfast' }, used)).toBe(CURATED_MEAL_ART.breakfast);
    expect(used.has(CURATED_MEAL_ART.breakfast)).toBe(true);
  });

  it('prefers a fresh live URL over curated art', () => {
    const used = new Set<string>();
    expect(resolveFoodChipArt('https://img/idli.jpg', { meal: 'breakfast' }, used)).toBe(
      'https://img/idli.jpg',
    );
  });

  it('locks Home Food and South cuisine to identifiable curated art', () => {
    expect(CURATED_CATEGORY_ART.home_food).toBeTruthy();
    expect(CURATED_CUISINE_ART.south_indian).toContain('unsplash');
    const used = new Set<string>();
    expect(resolveFoodChipArt(null, { category: 'home_food' }, used)).toBe(CURATED_CATEGORY_ART.home_food);
    expect(resolveFoodChipArt(null, { cuisine: 'south_indian' }, used)).toBe(
      CURATED_CUISINE_ART.south_indian,
    );
  });

  it('falls back dosa / south listings to curated south art when the photo is missing or broken', async () => {
    const { listingDisplayArt, listingArtFallback, inferCuisineFromListing } = await import('@/lib/food-chip-art');
    expect(inferCuisineFromListing({ name: 'Classic Dosa Batter', cuisine_type: 'south_indian' })).toBe('south_indian');
    expect(listingDisplayArt({ name: 'Classic Dosa Batter', cuisine_type: 'south_indian' })).toBe(
      CURATED_CUISINE_ART.south_indian,
    );
    expect(listingArtFallback({
      name: 'Classic Dosa Batter',
      cuisine_type: 'south_indian',
      image_url: 'https://images.unsplash.com/photo-1668236543090-982573ede04d?auto=format&fit=crop&w=800&q=80',
    })).toBe(CURATED_CUISINE_ART.south_indian);
  });

  it('counts unique kitchens for meal tiles', () => {
    expect(guidedKitchenCountLabel([
      { seller_id: 'a' },
      { seller_id: 'a' },
      { seller_id: 'b' },
    ])).toBe('2 kitchens');
    expect(guidedKitchenCountLabel([{ seller_id: 'a' }])).toBe('1 kitchen');
  });
});
