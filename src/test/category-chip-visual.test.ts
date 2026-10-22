import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { categoryLucideName, listingPlaceholderGlyph } from '@/lib/category-chip-visual';
import { buildLeafPhotoChipItems } from '@/components/category/CategoryPhotoChipRail';

const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

describe('category chip visual fallbacks', () => {
  it('maps travel contact-seller slugs to Lucide names, not emoji or words', () => {
    expect(categoryLucideName('airport_transfers', '✈️')).toBe('Plane');
    expect(categoryLucideName('self_drive', '🔑')).toBe('KeyRound');
    expect(categoryLucideName('driver_hire', '🧑‍✈️')).toBe('UserRound');
    expect(categoryLucideName('local_trips', '🏙️')).toBe('Building2');
    expect(categoryLucideName('home_food', 'Utensils')).toBe('Utensils');
    expect(categoryLucideName('unknown_cat', 'plane')).toBe('Package');
  });

  it('turns word placeholders into emoji so listing frames are not blank', () => {
    expect(listingPlaceholderGlyph('airport_transfers', 'plane')).toBe('✈️');
    expect(listingPlaceholderGlyph('self_drive', 'key')).toBe('🔑');
    expect(listingPlaceholderGlyph('driver_hire', 'driver')).toBe('🚗');
    expect(listingPlaceholderGlyph('home_food', '🍱')).toBe('🍱');
  });

  it('buildLeafPhotoChipItems uses Lucide fallbacks for travel even when Unsplash URLs exist', () => {
    const items = buildLeafPhotoChipItems(
      [
        {
          category: 'airport_transfers',
          displayName: 'Airport Transfers',
          icon: '✈️',
          imageUrl: 'https://images.unsplash.com/photo-airport',
        },
        {
          category: 'self_drive',
          displayName: 'Self-Drive Rentals',
          icon: '🔑',
        },
        {
          category: 'driver_hire',
          displayName: 'Driver on Hire',
          icon: '🧑‍✈️',
        },
      ],
      ['airport_transfers', 'self_drive', 'driver_hire'],
    );
    expect(items.map((i) => i.id)).toEqual(['airport_transfers', 'self_drive', 'driver_hire']);
    expect(items[0].icon).toBe('Plane');
    expect(items[1].icon).toBe('KeyRound');
    expect(items[2].icon).toBe('UserRound');
  });

  it('chip rail hides a failed photo instead of leaving a broken image', () => {
    const rail = read('components/category/CategoryPhotoChipRail.tsx');
    expect(rail).toMatch(/function ChipPhoto/);
    expect(rail).toMatch(/onError=\{\(\) => setFailed\(true\)\}/);
    expect(rail).toMatch(/categoryLucideName/);
  });

  it('listing cards keep a glyph when the photo fails', () => {
    expect(read('components/product/ProductListingCard.tsx')).toMatch(/setImgFailed\(true\)/);
    expect(read('components/product/ProductListingCard.tsx')).toMatch(/listingPlaceholderGlyph/);
    expect(read('components/product/ProductGridCard.tsx')).toMatch(/setImgFailed\(true\)/);
  });
});
