import { describe, expect, it } from 'vitest';
import { effectiveHomeService, homeServiceBuyerLabel } from '@/lib/home-service-label';

describe('home service label', () => {
  it('shows salon and home when a salon visit is also offered', () => {
    expect(homeServiceBuyerLabel({
      sellerHome: true,
      fulfillmentMode: 'self_pickup',
      category: 'salon',
    })).toBe('Available at salon and home');
  });

  it('shows home service only when there is no in-store visit', () => {
    expect(homeServiceBuyerLabel({
      sellerHome: true,
      fulfillmentMode: 'seller_delivery',
      category: 'salon',
    })).toBe('Home service available');
  });

  it('lets a product turn the seller setting off', () => {
    expect(effectiveHomeService({ sellerHome: true, productHome: false })).toBe(false);
    expect(homeServiceBuyerLabel({
      sellerHome: true,
      productHome: false,
      category: 'salon',
    })).toBeNull();
  });

  it('stays quiet when home service is off', () => {
    expect(homeServiceBuyerLabel({ sellerHome: false, category: 'salon' })).toBeNull();
  });
});
