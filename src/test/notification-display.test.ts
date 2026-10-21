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

  it('drops the extra A before a The-named parcel sender', () => {
    const out = resolveNotificationDisplay({
      title: 'Parcel Received',
      body: 'A The Daily Kitchen by Arushi has arrived for you.',
      type: 'parcel',
    });
    expect(out.body).toBe('The Daily Kitchen by Arushi has arrived for you.');
  });

  it('drops stale accept copy on scheduled-order notifications', () => {
    const out = resolveNotificationDisplay({
      title: 'Scheduled order for 22 Oct, 9:45 AM',
      body: 'Scheduled for 22 Oct, 9:45 AM - 1x Biryani. Tap to review and accept.',
      type: 'order',
    });
    expect(out.body).toBe('Scheduled for 22 Oct, 9:45 AM - 1x Biryani.');
    expect(out.body).not.toMatch(/Tap to review and accept/);
  });
});
