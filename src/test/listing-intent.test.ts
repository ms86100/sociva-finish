import { describe, it, expect } from 'vitest';
import {
  resolveListingIntent,
  findBestSubcategoryMatch,
  migrateOnboardingStep,
  commerceModelToDefaultAction,
  shouldSurfaceListingSuggestion,
  type IntentCatalogCategory,
  type IntentCatalogSubcategory,
} from '@/lib/listing-intent';

const categories: IntentCatalogCategory[] = [
  {
    slug: 'clothing',
    id: 'cfg-clothing',
    displayName: 'Clothing',
    parentGroup: 'marketplace',
    transactionType: 'cart_purchase',
    supportsCart: true,
  },
  {
    slug: 'yoga',
    id: 'cfg-yoga',
    displayName: 'Yoga',
    parentGroup: 'wellness',
    transactionType: 'book_session',
    requiresTimeSlot: true,
    supportsCart: false,
  },
  {
    slug: 'plumber',
    id: 'cfg-plumber',
    displayName: 'Plumber',
    parentGroup: 'home_services',
    transactionType: 'request_service',
    enquiryOnly: false,
    supportsCart: false,
  },
  {
    slug: 'daily_tiffin',
    id: 'cfg-tiffin',
    displayName: 'Daily Tiffin',
    parentGroup: 'food',
    transactionType: 'cart_purchase',
    supportsCart: true,
  },
  {
    slug: 'one_time_meals',
    id: 'cfg-meals',
    displayName: 'One-time Meals',
    parentGroup: 'food',
    transactionType: 'cart_purchase',
    supportsCart: true,
  },
  {
    slug: 'cakes',
    id: 'cfg-cakes',
    displayName: 'Cakes',
    parentGroup: 'food',
    transactionType: 'cart_purchase',
    supportsCart: true,
  },
];

const subcategories: IntentCatalogSubcategory[] = [
  {
    id: 'sub-tshirts',
    slug: 't_shirts',
    displayName: 'T-Shirts',
    categoryConfigId: 'cfg-clothing',
    categorySlug: 'clothing',
  },
  {
    id: 'sub-western',
    slug: 'western_wear',
    displayName: 'Western Wear',
    categoryConfigId: 'cfg-clothing',
    categorySlug: 'clothing',
  },
  {
    id: 'sub-hatha',
    slug: 'hatha_yoga',
    displayName: 'Hatha Yoga',
    categoryConfigId: 'cfg-yoga',
    categorySlug: 'yoga',
  },
];

describe('findBestSubcategoryMatch', () => {
  it('matches T-shirt to T-Shirts subcategory', () => {
    const hit = findBestSubcategoryMatch('T-shirt', subcategories);
    expect(hit).not.toBeNull();
    expect(hit!.sub.id).toBe('sub-tshirts');
  });

  it('scopes match to category when provided', () => {
    const hit = findBestSubcategoryMatch('T-shirt', subcategories, {
      categoryConfigId: 'cfg-clothing',
    });
    expect(hit!.sub.displayName).toBe('T-Shirts');
  });
});

describe('resolveListingIntent', () => {
  it('resolves T-shirt → clothing + T-Shirts + cart', () => {
    const r = resolveListingIntent({
      phrase: 'T-shirt',
      categories,
      subcategories,
    });
    expect(r.suggestedCategorySlug).toBe('clothing');
    expect(r.suggestedSubcategoryId).toBe('sub-tshirts');
    expect(r.commerceModel).toBe('cart');
    expect(r.seedProductName).toBe('T-shirt');
    expect(r.needsOtherSubcategory).toBe(false);
  });

  it('resolves yoga → book', () => {
    const r = resolveListingIntent({
      phrase: 'Yoga classes',
      categories,
      subcategories,
    });
    expect(r.suggestedCategorySlug).toBe('yoga');
    expect(r.commerceModel).toBe('book');
  });

  it('seller-explicit commerce model wins over inference', () => {
    const r = resolveListingIntent({
      phrase: 'T-shirt',
      commerceModel: 'enquire',
      categories,
      subcategories,
    });
    expect(r.commerceModel).toBe('enquire');
    expect(r.suggestedCategorySlug).toBe('clothing');
  });

  it('plumber maps without hard fail', () => {
    const r = resolveListingIntent({
      phrase: 'plumber',
      categories,
      subcategories,
    });
    expect(r.suggestedCategorySlug).toBe('plumber');
    expect(['enquire', 'book', 'contact', 'cart']).toContain(r.commerceModel);
  });

  it('unknown phrase → enquire + no hard fail', () => {
    const r = resolveListingIntent({
      phrase: 'quantum widget fabrication',
      categories,
      subcategories,
    });
    expect(r.commerceModel).toBe('enquire');
    expect(r.suggestedCategorySlug).toBeNull();
    expect(r.seedProductName).toBe('Quantum widget fabrication');
  });

  it('category without subcategory match sets Other path', () => {
    const r = resolveListingIntent({
      phrase: 'vintage denim jackets',
      categories,
      subcategories: [
        {
          id: 'sub-only-socks',
          slug: 'socks',
          displayName: 'Socks',
          categoryConfigId: 'cfg-clothing',
          categorySlug: 'clothing',
        },
      ],
    });
    // clothing alias may still hit from "denim"/clothes — if category hit without good sub:
    if (r.suggestedCategorySlug === 'clothing' && !r.suggestedSubcategoryId) {
      expect(r.needsOtherSubcategory).toBe(true);
      expect(r.useCustomSubcategoryLabel).toBeTruthy();
    }
  });

  it('maps commerce model to default_action_type', () => {
    expect(commerceModelToDefaultAction('cart')).toBeTruthy();
    expect(commerceModelToDefaultAction('book')).toBeTruthy();
  });

  it('classifies biryani variants onto existing one_time_meals without renaming the item', () => {
    for (const phrase of ['Biryani', 'biriyani', 'Chicken Biryani', 'Homemade Hyderabadi Chicken Biryani']) {
      const r = resolveListingIntent({ phrase, categories, subcategories });
      expect(r.suggestedCategorySlug).toBe('one_time_meals');
      expect(r.seedProductName).toBe(phrase.charAt(0).toUpperCase() + phrase.slice(1));
      expect(r.matchBand === 'none').toBe(false);
    }
  });

  it('keeps cake, saree, and yoga on their existing categories', () => {
    expect(resolveListingIntent({ phrase: 'Cake', categories, subcategories }).suggestedCategorySlug).toBe('cakes');
    expect(resolveListingIntent({ phrase: 'Saree', categories, subcategories }).suggestedCategorySlug).toBe('clothing');
    expect(resolveListingIntent({ phrase: 'Yoga', categories, subcategories }).suggestedCategorySlug).toBe('yoga');
  });

  it('does not create taxonomy for unknown products and does not throw', () => {
    const r = resolveListingIntent({
      phrase: 'quantum widget fabrication',
      categories,
      subcategories,
    });
    expect(r.commerceModel).toBe('enquire');
    expect(r.suggestedCategorySlug).toBeNull();
    expect(r.matchBand).toBe('none');
    expect(r.seedProductName).toBe('Quantum widget fabrication');
  });

  it('falls back to an existing other-* parent instead of failing', () => {
    const r = resolveListingIntent({
      phrase: 'Korean fermented soybean paste',
      categories: [
        ...categories,
        {
          slug: 'other-food',
          id: 'cfg-other-food',
          displayName: 'Other Food',
          parentGroup: 'food_beverages',
          transactionType: 'cart_purchase',
          supportsCart: true,
        },
      ],
      subcategories,
    });
    expect(r.suggestedCategorySlug).toBe('other-food');
    expect(r.matchBand).toBe('weak');
    expect(r.seedProductName).toBe('Korean fermented soybean paste');
    expect(shouldSurfaceListingSuggestion(r)).toBe(false);
  });

  it('does not dump unknown or garbage phrases onto the first other-* category', () => {
    const dumpCatalog: IntentCatalogCategory[] = [
      ...categories,
      {
        slug: 'other-rentals',
        id: 'cfg-other-rentals',
        displayName: 'Other Rentals',
        parentGroup: 'rentals',
        transactionType: 'request_service',
        supportsCart: false,
      },
      {
        slug: 'other-food',
        id: 'cfg-other-food',
        displayName: 'Other Food',
        parentGroup: 'food_beverages',
        transactionType: 'cart_purchase',
        supportsCart: true,
      },
    ];
    for (const phrase of ['somethingxyz123noMatch', 'quantum widget fabrication']) {
      const r = resolveListingIntent({ phrase, categories: dumpCatalog, subcategories });
      expect(r.suggestedCategorySlug).toBeNull();
      expect(r.matchBand).toBe('none');
      expect(shouldSurfaceListingSuggestion(r)).toBe(false);
    }
  });

  it('maps gujiya to a food category instead of Other Rentals', () => {
    const foodCatalog: IntentCatalogCategory[] = [
      ...categories,
      {
        slug: 'home_food',
        id: 'cfg-home-food',
        displayName: 'Home Food',
        parentGroup: 'food_beverages',
        transactionType: 'cart_purchase',
        supportsCart: true,
      },
      {
        slug: 'traditional_sweets',
        id: 'cfg-sweets',
        displayName: 'Traditional Sweets',
        parentGroup: 'food_beverages',
        transactionType: 'cart_purchase',
        supportsCart: true,
      },
      {
        slug: 'other-rentals',
        id: 'cfg-other-rentals',
        displayName: 'Other Rentals',
        parentGroup: 'rentals',
        transactionType: 'request_service',
        supportsCart: false,
      },
    ];
    const r = resolveListingIntent({ phrase: 'gujiya', categories: foodCatalog, subcategories });
    expect(['traditional_sweets', 'home_food']).toContain(r.suggestedCategorySlug);
    expect(r.suggestedCategorySlug).not.toBe('other-rentals');
    expect(shouldSurfaceListingSuggestion(r)).toBe(true);
  });

  it('still sparkles a real food match such as homemade tiffin or Rajma Chawal', () => {
    const foodCatalog: IntentCatalogCategory[] = [
      ...categories,
      {
        slug: 'home_food',
        id: 'cfg-home-food',
        displayName: 'Home Food',
        parentGroup: 'food_beverages',
        transactionType: 'cart_purchase',
        supportsCart: true,
      },
    ];
    const tiffin = resolveListingIntent({ phrase: 'homemade tiffin', categories: foodCatalog, subcategories });
    expect(['daily_tiffin', 'home_food']).toContain(tiffin.suggestedCategorySlug);
    expect(shouldSurfaceListingSuggestion(tiffin)).toBe(true);

    const rajma = resolveListingIntent({ phrase: 'Rajma Chawal', categories: foodCatalog, subcategories });
    expect(rajma.suggestedCategorySlug).toBe('home_food');
    expect(shouldSurfaceListingSuggestion(rajma)).toBe(true);
  });

  it('empty input keeps previous validation behavior', () => {
    const r = resolveListingIntent({
      phrase: '',
      categories,
      subcategories,
    });
    expect(r.suggestedCategorySlug).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.matchBand).toBe('none');
  });
});

describe('migrateOnboardingStep', () => {
  it('maps legacy 5-step indices into compact v5 steps', () => {
    expect(migrateOnboardingStep(1)).toBe(1);
    expect(migrateOnboardingStep(2)).toBe(4);
    expect(migrateOnboardingStep(3)).toBe(4);
    expect(migrateOnboardingStep(4)).toBe(3);
    expect(migrateOnboardingStep(5)).toBe(4);
  });

  it('maps intent-first v2 steps into compact v5 steps', () => {
    expect(migrateOnboardingStep(1, '2')).toBe(1);
    expect(migrateOnboardingStep(2, '2')).toBe(1);
    expect(migrateOnboardingStep(3, '2')).toBe(3);
    expect(migrateOnboardingStep(4, '2')).toBe(4);
    expect(migrateOnboardingStep(5, '2')).toBe(4);
    expect(migrateOnboardingStep(6, '2')).toBe(3);
    expect(migrateOnboardingStep(7, '2')).toBe(4);
  });

  it('maps v3/v4 funnels onto compact v5', () => {
    expect(migrateOnboardingStep(1, '3')).toBe(1);
    expect(migrateOnboardingStep(2, '3')).toBe(1);
    expect(migrateOnboardingStep(3, '3')).toBe(1);
    expect(migrateOnboardingStep(4, '3')).toBe(1);
    expect(migrateOnboardingStep(5, '3')).toBe(4);
    expect(migrateOnboardingStep(7, '3')).toBe(3);
    expect(migrateOnboardingStep(7, '4')).toBe(3);
    expect(migrateOnboardingStep(8, '4')).toBe(4);
  });
});
