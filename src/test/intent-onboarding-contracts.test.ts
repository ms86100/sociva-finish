import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  migrateOnboardingStep,
  NEW_ONBOARDING_TOTAL_STEPS,
  resolveListingIntent,
  commerceModelToDefaultAction,
} from '@/lib/listing-intent';
import { BUYER_JOURNEYS } from '@/lib/buyer-journey';
import { normalizeServiceLocationTypes, primaryServiceLocationType } from '@/lib/service-location';

const root = process.cwd();

function readSrc(rel: string) {
  return readFileSync(join(root, rel), 'utf8');
}

describe('category-first onboarding contracts', () => {
  it('BecomeSeller uses 8-step group → category → commerce → offering order', () => {
    const src = readSrc('src/pages/BecomeSellerPage.tsx');
    expect(src).toContain('NEW_ONBOARDING_TOTAL_STEPS');
    expect(src).toContain('ParentGroupPickerStep');
    expect(src).toContain('GuidedStep2');
    expect(src).toContain('CommerceModelStep');
    expect(src).toContain('ProductOfferingStep');
    expect(src).toMatch(/step === 1[\s\S]*ParentGroupPickerStep/);
    expect(src).toMatch(/step === 2[\s\S]*GuidedStep2/);
    expect(src).toMatch(/step === 3[\s\S]*CommerceModelStep/);
    expect(src).toMatch(/step === 4[\s\S]*ProductOfferingStep/);
    expect(src).toMatch(/step === 7[\s\S]*DraftProductManager/);
    expect(src).toMatch(/step === 8/);
    expect(src).not.toMatch(/configSubStep === 1[\s\S]*key="interaction"/);
  });

  it('existing-store confirmation does not claim the store is fully live when a category is under review', () => {
    const src = readSrc('src/pages/BecomeSellerPage.tsx');
    expect(src).toContain('Store setup complete');
    expect(src).toContain('still under review');
    expect(src).toContain('flex flex-col gap-4');
    expect(src).not.toContain('Store Approved! 🎉');
    expect(src).not.toContain('is live. Go to your seller dashboard to manage it.');
  });

  it('CategorySearchPicker auto-commits subcategory via shared resolver', () => {
    const src = readSrc('src/components/seller/CategorySearchPicker.tsx');
    expect(src).toContain('findBestSubcategoryMatch');
    expect(src).toContain('CATEGORY_ALIAS_MAP');
    expect(src).toContain('setSearch(\'\')');
  });

  it('SubcategoryPickerDialog clears stuck search and offers Other', () => {
    const src = readSrc('src/components/seller/SubcategoryPickerDialog.tsx');
    expect(src).toContain('findBestSubcategoryMatch');
    expect(src).toContain('Continue as Other');
    expect(src).toContain('Detected:');
  });

  it('draft hook persists intent fields and migrates steps', () => {
    const src = readSrc('src/hooks/useSellerApplication.ts');
    expect(src).toContain('listing_intent_phrase');
    expect(src).toContain('commerce_model');
    expect(src).toContain('seed_product_name');
    expect(src).toContain('migrateOnboardingStep');
    expect(src).toContain('setStep(6)');
    expect(src).toContain('setStep(7)');
    expect(src).toContain("ONBOARDING_VERSION = '3'");
  });

  it('DraftProductManager accepts seedProductName', () => {
    const src = readSrc('src/components/seller/DraftProductManager.tsx');
    expect(src).toContain('seedProductName');
  });

  it('commerce models map 1:1 to buyer journeys / default_action_type', () => {
    for (const j of BUYER_JOURNEYS) {
      expect(commerceModelToDefaultAction(j.id)).toBe(j.default_action_type);
    }
    expect(NEW_ONBOARDING_TOTAL_STEPS).toBe(8);
    expect(migrateOnboardingStep(7, '2')).toBe(8);
    expect(migrateOnboardingStep(3, '2')).toBe(2);
  });

  it('T-shirt intent never hard-fails without category suggestion path', () => {
    const r = resolveListingIntent({
      phrase: 'T-shirt',
      categories: [{
        slug: 'clothing',
        id: 'c1',
        displayName: 'Clothing',
        parentGroup: 'marketplace',
        transactionType: 'cart_purchase',
        supportsCart: true,
      }],
      subcategories: [{
        id: 's1',
        slug: 't_shirts',
        displayName: 'T-Shirts',
        categoryConfigId: 'c1',
        categorySlug: 'clothing',
      }],
    });
    expect(r.suggestedCategorySlug).toBe('clothing');
    expect(r.suggestedSubcategoryId).toBe('s1');
    expect(r.commerceModel).toBe('cart');
  });

  it('service location helpers normalize arrays and primary type', () => {
    expect(normalizeServiceLocationTypes({ location_types: ['online', 'home_visit'] })).toEqual(['online', 'home_visit']);
    expect(normalizeServiceLocationTypes({ location_type: 'at_store' })).toEqual(['at_store']);
    expect(primaryServiceLocationType(['online', 'home_visit'])).toBe('online');
  });

  it('ServiceFieldsSection supports multi-select locations', () => {
    const src = readSrc('src/components/seller/ServiceFieldsSection.tsx');
    expect(src).toContain('location_types');
    expect(src).toContain('SERVICE_LOCATION_OPTIONS');
  });

  it('ServiceBookingFlow lets buyers pick among multiple service locations', () => {
    const src = readSrc('src/components/booking/ServiceBookingFlow.tsx');
    expect(src).toContain('location_types');
    expect(src).toContain('allowedLocationTypes');
    expect(src).toContain('Where should this happen?');
  });
});

/**
 * Manual QA checklist (category-first seller onboarding)
 *
 * [ ] Fresh start: Food group → Meals → Cart → "Chicken biryani" → store → product name seeded
 * [ ] Resume mid-draft after refresh: step + categories + commerce model restored
 * [ ] Request category from step 2; pending banner still shows
 * [ ] Multi service location: seller selects Online + Home visit; buyer picks at booking
 * [ ] Post-approval product add: buyer CTA still from store default_action_type
 */
describe('manual QA checklist documented', () => {
  it('keeps checklist in this file for release QA', () => {
    expect(true).toBe(true);
  });
});
