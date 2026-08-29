import { describe, it, expect } from 'vitest';
import {
  detectWorkflowConflict,
  mapOfferingName,
  normalizeOfferingNames,
  pickFallbackCategory,
  resolveOfferingBatch,
} from '@/lib/offering-taxonomy';
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
    slug: 'other-food_beverages',
    id: 'cfg-other-food',
    displayName: 'Other Food',
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
    slug: 'plumber',
    id: 'cfg-plumber',
    displayName: 'Plumber',
    parentGroup: 'home_services',
    transactionType: 'request_service',
    supportsCart: false,
  },
  {
    slug: 'tuition',
    id: 'cfg-tuition',
    displayName: 'Tuition',
    parentGroup: 'education_learning',
    transactionType: 'service_booking',
    requiresTimeSlot: true,
    supportsCart: false,
  },
  {
    slug: 'tax_consultant',
    id: 'cfg-tax',
    displayName: 'Tax Consultant',
    parentGroup: 'professional',
    transactionType: 'request_service',
    enquiryOnly: true,
    supportsCart: false,
  },
  {
    slug: 'ayurveda',
    id: 'cfg-ayurveda',
    displayName: 'Ayurveda',
    parentGroup: 'health',
    transactionType: 'service_booking',
    requiresTimeSlot: true,
    supportsCart: false,
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
    slug: 'medical_specialist',
    id: 'cfg-doctor',
    displayName: 'Medical Specialist',
    parentGroup: 'health',
    transactionType: 'service_booking',
    requiresTimeSlot: true,
    supportsCart: false,
  },
];

const subcategories: IntentCatalogSubcategory[] = [
  {
    id: 'sub-facial',
    slug: 'facial',
    displayName: 'Facial',
    categoryConfigId: 'cfg-beauty',
    categorySlug: 'beauty',
  },
  {
    id: 'sub-bridal',
    slug: 'bridal_makeup',
    displayName: 'Bridal Makeup',
    categoryConfigId: 'cfg-beauty',
    categorySlug: 'beauty',
  },
  {
    id: 'sub-cakes',
    slug: 'cakes',
    displayName: 'Cakes',
    categoryConfigId: 'cfg-bakery',
    categorySlug: 'bakery',
  },
];

describe('normalizeOfferingNames', () => {
  it('trims, title-cases, and de-dupes', () => {
    expect(normalizeOfferingNames([' rajma chawal ', 'Rajma Chawal', 'x'])).toEqual(['Rajma chawal']);
  });
});

describe('mapOfferingName', () => {
  it('maps Rajma Chawal onto Home Food, not a Lunch subcategory', () => {
    const mapped = mapOfferingName({ name: 'Rajma Chawal', categories, subcategories });
    expect(mapped.group).toBe('food_beverages');
    expect(mapped.categorySlug).toBe('home_food');
    expect(mapped.matchBand === 'strong' || mapped.matchBand === 'reasonable').toBe(true);
    expect(mapped.subcategoryName).not.toBe('Lunch');
  });

  it('maps Facial onto Beauty in Personal Care', () => {
    const mapped = mapOfferingName({ name: 'Facial', categories, subcategories });
    expect(mapped.group).toBe('personal_care');
    expect(mapped.categorySlug).toBe('beauty');
  });

  it('never dumps Ayurveda or doctor into Food', () => {
    const ayur = mapOfferingName({ name: 'Ayurveda', categories, subcategories });
    expect(ayur.group).toBe('health');
    expect(ayur.categorySlug).not.toMatch(/food/);

    const doctor = mapOfferingName({ name: 'Doctor', categories, subcategories });
    expect(doctor.group).toBe('health');
    expect(doctor.categorySlug).toBe('medical_specialist');
  });
});

describe('resolveOfferingBatch', () => {
  it('stamps a confident same-group batch', () => {
    const batch = resolveOfferingBatch({
      names: ['Rajma Chawal', 'Chole'],
      commerceModel: 'cart',
      categories,
      subcategories,
      groupLabelBySlug: { food_beverages: 'Food & Beverages' },
    });
    expect(batch.status).toBe('ready');
    expect(batch.stamp?.primaryGroup).toBe('food_beverages');
    expect(batch.stamp?.categories).toContain('home_food');
    expect(batch.stamp?.stampLabel).toContain('Food & Beverages');
    expect(batch.workflowConflict).toBeNull();
  });

  it('keeps Rajma as Home Food and Cakes as Bakery in the same store stamp', () => {
    const batch = resolveOfferingBatch({
      names: ['Rajma Chawal', 'Cakes'],
      commerceModel: 'cart',
      categories,
      subcategories,
    });
    expect(batch.status).toBe('ready');
    expect(batch.stamp?.categories).toContain('home_food');
    expect(batch.stamp?.categories).toContain('bakery');
    const cakes = batch.offerings.find((o) => o.name === 'Cakes');
    expect(cakes?.subcategoryId).toBe('sub-cakes');
    const rajma = batch.offerings.find((o) => /rajma/i.test(o.name));
    expect(rajma?.subcategoryName).not.toBe('Rajma Chawal');
  });

  it('blocks two parent groups in one store', () => {
    const batch = resolveOfferingBatch({
      names: ['Rajma Chawal', 'Facial'],
      commerceModel: 'cart',
      categories,
      subcategories,
    });
    expect(batch.status).toBe('mixed_groups');
    expect(batch.groups.sort()).toEqual(['food_beverages', 'personal_care'].sort());
    expect(batch.stamp).toBeNull();
  });

  it('asks for a group pick when names are unknown', () => {
    const batch = resolveOfferingBatch({
      names: ['Xyzzy unknown widget'],
      categories,
      subcategories,
    });
    expect(batch.status).toBe('needs_group');
    expect(batch.offerings[0].group).toBeNull();
  });

  it('flags cart + beauty without silently overriding', () => {
    const batch = resolveOfferingBatch({
      names: ['Facial'],
      commerceModel: 'cart',
      categories,
      subcategories,
    });
    expect(batch.status).toBe('ready');
    expect(batch.workflowConflict).toMatchObject({
      chosen: 'cart',
      recommended: 'book',
      canKeepChosen: false,
      categorySlug: 'beauty',
    });
  });
});

describe('pickFallbackCategory', () => {
  it('uses real Home Food for Food & Beverages, never invents Lunch', () => {
    const cat = pickFallbackCategory('food_beverages', categories);
    expect(cat?.slug).toBe('home_food');
  });

  it('uses Beauty for Personal Care', () => {
    expect(pickFallbackCategory('personal_care', categories)?.slug).toBe('beauty');
  });

  it('uses health categories, never food, for Health', () => {
    const cat = pickFallbackCategory('health', categories);
    expect(cat?.parentGroup).toBe('health');
    expect(cat?.slug).not.toMatch(/food/);
  });
});

describe('detectWorkflowConflict', () => {
  it('does not allow keeping cart on a non-cart category', () => {
    const conflict = detectWorkflowConflict('cart', [{
      name: 'Facial',
      matchBand: 'strong',
      group: 'personal_care',
      categorySlug: 'beauty',
      categoryConfigId: 'cfg-beauty',
      categoryDisplayName: 'Beauty',
      subcategoryId: 'sub-facial',
      subcategoryName: 'Facial',
      supportsCart: false,
      recommendedModel: 'book',
    }], categories);
    expect(conflict?.canKeepChosen).toBe(false);
    expect(conflict?.recommended).toBe('book');
  });
});
