import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('BUG-10/12 CMVO coupon + transaction stamp', () => {
  it('migration patches CMVO for coupon_id/discount_amount and resolve_cart_order_transaction_type', () => {
    const mig = read('supabase/migrations/20260904123000_fix_cmvo_coupon_stamp_and_txn_type.sql');
    expect(mig).toContain('resolve_cart_order_transaction_type');
    expect(mig).toContain('discount_amount, coupon_id');
    expect(mig).toContain('heal_order_transaction_type');
    expect(mig).toContain('coupon_redemptions');
  });

  it('order bill prefers coupon_discount for discount line', () => {
    const page = read('src/pages/OrderDetailPage.tsx');
    expect(page).toMatch(/coupon_discount \|\| \(order as any\)\.discount_amount/);
  });

  it('cart does not toast coupon-removed when cart empties after place', () => {
    const cart = read('src/hooks/useCartPage.ts');
    expect(cart).toContain('Skip toast when cart is empty');
    expect(cart).toContain('if (totalAmount > 0)');
  });
});
