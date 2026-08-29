import { describe, expect, it } from 'vitest';
import { orderPaymentChipLabel, paymentMethodName } from '@/lib/payment-method-label';

describe('orderPaymentChipLabel', () => {
  it('never shows a checkmark for unpaid UPI', () => {
    expect(orderPaymentChipLabel('upi', 'pending')).toBe('UPI · Waiting');
    expect(orderPaymentChipLabel('upi', null)).toBe('UPI · Waiting');
    expect(orderPaymentChipLabel('card', 'created')).toBe('Online · Waiting');
  });

  it('reserves paid language for captured money', () => {
    expect(orderPaymentChipLabel('upi', 'paid')).toBe('UPI · Paid');
    expect(orderPaymentChipLabel('card', 'captured')).toBe('Online · Paid');
    expect(orderPaymentChipLabel('cod', 'paid')).toBe('Cash · Paid');
  });

  it('does not invent a generic Payment label', () => {
    expect(orderPaymentChipLabel(null, 'paid')).toBeNull();
    expect(paymentMethodName(undefined)).toBeNull();
  });
});
