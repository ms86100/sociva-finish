import { describe, expect, it } from 'vitest';
import { ACTION_CONFIG } from '@/lib/marketplace-constants';
import { usesServiceBookingFlow } from '@/components/product/ProductDetailSheet';
import {
  canQuickAddRecentlyViewed,
  resolveRecentlyViewedAction,
} from '@/components/home/RecentlyViewedRow';

describe('release-critical buyer action routing', () => {
  it('reserves ServiceBookingFlow for canonical book actions', () => {
    expect(usesServiceBookingFlow('book')).toBe(true);
    expect(usesServiceBookingFlow('request_service')).toBe(false);
    expect(usesServiceBookingFlow('request_quote')).toBe(false);
    expect(usesServiceBookingFlow('add_to_cart')).toBe(false);
  });

  it('routes ordinary service requests through the non-cart path', () => {
    const action = resolveRecentlyViewedAction('request_service', 'request_service');

    expect(action).toBe('request_service');
    expect(canQuickAddRecentlyViewed(action)).toBe(false);
  });

  it('quick-adds only actions marked cart-compatible by canonical config', () => {
    for (const [action, config] of Object.entries(ACTION_CONFIG)) {
      expect(canQuickAddRecentlyViewed(action as keyof typeof ACTION_CONFIG)).toBe(config.isCart);
    }
  });

  it('fails closed while a legacy listing action is unresolved', () => {
    expect(canQuickAddRecentlyViewed('add_to_cart', false)).toBe(false);
  });

  it('uses category behavior when a recently viewed listing has no override', () => {
    expect(resolveRecentlyViewedAction(null, 'book_slot')).toBe('book');
    expect(resolveRecentlyViewedAction(null, 'request_service')).toBe('request_service');
    expect(resolveRecentlyViewedAction(null, 'cart_purchase')).toBe('add_to_cart');
  });
});
