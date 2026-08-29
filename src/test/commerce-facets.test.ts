import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  extractAvailableCommerceFacets,
  productMatchesCommerceFacets,
  emptyCommerceFacetState,
  normalizeServiceMode,
} from '@/lib/commerce-facets';

describe('commerce facets extraction and filtering', () => {
  const dummyProducts = [
    {
      id: '1',
      name: 'Electrician Inspection',
      category: 'electrician',
      parentGroup: 'home_services',
      price: 199,
      action_type: 'book',
      service_duration_minutes: 30,
      delivery_time_text: 'Doorstep · 30 min',
      service_scope: null,
      is_veg: null,
    },
    {
      id: '2',
      name: 'Plumber Tap Fix',
      category: 'plumber',
      parentGroup: 'home_services',
      price: 249,
      action_type: 'book',
      service_duration_minutes: 45,
      delivery_time_text: 'Doorstep · 45 min',
      service_scope: null,
      is_veg: null,
    },
    {
      id: '3',
      name: 'AC Foam Jet Deep Cleaning',
      category: 'ac_service',
      parentGroup: 'home_services',
      price: 499,
      action_type: 'book',
      service_duration_minutes: 60,
      delivery_time_text: 'Doorstep · 60 min',
      service_scope: null,
      is_veg: null,
    },
    {
      id: '4',
      name: 'Experienced Cook for 2BHK',
      category: 'cook',
      parentGroup: 'domestic_help',
      price: 0,
      action_type: 'contact_seller',
      service_duration_minutes: null,
      delivery_time_text: 'Home visit',
      service_scope: 'Breakfast & dinner cooking',
      is_veg: null,
    },
    {
      id: '5',
      name: 'CBSE Tuition Online',
      category: 'tuition',
      parentGroup: 'education_learning',
      price: 800,
      action_type: 'book',
      service_duration_minutes: 60,
      delivery_time_text: 'Online & In-person',
      service_scope: 'Max 4 students',
      is_veg: null,
    },
  ];

  it('correctly normalizes service delivery modes', () => {
    expect(normalizeServiceMode('Doorstep · 30 min', null)).toBe('home_visit');
    expect(normalizeServiceMode('At Clinic', null)).toBe('at_store');
    expect(normalizeServiceMode('Online & In-person', null)).toBe('online');
    expect(normalizeServiceMode(null, null)).toBe(null);
  });

  it('extracts non-empty dynamic facet chips for service categories', () => {
    const chips = extractAvailableCommerceFacets(dummyProducts, {
      parentGroup: 'home_services',
      currentState: emptyCommerceFacetState(),
    });

    expect(chips.length).toBeGreaterThan(0);
    // Should have action type book
    expect(chips.some((c) => c.type === 'action_type' && c.value === 'book')).toBe(true);
    // Should have home_visit mode
    expect(chips.some((c) => c.type === 'service_mode' && c.value === 'home_visit')).toBe(true);
    // Should have duration <= 30 min
    expect(chips.some((c) => c.type === 'duration' && c.value === 30)).toBe(true);
    // Should have price bracket Under 300
    expect(chips.some((c) => c.type === 'price' && c.value === 300)).toBe(true);
  });

  it('accurately filters products matching facet state', () => {
    // Filter for actionType: 'book'
    const filteredAction = dummyProducts.filter((p) =>
      productMatchesCommerceFacets(p, { ...emptyCommerceFacetState(), actionType: 'book' })
    );
    expect(filteredAction.length).toBe(4);

    // Filter for actionType: 'contact_seller'
    const filteredContact = dummyProducts.filter((p) =>
      productMatchesCommerceFacets(p, { ...emptyCommerceFacetState(), actionType: 'contact_seller' })
    );
    expect(filteredContact.length).toBe(1);
    expect(filteredContact[0].name).toBe('Experienced Cook for 2BHK');

    // Filter for duration <= 30 mins
    const filteredDuration = dummyProducts.filter((p) =>
      productMatchesCommerceFacets(p, { ...emptyCommerceFacetState(), durationMax: 30 })
    );
    expect(filteredDuration.length).toBe(1);
    expect(filteredDuration[0].name).toBe('Electrician Inspection');

    // Filter for price <= 300
    const filteredPrice = dummyProducts.filter((p) =>
      productMatchesCommerceFacets(p, { ...emptyCommerceFacetState(), priceMax: 300 })
    );
    expect(filteredPrice.length).toBe(2); // 199 and 249 (0 is excluded from priceMax filter)
  });

  it('surfaces Taste moods for food inventory without prefixed tags', () => {
    const food = [
      { name: 'Dal Makhani Bowl', category: 'home_food', parentGroup: 'food_beverages', price: 180, tags: ['Lunch', 'North Indian'], cuisine_type: 'North Indian', action_type: 'add_to_cart' },
      { name: 'Masala Dosa', category: 'home_food', parentGroup: 'food_beverages', price: 120, tags: ['Breakfast'], cuisine_type: 'south_indian', action_type: 'add_to_cart' },
      { name: 'Belgian Chocolate Cake', category: 'bakery', parentGroup: 'food_beverages', price: 450, tags: ['Dessert', 'Cake'], cuisine_type: 'continental', action_type: 'add_to_cart' },
    ];
    const chips = extractAvailableCommerceFacets(food, {
      parentGroup: 'food_beverages',
      currentState: emptyCommerceFacetState(),
    });
    expect(chips.some((c) => c.type === 'food_mood' && c.id === 'mood:lunch')).toBe(true);
    expect(chips.some((c) => c.type === 'food_mood' && c.id === 'mood:breakfast')).toBe(true);
    expect(chips.some((c) => c.type === 'food_mood' && c.id === 'mood:dessert')).toBe(true);
    expect(chips.some((c) => c.type === 'food_mood' && c.id === 'mood:north_indian')).toBe(true);
    expect(chips.some((c) => c.type === 'food_mood' && c.id === 'mood:continental')).toBe(true);
    expect(chips.some((c) => c.type === 'action_type')).toBe(false);
  });

  it('defines productsWithFacets on category pages before filtering', () => {
    const page = readFileSync(resolve(__dirname, '../pages/CategoryGroupPage.tsx'), 'utf8');
    expect(page).toContain('const productsWithFacets');
    expect(page).toContain('useProductFacets');
    expect(page).toContain('applyProductFacetRow');
    const rail = readFileSync(resolve(__dirname, '../components/discovery/CommerceFacetRail.tsx'), 'utf8');
    expect(rail).toContain("c.type === 'food_mood'");
    expect(rail).toContain('FOOD_CUISINES');
    expect(rail).toContain('FOOD_MEALS');
    expect(rail).toContain('FOOD_COURSES');
  });
});
