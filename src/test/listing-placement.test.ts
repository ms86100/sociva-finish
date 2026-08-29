import { describe, expect, it } from 'vitest';
import { resolveListingPlacement } from '@/lib/listing-placement';
import {
  inferFoodFacets,
  parseFoodFacets,
  productMatchesFoodFacets,
  serializeFoodFacets,
  emptyFoodFacets,
  TASTE_MOODS,
  toggleTasteMood,
  isTasteMoodActive,
  foodFacetsBrowsePath,
  foodFacetsHeadline,
  readFoodFacetsFromSearchParams,
  availableTasteMoods,
} from '@/lib/food-facets';
import type { IntentCatalogCategory, IntentCatalogSubcategory } from '@/lib/listing-intent';

const categories: IntentCatalogCategory[] = [
  {
    slug: 'home_food',
    id: 'cfg-home-food',
    displayName: 'Home Food',
    parentGroup: 'food_beverages',
    transactionType: 'cart_purchase',
    supportsCart: true,
  },
  {
    slug: 'bakery',
    id: 'cfg-bakery',
    displayName: 'Bakery',
    parentGroup: 'food_beverages',
    transactionType: 'cart_purchase',
    supportsCart: true,
  },
  {
    slug: 'cakes',
    id: 'cfg-cakes',
    displayName: 'Cakes',
    parentGroup: 'food_beverages',
    transactionType: 'cart_purchase',
    supportsCart: true,
  },
  {
    slug: 'beauty',
    id: 'cfg-beauty',
    displayName: 'Beauty',
    parentGroup: 'personal_care',
    transactionType: 'service_booking',
    requiresTimeSlot: true,
    supportsCart: false,
  },
  {
    slug: 'salon',
    id: 'cfg-salon',
    displayName: 'Salon',
    parentGroup: 'personal_care',
    transactionType: 'service_booking',
    requiresTimeSlot: true,
    supportsCart: false,
  },
];

const subcategories: IntentCatalogSubcategory[] = [
  {
    id: 'sub-breakfast',
    slug: 'breakfast_items',
    displayName: 'Breakfast',
    categoryConfigId: 'cfg-home-food',
    categorySlug: 'home_food',
  },
  {
    id: 'sub-tiffin',
    slug: 'daily_tiffin',
    displayName: 'Tiffin',
    categoryConfigId: 'cfg-home-food',
    categorySlug: 'home_food',
  },
  {
    id: 'sub-cakes',
    slug: 'cakes',
    displayName: 'Cakes',
    categoryConfigId: 'cfg-bakery',
    categorySlug: 'bakery',
  },
  {
    id: 'sub-bridal',
    slug: 'bridal_makeup',
    displayName: 'Bridal Makeup',
    categoryConfigId: 'cfg-beauty',
    categorySlug: 'beauty',
  },
  {
    id: 'sub-haircut',
    slug: 'haircut',
    displayName: 'Haircut',
    categoryConfigId: 'cfg-salon',
    categorySlug: 'salon',
  },
];

describe('resolveListingPlacement', () => {
  it('keeps Rajma Chawal as a Home Food item, never a Rajma subcategory', () => {
    const placed = resolveListingPlacement({
      name: 'Rajma Chawal',
      storeCategories: ['home_food'],
      categories,
      subcategories,
      commerceModel: 'cart',
    });
    expect(placed.category).toBe('home_food');
    expect(placed.subcategoryName).not.toBe('Rajma Chawal');
    expect(placed.subcategoryName).not.toBe('Lunch');
    expect(placed.extraCategory).toBeNull();
  });

  it('maps Cakes onto Bakery → Cakes and expands the food store', () => {
    const placed = resolveListingPlacement({
      name: 'Cakes',
      storeCategories: ['home_food'],
      categories,
      subcategories,
      commerceModel: 'cart',
    });
    expect(placed.category).toBe('bakery');
    expect(placed.subcategoryId).toBe('sub-cakes');
    expect(placed.extraCategory).toBe('bakery');
  });

  it('maps Bridal Makeup onto the existing Beauty subcategory', () => {
    const placed = resolveListingPlacement({
      name: 'Bridal Makeup',
      storeCategories: ['beauty'],
      categories,
      subcategories,
      commerceModel: 'book',
    });
    expect(placed.category).toBe('beauty');
    expect(placed.subcategoryId).toBe('sub-bridal');
    expect(placed.extraCategory).toBeNull();
  });

  it('maps Haircut onto Salon, not Food', () => {
    const placed = resolveListingPlacement({
      name: 'Haircut',
      storeCategories: ['salon'],
      categories,
      subcategories,
      commerceModel: 'book',
    });
    expect(placed.category).toBe('salon');
    expect(placed.subcategoryId).toBe('sub-haircut');
  });

  it('does not move an AC-style service onto a food store', () => {
    const placed = resolveListingPlacement({
      name: 'AC repair',
      storeCategories: ['home_food'],
      categories,
      subcategories,
      commerceModel: 'cart',
    });
    expect(placed.category).toBe('home_food');
    expect(placed.extraCategory).toBeNull();
  });
});

describe('food facets', () => {
  it('infers North Indian mains from Rajma / Dal Makhani without creating taxonomy', () => {
    const rajma = inferFoodFacets('Rajma Chawal');
    expect(rajma.cuisine).toBe('north_indian');
    expect(rajma.course).toBe('main');

    const dal = inferFoodFacets('Dal Makhani');
    expect(dal.cuisine).toBe('north_indian');
  });

  it('infers dessert for cakes', () => {
    expect(inferFoodFacets('Birthday Cakes').course).toBe('dessert');
  });

  it('round-trips namespaced tags and cuisine_type', () => {
    const saved = serializeFoodFacets({
      cuisine: 'south_indian',
      meal: 'breakfast',
      course: 'main',
    }, ['handmade']);
    expect(saved.cuisine_type).toBe('south_indian');
    expect(saved.tags).toEqual([
      'handmade',
      'cuisine:south_indian',
      'meal:breakfast',
      'course:main',
    ]);
    expect(parseFoodFacets(saved.tags, saved.cuisine_type)).toEqual({
      cuisine: 'south_indian',
      meal: 'breakfast',
      course: 'main',
    });
  });

  it('filters products by selected facets only', () => {
    const southIdli = { tags: ['cuisine:south_indian', 'meal:breakfast'], cuisine_type: 'south_indian' };
    const northRajma = { tags: ['cuisine:north_indian', 'course:main'], cuisine_type: 'north_indian' };
    expect(productMatchesFoodFacets(southIdli, { cuisine: 'south_indian' })).toBe(true);
    expect(productMatchesFoodFacets(northRajma, { cuisine: 'south_indian' })).toBe(false);
    expect(productMatchesFoodFacets(northRajma, { course: 'main' })).toBe(true);
  });
});

describe('taste moods and browse URLs', () => {
  it('toggles a mood on one facet without clearing the others', () => {
    const dessert = TASTE_MOODS.find((m) => m.id === 'dessert');
    const north = TASTE_MOODS.find((m) => m.id === 'north_indian');
    expect(dessert && north).toBeTruthy();
    const withDessert = toggleTasteMood(dessert!, emptyFoodFacets());
    expect(withDessert.course).toBe('dessert');
    const mixed = toggleTasteMood(north!, withDessert);
    expect(mixed).toEqual({ cuisine: 'north_indian', meal: null, course: 'dessert' });
    expect(isTasteMoodActive(dessert!, mixed)).toBe(true);
    expect(isTasteMoodActive(north!, mixed)).toBe(true);
  });

  it('round-trips cuisine/meal/course on category URLs', () => {
    const path = foodFacetsBrowsePath('food_beverages', { cuisine: 'north_indian', course: 'dessert' });
    expect(path).toBe('/category/food_beverages?cuisine=north_indian&course=dessert');
    const facets = readFoodFacetsFromSearchParams(new URLSearchParams('cuisine=north_indian&course=dessert&sub=bakery'));
    expect(facets).toEqual({ cuisine: 'north_indian', meal: null, course: 'dessert' });
  });

  it('builds a readable craving headline', () => {
    expect(foodFacetsHeadline({ cuisine: 'north_indian', meal: null, course: 'dessert' })).toBe('North Indian · Dessert');
    expect(foodFacetsHeadline(emptyFoodFacets())).toBeNull();
  });

  it('only surfaces moods that exist in inventory', () => {
    const moods = availableTasteMoods([
      { name: 'Cakes', tags: ['course:dessert'] },
      { name: 'Dal', tags: ['cuisine:north_indian'] },
    ]);
    expect(moods.map((m) => m.id)).toEqual(['north_indian', 'dessert']);
  });

  it('matches human tags, cuisine labels, and dish names used by live and dummy listings', () => {
    const dal = {
      name: 'Dal Makhani & Jeera Rice Meal Box',
      tags: ['Lunch', 'Dinner', 'North Indian', 'Thali'],
      cuisine_type: 'North Indian',
    };
    const dosa = {
      name: 'Crispy Masala Dosa with Sambar & Chutney',
      tags: ['Breakfast', 'South Indian'],
      cuisine_type: 'south_indian',
    };
    expect(productMatchesFoodFacets(dal, { meal: 'lunch' })).toBe(true);
    expect(productMatchesFoodFacets(dal, { cuisine: 'north_indian' })).toBe(true);
    expect(productMatchesFoodFacets(dosa, { meal: 'breakfast' })).toBe(true);
    expect(productMatchesFoodFacets(dosa, { cuisine: 'south_indian' })).toBe(true);
    expect(availableTasteMoods([dal, dosa]).map((m) => m.id)).toEqual(
      expect.arrayContaining(['breakfast', 'lunch', 'dinner', 'north_indian', 'south_indian']),
    );
  });
});
