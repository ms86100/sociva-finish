import { haversineKm } from '@/lib/buyerOrderLocation';

/** Urban two-wheeler effective speed including traffic. */
export const AVG_DELIVERY_SPEED_KMH = 15;
/** Building / parking / handoff buffer. */
export const HANDOFF_BUFFER_MIN = 3;
/** Never show travel under this floor when coords exist. */
export const MIN_TRAVEL_MINUTES = 5;

export type CheckoutEtaInput = {
  fulfillmentType: 'delivery' | 'pickup' | string;
  prepMinutes: number;
  buyerLat?: number | null;
  buyerLng?: number | null;
  sellerLat?: number | null;
  sellerLng?: number | null;
};

export type CheckoutEtaResult = {
  prepMinutes: number;
  distanceKm: number | null;
  travelMinutes: number | null;
  /** Total ETA for the active fulfillment mode (prep-only for pickup). */
  etaMinutes: number | null;
  distanceKnown: boolean;
};

function hasCoords(lat?: number | null, lng?: number | null): boolean {
  return lat != null && lng != null
    && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    && !(Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001);
}

/** Resolve seller pin: profile coords first, then nested society. */
export function resolveSellerCoords(seller: {
  latitude?: number | null;
  longitude?: number | null;
  society?: { latitude?: number | null; longitude?: number | null } | null;
} | null | undefined): { lat: number; lng: number } | null {
  if (!seller) return null;
  if (hasCoords(seller.latitude, seller.longitude)) {
    return { lat: Number(seller.latitude), lng: Number(seller.longitude) };
  }
  const society = seller.society;
  if (society && hasCoords(society.latitude, society.longitude)) {
    return { lat: Number(society.latitude), lng: Number(society.longitude) };
  }
  return null;
}

export function travelMinutesFromDistanceKm(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    return MIN_TRAVEL_MINUTES;
  }
  const raw = Math.ceil((distanceKm / AVG_DELIVERY_SPEED_KMH) * 60) + HANDOFF_BUFFER_MIN;
  return Math.max(MIN_TRAVEL_MINUTES, raw);
}

export function formatDistanceKmLabel(km: number): string {
  if (km < 0.1) return 'Nearby';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/**
 * Checkout ETA: delivery = max prep + travel from haversine;
 * pickup = prep only. Missing coords → no invented travel minutes.
 */
export function computeCheckoutEta(input: CheckoutEtaInput): CheckoutEtaResult {
  const prepMinutes = Math.max(0, Math.round(Number(input.prepMinutes) || 0));
  const distanceKnown = hasCoords(input.buyerLat, input.buyerLng)
    && hasCoords(input.sellerLat, input.sellerLng);

  let distanceKm: number | null = null;
  let travelMinutes: number | null = null;

  if (distanceKnown) {
    distanceKm = haversineKm(
      Number(input.buyerLat),
      Number(input.buyerLng),
      Number(input.sellerLat),
      Number(input.sellerLng),
    );
    travelMinutes = travelMinutesFromDistanceKm(distanceKm);
  }

  if (input.fulfillmentType === 'pickup') {
    return {
      prepMinutes,
      distanceKm,
      travelMinutes,
      etaMinutes: prepMinutes > 0 ? prepMinutes : null,
      distanceKnown,
    };
  }

  // delivery (default)
  if (prepMinutes <= 0 && travelMinutes == null) {
    return {
      prepMinutes,
      distanceKm,
      travelMinutes,
      etaMinutes: null,
      distanceKnown,
    };
  }

  const etaMinutes = prepMinutes + (travelMinutes ?? 0);
  return {
    prepMinutes,
    distanceKm,
    travelMinutes,
    etaMinutes: etaMinutes > 0 ? etaMinutes : null,
    distanceKnown,
  };
}

/** Best seller coords across a cart group (first item with coords wins). */
export function sellerCoordsFromCartItems(
  items: Array<{ product?: { seller?: Parameters<typeof resolveSellerCoords>[0] } | null }>,
): { lat: number; lng: number } | null {
  for (const item of items) {
    const coords = resolveSellerCoords(item.product?.seller);
    if (coords) return coords;
  }
  return null;
}
