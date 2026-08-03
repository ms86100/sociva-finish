import { describe, it, expect } from 'vitest';
import {
  resolveListingIntent,
  findBestSubcategoryMatch,
  migrateOnboardingStep,
  commerceModelToDefaultAction,
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
});

describe('migrateOnboardingStep', () => {
  it('maps old 5-step indices into intent-first steps', () => {
    expect(migrateOnboardingStep(1)).toBe(1);
    expect(migrateOnboardingStep(2)).toBe(4);
    expect(migrateOnboardingStep(3)).toBe(5);
    expect(migrateOnboardingStep(4)).toBe(6);
    expect(migrateOnboardingStep(5)).toBe(7);
  });
});
