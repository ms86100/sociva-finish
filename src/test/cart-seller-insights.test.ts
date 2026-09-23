import { describe, expect, it } from 'vitest';
import { cartItemMetaLine, getCartSellerInsights } from '@/lib/cart-seller-insights';

describe('cart seller insights', () => {
  it('builds store name, location and distance for checkout', () => {
    const insights = getCartSellerInsights({
      name: 'Biryani',
      seller_name: 'Biryani and Kebab',
      society_name: 'Shriram Greenfield Phase-2, Tower H',
      distance_km: 0.034,
      prep_time_minutes: 25,
      seller: {
        business_name: 'Biryani and Kebab',
        store_location_label: 'Shriram Greenfield Phase-2, Tower H',
      },
    });
    expect(insights.storeName).toBe('Biryani and Kebab');
    expect(insights.locationLabel).toContain('Shriram');
    expect(insights.distanceLabel).toBe('Nearby');
    expect(insights.prepLabel).toBe('Ready in ~25 min');
    expect(cartItemMetaLine({
      society_name: 'Shriram Greenfield Phase-2, Tower H',
      distance_km: 0.5,
      prep_time_minutes: 20,
    })).toContain('m away');
  });
});
