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

export function isPickupFulfillment(fulfillmentType: string | null | undefined): boolean {
  const kind = (fulfillmentType || '').trim().toLowerCase();
  return kind === 'pickup' || kind === 'self_pickup';
}

/** Kitchen prep is the cart product field. Service bookings keep that column as appointment length. */
export function countsTowardKitchenPrep(actionType?: string | null): boolean {
  const kind = (actionType || 'add_to_cart').trim().toLowerCase();
  return kind === '' || kind === 'add_to_cart';
}

export type PrepLine = {
  prep_time_minutes?: number | null;
  quantity?: number | null;
  action_type?: string | null;
};

/**
 * Sequential prep inside one seller. Each line counts once.
 * Quantity does not multiply. Blank, 0, and service lines add nothing.
 */
export function sumSequentialPrepMinutes(lines: PrepLine[]): number {
  let sum = 0;
  for (const line of lines) {
    if (!countsTowardKitchenPrep(line.action_type)) continue;
    const minutes = Number(line.prep_time_minutes);
    if (!Number.isFinite(minutes) || minutes <= 0) continue;
    sum += Math.round(minutes);
  }
  return sum;
}

/**
 * Minutes written to estimated_delivery_at for an instant order.
 * Null means leave the column empty so the accept-time travel ETA is unchanged.
 * Scheduled and pre-order orders always return null.
 */
export function instantPrepStampMinutes(input: {
  scheduled?: boolean;
  preorder?: boolean;
  fulfillmentType: string;
  prepMinutes: number;
  travelMinutes?: number | null;
}): number | null {
  if (input.scheduled || input.preorder) return null;
  const prep = Math.max(0, Math.round(Number(input.prepMinutes) || 0));
  if (prep <= 0) return null;
  if (isPickupFulfillment(input.fulfillmentType)) return prep;
  if (input.travelMinutes == null) return prep;
  return prep + Math.max(0, Math.round(input.travelMinutes));
}

export type CheckoutEtaBanner = {
  title: string;
  detail: string;
};

/** Buyer-facing checkout line. No-prep delivery keeps the existing travel wording. */
export function checkoutEtaBanner(
  eta: CheckoutEtaResult,
  fulfillmentType: string,
  distanceLabel?: string | null,
): CheckoutEtaBanner | null {
  if (isPickupFulfillment(fulfillmentType)) {
    if (eta.prepMinutes <= 0) return null;
    return {
      title: `Ready in about ${eta.prepMinutes} min`,
      detail: 'Seller preparation time',
    };
  }

  if (eta.distanceKnown && eta.etaMinutes != null && eta.travelMinutes != null) {
    if (eta.prepMinutes > 0) {
      const distance = distanceLabel ? `${distanceLabel}. ` : '';
      return {
        title: `About ${eta.etaMinutes} min`,
        detail: `${distance}${eta.prepMinutes} min for the seller to prepare, ${eta.travelMinutes} min to deliver`,
      };
    }
    const bits = [
      distanceLabel || null,
      `prep ~${eta.prepMinutes} min`,
      `travel ~${eta.travelMinutes} min`,
    ].filter(Boolean);
    return {
      title: `Delivering in ~${eta.etaMinutes} minutes`,
      detail: bits.join(' · '),
    };
  }

  if (eta.prepMinutes > 0) {
    return {
      title: `Ready in about ${eta.prepMinutes} min`,
      detail: 'Seller preparation time. Delivery travel will be confirmed.',
    };
  }

  return null;
}

/**
 * Checkout ETA: delivery = prep + travel from haversine;
 * pickup = prep only. Missing coords do not invent travel minutes.
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

  if (isPickupFulfillment(input.fulfillmentType)) {
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
