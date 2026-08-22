import { describe, expect, it } from 'vitest';
import { buyerLocationPushLine, describeBuyerOrderLocation } from '@/lib/buyerOrderLocation';

describe('buyer order location for sellers', () => {
  it('shows society, phase, and distance', () => {
    const view = describeBuyerOrderLocation({
      societyName: 'Shriram Greenfield',
      phase: '2',
      buyerLat: 12.9716,
      buyerLng: 77.5946,
      sellerLat: 12.9900,
      sellerLng: 77.5946,
      sellerRadiusKm: 1,
    });
    expect(view?.label).toContain('Shriram Greenfield');
    expect(view?.label).toContain('Phase 2');
    expect(view?.distanceLabel).toMatch(/km away/);
    expect(view?.outsideRadius).toBe(true);
    expect(buyerLocationPushLine(view)).toMatch(/outside your 1 km radius/);
  });

  it('falls back to the delivery address when society is missing', () => {
    const view = describeBuyerOrderLocation({
      deliveryAddress: 'Whitefield, Bengaluru',
    });
    expect(view?.label).toBe('Whitefield, Bengaluru');
    expect(view?.outsideRadius).toBe(false);
  });
});
