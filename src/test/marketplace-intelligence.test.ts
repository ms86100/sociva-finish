import { describe, expect, it } from 'vitest';
import {
  classifyOrderBucket,
  clusterSearchDemand,
  conversionPercent,
  identifyTraitsForAmplitude,
  isOutForDelivery,
  levenshtein,
  normalizeSearchTerm,
  onboardingStageFromStep,
  productViewDayKey,
  stageFromSellerStore,
  stripBuyerIdentity,
} from '@/lib/marketplace-intelligence';
import { factTargetForEvent, onboardingStageForEvent } from '@/lib/analytics-facts';
import { isAnalyticsEventName } from '@/lib/analytics-events';

describe('order status buckets', () => {
  it('maps delivered, rejected cancels, and out for delivery', () => {
    expect(classifyOrderBucket('delivered')).toBe('completed');
    expect(classifyOrderBucket('completed')).toBe('completed');
    expect(classifyOrderBucket('cancelled', 'Out of stock')).toBe('rejected');
    expect(classifyOrderBucket('cancelled', '   ')).toBe('cancelled');
    expect(classifyOrderBucket('cancelled')).toBe('cancelled');
    expect(classifyOrderBucket('on_the_way')).toBe('open');
    expect(isOutForDelivery('on_the_way')).toBe(true);
    expect(isOutForDelivery('preparing')).toBe(false);
  });
});

describe('onboarding stages', () => {
  it('maps the four wizard steps without creating a store', () => {
    expect(onboardingStageFromStep(1)).toBe('category_selected');
    expect(onboardingStageFromStep(2)).toBe('category_selected');
    expect(onboardingStageFromStep(3)).toBe('product_added');
    expect(onboardingStageFromStep(4)).toBe('store_details');
    expect(onboardingStageForEvent('seller_onboarding_started', {})).toBe('started');
    expect(onboardingStageForEvent('seller_onboarding_completed', {})).toBe('submitted');
    expect(onboardingStageForEvent('seller_onboarding_step_abandoned', {})).toBe('abandoned');
    expect(stageFromSellerStore({
      verification_status: 'approved',
      business_name: 'Tadka Ghar',
      is_available: true,
    })).toBe('live');
  });
});

describe('amplitude identity', () => {
  it('keeps the name and drops phone and email', () => {
    const traits = identifyTraitsForAmplitude({
      name: 'Twinkle',
      store_name: 'Tadka Ghar',
      phone: '+919999000001',
      email: 'secret@example.com',
      seller_onboarding_stage: 'live',
    });
    expect(traits.name).toBe('Twinkle');
    expect(traits.store_name).toBe('Tadka Ghar');
    expect(traits.seller_onboarding_stage).toBe('live');
    expect(traits.phone).toBeUndefined();
    expect(traits.email).toBeUndefined();
  });
});

describe('shared event names', () => {
  it('writes one product view fact and one Amplitude event for the same ids', () => {
    const morning = new Date('2026-09-27T02:00:00.000Z');
    const evening = new Date('2026-09-27T18:00:00.000Z');
    const nextDay = new Date('2026-09-28T00:30:00.000Z');
    expect(productViewDayKey('user-1', 'product-1', morning)).toBe(productViewDayKey('user-1', 'product-1', evening));
    expect(productViewDayKey('user-1', 'product-1', morning)).not.toBe(productViewDayKey('user-1', 'product-1', nextDay));

    const shared = ['product_viewed', 'add_to_cart', 'search_submitted', 'search_no_results', 'order_completed', 'order_status_changed', 'seller_onboarding_completed'];
    for (const name of shared) {
      expect(isAnalyticsEventName(name)).toBe(true);
      expect(factTargetForEvent(name)).toBeTruthy();
    }
    expect(factTargetForEvent('product_viewed')).toBe('product_views');
    expect(factTargetForEvent('add_to_cart')).toBe('cart_add_log');
    expect(factTargetForEvent('search_submitted')).toBe('search_demand_log');
    expect(factTargetForEvent('order_status_changed')).toBe('orders');
    expect(conversionPercent(1, 4)).toBe(25);
  });
});

describe('seller payload privacy', () => {
  it('removes buyer identity keys and keeps aggregates', () => {
    const safe = stripBuyerIdentity({
      views_30d: 4,
      phone: '9999000002',
      products: [{ name: 'Aloo Paratha', viewer_id: 'secret', views: 2 }],
      demand: [{ search_term: 'biryani', unique_users: 3 }],
    });
    expect(safe.views_30d).toBe(4);
    expect(safe.phone).toBeUndefined();
    expect(safe.products[0].viewer_id).toBeUndefined();
    expect(safe.products[0].views).toBe(2);
    expect(safe.demand[0].search_term).toBe('biryani');
  });
});

describe('search demand clustering', () => {
  it('groups keystroke prefixes and one-letter typos onto the longest query', () => {
    const clustered = clusterSearchDemand([
      { search_term: 'biry', unique_users: 1, searches: 1, no_results: true },
      { search_term: 'birya', unique_users: 1, searches: 1, no_results: true },
      { search_term: 'biryan', unique_users: 1, searches: 1, no_results: true },
      { search_term: 'biryani', unique_users: 1, searches: 2, no_results: true, matched_your_listings: true },
      { search_term: 'biryanu', unique_users: 1, searches: 1, no_results: true },
      { search_term: 'cake.', unique_users: 1, searches: 1, no_results: true },
      { search_term: 'cake', unique_users: 1, searches: 1, no_results: true },
      { search_term: 'berd', unique_users: 1, searches: 1, no_results: true },
    ]);

    expect(normalizeSearchTerm('cake.')).toBe('cake');
    expect(levenshtein('biryani', 'biryanu')).toBe(1);

    const biryani = clustered.find((row) => row.search_term === 'biryani');
    expect(biryani).toBeTruthy();
    expect(biryani?.unique_users).toBe(5);
    expect(biryani?.searches).toBe(6);
    expect(biryani?.matched_your_listings).toBe(true);
    expect(biryani?.aliases.sort()).toEqual(['biry', 'birya', 'biryan', 'biryanu']);

    const cake = clustered.find((row) => row.search_term === 'cake');
    expect(cake?.unique_users).toBe(2);
    expect(clustered.some((row) => row.search_term === 'berd')).toBe(true);
    expect(clustered.some((row) => row.search_term === 'biry')).toBe(false);
  });
});
