import { describe, expect, it } from 'vitest';
import {
  COOKING_NEARBY_HEADING,
  buildCookingNearbyKitchens,
  cookingNearbyDisplayName,
} from '@/lib/cooking-nearby';

describe('cooking nearby', () => {
  it('uses the Lobby heading', () => {
    expect(COOKING_NEARBY_HEADING).toBe('Cooking nearby');
  });

  it('shortens store names to a first-name style label', () => {
    expect(cookingNearbyDisplayName("Meera's Kitchen")).toBe('Meera');
    expect(cookingNearbyDisplayName('Tadka Ghar')).toBe('Tadka');
    expect(cookingNearbyDisplayName('')).toBe('Neighbor');
  });

  it('dedupes sellers, prefers open kitchens, and links to the seller page', () => {
    const kitchens = buildCookingNearbyKitchens(
      [
        {
          id: '1',
          category: 'home_food',
          parentGroup: 'food_beverages',
          seller_id: 's1',
          seller_name: "Meera's Kitchen",
          seller_is_available: true,
          seller_availability_start: '00:00',
          seller_availability_end: '23:59',
          seller_operating_days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
          image_url: 'https://img/meera-dish.jpg',
        },
        {
          id: '2',
          category: 'home_food',
          parentGroup: 'food_beverages',
          seller_id: 's1',
          seller_name: "Meera's Kitchen",
          seller_is_available: true,
          image_url: 'https://img/other.jpg',
        },
        {
          id: '3',
          category: 'restaurant',
          parentGroup: 'food_beverages',
          seller_id: 's2',
          seller_name: 'Ankit Dhaba',
          seller_is_available: false,
          image_url: 'https://img/ankit.jpg',
        },
        {
          id: '4',
          category: 'salon',
          parentGroup: 'services',
          seller_id: 's3',
          seller_name: 'Priya Salon',
          seller_is_available: true,
        },
      ],
      {
        categoryConfigs: [
          { category: 'home_food', parentGroup: 'food_beverages' },
          { category: 'restaurant', parentGroup: 'food_beverages' },
          { category: 'salon', parentGroup: 'services' },
        ],
        sellerImages: new Map([
          ['s1', { profileImage: 'https://img/meera-face.jpg', coverImage: null }],
        ]),
      },
    );

    expect(kitchens).toHaveLength(2);
    expect(kitchens[0]).toMatchObject({
      sellerId: 's1',
      name: 'Meera',
      open: true,
      href: '/seller/s1',
      imageUrl: 'https://img/meera-face.jpg',
    });
    expect(kitchens[1]).toMatchObject({
      sellerId: 's2',
      name: 'Ankit',
      open: false,
      href: '/seller/s2',
    });
  });
});
