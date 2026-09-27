import { describe, expect, it } from 'vitest';
import {
  checkoutEtaBanner,
  computeCheckoutEta,
  formatDistanceKmLabel,
  instantPrepStampMinutes,
  resolveSellerCoords,
  sumSequentialPrepMinutes,
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

  it('sums prep sequentially and ignores quantity, blanks, and services', () => {
    expect(sumSequentialPrepMinutes([
      { prep_time_minutes: 10, quantity: 1 },
      { prep_time_minutes: 10, quantity: 2 },
      { prep_time_minutes: 10, quantity: 1 },
    ])).toBe(30);
    expect(sumSequentialPrepMinutes([
      { prep_time_minutes: 10, quantity: 2 },
    ])).toBe(10);
    expect(sumSequentialPrepMinutes([
      { prep_time_minutes: null },
      { prep_time_minutes: 0 },
      { prep_time_minutes: 15 },
    ])).toBe(15);
    expect(sumSequentialPrepMinutes([
      { prep_time_minutes: null },
      { prep_time_minutes: 0 },
    ])).toBe(0);
    expect(sumSequentialPrepMinutes([
      { prep_time_minutes: 45, action_type: 'book', quantity: 1 },
      { prep_time_minutes: 10, action_type: 'add_to_cart' },
    ])).toBe(10);
  });

  it('adds sequential prep on top of the existing travel formula', () => {
    const travelOnly = computeCheckoutEta({
      fulfillmentType: 'delivery',
      prepMinutes: 0,
      buyerLat: 12.97,
      buyerLng: 77.59,
      sellerLat: 12.971,
      sellerLng: 77.594,
    });
    const withPrep = computeCheckoutEta({
      fulfillmentType: 'delivery',
      prepMinutes: sumSequentialPrepMinutes([
        { prep_time_minutes: 10 },
        { prep_time_minutes: 10 },
        { prep_time_minutes: 10 },
      ]),
      buyerLat: 12.97,
      buyerLng: 77.59,
      sellerLat: 12.971,
      sellerLng: 77.594,
    });
    expect(travelOnly.travelMinutes).not.toBeNull();
    expect(withPrep.prepMinutes).toBe(30);
    expect(withPrep.travelMinutes).toBe(travelOnly.travelMinutes);
    expect(withPrep.etaMinutes).toBe(30 + (travelOnly.travelMinutes ?? 0));
    expect(checkoutEtaBanner(withPrep, 'delivery', '1.2 km')?.detail).toContain('30 min for the seller to prepare');
    expect(checkoutEtaBanner(withPrep, 'delivery', '1.2 km')?.detail).toContain('min to deliver');
  });

  it('blank prep stays travel-only and does not invent a prep wait', () => {
    const result = computeCheckoutEta({
      fulfillmentType: 'delivery',
      prepMinutes: sumSequentialPrepMinutes([{ prep_time_minutes: null }, { prep_time_minutes: 0 }]),
      buyerLat: 12.97,
      buyerLng: 77.59,
      sellerLat: 13.0,
      sellerLng: 77.6,
    });
    expect(result.prepMinutes).toBe(0);
    expect(result.etaMinutes).toBe(result.travelMinutes);
    expect(instantPrepStampMinutes({
      fulfillmentType: 'delivery',
      prepMinutes: result.prepMinutes,
      travelMinutes: result.travelMinutes,
    })).toBeNull();
  });

  it('pickup stamp is prep only', () => {
    const result = computeCheckoutEta({
      fulfillmentType: 'self_pickup',
      prepMinutes: 20,
      buyerLat: 12.97,
      buyerLng: 77.59,
      sellerLat: 13.0,
      sellerLng: 77.6,
    });
    expect(result.etaMinutes).toBe(20);
    expect(instantPrepStampMinutes({
      fulfillmentType: 'self_pickup',
      prepMinutes: 20,
      travelMinutes: result.travelMinutes,
    })).toBe(20);
  });

  it('does not stamp instant prep onto scheduled or pre-order orders', () => {
    expect(instantPrepStampMinutes({
      scheduled: true,
      fulfillmentType: 'delivery',
      prepMinutes: 30,
      travelMinutes: 8,
    })).toBeNull();
    expect(instantPrepStampMinutes({
      preorder: true,
      fulfillmentType: 'delivery',
      prepMinutes: 30,
      travelMinutes: 8,
    })).toBeNull();
    expect(instantPrepStampMinutes({
      fulfillmentType: 'delivery',
      prepMinutes: 30,
      travelMinutes: null,
    })).toBe(30);
  });

  it('unknown distance mentions preparation and does not invent travel', () => {
    const result = computeCheckoutEta({
      fulfillmentType: 'delivery',
      prepMinutes: 30,
      buyerLat: null,
      buyerLng: null,
      sellerLat: null,
      sellerLng: null,
    });
    const banner = checkoutEtaBanner(result, 'delivery');
    expect(banner?.title).toBe('Ready in about 30 min');
    expect(banner?.detail).toBe('Seller preparation time. Delivery travel will be confirmed.');
    expect(banner?.detail).not.toMatch(/10-20/);
  });
});
