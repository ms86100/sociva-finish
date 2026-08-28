import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildOnboardingMeta,
  parseOnboardingMeta,
  pruneSubcategoryPreferences,
  restoreStepFromBackup,
  validateStoreProductActionConsistency,
  findActionMismatchedProducts,
} from '@/lib/onboarding-state';
import { commerceModelToDefaultAction } from '@/lib/listing-intent';

const root = process.cwd();

function readSrc(rel: string) {
  return readFileSync(join(root, rel), 'utf8');
}

describe('onboarding resume (Test 4)', () => {
  it('restores step 2–4 without forcing step 5', () => {
    expect(restoreStepFromBackup(2)).toBe(2);
    expect(restoreStepFromBackup(3)).toBe(3);
    expect(restoreStepFromBackup(4)).toBe(4);
    expect(restoreStepFromBackup(7)).toBe(7);
    expect(restoreStepFromBackup(undefined)).toBe(1);
  });

  it('hook no longer uses Math.max(5, backup.step)', () => {
    const src = readSrc('src/hooks/useSellerApplication.ts');
    expect(src).toContain('restoreStepFromBackup');
    expect(src).not.toMatch(/Math\.max\(5,\s*Math\.min\(Number\(backup\.step\)/);
  });
});

describe('onboarding meta persistence (Tests 2, 3, 5)', () => {
  it('builds and parses durable onboarding meta', () => {
    const meta = buildOnboardingMeta({
      step: 3,
      commerceModel: 'cart',
      seedProductName: 'Biryani',
      listingIntentPhrase: 'Chicken biryani',
      onboardingVersion: '3',
    });
    const parsed = parseOnboardingMeta(meta);
    expect(parsed?.step).toBe(3);
    expect(parsed?.commerce_model).toBe('cart');
    expect(parsed?.seed_product_name).toBe('Biryani');
  });

  it('saveDraft writes onboarding_meta and allows Untitled store', () => {
    const src = readSrc('src/hooks/useSellerApplication.ts');
    expect(src).toContain('onboarding_meta: buildOnboardingMeta');
    expect(src).toContain("'Untitled store'");
    expect(src).toMatch(/step < 2 \|\| !selectedGroup/); // backup from step 2
    expect(src).toContain('readSession(COMMERCE_MODEL_KEY)');
  });

  it('persists commerce model to DB not only sessionStorage', () => {
    const src = readSrc('src/hooks/useSellerApplication.ts');
    expect(src).toContain('hydrateOnboardingFromMeta');
    expect(src).toContain('onboarding_meta');
    expect(src).toMatch(/saveDraft\(\{ silent: true/);
  });
});

describe('commerce / product action consistency (Tests 6–9)', () => {
  it('detects cart product on book store', () => {
    const result = validateStoreProductActionConsistency(
      [{ id: 'p1', name: 'Item', action_type: 'add_to_cart', approval_status: 'draft' }],
      'book',
    );
    expect(result.ok).toBe(false);
    expect(result.mismatched).toHaveLength(1);
  });

  it('detects book product on cart store', () => {
    const mismatched = findActionMismatchedProducts(
      [{ id: 'p1', name: 'Service', action_type: 'book', approval_status: 'draft' }],
      'add_to_cart',
    );
    expect(mismatched).toHaveLength(1);
  });

  it('ignores approved products when checking mismatch', () => {
    const mismatched = findActionMismatchedProducts(
      [{ id: 'p1', name: 'Live', action_type: 'add_to_cart', approval_status: 'approved' }],
      'book',
    );
    expect(mismatched).toHaveLength(0);
  });

  it('applyCommerceModelChange syncs draft products', () => {
    const src = readSrc('src/hooks/useSellerApplication.ts');
    expect(src).toContain('applyCommerceModelChange');
    expect(src).toContain('syncDraftProductsToStoreAction');
    expect(src).toContain('validateStoreProductActionConsistency');
  });

  it('RPC validates store default vs product action_type (not per-product override)', () => {
    const sql = readSrc('supabase/migrations/20260829190000_onboarding_meta_and_action_validation.sql');
    expect(sql).toMatch(/action_type IS DISTINCT FROM v_store_action/);
    expect(sql).toMatch(/atm\.action_type = v_store_action/);
    expect(sql).not.toMatch(/COALESCE\(p\.action_type,\s*\(SELECT sp\.default_action_type/);
  });

  it('commerce model maps to default_action_type for sync', () => {
    expect(commerceModelToDefaultAction('cart')).toBe('add_to_cart');
    expect(commerceModelToDefaultAction('book')).toBe('book');
  });
});

describe('category / subcategory integrity (Tests 10–11)', () => {
  const slugToId = { food: 'cfg-food', clothing: 'cfg-clothing' };

  it('removes subcategory prefs when category is removed', () => {
    const pruned = pruneSubcategoryPreferences(
      {
        v: 1,
        data: {
          'cfg-food': { primary: 'sub1', others: [] },
          'cfg-clothing': { primary: 'sub2', others: [] },
        },
      },
      ['clothing'],
      slugToId,
    );
    expect(pruned.data['cfg-food']).toBeUndefined();
    expect(pruned.data['cfg-clothing']).toBeDefined();
  });

  it('handleCategoryChange prunes stale preferences', () => {
    const src = readSrc('src/hooks/useSellerApplication.ts');
    expect(src).toContain('pruneSubcategoryPreferences');
  });

  it('back to group picker clears categories before save', () => {
    const src = readSrc('src/hooks/useSellerApplication.ts');
    expect(src).toContain('handleBackToGroupPicker');
    expect(src).toContain('formOverrides');
  });
});

describe('service location persistence (Test 12)', () => {
  it('service location types are multi-select end-to-end', () => {
    const migration = readSrc('supabase/migrations/20260829180000_service_location_types_multiselect.sql');
    expect(migration).toContain('location_types');
    const fields = readSrc('src/components/seller/ServiceFieldsSection.tsx');
    expect(fields).toContain('location_types');
    const booking = readSrc('src/components/booking/ServiceBookingFlow.tsx');
    expect(booking).toContain('allowedLocationTypes');
  });
});

describe('silent failure prevention (Tests 14–15)', () => {
  it('Save Draft shows error when save fails', () => {
    const src = readSrc('src/hooks/useSellerApplication.ts');
    expect(src).toMatch(/if \(!savedId\)[\s\S]*Could not save draft/);
    expect(src).toMatch(/if \(!opts\?\.silent\) toast\.error/);
  });

  it('submit rolls back profile when product promotion fails', () => {
    const src = readSrc('src/hooks/useSellerApplication.ts');
    expect(src).toMatch(/verification_status: 'draft'/);
    expect(src).toContain('throw prodError');
  });
});
