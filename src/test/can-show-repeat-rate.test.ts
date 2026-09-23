import { describe, expect, it } from 'vitest';
import { canShowRepeatRate } from '@/hooks/queries/useProductTrustMetrics';

describe('canShowRepeatRate', () => {
  it('hides 100% when sample is a single repeat buyer', () => {
    expect(
      canShowRepeatRate({
        unique_customers: 1,
        completed_orders: 2,
        repeat_customer_pct: 100,
      }),
    ).toBe(false);
  });

  it('hides when unique customers are below threshold', () => {
    expect(
      canShowRepeatRate({
        unique_customers: 4,
        completed_orders: 10,
        repeat_customer_pct: 50,
      }),
    ).toBe(false);
  });

  it('shows when unique customers and completed orders meet minimums', () => {
    expect(
      canShowRepeatRate({
        unique_customers: 5,
        completed_orders: 5,
        repeat_customer_pct: 60,
      }),
    ).toBe(true);
  });

  it('hides zero or missing rates even with large samples', () => {
    expect(
      canShowRepeatRate({
        unique_customers: 20,
        completed_orders: 40,
        repeat_customer_pct: 0,
      }),
    ).toBe(false);
    expect(canShowRepeatRate(null)).toBe(false);
  });
});
