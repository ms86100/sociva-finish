import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { dismissHomeOrderStrip, getDismissedHomeOrderIds } from '@/lib/home-order-strip';
import { resolveReorderLines } from '@/lib/reorder';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

afterEach(() => {
  localStorage.clear();
});

describe('home active order strip dismiss', () => {
  it('persists dismissed order ids across reads', () => {
    expect(getDismissedHomeOrderIds().size).toBe(0);
    dismissHomeOrderStrip('order-1');
    dismissHomeOrderStrip('order-1');
    expect([...getDismissedHomeOrderIds()]).toEqual(['order-1']);
  });

  it('puts an X on the home strip without navigating', () => {
    const strip = read('src/components/home/ActiveOrderStrip.tsx');
    expect(strip).toMatch(/Hide this order from Home/);
    expect(strip).toMatch(/dismissHomeOrderStrip/);
    expect(strip).toMatch(/stopPropagation/);
  });

  it('keeps the strip on Home and removes Your Society from Home for every user', () => {
    const home = read('src/pages/HomePage.tsx');
    expect(home).toMatch(/ActiveOrderStrip/);
    expect(home).not.toMatch(/SocietyQuickLinks/);
  });
});

describe('orders list reorder', () => {
  it('selects product_id so list Reorder can match order-detail Reorder', () => {
    const list = read('src/hooks/useOrdersList.ts');
    expect(list).toMatch(/items:order_items\(id, product_id, product_name/);
    expect(list).not.toMatch(/items:order_items\(id, product_name/);
  });

  it('uses listed product ids without waiting on a fetch', async () => {
    const lines = await resolveReorderLines([
      { product_id: 'p1', quantity: 2 },
      { product_id: null, quantity: 1 },
    ]);
    expect(lines).toEqual([{ product_id: 'p1', quantity: 2 }]);
  });

  it('checks operating hours before treating reorder as a failure', () => {
    const button = read('src/components/order/ReorderButton.tsx');
    expect(button).toMatch(/getClosedStoreReorderMessage/);
    expect(button).toMatch(/parseStoreClosedBuyerError/);
    expect(button).toMatch(/orderId/);
  });
});
