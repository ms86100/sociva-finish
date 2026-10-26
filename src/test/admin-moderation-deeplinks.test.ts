import { describe, expect, it } from 'vitest';
import {
  pickNotificationRoute,
  resolveAdminModerationRoute,
  resolveNotificationRoute,
} from '@/lib/notification-routes';
import { getCommercePriceLabel, shouldShowMonetaryPrice } from '@/lib/marketplace-constants';

describe('admin moderation deep links', () => {
  it('routes new store applications to seller moderation', () => {
    expect(resolveAdminModerationRoute({ type: 'new_store_application' }))
      .toBe('/admin?tab=sellers');
    expect(resolveNotificationRoute('new_store_application')).toBe('/admin?tab=sellers');
    expect(resolveNotificationRoute('moderation', { type: 'new_store_application' }))
      .toBe('/admin?tab=sellers');
  });

  it('rewrites bare /admin reference_path using payload type', () => {
    expect(pickNotificationRoute({
      type: 'moderation',
      reference_path: '/admin',
      payload: { type: 'new_store_application', seller_id: 'abc' },
    })).toBe('/admin?tab=sellers');

    expect(pickNotificationRoute({
      type: 'moderation',
      reference_path: '/admin',
      payload: { type: 'category_request' },
    })).toBe('/admin?tab=catalog');

    expect(pickNotificationRoute({
      type: 'moderation',
      reference_path: '/admin',
      payload: { type: 'product_review', productId: 'p1' },
    })).toBe('/admin?tab=sellers');

    expect(pickNotificationRoute({
      type: 'moderation',
      reference_path: '/admin?tab=feedback',
      payload: { type: 'user_feedback' },
    })).toBe('/admin?tab=feedback');
  });
});

describe('notification vague reference_path', () => {
  it('ignores bare / and dead campaign paths for order types', () => {
    expect(pickNotificationRoute({
      type: 'order',
      reference_path: '/',
      payload: { order_id: 'ord-1' },
    })).toBe('/orders/ord-1');

    expect(pickNotificationRoute({
      type: 'order_status',
      reference_path: '/marketplace',
      payload: { order_id: 'ord-2' },
    })).toBe('/orders/ord-2');

    expect(pickNotificationRoute({
      type: 'campaign',
      payload: {},
    })).toBe('/');
  });
});

describe('zero-price book listings', () => {
  it('shows Price on request instead of ₹0 for book services', () => {
    expect(shouldShowMonetaryPrice('book', 0)).toBe(false);
    expect(getCommercePriceLabel('book', 0, (n) => `₹${n}`)).toBe('Price on request');
    expect(getCommercePriceLabel('book', 499, (n) => `₹${n}`)).toBe('₹499');
  });
});
