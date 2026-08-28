import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  assertBuyerCanCheckout,
  checkoutErrorMessage,
  BUYER_SOCIETY_REQUIRED_MSG,
  BUYER_DELIVERY_LOCATION_MSG,
  DELIVERY_ADDRESS_REQUIRED_MSG,
} from '@/lib/checkout-guards';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('checkout guards', () => {
  const migration = read('supabase/migrations/20260829160000_checkout_society_location_guards.sql');
  const cartHook = read('src/hooks/useCartPage.ts');

  it('blocks buyers without a linked society', () => {
    expect(
      assertBuyerCanCheckout({
        profileSocietyId: null,
        fulfillmentType: 'self_pickup',
        hasDeliveryAddress: false,
        hasPreciseDeliveryCoords: false,
      }),
    ).toBe(BUYER_SOCIETY_REQUIRED_MSG);
  });

  it('allows pickup when buyer has society and skips delivery coords', () => {
    expect(
      assertBuyerCanCheckout({
        profileSocietyId: 'soc-1',
        fulfillmentType: 'self_pickup',
        hasDeliveryAddress: false,
        hasPreciseDeliveryCoords: false,
      }),
    ).toBeNull();
  });

  it('requires delivery address and coords for delivery', () => {
    expect(
      assertBuyerCanCheckout({
        profileSocietyId: 'soc-1',
        fulfillmentType: 'delivery',
        hasDeliveryAddress: false,
        hasPreciseDeliveryCoords: false,
      }),
    ).toBe(DELIVERY_ADDRESS_REQUIRED_MSG);

    expect(
      assertBuyerCanCheckout({
        profileSocietyId: 'soc-1',
        fulfillmentType: 'delivery',
        hasDeliveryAddress: true,
        hasPreciseDeliveryCoords: false,
      }),
    ).toBe(BUYER_DELIVERY_LOCATION_MSG);
  });

  it('maps server error codes to user-facing copy', () => {
    expect(checkoutErrorMessage('buyer_society_required')).toBe(BUYER_SOCIETY_REQUIRED_MSG);
    expect(checkoutErrorMessage('seller_society_required', 'Store X')).toBe('Store X');
    expect(checkoutErrorMessage('seller_location_required')).toMatch(/no location/i);
  });

  it('migration adds society and location guards to create_multi_vendor_orders', () => {
    expect(migration).toMatch(/seller_has_resolvable_location/);
    expect(migration).toMatch(/buyer_society_required/);
    expect(migration).toMatch(/seller_society_required/);
    expect(migration).toMatch(/seller_location_required/);
    expect(migration).toMatch(/FUNCTION public\.create_multi_vendor_orders/);
  });

  it('cart page uses client guards and server error mapping', () => {
    expect(cartHook).toMatch(/assertBuyerCanCheckout/);
    expect(cartHook).toMatch(/checkoutErrorMessage/);
    expect(cartHook).toMatch(/buyer_society_required/);
    expect(cartHook).toMatch(/seller_location_required/);
  });
});
