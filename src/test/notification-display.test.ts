import { describe, it, expect } from 'vitest';
import { resolveNotificationDisplay } from '@/lib/notification-display';

describe('resolveNotificationDisplay', () => {
  it('fills empty buyer accepted notification from payload', () => {
    const out = resolveNotificationDisplay({
      title: '',
      body: '',
      type: 'order_status',
      data: {
        status: 'accepted',
        target_role: 'buyer',
        sellerName: 'Sagar store',
      },
    });
    expect(out.title).toBe('✅ Order Accepted!');
    expect(out.body).toContain('Sagar store');
    expect(out.body).toContain('accepted');
  });

  it('fills empty seller new order from item summary', () => {
    const out = resolveNotificationDisplay({
      title: '',
      body: '',
      type: 'order',
      data: {
        status: 'placed',
        target_role: 'seller',
        buyer_name: 'Test Buyer',
        item_summary: '1x Biryani',
      },
    });
    expect(out.title).toBe('🆕 New Order Received!');
    expect(out.body).toContain('1x Biryani');
    expect(out.body).toContain('Test Buyer');
  });

  it('preserves non-empty title and body', () => {
    const out = resolveNotificationDisplay({
      title: 'Hello',
      body: 'World',
      type: 'order',
      data: { status: 'placed' },
    });
    expect(out.title).toBe('Hello');
    expect(out.body).toBe('World');
  });
});
