import { describe, expect, it } from 'vitest';
import { listingsSellingWell } from '@/lib/selling-well';

function item(id: string, seller: string, orders: number) {
  return { id, seller_id: seller, completed_order_count: orders };
}

describe('listingsSellingWell', () => {
  it('caps listings per seller so one store cannot fill the rail', () => {
    const picked = listingsSellingWell([
      item('m1', 'mountain', 40),
      item('m2', 'mountain', 40),
      item('m3', 'mountain', 40),
      item('p1', 'pickle', 2),
      item('p2', 'pickle', 2),
      item('p3', 'pickle', 2),
    ]);
    expect(picked.map((product) => product.id)).toEqual(['m1', 'm2', 'p1', 'p2']);
  });

  it('hides when fewer than two sellers have completed orders', () => {
    expect(listingsSellingWell([
      item('m1', 'mountain', 40),
      item('m2', 'mountain', 40),
      item('p1', 'pickle', 0),
    ])).toEqual([]);
  });

  it('does not invent demand from zero-order listings', () => {
    expect(listingsSellingWell([
      item('a', 'one', 0),
      item('b', 'two', 0),
    ])).toEqual([]);
  });
});
