import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');

describe('checkout partial multi-seller block', () => {
  it('migration blocks partial checkout and rolls back created orders', () => {
    const sql = read('../../supabase/migrations/20260828280000_checkout_partial_block_and_onboarding_service_gate.sql');
    expect(sql).toMatch(/partial_checkout_blocked/);
    expect(sql).toMatch(/delete from public\.orders where id = any\(_order_ids\)/);
    expect(sql).toMatch(/_created_count < _total_groups/);
  });

  it('useCartPage surfaces partial_checkout_blocked as blocking error', () => {
    const src = read('../hooks/useCartPage.ts');
    expect(src).toMatch(/partial_checkout_blocked/);
    expect(src).not.toMatch(/warnings\?\.credit_blocked_sellers/);
  });
});

describe('onboarding service listing gate', () => {
  it('migration adds validate_seller_service_products_ready RPC', () => {
    const sql = read('../../supabase/migrations/20260828280000_checkout_partial_block_and_onboarding_service_gate.sql');
    expect(sql).toMatch(/validate_seller_service_products_ready/);
    expect(sql).toMatch(/requires_availability/);
  });

  it('useSellerApplication resolves action type from profile and calls server validator', () => {
    const src = read('../hooks/useSellerApplication.ts');
    expect(src).toMatch(/resolveOnboardingStoreActionType/);
    expect(src).toMatch(/validate_seller_service_products_ready/);
    expect(src).toMatch(/storeActionRequiresAvailability/);
    expect(src).not.toMatch(/if \(!storeActionType\) return true/);
  });
});
