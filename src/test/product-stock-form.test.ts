import { describe, it, expect } from 'vitest';
import { resolveStockSaveValues } from '@/lib/product-stock-form';

describe('resolveStockSaveValues', () => {
  it('keeps toggles independent — empty stock with tracking on is a validation error, not disabled', () => {
    const result = resolveStockSaveValues({
      tracks_stock: true,
      stock_quantity: '',
      tracks_low_stock_alert: false,
      low_stock_threshold: '',
    });
    expect(result.errors.stock_quantity).toBe('Please enter a stock quantity.');
    expect(result.stockQty).toBeNull();
  });

  it('parses valid stock when tracking is on', () => {
    const result = resolveStockSaveValues({
      tracks_stock: true,
      stock_quantity: '25',
      tracks_low_stock_alert: false,
      low_stock_threshold: '',
    });
    expect(result.errors).toEqual({});
    expect(result.stockQty).toBe(25);
    expect(result.lowStockThreshold).toBeNull();
  });

  it('allows zero stock when tracking is on', () => {
    const result = resolveStockSaveValues({
      tracks_stock: true,
      stock_quantity: '0',
      tracks_low_stock_alert: false,
      low_stock_threshold: '',
    });
    expect(result.errors).toEqual({});
    expect(result.stockQty).toBe(0);
  });

  it('requires low stock threshold only when low stock alert toggle is on', () => {
    const empty = resolveStockSaveValues({
      tracks_stock: true,
      stock_quantity: '10',
      tracks_low_stock_alert: true,
      low_stock_threshold: '',
    });
    expect(empty.errors.low_stock_threshold).toBe('Please enter a low stock alert level.');

    const off = resolveStockSaveValues({
      tracks_stock: true,
      stock_quantity: '10',
      tracks_low_stock_alert: false,
      low_stock_threshold: '',
    });
    expect(off.errors).toEqual({});
    expect(off.lowStockThreshold).toBeNull();
  });

  it('rejects low stock threshold greater than or equal to current stock', () => {
    const result = resolveStockSaveValues({
      tracks_stock: true,
      stock_quantity: '10',
      tracks_low_stock_alert: true,
      low_stock_threshold: '10',
    });
    expect(result.errors.low_stock_threshold).toBe('Low stock alert must be less than current stock.');
  });

  it('ignores stock fields when tracking is off', () => {
    const result = resolveStockSaveValues({
      tracks_stock: false,
      stock_quantity: '',
      tracks_low_stock_alert: false,
      low_stock_threshold: '',
    });
    expect(result.errors).toEqual({});
    expect(result.stockQty).toBeNull();
    expect(result.lowStockThreshold).toBeNull();
  });
});
