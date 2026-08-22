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

const root = process.cwd();

function readSrc(rel: string) {
  return readFileSync(join(root, rel), 'utf8');
}

describe('intent-first onboarding contracts', () => {
  it('BecomeSeller uses 7-step intent → model → taxonomy order', () => {
    const src = readSrc('src/pages/BecomeSellerPage.tsx');
    expect(src).toContain('NEW_ONBOARDING_TOTAL_STEPS');
    expect(src).toContain('ListingIntentStep');
    expect(src).toContain('CommerceModelStep');
    expect(src).toContain('TaxonomySuggestCard');
    expect(src).toMatch(/step === 1[\s\S]*ListingIntentStep/);
    expect(src).toMatch(/step === 2[\s\S]*CommerceModelStep/);
    expect(src).toMatch(/step === 3[\s\S]*TaxonomySuggestCard/);
    expect(src).toMatch(/step === 6[\s\S]*DraftProductManager/);
    expect(src).toMatch(/step === 7/);
    // Interaction tiles moved out of configure
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
    expect(src).toContain('setStep(5)');
    expect(src).toContain('setStep(6)');
  });

  it('DraftProductManager accepts seedProductName', () => {
    const src = readSrc('src/components/seller/DraftProductManager.tsx');
    expect(src).toContain('seedProductName');
  });

  it('commerce models map 1:1 to buyer journeys / default_action_type', () => {
    for (const j of BUYER_JOURNEYS) {
      expect(commerceModelToDefaultAction(j.id)).toBe(j.default_action_type);
    }
    expect(NEW_ONBOARDING_TOTAL_STEPS).toBe(7);
    expect(migrateOnboardingStep(5)).toBe(7);
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
});

/**
 * Manual QA checklist (intent-first seller onboarding)
 *
 * [ ] Fresh start: "T-shirts" → Cart → Clothing/T-Shirts suggested → confirm → store → products name seeded
 * [ ] Resume mid-draft after refresh: step + intent phrase + commerce model restored
 * [ ] Unknown phrase: enquire default + browse/request path; never stuck empty picker
 * [ ] Request category from suggest step; pending banner still shows
 * [ ] Multi-category change via browse on step 3 still continues
 * [ ] Post-approval product add: buyer CTA still from store default_action_type
 * [ ] Cart / Book / Enquire / Contact checkout modes unchanged for buyers
 */
describe('manual QA checklist documented', () => {
  it('keeps checklist in this file for release QA', () => {
    expect(true).toBe(true);
  });
});
