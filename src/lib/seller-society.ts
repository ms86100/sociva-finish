/**
 * Last-resort society attach for seller submit when signup society was skipped.
 * Primary path: Auth "Find Your Society" → profiles.society_id → seller draft copies it.
 * Store map location ≠ society membership — approval requires society_id.
 */
import { supabase } from '@/integrations/supabase/client';

const EARTH_KM = 6371;
/** Radius for matching store pin → registered society (residential societies can be sparse). */
const DEFAULT_MATCH_KM = 15;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface SocietyMatch {
  id: string;
  name: string;
  distanceKm: number;
}

/** Find nearest registered society with coordinates within maxKm. */
export async function findNearestSociety(
  lat: number,
  lng: number,
  maxKm = DEFAULT_MATCH_KM,
): Promise<SocietyMatch | null> {
  const { data, error } = await supabase
    .from('societies')
    .select('id, name, latitude, longitude')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .limit(500);

  if (error || !data?.length) return null;

  let best: SocietyMatch | null = null;
  for (const row of data) {
    const sLat = Number(row.latitude);
    const sLng = Number(row.longitude);
    if (!Number.isFinite(sLat) || !Number.isFinite(sLng)) continue;
    const distanceKm = haversineKm(lat, lng, sLat, sLng);
    if (distanceKm > maxKm) continue;
    if (!best || distanceKm < best.distanceKm) {
      best = { id: row.id, name: row.name || 'Society', distanceKm };
    }
  }
  return best;
}

/** Prefer society already used on a delivery address for this user. */
export async function findSocietyFromUserAddresses(userId: string): Promise<SocietyMatch | null> {
  const { data, error } = await supabase
    .from('delivery_addresses')
    .select('society_id')
    .eq('user_id', userId)
    .not('society_id', 'is', null)
    .order('is_default', { ascending: false })
    .limit(5);

  if (error || !data?.length) return null;
  const societyId = data.find((r) => r.society_id)?.society_id as string | undefined;
  if (!societyId) return null;

  const { data: society } = await supabase
    .from('societies')
    .select('id, name')
    .eq('id', societyId)
    .maybeSingle();

  return {
    id: societyId,
    name: society?.name || 'Your society',
    distanceKm: 0,
  };
}

async function linkSocietyToAccount(
  userId: string,
  sellerId: string,
  societyId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error: profileErr } = await supabase
    .from('profiles')
    .update({ society_id: societyId } as any)
    .eq('id', userId);
  if (profileErr) {
    return {
      ok: false,
      error: 'Could not link your account to a society. Please try again from Profile.',
    };
  }
  await supabase
    .from('seller_profiles')
    .update({ society_id: societyId } as any)
    .eq('id', sellerId);
  return { ok: true };
}

export interface EnsureSocietyResult {
  ok: boolean;
  societyId: string | null;
  societyName?: string;
  /** Linked profile and/or seller during this call */
  linked: boolean;
  error?: string;
}

/**
 * Ensure the seller (and profile when possible) have a society_id before submit.
 * Prefers existing profile/seller society; then delivery-address society; then nearest to store pin.
 */
export async function ensureSellerSocietyForSubmit(opts: {
  userId: string;
  sellerId: string;
  profileSocietyId?: string | null;
  sellerSocietyId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): Promise<EnsureSocietyResult> {
  const { userId, sellerId, profileSocietyId, sellerSocietyId, latitude, longitude } = opts;

  let societyId = profileSocietyId || sellerSocietyId || null;

  if (!societyId) {
    const fromAddress = await findSocietyFromUserAddresses(userId);
    if (fromAddress) {
      const linked = await linkSocietyToAccount(userId, sellerId, fromAddress.id);
      if (!linked.ok) {
        return { ok: false, societyId: null, linked: false, error: linked.error };
      }
      return {
        ok: true,
        societyId: fromAddress.id,
        societyName: fromAddress.name,
        linked: true,
      };
    }
  }

  if (!societyId && latitude != null && longitude != null) {
    const match = await findNearestSociety(latitude, longitude);
    if (match) {
      const linked = await linkSocietyToAccount(userId, sellerId, match.id);
      if (!linked.ok) {
        return { ok: false, societyId: null, linked: false, error: linked.error };
      }
      return {
        ok: true,
        societyId: match.id,
        societyName: match.name,
        linked: true,
      };
    }

    return {
      ok: false,
      societyId: null,
      linked: false,
      error:
        'Your map pin is set, but no registered society is nearby. Join or request your society from Profile, then submit again.',
    };
  }

  if (!societyId) {
    return {
      ok: false,
      societyId: null,
      linked: false,
      error:
        'Link your account to a society in Profile before submitting. Setting a map pin alone is not enough — Sociva needs a society membership for store approval.',
    };
  }

  // Sync seller ← profile when seller row is missing society
  if (profileSocietyId && !sellerSocietyId) {
    await supabase
      .from('seller_profiles')
      .update({ society_id: profileSocietyId } as any)
      .eq('id', sellerId);
  }

  // Sync profile ← seller when profile is missing but seller has society
  if (!profileSocietyId && sellerSocietyId) {
    await supabase
      .from('profiles')
      .update({ society_id: sellerSocietyId } as any)
      .eq('id', userId);
    return { ok: true, societyId: sellerSocietyId, linked: true };
  }

  return { ok: true, societyId, linked: false };
}
