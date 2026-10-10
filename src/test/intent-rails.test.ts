import { describe, expect, it } from 'vitest';
import { buildIntentRails, type IntentListing } from '@/lib/intent-rails';

function item(partial: Partial<IntentListing> & { id: string }): IntentListing {
  return {
    category: 'home_food',
    created_at: '2020-01-01T00:00:00.000Z',
    completed_order_count: 0,
    distance_km: 1,
    ...partial,
  };
}

const now = Date.parse('2026-10-10T12:00:00.000Z');

describe('intent rails', () => {
  it('does not call a zero-order catalogue popular', () => {
    const rails = buildIntentRails({
      mode: 'shop',
      products: [item({ id: 'a', distance_km: 2 }), item({ id: 'b', distance_km: 0.4 })],
      recentIds: [],
      favoriteIds: [],
      lastOpenedAt: null,
      now,
    });
    expect(rails.primary?.title).toBe('Nearby to order');
    expect(rails.primary?.products.map((product) => product.id)).toEqual(['b', 'a']);
    expect(rails.foodPopular).toBeNull();
    expect(rails.sinceLastVisit).toBeNull();
  });

  it('hides popular food when those stores are already in popular nearby', () => {
    const rails = buildIntentRails({
      mode: 'shop',
      products: [
        item({ id: 'biryani', seller_id: 'tadka', completed_order_count: 4, category: 'home_food' }),
        item({ id: 'shirt', seller_id: 'cloth', completed_order_count: 9, category: 'clothing' }),
      ],
      recentIds: [],
      favoriteIds: [],
      lastOpenedAt: null,
      now,
      isFood: (listing) => listing.category === 'home_food',
    });
    expect(rails.primary?.title).toBe('Popular nearby');
    expect(rails.primary?.products.map((product) => product.id)).toEqual(['shirt', 'biryani']);
    expect(rails.foodPopular).toBeNull();
  });

  it('keeps popular food when it adds a store the primary rail does not show', () => {
    const rails = buildIntentRails({
      mode: 'shop',
      products: [
        item({ id: 'shirt', seller_id: 'cloth', completed_order_count: 9, category: 'clothing' }),
        item({ id: 'biryani', seller_id: 'tadka', completed_order_count: 4, category: 'home_food' }),
      ],
      recentIds: [],
      favoriteIds: [],
      lastOpenedAt: null,
      now,
      limit: 1,
      isFood: (listing) => listing.category === 'home_food',
    });
    expect(rails.primary?.products.map((product) => product.id)).toEqual(['shirt']);
    expect(rails.foodPopular?.products.map((product) => product.id)).toEqual(['biryani']);
  });

  it('keeps other nearby stores in the same rail when one store has many ordered dishes', () => {
    const tadka = Array.from({ length: 12 }, (_, index) => item({
      id: `tadka-${index}`,
      seller_id: 'tadka',
      completed_order_count: 10,
      distance_km: 0.5,
    }));
    const rails = buildIntentRails({
      mode: 'shop',
      products: [
        ...tadka,
        item({ id: 'dal', seller_id: 'chatpatta', completed_order_count: 2, distance_km: 0.8 }),
        item({ id: 'omlette', seller_id: 'mountain', completed_order_count: 0, distance_km: 0.1 }),
      ],
      recentIds: [],
      favoriteIds: [],
      lastOpenedAt: null,
      now,
      limit: 10,
      isFood: (listing) => listing.category === 'home_food',
    });
    const sellers = rails.primary?.products.map((product) => product.seller_id).filter((id, index, all) => all.indexOf(id) === index);
    expect(sellers).toEqual(['tadka', 'chatpatta', 'mountain']);
    expect(rails.foodPopular).toBeNull();
  });

  it('hides since-last-visit until a previous open, and keeps other modes out of shop recents', () => {
    const products = [
      item({ id: 'new-dish', created_at: '2026-10-09T12:00:00.000Z' }),
      item({ id: 'old-dish', created_at: '2026-01-01T00:00:00.000Z' }),
    ];
    const first = buildIntentRails({
      mode: 'shop',
      products,
      recentIds: ['missing', 'old-dish'],
      favoriteIds: [],
      lastOpenedAt: null,
      now,
      categoryLabel: () => 'Home Food',
    });
    expect(first.sinceLastVisit).toBeNull();
    expect(first.recentlyViewed?.products.map((product) => product.id)).toEqual(['old-dish']);
    expect(first.moreInCategory?.title).toBe('More in Home Food');
    expect(first.moreInCategory?.products.map((product) => product.id)).toEqual(['new-dish']);

    const returning = buildIntentRails({
      mode: 'book',
      products,
      recentIds: [],
      favoriteIds: [],
      lastOpenedAt: Date.parse('2026-10-08T12:00:00.000Z'),
      now,
    });
    expect(returning.sinceLastVisit?.products.map((product) => product.id)).toEqual(['new-dish']);
    expect(returning.newlyListed?.title).toBe('New services');
    expect(returning.primary?.title).toBe('Nearby to book');
    expect(returning.primary?.products.map((product) => product.id)).toEqual(['new-dish', 'old-dish']);
  });

  it('keeps book and contact providers in one rail, and calls it popular only after a completed order', () => {
    const products = [
      item({ id: 'yoga', seller_id: 'studio', category: 'yoga', distance_km: 0.4 }),
      item({ id: 'haircut', seller_id: 'salon', category: 'salon', completed_order_count: 3, distance_km: 1.2 }),
    ];
    const shared = { products, recentIds: [], favoriteIds: [], lastOpenedAt: null, now };
    const booked = buildIntentRails({ mode: 'book', ...shared });
    expect(booked.primary?.title).toBe('Popular services');
    const bookedSellers = booked.primary?.products.map((product) => product.seller_id).filter((id, index, all) => all.indexOf(id) === index);
    expect(bookedSellers).toEqual(['salon', 'studio']);

    const contact = buildIntentRails({
      mode: 'services',
      ...shared,
      products: products.map((product) => ({ ...product, completed_order_count: 0 })),
    });
    expect(contact.primary?.title).toBe('Businesses nearby');
    const contactSellers = contact.primary?.products.map((product) => product.seller_id).filter((id, index, all) => all.indexOf(id) === index);
    expect(contactSellers).toEqual(['studio', 'salon']);
  });
});
