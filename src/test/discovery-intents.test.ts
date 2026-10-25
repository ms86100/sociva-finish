import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDiscoveryIntents, relevantBrowseIntents, type DiscoveryCategoryInput } from '@/lib/discovery-intents';

const homeFood: DiscoveryCategoryInput = {
  category: 'home_food',
  parentGroup: 'food_beverages',
  displayName: 'Home Food',
  icon: 'UtensilsCrossed',
  products: [
    { id: '1', name: 'Cakes', image_url: 'https://img/cake.jpg', tags: ['course:dessert'] },
    { id: '2', name: 'Dal Makhani', tags: ['cuisine:north_indian', 'course:main'] },
  ],
};

const repairs: DiscoveryCategoryInput = {
  category: 'repairs',
  parentGroup: 'home_services',
  displayName: 'Repairs',
  icon: 'Wrench',
  products: [{ id: '3', name: 'AC service' }],
};

describe('buildDiscoveryIntents', () => {
  it('never emits a chip with count 0', () => {
    const intents = buildDiscoveryIntents([homeFood, repairs]);
    expect(intents.every((intent) => intent.count > 0)).toBe(true);
  });

  it('leads with live categories on All so services are not buried under meals', () => {
    const intents = buildDiscoveryIntents([homeFood, repairs]);
    expect(intents[0].kind).toBe('category');
    expect(intents.map((i) => i.label)).toContain('Home Food');
    expect(intents.map((i) => i.label)).toContain('Repairs');
  });

  it('does not show Breakfast when no meal:breakfast inventory exists', () => {
    const intents = buildDiscoveryIntents([homeFood]);
    expect(intents.some((i) => i.label === 'Breakfast')).toBe(false);
    expect(intents.some((i) => i.id === 'mood:dessert')).toBe(true);
  });

  it('hides a category that has no items for the selected meal', () => {
    const restaurant: DiscoveryCategoryInput = {
      category: 'restaurant',
      parentGroup: 'food_beverages',
      displayName: 'Restaurant',
      icon: 'Utensils',
      products: [{ id: '9', name: 'Dinner thali', tags: ['meal:dinner'] }],
    };
    const breakfastHome: DiscoveryCategoryInput = {
      ...homeFood,
      products: [{ id: '8', name: 'Idli', tags: ['meal:breakfast'] }],
    };
    const intents = relevantBrowseIntents([breakfastHome, restaurant], {
      facets: { meal: 'breakfast' },
    });
    expect(intents.map((intent) => intent.label)).toContain('Home Food');
    expect(intents.map((intent) => intent.label)).toContain('Breakfast');
    expect(intents.map((intent) => intent.label)).not.toContain('Restaurant');
  });

  it('keeps Breakfast selected as a switch even when a category is already chosen', () => {
    const breakfastHome: DiscoveryCategoryInput = {
      ...homeFood,
      products: [
        { id: '8', name: 'Idli', tags: ['meal:breakfast'] },
        { id: '9', name: 'Dal', tags: ['meal:lunch'] },
      ],
    };
    const intents = relevantBrowseIntents([breakfastHome], {
      category: 'home_food',
      facets: { meal: 'breakfast' },
    });
    expect(intents.map((intent) => intent.id)).toEqual(expect.arrayContaining(['cat:home_food', 'mood:breakfast', 'mood:lunch']));
  });

  it('emits a tap chip for live Puja inventory', () => {
    const agarbatti: DiscoveryCategoryInput = {
      category: 'agarbatti',
      parentGroup: 'puja',
      displayName: 'Agarbatti & Dhoop',
      icon: '🪔',
      imageUrl: 'https://img/festival.jpg',
      products: [{ id: 'a1', name: 'Divine Purity', image_url: 'https://img/festival.jpg' }],
    };
    const intents = buildDiscoveryIntents([homeFood, agarbatti]);
    const chip = intents.find((i) => i.id === 'cat:agarbatti');
    expect(chip?.label).toBe('Agarbatti & Dhoop');
    expect(chip?.href).toBe('/category/puja?sub=agarbatti');
    expect(chip?.count).toBe(1);
  });

  it('uses listing photos for chips and never puts makhana on Breakfast', () => {
    const snacks: DiscoveryCategoryInput = {
      category: 'snacks',
      parentGroup: 'food_beverages',
      displayName: 'Snacks',
      icon: 'Cookie',
      products: [{
        id: 'm1',
        category: 'snacks',
        name: 'madhubani makhana',
        image_url: 'https://img/makhana.jpg',
        tags: ['meal:breakfast'],
      }],
    };
    const breakfastHome: DiscoveryCategoryInput = {
      category: 'home_food',
      parentGroup: 'food_beverages',
      displayName: 'Home Food',
      icon: 'UtensilsCrossed',
      products: [{
        id: 'i1',
        category: 'home_food',
        name: 'Idli',
        image_url: 'https://img/idli.jpg',
        tags: ['meal:breakfast'],
      }],
    };
    const intents = buildDiscoveryIntents([snacks, breakfastHome], { maxChips: 40 });
    const snacksChip = intents.find((intent) => intent.id === 'cat:snacks');
    const breakfastChip = intents.find((intent) => intent.id === 'mood:breakfast');
    expect(snacksChip?.imageUrl).toBe('https://img/makhana.jpg');
    expect(breakfastChip?.imageUrl).toBe('https://img/idli.jpg');
    expect(breakfastChip?.imageUrl).not.toBe(snacksChip?.imageUrl);
    expect(intents.filter((intent) => intent.label === 'Snacks')).toHaveLength(1);
    expect(intents.find((intent) => intent.id === 'mood:snack')).toBeUndefined();
  });

  it('keeps one Snacks chip and counts cafe / home-food snack listings on it', () => {
    const snacks: DiscoveryCategoryInput = {
      category: 'snacks',
      parentGroup: 'food_beverages',
      displayName: 'Snacks',
      icon: 'Cookie',
      products: [{ id: 'm1', category: 'snacks', name: 'madhubani makhana' }],
    };
    const home: DiscoveryCategoryInput = {
      category: 'home_food',
      parentGroup: 'food_beverages',
      displayName: 'Home Food',
      icon: 'UtensilsCrossed',
      products: [{
        id: 'p1',
        category: 'home_food',
        name: 'Aloo pyaz pakoda with theekhi chutney',
        tags: ['meal:snack'],
      }],
    };
    const cafe: DiscoveryCategoryInput = {
      category: 'cafe',
      parentGroup: 'food_beverages',
      displayName: 'Cafe',
      icon: 'Coffee',
      products: [
        { id: 'f1', category: 'cafe', name: 'French Fries', tags: ['meal:snack'] },
        { id: 'c1', category: 'cafe', name: 'Cappuccino', tags: ['meal:breakfast'] },
      ],
    };
    const intents = relevantBrowseIntents([snacks, home, cafe], { category: 'snacks' });
    expect(intents.filter((intent) => intent.label === 'Snacks')).toHaveLength(1);
    expect(intents.find((intent) => intent.id === 'mood:snack')).toBeUndefined();
    expect(intents.find((intent) => intent.id === 'cat:snacks')?.count).toBe(3);
  });

  it('uses a snack food photo on the Snacks chip instead of makhana when one exists', () => {
    const snacks: DiscoveryCategoryInput = {
      category: 'snacks',
      parentGroup: 'food_beverages',
      displayName: 'Snacks',
      icon: 'Cookie',
      products: [{
        id: 'm1',
        category: 'snacks',
        name: 'madhubani makhana',
        image_url: 'https://img/makhana.jpg',
      }],
    };
    const cafe: DiscoveryCategoryInput = {
      category: 'cafe',
      parentGroup: 'food_beverages',
      displayName: 'Cafe',
      icon: 'Coffee',
      products: [{
        id: 'f1',
        category: 'cafe',
        name: 'Fresh French Fries',
        image_url: 'https://img/fries.jpg',
        tags: ['meal:snack'],
      }],
    };
    const homeIntents = buildDiscoveryIntents([snacks, cafe], { maxChips: 40 });
    const browseIntents = relevantBrowseIntents([snacks, cafe], { category: 'snacks' });
    expect(homeIntents.find((intent) => intent.id === 'cat:snacks')?.imageUrl).toBe('https://img/fries.jpg');
    expect(browseIntents.find((intent) => intent.id === 'cat:snacks')?.imageUrl).toBe('https://img/fries.jpg');
  });

  it('category pages filter Snacks with the expanded meal matcher', () => {
    const page = readFileSync('src/pages/CategoryGroupPage.tsx', 'utf8');
    const home = readFileSync('src/components/home/MarketplaceSection.tsx', 'utf8');
    expect(page).toMatch(/listingMatchesCategoryChip\(p, routeLeaf\)/);
    expect(home).toMatch(/listingMatchesCategoryChip\(p, activeCategory\)/);
  });

  it('omits empty categories entirely', () => {
    const emptyDoctors: DiscoveryCategoryInput = {
      category: 'doctors',
      parentGroup: 'healthcare',
      displayName: 'Doctors',
      icon: 'Stethoscope',
      products: [],
    };
    const intents = buildDiscoveryIntents([homeFood, emptyDoctors]);
    expect(intents.some((i) => i.label === 'Doctors')).toBe(false);
  });
});
