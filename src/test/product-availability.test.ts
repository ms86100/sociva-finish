import { describe, it, expect } from 'vitest';
import { resolveProductAvailability } from '@/lib/product-availability';

describe('resolveProductAvailability', () => {
  it('marks seller toggle-off as currently not available', () => {
    const result = resolveProductAvailability({ is_available: false, stock_quantity: 5 });
    expect(result.state).toBe('unavailable');
    expect(result.canOrder).toBe(false);
    expect(result.overlayLabel).toBe('Currently not available');
  });

  it('marks zero stock as out of stock when available toggle is on', () => {
    const result = resolveProductAvailability({ is_available: true, stock_quantity: 0 });
    expect(result.state).toBe('out_of_stock');
    expect(result.overlayLabel).toBe('Out of stock');
  });

  it('allows ordering when available and stock is positive', () => {
    const result = resolveProductAvailability({ is_available: true, stock_quantity: 5 });
    expect(result.state).toBe('available');
    expect(result.canOrder).toBe(true);
  });

  it('allows ordering when stock is not tracked', () => {
    const result = resolveProductAvailability({ is_available: true, stock_quantity: null });
    expect(result.state).toBe('available');
    expect(result.canOrder).toBe(true);
  });
});
