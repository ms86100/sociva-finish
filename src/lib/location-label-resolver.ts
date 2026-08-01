// @ts-nocheck
/// <reference types="@types/google.maps" />

const PLUS_CODE_REGEX = /^[23456789CFGHJMPQRVWX]+\+/;

/** Labels considered too generic to be useful */
const GENERIC_LABELS = [
  'unnamed road', 'unnamed', 'unknown', 'unknown road',
  'service road', 'main road', 'road',
];

/** Quality tiers – higher is better */
export enum LabelQuality {
  Coords = 0,
  Route = 1,
  Sublocality = 2,
  Neighborhood = 3,
  Premise = 4,
  POI = 5, // point_of_interest / establishment / places result
}

export interface ResolvedLabel {
  name: string;
  quality: LabelQuality;
  formattedAddress?: string;
}

function isGeneric(label: string): boolean {
  return GENERIC_LABELS.includes(label.toLowerCase().trim());
}

function isPlusCode(text: string): boolean {
  return PLUS_CODE_REGEX.test(text);
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Score a single geocoder result and return the best candidate from it.
 * NOTE: We no longer reject results whose formatted_address starts with a plus code,
 * because the address_components may still contain a useful POI name.
 */
function scoreGeocoderResult(result: google.maps.GeocoderResult): ResolvedLabel | null {
  // Skip results that are purely plus_code type with no useful components
  if (result.types.includes('plus_code' as any) && (!result.address_components || result.address_components.length <= 2)) {
    return null;
  }

  const components = result.address_components || [];
  const get = (type: string) => components.find(c => c.types.includes(type))?.long_name;

  // Derive the best formatted address: prefer the one from this result if it's not a plus code
  const formattedAddr = isPlusCode(result.formatted_address)
    ? undefined // will be filled by extractBestFormattedAddress separately
    : result.formatted_address;

  // POI-level
  const poi = get('point_of_interest') || get('establishment');
  if (poi && !isGeneric(poi)) return { name: poi, quality: LabelQuality.POI, formattedAddress: formattedAddr };

  const premise = get('premise');
  if (premise && !isGeneric(premise)) return { name: premise, quality: LabelQuality.Premise, formattedAddress: formattedAddr };

  const neighborhood = get('neighborhood');
  if (neighborhood && !isGeneric(neighborhood)) return { name: neighborhood, quality: LabelQuality.Neighborhood, formattedAddress: formattedAddr };

  const sublocality = get('sublocality_level_1') || get('sublocality');
  if (sublocality && !isGeneric(sublocality)) return { name: sublocality, quality: LabelQuality.Sublocality, formattedAddress: formattedAddr };

  const route = get('route');
  if (route && !isGeneric(route)) return { name: route, quality: LabelQuality.Route, formattedAddress: formattedAddr };

  // Fallback to first segment of formatted address (only if it's not a plus code)
  if (formattedAddr) {
    const firstSeg = formattedAddr.split(',')[0]?.trim();
    if (firstSeg && !isPlusCode(firstSeg) && !isGeneric(firstSeg)) {
      return { name: firstSeg, quality: LabelQuality.Route, formattedAddress: formattedAddr };
    }
  }

  return null;
}

/**
 * Extract the best label from an array of geocoder results.
 */
export function extractBestLabel(results: google.maps.GeocoderResult[]): ResolvedLabel | null {
  let best: ResolvedLabel | null = null;
  for (const result of results) {
    const candidate = scoreGeocoderResult(result);
    if (candidate && (!best || candidate.quality > best.quality)) {
      best = candidate;
    }
    // Short-circuit if we already found a POI
    if (best?.quality === LabelQuality.POI) break;
  }

  // If best label has no formattedAddress yet, try to get one from the results
  if (best && !best.formattedAddress) {
    const addr = extractBestFormattedAddress(results);
    if (addr) best.formattedAddress = addr;
  }

  return best;
}

/**
 * Extract the best human-readable formatted address from geocoder results.
 * Skips plus-code addresses and overly generic ones (just city/state).
 * Returns a street-level or area-level formatted address.
 */
export function extractBestFormattedAddress(results: google.maps.GeocoderResult[]): string | null {
  for (const result of results) {
    const addr = result.formatted_address;
    if (!addr) continue;
    if (isPlusCode(addr)) continue;
    // Skip overly generic (just locality/political)
    const types = result.types || [];
    if (types.length === 1 && (types[0] === 'locality' || types[0] === 'political' || types[0] === 'country')) continue;
    // Must have at least a route or sublocality for street-level detail
    const components = result.address_components || [];
    const hasDetail = components.some(c =>
      c.types.includes('route') ||
      c.types.includes('sublocality') ||
      c.types.includes('sublocality_level_1') ||
      c.types.includes('neighborhood') ||
      c.types.includes('premise') ||
      c.types.includes('street_number')
    );
    if (hasDetail) return addr;
  }
  // If nothing with street detail, return first non-plus-code address
  for (const result of results) {
    if (result.formatted_address && !isPlusCode(result.formatted_address)) {
      return result.formatted_address;
    }
  }
  return null;
}

/**
 * Use Places API to find a nearby POI name.
 * Filters out overly generic results and ignores POIs that are too far from the pin.
 */
export async function findNearbyPlaceName(
  _map: google.maps.Map,
  lat: number,
  lng: number,
  options?: { maxDistanceMeters?: number }
): Promise<ResolvedLabel | null> {
  // Generous radius — POI coordinates registered in Google can be 30-80m off
  // from the actual storefront, so a tight filter misses the establishment
  // directly under the pin and we fall back to a useless area name.
  const maxDistanceMeters = options?.maxDistanceMeters ?? 90;

  try {
    const { Place, SearchNearbyRankPreference } =
      (await google.maps.importLibrary('places')) as google.maps.PlacesLibrary;

    const { places } = await Place.searchNearby({
      fields: ['displayName', 'location', 'types'],
      locationRestriction: {
        center: { lat, lng },
        radius: Math.max(maxDistanceMeters, 100),
      },
      rankPreference: SearchNearbyRankPreference.DISTANCE,
      maxResultCount: 15,
    });

    // Collect all valid establishment candidates with their distance
    const candidates: { name: string; dist: number; isEstablishment: boolean }[] = [];

    for (const place of places || []) {
      const name = (place as any).displayName as string | undefined;
      const loc = (place as any).location;
      const types = ((place as any).types || []) as string[];
      if (!name || !loc) continue;
      if (isGeneric(name) || isPlusCode(name)) continue;
      if (
        types.includes('locality') ||
        types.includes('administrative_area_level_1') ||
        types.includes('administrative_area_level_2') ||
        types.includes('country') ||
        types.includes('postal_code') ||
        types.includes('route')
      ) {
        continue;
      }

      const placeLat = Number(typeof loc.lat === 'function' ? loc.lat() : loc.lat);
      const placeLng = Number(typeof loc.lng === 'function' ? loc.lng() : loc.lng);
      const dist = distanceMeters(lat, lng, placeLat, placeLng);
      if (dist > maxDistanceMeters) continue;

      const isEstablishment =
        types.includes('establishment') ||
        types.includes('point_of_interest') ||
        types.includes('store') ||
        types.includes('restaurant') ||
        types.includes('food') ||
        types.includes('cafe');

      candidates.push({ name, dist, isEstablishment });
    }

    if (candidates.length === 0) return null;

    // Prefer real establishments (storefronts) over generic places (intersections,
    // bus stops). Within each group, take the nearest.
    candidates.sort((a, b) => {
      if (a.isEstablishment !== b.isEstablishment) return a.isEstablishment ? -1 : 1;
      return a.dist - b.dist;
    });

    const winner = candidates[0];
    console.info('[LocationResolver] (New) Places fallback:', winner.name, 'distance(m):', Math.round(winner.dist));
    return { name: winner.name, quality: LabelQuality.POI };
  } catch (err) {
    console.warn('[LocationResolver] Place.searchNearby failed:', err);
    return null;
  }
}

/**
 * Pick the better of two resolved labels. Returns the higher quality one.
 */
export function pickBetterLabel(
  a: ResolvedLabel | null,
  b: ResolvedLabel | null
): ResolvedLabel | null {
  if (!a) return b;
  if (!b) return a;
  return b.quality >= a.quality ? b : a;
}

/**
 * Check if a label quality is too generic to display alone
 * (i.e. we should try a Places fallback).
 */
export function isLowQualityLabel(label: ResolvedLabel | null): boolean {
  if (!label) return true;
  return label.quality <= LabelQuality.Route || isGeneric(label.name);
}

/**
 * Format coordinates as a display string (last resort).
 */
export function formatCoords(lat: number, lng: number): ResolvedLabel {
  return { name: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, quality: LabelQuality.Coords };
}
