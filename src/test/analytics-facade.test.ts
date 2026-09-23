import { describe, expect, it } from 'vitest';
import { sanitizeAnalyticsProps } from '@/lib/analytics-privacy';
import {
  ANALYTICS_EVENT_NAMES,
  isAnalyticsEventName,
  sellerOnboardingStepKey,
} from '@/lib/analytics-events';
import {
  SELLER_ONBOARDING_FLOW_VERSION,
  trackSellerOnboardingStep,
} from '@/lib/analytics-journey';

describe('analytics privacy', () => {
  it('strips sensitive keys and truncates long strings', () => {
    const out = sanitizeAnalyticsProps({
      product_id: 'abc',
      otp: '1234',
      phone: '8448802907',
      password: 'secret',
      search_term: 'biryani',
      note: 'x'.repeat(250),
      intent_phrase_len: 42,
    });
    expect(out.product_id).toBe('abc');
    expect(out.search_term).toBe('biryani');
    expect(out.intent_phrase_len).toBe(42);
    expect(out.otp).toBeUndefined();
    expect(out.phone).toBeUndefined();
    expect(out.password).toBeUndefined();
    expect(String(out.note).length).toBeLessThanOrEqual(201);
  });
});

describe('analytics event dictionary', () => {
  it('includes core funnel and journey v2 events', () => {
    expect(isAnalyticsEventName('product_viewed')).toBe(true);
    expect(isAnalyticsEventName('add_to_cart')).toBe(true);
    expect(isAnalyticsEventName('order_completed')).toBe(true);
    expect(isAnalyticsEventName('seller_onboarding_step_started')).toBe(true);
    expect(isAnalyticsEventName('seller_onboarding_step_abandoned')).toBe(true);
    expect(isAnalyticsEventName('seller_commerce_model_changed')).toBe(true);
    expect(isAnalyticsEventName('seller_listing_draft_created')).toBe(true);
    expect(isAnalyticsEventName('push_notification_opened')).toBe(true);
    expect(isAnalyticsEventName('app_opened_from_push')).toBe(true);
    expect(isAnalyticsEventName('not_a_real_event')).toBe(false);
    expect(ANALYTICS_EVENT_NAMES.length).toBeGreaterThan(40);
  });

  it('maps step numbers to v5 keys', () => {
    expect(sellerOnboardingStepKey(1)).toBe('intent_category');
    expect(sellerOnboardingStepKey(2)).toBe('subcategory');
    expect(sellerOnboardingStepKey(3)).toBe('listing');
    expect(sellerOnboardingStepKey(4)).toBe('store_submit');
    expect(sellerOnboardingStepKey(0)).toBeNull();
    expect(sellerOnboardingStepKey(9)).toBeNull();
  });
});

describe('analytics facade', () => {
  it('no-ops track/identify when Amplitude key is missing', async () => {
    const mod = await import('@/lib/analytics');
    expect(mod.isAnalyticsEnabled()).toBe(false);
    expect(() => mod.track('product_viewed', { product_id: 'x' })).not.toThrow();
    expect(() => mod.identify('user-1', { society_id: 's' })).not.toThrow();
    expect(() => mod.resetAnalytics()).not.toThrow();
  });

  it('stores and clears attribution bag without throwing', async () => {
    const mod = await import('@/lib/analytics');
    mod.clearAttribution();
    mod.setAttribution({ campaign_id: 'camp-1', queue_item_id: 'q-1' });
    expect(mod.getAttribution().campaign_id).toBe('camp-1');
    expect(mod.getAttribution().queue_item_id).toBe('q-1');
    mod.clearAttribution();
    expect(mod.getAttribution()).toEqual({});
  });

  it('journey helper no-ops without Amplitude key', () => {
    expect(SELLER_ONBOARDING_FLOW_VERSION).toBe('5');
    expect(() =>
      trackSellerOnboardingStep({
        step: 1,
        action: 'started',
        sellerId: 'seller-1',
        props: { category: 'food' },
      }),
    ).not.toThrow();
  });
});
