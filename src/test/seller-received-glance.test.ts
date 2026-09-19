import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  formatOrderItemsGlance,
  formatSellerOrderLocation,
  formatSellerWhenGlance,
} from '@/lib/order-glance';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('seller received order glance', () => {
  it('aggregates items as name + qty', () => {
    expect(
      formatOrderItemsGlance([
        { product_name: 'Chicken Biryani', quantity: 2 },
        { product_name: 'Seekh Kebab', quantity: 2 },
      ]),
    ).toBe('Chicken Biryani 2x, Seekh Kebab 2x');
  });

  it('merges duplicate names and caps the line', () => {
    expect(
      formatOrderItemsGlance([
        { product_name: 'Biryani', quantity: 1 },
        { product_name: 'Biryani', quantity: 1 },
        { product_name: 'Kebab', quantity: 2 },
        { product_name: 'Raita', quantity: 1 },
        { product_name: 'Coke', quantity: 1 },
        { product_name: 'Gulab Jamun', quantity: 1 },
      ]),
    ).toBe('Biryani 2x, Kebab 2x, Raita 1x, Coke 1x +1 more');
  });

  it('labels instant vs pre-order with the slot time', () => {
    expect(formatSellerWhenGlance({ status: 'placed' }).kind).toBe('instant');
    expect(formatSellerWhenGlance({ status: 'placed' }).label).toBe('Instant');

    const scheduled = formatSellerWhenGlance({
      status: 'scheduled',
      scheduled_date: '2026-09-20',
      scheduled_time_start: '14:00:00',
    });
    expect(scheduled.kind).toBe('preorder');
    expect(scheduled.label).toMatch(/Pre-order/);
    expect(scheduled.label).toMatch(/2:00/i);

    const booking = formatSellerWhenGlance({
      status: 'scheduled',
      order_type: 'booking',
      scheduled_date: '2026-09-20',
      scheduled_time_start: '14:00:00',
    });
    expect(booking.label).toMatch(/^Scheduled/);
    expect(booking.label).not.toMatch(/Pre-order/);
  });

  it('prefers delivery address, then block/flat', () => {
    expect(
      formatSellerOrderLocation({
        delivery_address: 'Block F, F1601',
        buyer: { block: 'H', flat_number: '1809' },
      }),
    ).toBe('Block F, F1601');
    expect(
      formatSellerOrderLocation({
        buyer: { phase: 'Phase 2', block: 'F', flat_number: 'F1601' },
      }),
    ).toBe('Phase 2 · Block F, F1601');
  });

  it('loads scheduled slot + items on the seller Received list', () => {
    const list = read('src/hooks/useOrdersList.ts');
    expect(list).toMatch(/sellerListSelect/);
    expect(list).toMatch(/scheduled_date, scheduled_time_start/);
    expect(list).toMatch(/delivery_address/);
    expect(list).toMatch(/items:order_items\(id, product_id, product_name, quantity/);

    const page = read('src/pages/OrdersPage.tsx');
    expect(page).toMatch(/formatOrderItemsGlance/);
    expect(page).toMatch(/formatSellerWhenGlance/);
    expect(page).toMatch(/sellerItemGlance/);
  });
});
