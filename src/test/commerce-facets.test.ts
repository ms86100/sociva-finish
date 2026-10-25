import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  extractAvailableCommerceFacets,
  productMatchesCommerceFacets,
  emptyCommerceFacetState,
  normalizeServiceMode,
  purposeChipsForMode,
  packLooksLikeSize,
  packSizeBuyerLabel,
  remainingAttributeCount,
  shouldShowTasteChip,
  tasteSheetCounts,
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
    expect(rail).toContain('tasteSheetCounts');
    expect(rail).toContain('shouldShowTasteChip');
    expect(rail).toContain('Pack size');
    expect(rail).toContain('Refine what is nearby');
    expect(rail).not.toContain('From this catalogue');
    expect(rail).not.toContain('foodMoodCount');
    expect(rail).not.toMatch(/label="Veg Only"\s*\n\s*count=\{0\}/);
  });

  it('keeps Book filters to place and session, and Contact filters to a real choice', () => {
    const chips = extractAvailableCommerceFacets(dummyProducts, {
      parentGroup: 'home_services',
      currentState: emptyCommerceFacetState(),
    });
    const book = purposeChipsForMode('book', chips, dummyProducts);
    expect(book.map((chip) => chip.label)).toEqual(expect.arrayContaining(['At your home', 'Short session']));
    expect(book.some((chip) => chip.type === 'action_type')).toBe(false);

    const contact = purposeChipsForMode('services', [], [
      { action_type: 'request_quote', category: 'tuition' },
      { action_type: 'make_offer', category: 'tuition' },
      { action_type: 'contact_seller', category: 'salon' },
    ]);
    expect(contact.map((chip) => chip.label)).toEqual(['Get a quote', 'Make an offer']);

    const onlyAsk = purposeChipsForMode('services', [], [
      { action_type: 'request_service', category: 'tuition' },
      { action_type: 'contact_seller', category: 'salon' },
    ]);
    expect(onlyAsk).toEqual([]);
  });

  it('builds spice, pack, and catalogue filters only from values that narrow the list', () => {
    const pickles = [
      { id: 'p1', name: 'Mango', category: 'pickles', parentGroup: 'food_beverages', price: 180, is_veg: true, spice_level: 'hot', serving_size: '250 g', tags: ['cuisine:north_indian'] },
      { id: 'p2', name: 'Lemon', category: 'pickles', parentGroup: 'food_beverages', price: 160, is_veg: true, spice_level: 'medium', serving_size: '500 g', tags: ['cuisine:north_indian'] },
      { id: 'p3', name: 'Amla', category: 'pickles', parentGroup: 'food_beverages', price: 200, is_veg: true, spice_level: 'medium', serving_size: '250 g', tags: ['cuisine:north_indian'] },
    ];
    const chips = extractAvailableCommerceFacets(pickles, {
      parentGroup: 'food_beverages',
      currentState: emptyCommerceFacetState(),
    });
    expect(chips.filter((chip) => chip.type === 'spice').map((chip) => chip.label).sort()).toEqual(['Hot', 'Medium']);
    expect(chips.filter((chip) => chip.type === 'pack').map((chip) => chip.value).sort()).toEqual(['250 g', '500 g']);
    expect(chips.some((chip) => /mom|pickle seller/i.test(chip.label))).toBe(false);

    const hot = { ...emptyCommerceFacetState(), spiceLevel: 'hot' };
    expect(pickles.filter((product) => productMatchesCommerceFacets(product, hot)).map((product) => product.id)).toEqual(['p1']);

    const sameSpice = pickles.map((product) => ({ ...product, spice_level: 'medium', serving_size: '250 g' }));
    const flat = extractAvailableCommerceFacets(sameSpice, {
      parentGroup: 'food_beverages',
      currentState: emptyCommerceFacetState(),
    });
    expect(flat.some((chip) => chip.type === 'spice' || chip.type === 'pack')).toBe(false);
  });

  it('uses clothing tags that exist and ignores a material that was never stored', () => {
    const clothing = [
      { id: 'c1', name: 'Silk saree', category: 'clothing', parentGroup: 'clothing', price: 2400, action_type: 'contact_seller', tags: ['saree', 'festive'] },
      { id: 'c2', name: 'Cotton saree', category: 'clothing', parentGroup: 'clothing', price: 1800, action_type: 'contact_seller', tags: ['saree', 'ethnic'] },
    ];
    const chips = extractAvailableCommerceFacets(clothing, {
      parentGroup: 'clothing',
      currentState: emptyCommerceFacetState(),
    });
    const labels = chips.filter((chip) => chip.type === 'catalogue').map((chip) => chip.label);
    expect(labels).toEqual(expect.arrayContaining(['Festive', 'Ethnic']));
    expect(labels).not.toContain('Silk');
    expect(labels).not.toContain('Saree');

    const contact = purposeChipsForMode('services', chips, clothing);
    expect(contact.map((chip) => chip.label)).toEqual(expect.arrayContaining(['Festive', 'Ethnic']));
    expect(contact.some((chip) => chip.type === 'action_type')).toBe(false);

    const festive = { ...emptyCommerceFacetState(), catalogueTag: 'festive' };
    expect(clothing.filter((product) => productMatchesCommerceFacets(product, festive)).map((product) => product.id)).toEqual(['c1']);
  });
});

describe('taste sheet remaining counts and pack labels', () => {
  const food = [
    { id: 'b1', name: 'Poha', category: 'home_food', parentGroup: 'food_beverages', price: 60, tags: ['Breakfast'], cuisine_type: 'north_indian', is_veg: true, spice_level: 'mild', serving_size: '1' },
    { id: 'b2', name: 'Masala Dosa', category: 'home_food', parentGroup: 'food_beverages', price: 120, tags: ['Breakfast'], cuisine_type: 'south_indian', is_veg: true, spice_level: 'medium', serving_size: '1' },
    { id: 'l1', name: 'Butter Chicken', category: 'home_food', parentGroup: 'food_beverages', price: 220, tags: ['Lunch'], cuisine_type: 'north_indian', is_veg: false, spice_level: 'hot', serving_size: '200 g' },
    { id: 'l2', name: 'Veg Fried Rice', category: 'home_food', parentGroup: 'food_beverages', price: 140, tags: ['Lunch'], cuisine_type: 'chinese', is_veg: true, spice_level: 'medium', serving_size: '200 g' },
  ];

  it('keeps breakfast and cuisine counts when food_mood chips were stripped', () => {
    const chips = extractAvailableCommerceFacets(food, {
      parentGroup: 'food_beverages',
      currentState: emptyCommerceFacetState(),
    }).filter((chip) => chip.type !== 'food_mood');
    expect(chips.some((chip) => chip.type === 'food_mood')).toBe(false);

    const breakfast = { ...emptyCommerceFacetState(), meal: 'breakfast' };
    const counts = tasteSheetCounts(food, breakfast);
    expect(counts.meals.breakfast).toBe(2);
    expect(counts.cuisines.north_indian).toBe(1);
    expect(counts.cuisines.south_indian).toBe(1);
    expect(shouldShowTasteChip(counts.meals.breakfast, true)).toBe(true);
  });

  it('scopes veg and cuisine to breakfast while meal switchers use the full list', () => {
    const breakfast = { ...emptyCommerceFacetState(), meal: 'breakfast' };
    const counts = tasteSheetCounts(food, breakfast);
    expect(counts.veg).toBe(2);
    expect(counts.nonVeg).toBe(0);
    expect(counts.cuisines.chinese).toBe(0);
    expect(counts.meals.lunch).toBe(2);
    expect(shouldShowTasteChip(counts.cuisines.chinese, false)).toBe(false);
    expect(shouldShowTasteChip(counts.meals.lunch, false)).toBe(true);
    expect(shouldShowTasteChip(0, true)).toBe(true);
  });

  it('labels pack 1 as Serves 1 and keeps 200 g, skipping SKU noise', () => {
    expect(packSizeBuyerLabel('1')).toBe('Serves 1');
    expect(packSizeBuyerLabel('200 g')).toBe('200 g');
    expect(packLooksLikeSize('1')).toBe(true);
    expect(packLooksLikeSize('200 g')).toBe(true);
    expect(packLooksLikeSize('SKU-99')).toBe(false);

    const mixed = [
      ...food,
      { id: 'x1', name: 'Mystery jar', category: 'pickles', parentGroup: 'food_beverages', price: 90, is_veg: true, serving_size: 'SKU-99' },
    ];
    const chips = extractAvailableCommerceFacets(mixed, {
      parentGroup: 'food_beverages',
      currentState: emptyCommerceFacetState(),
    });
    const packs = chips.filter((chip) => chip.type === 'pack');
    expect(packs.map((chip) => chip.label).sort()).toEqual(['200 g', 'Serves 1']);
    expect(packs.some((chip) => chip.value === 'SKU-99')).toBe(false);

    const breakfast = { ...emptyCommerceFacetState(), meal: 'breakfast' };
    expect(remainingAttributeCount(food, breakfast, 'pack', '1')).toBe(2);
    expect(remainingAttributeCount(food, breakfast, 'pack', '200 g')).toBe(0);
    expect(remainingAttributeCount(food, breakfast, 'spice', 'hot')).toBe(0);
    expect(remainingAttributeCount(food, breakfast, 'spice', 'mild')).toBe(1);
  });
});
