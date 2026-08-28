import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('seller refund dispute access', () => {
  const migration = read('supabase/migrations/20260828210000_seller_refund_dispute_access_fix.sql');
  const refundList = read('src/components/seller/SellerRefundList.tsx');

  it('restores authenticated execute on is_seller_for_refund', () => {
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.is_seller_for_refund\(uuid\) TO authenticated/);
  });

  it('exposes seller-scoped list_seller_refund_requests RPC', () => {
    expect(migration).toMatch(/FUNCTION public\.list_seller_refund_requests/);
    expect(migration).toMatch(/seller scope forbidden/);
    expect(refundList).toMatch(/list_seller_refund_requests/);
  });
});
