import { describe, expect, it } from 'vitest';
import {
  computeCheckoutEta,
  formatDistanceKmLabel,
  resolveSellerCoords,
  travelMinutesFromDistanceKm,
  MIN_TRAVEL_MINUTES,
  HANDOFF_BUFFER_MIN,
  AVG_DELIVERY_SPEED_KMH,
} from '@/lib/checkout-eta';

describe('checkout-eta', () => {
  it('floors travel at MIN_TRAVEL_MINUTES for near-zero distance', () => {
    expect(travelMinutesFromDistanceKm(0)).toBe(MIN_TRAVEL_MINUTES);
    expect(travelMinutesFromDistanceKm(0.01)).toBe(MIN_TRAVEL_MINUTES);
  });

  it('computes travel from distance at urban speed + handoff buffer', () => {
    // 3 km @ 15 km/h = 12 min + 3 buffer = 15
    expect(travelMinutesFromDistanceKm(3)).toBe(
      Math.max(MIN_TRAVEL_MINUTES, Math.ceil((3 / AVG_DELIVERY_SPEED_KMH) * 60) + HANDOFF_BUFFER_MIN),
    );
  });

  it('delivery ETA = prep + travel when coords known', () => {
    // Same point → travel floor 5; prep 25 → eta 30
    const result = computeCheckoutEta({
      fulfillmentType: 'delivery',
      prepMinutes: 25,
      buyerLat: 12.97,
      buyerLng: 77.59,
      sellerLat: 12.97,
      sellerLng: 77.59,
    });
    expect(result.distanceKnown).toBe(true);
    expect(result.travelMinutes).toBe(MIN_TRAVEL_MINUTES);
    expect(result.etaMinutes).toBe(25 + MIN_TRAVEL_MINUTES);
    expect(result.distanceKm).toBeCloseTo(0, 3);
  });

  it('pickup ignores travel for etaMinutes', () => {
    const result = computeCheckoutEta({
      fulfillmentType: 'pickup',
      prepMinutes: 20,
      buyerLat: 12.97,
      buyerLng: 77.59,
      sellerLat: 13.0,
      sellerLng: 77.6,
    });
    expect(result.distanceKnown).toBe(true);
    expect(result.travelMinutes).toBeGreaterThan(0);
    expect(result.etaMinutes).toBe(20);
  });

  it('missing coords → no invented travel', () => {
    const result = computeCheckoutEta({
      fulfillmentType: 'delivery',
      prepMinutes: 30,
      buyerLat: 12.97,
      buyerLng: 77.59,
      sellerLat: null,
      sellerLng: null,
    });
    expect(result.distanceKnown).toBe(false);
    expect(result.travelMinutes).toBeNull();
    expect(result.distanceKm).toBeNull();
    expect(result.etaMinutes).toBe(30);
  });

  it('resolves seller coords from profile then society fallback', () => {
    expect(resolveSellerCoords({ latitude: 1, longitude: 2 })).toEqual({ lat: 1, lng: 2 });
    expect(resolveSellerCoords({
      latitude: null,
      longitude: null,
      society: { latitude: 3, longitude: 4 },
    })).toEqual({ lat: 3, lng: 4 });
    expect(resolveSellerCoords({})).toBeNull();
  });

  it('formats distance labels', () => {
    expect(formatDistanceKmLabel(0.05)).toBe('Nearby');
    expect(formatDistanceKmLabel(0.4)).toBe('400 m');
    expect(formatDistanceKmLabel(2.3)).toBe('2.3 km');
  });
});
