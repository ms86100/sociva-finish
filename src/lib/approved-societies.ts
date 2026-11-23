import { supabase } from '@/integrations/supabase/client';

export type ApprovedSociety = {
  id: string;
  name: string;
  slug?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  invite_code?: string | null;
  geofence_radius_meters?: number | null;
};

export const APPROVED_SOCIETY_REQUIRED =
  'Pick an approved Sociva society. Maps cannot create or join a community.';

export const SOCIETY_NOT_IN_REGISTRY =
  'This location is not in the approved society registry. Request it from Sociva admin before joining.';

export async function fetchApprovedSocieties(): Promise<ApprovedSociety[]> {
  const { data, error } = await supabase
    .from('societies')
    .select('id, name, slug, address, city, state, pincode, latitude, longitude, invite_code, geofence_radius_meters')
    .eq('is_active', true)
    .eq('is_verified', true)
    .order('name');
  if (error) return [];
  return (data as ApprovedSociety[]) || [];
}

export function filterApprovedSocieties(societies: ApprovedSociety[], query: string): ApprovedSociety[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return societies.filter((s) =>
    [s.name, s.city, s.state, s.pincode, s.address]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q),
  );
}

export type RegistryRequestInput = {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  landmark?: string;
  contact?: string;
};

export async function submitSocietyRegistryRequest(
  input: RegistryRequestInput,
): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
  const name = (input.name || '').trim();
  if (name.length < 3) {
    return { ok: false, error: 'Enter the society name' };
  }

  const { data, error } = await supabase.rpc('submit_society_registry_request' as never, {
    _name: name,
    _address: input.address?.trim() || null,
    _city: input.city?.trim() || null,
    _state: input.state?.trim() || null,
    _pincode: input.pincode?.trim() || null,
    _landmark: input.landmark?.trim() || null,
    _contact: input.contact?.trim() || null,
  } as never);

  if (error) return { ok: false, error: error.message || 'Could not submit request' };
  const payload = (data || {}) as { ok?: boolean; id?: string };
  return { ok: true, id: payload.id };
}
