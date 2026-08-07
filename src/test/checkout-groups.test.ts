import { describe, expect, it } from 'vitest';
import {
  buyerStoreStatusLabel,
  checkoutKeyPrefix,
  groupBuyerOrdersForList,
  groupSummaryLabel,
  postCheckoutPath,
  sumOrderAmounts,
  type CheckoutChildOrder,
} from '@/lib/checkout-groups';

function order(partial: Partial<CheckoutChildOrder> & { id: string }): CheckoutChildOrder {
  return {
    created_at: partial.created_at || '2026-08-07T10:00:00Z',
    status: partial.status || 'placed',
    total_amount: partial.total_amount ?? 100,
    ...partial,
  };
}

describe('checkout-groups', () => {
  it('strips CMVO soft key suffix', () => {
    expect(checkoutKeyPrefix('user_123_abc:1')).toBe('user_123_abc');
    expect(checkoutKeyPrefix('user_123_abc:2')).toBe('user_123_abc');
    expect(checkoutKeyPrefix(null)).toBeNull();
    expect(checkoutKeyPrefix('nocolon')).toBeNull();
  });

  it('maps buyer store labels for mixed fulfillment', () => {
    expect(buyerStoreStatusLabel('placed')).toBe('Waiting for seller');
    expect(buyerStoreStatusLabel('accepted')).toBe('Accepted');
    expect(buyerStoreStatusLabel('rejected')).toBe('Rejected by store');
    expect(buyerStoreStatusLabel('cancelled', 'paid', { failureOwner: 'seller' })).toBe('Rejected by store');
    expect(buyerStoreStatusLabel('cancelled', 'paid', { failureOwner: 'buyer' })).toBe('Cancelled by you');
    expect(buyerStoreStatusLabel('payment_pending', 'pending')).toBe('Payment incomplete');
    expect(buyerStoreStatusLabel('cancelled', 'refund_initiated')).toBe('Refund in progress');
  });

  it('groups by checkout_group_id and collapses singles', () => {
    const rows = [
      order({ id: 'a', checkout_group_id: 'g1', created_at: '2026-08-07T12:00:00Z', status: 'accepted', total_amount: 200 }),
      order({ id: 'b', checkout_group_id: 'g1', created_at: '2026-08-07T12:01:00Z', status: 'placed', total_amount: 300 }),
      order({ id: 'c', checkout_group_id: 'g2', created_at: '2026-08-07T11:00:00Z', status: 'delivered', total_amount: 50 }),
    ];
    const items = groupBuyerOrdersForList(rows);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'group', groupId: 'g1' });
    if (items[0].kind === 'group') {
      expect(items[0].orders.map((o) => o.id)).toEqual(['a', 'b']);
      expect(sumOrderAmounts(items[0].orders)).toBe(500);
      expect(groupSummaryLabel(items[0].orders)).toContain('2 stores');
    }
    expect(items[1]).toMatchObject({ kind: 'single', order: { id: 'c' } });
  });

  it('falls back to soft idempotency prefix when group id missing', () => {
    const rows = [
      order({ id: 'x', idempotency_key: 'k:1', created_at: '2026-08-07T09:00:00Z', status: 'placed' }),
      order({ id: 'y', idempotency_key: 'k:2', created_at: '2026-08-07T09:01:00Z', status: 'cancelled' }),
    ];
    const items = groupBuyerOrdersForList(rows);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('group');
    if (items[0].kind === 'group') {
      expect(items[0].groupId).toBe('soft:k');
      expect(items[0].orders).toHaveLength(2);
    }
  });

  it('routes multi-store checkout to group detail when group id known', () => {
    expect(postCheckoutPath(['a', 'b'], 'g1').path).toBe('/checkouts/g1');
    expect(postCheckoutPath(['a'], 'g1').path).toBe('/orders/a');
    expect(postCheckoutPath(['a', 'b'], null).path).toBe('/orders/a');
  });
});
