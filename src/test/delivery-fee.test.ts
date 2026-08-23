import { describe, expect, it } from 'vitest';
import {
  parseSettingNumber,
  resolvePlatformDeliveryFee,
  settingValueToString,
} from '@/lib/delivery-fee';

describe('resolvePlatformDeliveryFee', () => {
  it('uses admin base fee below free-delivery threshold', () => {
    expect(
      resolvePlatformDeliveryFee({
        fulfillmentType: 'delivery',
        cartSubtotal: 100,
        baseDeliveryFee: 5,
        freeDeliveryThreshold: 500,
      }),
    ).toBe(5);
  });

  it('is free at or above threshold', () => {
    expect(
      resolvePlatformDeliveryFee({
        fulfillmentType: 'delivery',
        cartSubtotal: 500,
        baseDeliveryFee: 5,
        freeDeliveryThreshold: 500,
      }),
    ).toBe(0);
  });

  it('is zero for self_pickup', () => {
    expect(
      resolvePlatformDeliveryFee({
        fulfillmentType: 'self_pickup',
        cartSubtotal: 100,
        baseDeliveryFee: 5,
        freeDeliveryThreshold: 500,
      }),
    ).toBe(0);
  });
});

describe('setting value parsing', () => {
  it('unwraps jsonb-encoded numeric strings', () => {
    expect(settingValueToString('"5"')).toBe('5');
    expect(settingValueToString(5)).toBe('5');
    expect(parseSettingNumber('"5"', 20)).toBe(5);
    expect(parseSettingNumber('5', 20)).toBe(5);
  });
});
