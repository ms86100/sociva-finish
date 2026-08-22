/** Shared buyer coordinate + seller discovery helpers. */

export function hasPreciseCoordinates(lat: unknown, lng: unknown): boolean {
  if (lat == null || lng == null || lat === '' || lng === '') return false;
  const latitude = typeof lat === 'number' ? lat : Number(lat);
  const longitude = typeof lng === 'number' ? lng : Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return false;
  if (Math.abs(latitude) < 0.0001 && Math.abs(longitude) < 0.0001) return false;
  return true;
}

export const PRECISE_LOCATION_TITLE = 'Precise location required';
export const PRECISE_LOCATION_BODY =
  'Your selected address does not have a precise map location. Please update your location so we can confirm seller availability and delivery distance.';
export const SELLER_UNAVAILABLE_NEARBY =
  'This seller is not available for your location right now.';
