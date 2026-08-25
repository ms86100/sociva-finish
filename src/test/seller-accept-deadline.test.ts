import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isOrderAcceptanceExpired } from '@/lib/expired-order-acks';

describe('seller accept after response deadline', () => {
  it('treats placed + past auto_cancel_at as expired', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isOrderAcceptanceExpired(past, 'placed')).toBe(true);
    expect(isOrderAcceptanceExpired(past, 'accepted')).toBe(false);
    expect(isOrderAcceptanceExpired(null, 'placed')).toBe(false);
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isOrderAcceptanceExpired(future, 'placed')).toBe(false);
  });

  it('seller_advance_order migration hard-blocks late accepts', () => {
    const mig = readFileSync(
      resolve(__dirname, '../../supabase/migrations/20260825170000_block_accept_after_deadline.sql'),
      'utf8',
    );
    expect(mig).toMatch(/Seller response time expired/);
    expect(mig).toMatch(/auto_cancel_at <= now\(\)/);
    expect(mig).toMatch(/sweep_expired_unaccepted_orders/);
    expect(mig).toMatch(/\* \* \* \* \*/);
  });

  it('order detail UI hides accept when expired', () => {
    const page = readFileSync(resolve(__dirname, '../pages/OrderDetailPage.tsx'), 'utf8');
    const hook = readFileSync(resolve(__dirname, '../hooks/useOrderDetail.ts'), 'utf8');
    expect(hook).toMatch(/isAcceptanceExpired/);
    expect(page).toMatch(/!o\.isAcceptanceExpired/);
    expect(page).toMatch(/Response time expired — accept is closed/);
  });
});
