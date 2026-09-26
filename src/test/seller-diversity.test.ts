import { describe, expect, it } from 'vitest';
import {
  diversifyRankedProducts,
  newSellerBaseBoost,
  shouldDiversifySort,
} from '@/lib/sellerDiversity';

function block(sellerId: string, count: number, base: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${sellerId}-${index}`,
    sellerId,
    base,
  }));
}

describe('seller diversity', () => {
  it('interleaves two sellers when their products score the same', () => {
    const items = [...block('A', 100, 50), ...block('B', 100, 50)];
    const ranked = diversifyRankedProducts(items, {
      sellerId: (item) => item.sellerId,
      base: (item) => item.base,
    });
    expect(ranked.slice(0, 6).map((item) => item.sellerId)).toEqual(['A', 'B', 'A', 'B', 'A', 'B']);
    expect(new Set(ranked.slice(0, 10).map((item) => item.sellerId)).size).toBe(2);
  });

  it('lets a stronger seller lead, then still shows the other seller', () => {
    const items = [...block('A', 6, 100), ...block('B', 6, 30)];
    const ranked = diversifyRankedProducts(items, {
      sellerId: (item) => item.sellerId,
      base: (item) => item.base,
    });
    expect(ranked.slice(0, 6).map((item) => item.sellerId)).toEqual(['A', 'A', 'B', 'A', 'A', 'B']);
  });

  it('leaves a one-seller result in its original order', () => {
    const items = block('A', 5, 10);
    const ranked = diversifyRankedProducts(items, {
      sellerId: (item) => item.sellerId,
      base: (item) => item.base,
    });
    expect(ranked.map((item) => item.id)).toEqual(items.map((item) => item.id));
  });

  it('skips explicit price and nearest sorts', () => {
    expect(shouldDiversifySort(null)).toBe(true);
    expect(shouldDiversifySort('relevance')).toBe(true);
    expect(shouldDiversifySort('price_low')).toBe(false);
    expect(shouldDiversifySort('nearest')).toBe(false);
  });

  it('gives a new seller a small boost that cannot pass a much stronger item', () => {
    const now = Date.parse('2026-09-26T00:00:00Z');
    const created = '2026-09-20T00:00:00Z';
    expect(newSellerBaseBoost(created, now)).toBe(4);
    expect(newSellerBaseBoost('2026-08-01T00:00:00Z', now)).toBe(0);

    const items = [
      { id: 'old', sellerId: 'A', base: 20, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'fresh', sellerId: 'B', base: 0, createdAt: created },
    ];
    const ranked = diversifyRankedProducts(items, {
      sellerId: (item) => item.sellerId,
      base: (item) => item.base,
      createdAt: (item) => item.createdAt,
      now,
    });
    expect(ranked[0].id).toBe('old');
  });
});
