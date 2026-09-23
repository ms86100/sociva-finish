import { describe, expect, it } from 'vitest';
import { resolveCardTrustSignal } from '@/components/product/StockLeftBattery';

describe('resolveCardTrustSignal', () => {
  it('prefers stock battery over inactive scare copy', () => {
    expect(resolveCardTrustSignal({
      stockQuantity: 4,
      lastActiveAt: '2020-01-01T00:00:00Z',
      activityLabel: 'Active 2 years ago',
    })).toEqual({ kind: 'stock', quantity: 4 });
  });

  it('uses prep time when stock unknown', () => {
    expect(resolveCardTrustSignal({
      prepMinutes: 25,
      lastActiveAt: '2020-01-01T00:00:00Z',
    })).toEqual({ kind: 'prep', minutes: 25 });
  });

  it('omits unresponsive messaging for stale sellers without stock/prep', () => {
    expect(resolveCardTrustSignal({
      lastActiveAt: '2020-01-01T00:00:00Z',
      activityLabel: 'Active 2 years ago',
    })).toBeNull();
  });

  it('keeps soft recent activity label', () => {
    const recent = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(resolveCardTrustSignal({
      lastActiveAt: recent,
      activityLabel: 'Active 2 hours ago',
    })).toEqual({ kind: 'active', label: 'Active 2 hours ago' });
  });
});
