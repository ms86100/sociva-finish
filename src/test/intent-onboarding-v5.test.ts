import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  migrateOnboardingStep,
  NEW_ONBOARDING_TOTAL_STEPS,
  commerceModelToDefaultAction,
} from '@/lib/listing-intent';
import { BUYER_JOURNEYS } from '@/lib/buyer-journey';
import {
  inferSellerDomain,
  commerceModelFromCategory,
  domainFormFlags,
  offeringCopy,
} from '@/lib/seller-domain';
import { normalizeTaxonomyKey, taxonomyKeysLikelyDuplicate } from '@/lib/taxonomy-normalize';
import { computeStoreCompletion } from '@/lib/store-completion';

const root = process.cwd();
function readSrc(rel: string) {
  return readFileSync(join(root, rel), 'utf8');
}

describe('v5 intent-first onboarding contracts', () => {
  it('BecomeSeller uses 4-step intent → subcategory → listing → store name', () => {
    const src = readSrc('src/pages/BecomeSellerPage.tsx');
    expect(src).toContain('NEW_ONBOARDING_TOTAL_STEPS');
    expect(src).toContain('IntentCategoryStep');
    expect(src).toContain('SubcategorySelectStep');
    expect(src).toMatch(/step === 1[\s\S]*IntentCategoryStep/);
    expect(src).toMatch(/step === 2[\s\S]*SubcategorySelectStep/);
    expect(src).toMatch(/step === 3[\s\S]*DraftProductManager/);
    expect(src).toMatch(/step === 4[\s\S]*business_name/);
    expect(src).toContain('Go to Seller Dashboard');
    expect(src).not.toMatch(/step === 1[\s\S]*CommerceModelStep/);
  });

  it('draft hook uses onboarding version 5 and 4 steps', () => {
    const src = readSrc('src/hooks/useSellerApplication.ts');
    expect(src).toContain("ONBOARDING_VERSION = '5'");
    expect(src).toContain('resolveDefaultStoreLocation');
    expect(NEW_ONBOARDING_TOTAL_STEPS).toBe(4);
  });

  it('migrates v4 steps into the compact v5 funnel', () => {
    expect(migrateOnboardingStep(1, '4')).toBe(1);
    expect(migrateOnboardingStep(2, '4')).toBe(1);
    expect(migrateOnboardingStep(7, '4')).toBe(3);
    expect(migrateOnboardingStep(8, '4')).toBe(4);
    expect(migrateOnboardingStep(2, '5')).toBe(2);
  });

  it('commerce models still map 1:1 to buyer journeys', () => {
    for (const j of BUYER_JOURNEYS) {
      expect(commerceModelToDefaultAction(j.id)).toBe(j.default_action_type);
    }
  });
});

describe('seller domain isolation', () => {
  it('infers product / service / listing from category flags', () => {
    expect(inferSellerDomain({
      parentGroup: 'food_beverages',
      category: 'home_food',
      supportsCart: true,
      defaultActionType: 'add_to_cart',
    })).toBe('product');

    expect(inferSellerDomain({
      parentGroup: 'education_learning',
      category: 'tuition',
      requiresTimeSlot: true,
      defaultActionType: 'book',
    })).toBe('service');

    expect(inferSellerDomain({
      parentGroup: 'property',
      category: 'flat_rent',
      enquiryOnly: true,
      defaultActionType: 'contact_seller',
    })).toBe('listing');

    expect(inferSellerDomain({
      parentGroup: 'pets',
      category: 'pet_food',
      supportsCart: true,
      defaultActionType: 'add_to_cart',
    })).toBe('product');

    expect(inferSellerDomain({
      parentGroup: 'pets',
      category: 'pet_grooming',
      requiresTimeSlot: true,
      defaultActionType: 'book',
    })).toBe('service');
  });

  it('domain form flags never mix product stock into listing/service', () => {
    expect(domainFormFlags('product').showStock).toBe(true);
    expect(domainFormFlags('product').showServiceFields).toBe(false);
    expect(domainFormFlags('service').showServiceFields).toBe(true);
    expect(domainFormFlags('service').showStock).toBe(false);
    expect(domainFormFlags('listing').showStock).toBe(false);
    expect(domainFormFlags('listing').showContactForPrice).toBe(true);
  });

  it('uses service and listing nouns instead of Product on the offering form', () => {
    expect(offeringCopy('service').save).toBe('Save service');
    expect(offeringCopy('service').imageLabel).toBe('Service photo');
    expect(offeringCopy('listing').save).toBe('Save listing');
    expect(offeringCopy('listing').imageLabel).toBe('Listing photo');
    expect(offeringCopy('product').save).toBe('Save product');
    const draft = readSrc('src/components/seller/DraftProductManager.tsx');
    expect(draft).toContain('offeringCopy');
    const preview = readSrc('src/components/seller/ProductFormPreview.tsx');
    expect(preview).toContain("sellerProfile?.verification_status === 'approved'");
  });

  it('commerce model follows category transaction/action', () => {
    expect(commerceModelFromCategory({
      transactionType: 'cart_purchase',
      defaultActionType: 'add_to_cart',
    })).toBe('cart');
    expect(commerceModelFromCategory({
      transactionType: 'service_booking',
      defaultActionType: 'book',
    })).toBe('book');
  });
});

describe('store completion percent', () => {
  it('is 86% when name, pin, and listing are done and profile photo is missing (no cart extras)', () => {
    const r = computeStoreCompletion({
      businessName: 'QA V5 Apple Kitchen',
      latitude: 37.42,
      longitude: -122.08,
      productCount: 1,
      profileImageUrl: null,
    });
    expect(r.percent).toBe(86);
    expect(r.missing.map((i) => i.key)).toEqual(['profile_image']);
  });

  it('reaches 100% when required items and profile photo are done for a cart store with UPI off', () => {
    const r = computeStoreCompletion({
      businessName: 'QA V5 Apple Kitchen',
      latitude: 37.42,
      longitude: -122.08,
      productCount: 1,
      profileImageUrl: 'https://example.com/p.jpg',
      fulfillmentMode: 'self_pickup',
      defaultActionType: 'add_to_cart',
      acceptsUpi: false,
    });
    expect(r.percent).toBe(100);
    expect(r.missing).toEqual([]);
  });
});

describe('taxonomy normalize + store completion', () => {
  it('normalizes homemade food variants', () => {
    expect(normalizeTaxonomyKey('Homemade Food')).toBe('homemade-food');
    expect(normalizeTaxonomyKey('Home Made Food')).toBe('home-made-food');
    expect(taxonomyKeysLikelyDuplicate('Homemade Food', 'homemade foods')).toBe(true);
  });

  it('computes store completion percentage', () => {
    const result = computeStoreCompletion({
      businessName: 'Raji Classes',
      latitude: 12.9,
      longitude: 77.6,
      productCount: 1,
      profileImageUrl: null,
      defaultActionType: 'book',
    });
    expect(result.percent).toBeGreaterThan(50);
    expect(result.missing.some((m) => m.key === 'profile_image')).toBe(true);
  });
});

describe('hybrid subcategory propose path exists', () => {
  it('exposes propose_subcategory client helper and UI', () => {
    expect(readSrc('src/lib/propose-subcategory.ts')).toContain('propose_subcategory');
    expect(readSrc('src/components/seller/SubcategorySelectStep.tsx')).toContain('proposeOrReuseSubcategory');
    expect(readSrc('supabase/migrations/20260903164631_seller_domain_and_propose_subcategory.sql')).toContain('propose_subcategory');
  });
});
