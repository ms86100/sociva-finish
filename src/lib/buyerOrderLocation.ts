export type BuyerOrderLocationInput = {
  deliveryAddress?: string | null;
  societyName?: string | null;
  phase?: string | null;
  block?: string | null;
  flatNumber?: string | null;
  buyerLat?: number | null;
  buyerLng?: number | null;
  sellerLat?: number | null;
  sellerLng?: number | null;
  sellerRadiusKm?: number | null;
  distanceKm?: number | null;
};

export type BuyerOrderLocationView = {
  label: string;
  distanceLabel: string | null;
  outsideRadius: boolean;
  radiusKm: number | null;
};

function hasCoords(lat?: number | null, lng?: number | null): boolean {
  return lat != null && lng != null
    && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    && !(Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001);
}

export function haversineKm(
  lat1: number, lng1: number, lat2: number, lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatPhase(phase?: string | null): string | null {
  const raw = (phase || '').trim();
  if (!raw) return null;
  return /phase|ph\b|tower|block|wing/i.test(raw) ? raw : `Phase ${raw}`;
}

export function describeBuyerOrderLocation(input: BuyerOrderLocationInput): BuyerOrderLocationView | null {
  const society = (input.societyName || '').trim() || null;
  const phase = formatPhase(input.phase);
  const address = (input.deliveryAddress || '').trim() || null;
  const blockFlat = [input.block, input.flatNumber].filter(Boolean).join('-') || null;

  let distanceKm = input.distanceKm ?? null;
  if (distanceKm == null
    && hasCoords(input.buyerLat, input.buyerLng)
    && hasCoords(input.sellerLat, input.sellerLng)) {
    distanceKm = haversineKm(input.buyerLat!, input.buyerLng!, input.sellerLat!, input.sellerLng!);
  }

  const radiusKm = input.sellerRadiusKm != null && Number.isFinite(input.sellerRadiusKm)
    ? Number(input.sellerRadiusKm)
    : null;
  const outsideRadius = distanceKm != null && radiusKm != null && distanceKm > radiusKm;

  const placeParts = [society, phase].filter(Boolean);
  if (placeParts.length === 0 && address) placeParts.push(address);
  else if (blockFlat) placeParts.push(blockFlat);

  if (placeParts.length === 0 && distanceKm == null) return null;

  const distanceLabel = distanceKm == null
    ? null
    : `${distanceKm < 10 ? distanceKm.toFixed(1) : Math.round(distanceKm)} km away`;

  return {
    label: placeParts.join(', ') || 'Buyer location on file',
    distanceLabel,
    outsideRadius,
    radiusKm,
  };
}

export function buyerLocationPushLine(view: BuyerOrderLocationView | null): string | null {
  if (!view) return null;
  const bits = [view.label];
  if (view.distanceLabel) bits.push(view.distanceLabel);
  if (view.outsideRadius && view.radiusKm != null) {
    bits.push(`outside your ${view.radiusKm} km radius`);
  }
  return bits.join(' · ');
}
