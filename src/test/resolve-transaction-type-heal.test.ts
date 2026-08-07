import { describe, it, expect } from 'vitest';
import {
  resolveTransactionType,
  healOrderTransactionType,
  resolveCartOrderTransactionType,
} from '@/lib/resolveTransactionType';

describe('resolveTransactionType heal', () => {
  it('heals cart_purchase + seller delivery → seller_delivery', () => {
    expect(
      healOrderTransactionType('cart_purchase', 'delivery', 'seller'),
    ).toBe('seller_delivery');
    expect(
      resolveTransactionType('food_beverages', 'purchase', 'delivery', 'seller', null, 'cart_purchase'),
    ).toBe('seller_delivery');
  });

  it('heals cart_purchase + self_pickup → self_fulfillment', () => {
    expect(
      healOrderTransactionType('cart_purchase', 'self_pickup', 'seller'),
    ).toBe('self_fulfillment');
    expect(
      resolveTransactionType('default', 'purchase', 'self_pickup', null, null, 'cart_purchase'),
    ).toBe('self_fulfillment');
  });

  it('keeps platform cart_purchase', () => {
    expect(
      healOrderTransactionType('cart_purchase', 'delivery', 'platform'),
    ).toBe('cart_purchase');
    expect(
      resolveTransactionType('default', 'purchase', 'delivery', 'platform', null, 'cart_purchase'),
    ).toBe('cart_purchase');
  });

  it('stamps new cart orders by fulfillment', () => {
    expect(resolveCartOrderTransactionType('delivery', 'seller')).toBe('seller_delivery');
    expect(resolveCartOrderTransactionType('delivery', 'platform')).toBe('cart_purchase');
    expect(resolveCartOrderTransactionType('self_pickup', null)).toBe('self_fulfillment');
  });
});
