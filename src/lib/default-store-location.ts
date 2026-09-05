import { supabase } from '@/integrations/supabase/client';

export interface DefaultLocationResult {
  latitude: number;
  longitude: number;
  store_location_label: string | null;
  source: 'store' | 'profile' | 'society';
}

/** Prefer existing store pin, then profile coords, then society coords. */
export async function resolveDefaultStoreLocation(input: {
  latitude?: number | null;
  longitude?: number | null;
  storeLocationLabel?: string | null;
  profileLatitude?: number | null;
  profileLongitude?: number | null;
  societyId?: string | null;
}): Promise<DefaultLocationResult | null> {
  if (input.latitude != null && input.longitude != null) {
    return {
      latitude: input.latitude,
      longitude: input.longitude,
      store_location_label: input.storeLocationLabel || null,
      source: 'store',
    };
  }
  if (input.profileLatitude != null && input.profileLongitude != null) {
    return {
      latitude: input.profileLatitude,
      longitude: input.profileLongitude,
      store_location_label: input.storeLocationLabel || 'Home / profile location',
      source: 'profile',
    };
  }
  if (input.societyId) {
    // Prefer member-safe RPC so inactive societies (e.g. Apple Review) still yield a pin
    // when the caller belongs to that society. Falls back to direct select for active rows.
    const { data: rpcRows } = await supabase.rpc('get_member_society_location' as any, {
      p_society_id: input.societyId,
    });
    const rpc = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    if (rpc?.latitude != null && rpc?.longitude != null) {
      return {
        latitude: Number(rpc.latitude),
        longitude: Number(rpc.longitude),
        store_location_label: input.storeLocationLabel || rpc.name || 'Society location',
        source: 'society',
      };
    }

    const { data: soc } = await supabase
      .from('societies')
      .select('latitude, longitude, name')
      .eq('id', input.societyId)
      .maybeSingle();
    if (soc?.latitude != null && soc?.longitude != null) {
      return {
        latitude: Number(soc.latitude),
        longitude: Number(soc.longitude),
        store_location_label: input.storeLocationLabel || soc.name || 'Society location',
        source: 'society',
      };
    }
  }
  return null;
}
