import { supabase } from '@/integrations/supabase/client';
import { SOCIETY_NOT_IN_REGISTRY } from '@/lib/approved-societies';
import { assignSocietyIdToProfile as assignMembership, fetchOwnMembership } from '@/lib/society-membership';

export type ResolveSocietyInput = {
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  google_place_id?: string | null;
};

export type ResolveSocietyOk = {
  ok: true;
  societyId: string;
  matched: boolean;
  societyName: string;
};

export type ResolveSocietyInviteNeeded = {
  ok: false;
  error: 'invite_required';
  societyId: string;
  societyName: string;
  inviteRequired: true;
};

export type ResolveSocietyFail = {
  ok: false;
  error: string;
  inviteRequired?: false;
};

export type ResolveSocietyResult = ResolveSocietyOk | ResolveSocietyInviteNeeded | ResolveSocietyFail;

/**
 * Automatically ensures profile.society_id is set using an existing delivery address.
 * 1. If address.society_id is already set, assigns it to user profile.
 * 2. Otherwise matches an admin-approved society via resolveOrCreateSocietyForProfile,
 *    assigns to user profile, and updates the address row with the society_id.
 */
export async function ensureProfileSocietyFromAddress(
  userId: string,
  address: {
    id?: string;
    society_id?: string | null;
    building_name?: string | null;
    full_address?: string | null;
    pincode?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    google_place_id?: string | null;
  },
  options?: { inviteCode?: string },
): Promise<ResolveSocietyResult> {
  const existing = await fetchOwnMembership(userId);
  if (existing.societyId && (existing.status === 'active' || existing.status === 'pending')) {
    return {
      ok: true,
      societyId: existing.societyId,
      matched: true,
      societyName: address.building_name || 'Society',
    };
  }

  if (address.society_id) {
    const inviteCheck = await checkInviteGate(
      address.society_id,
      address.building_name || 'Society',
      options?.inviteCode,
    );
    if (!inviteCheck.ok) return inviteCheck;

    const assigned = await assignSocietyIdToProfile(userId, address.society_id, options?.inviteCode);
    if (!assigned.ok) {
      if ((assigned as { inviteRequired?: boolean }).inviteRequired) {
        return {
          ok: false,
          error: 'invite_required',
          societyId: address.society_id,
          societyName: address.building_name || 'Society',
          inviteRequired: true,
        };
      }
      return { ok: false, error: assigned.error };
    }
    return {
      ok: true,
      societyId: address.society_id,
      matched: true,
      societyName: address.building_name || 'Society',
    };
  }

  const name = (address.building_name || address.full_address || '').trim();
  if (!name && !(address.latitude && address.longitude)) {
    return { ok: false, error: 'Please enter building name or location on map' };
  }

  const resolved = await resolveOrCreateSocietyForProfile(
    {
      name: name || 'My society',
      address: address.full_address || '',
      city: '',
      state: '',
      pincode: address.pincode || '',
      latitude: address.latitude,
      longitude: address.longitude,
      google_place_id: address.google_place_id || null,
    },
    options,
  );

  if (!resolved.ok) return resolved;

  const assigned = await assignSocietyIdToProfile(userId, resolved.societyId, options?.inviteCode);
  if (!assigned.ok) {
    if ((assigned as { inviteRequired?: boolean }).inviteRequired) {
      return {
        ok: false,
        error: 'invite_required',
        societyId: resolved.societyId,
        societyName: resolved.societyName,
        inviteRequired: true,
      };
    }
    return { ok: false, error: assigned.error };
  }

  if (address.id) {
    try {
      await supabase
        .from('delivery_addresses')
        .update({ society_id: resolved.societyId })
        .eq('id', address.id);
    } catch {
      // Non-critical
    }
  }

  return resolved;
}

/**
 * Match an admin-approved society only. Maps never creates a society.
 * Invite-locked societies require a matching inviteCode before returning ok.
 */
export async function resolveOrCreateSocietyForProfile(
  input: ResolveSocietyInput,
  options?: { inviteCode?: string },
): Promise<ResolveSocietyResult> {
  const name = (input.name || '').trim();
  if (!name) {
    return { ok: false, error: 'Building or society name is required' };
  }

  let matches: Array<{
    society_id: string;
    society_name: string;
    match_type?: string;
    confidence: number;
  }> | null = null;

  try {
    const { data } = await supabase.rpc('resolve_society', {
      _input_name: name,
      _lat: input.latitude ?? null,
      _lng: input.longitude ?? null,
      _google_place_id: input.google_place_id ?? null,
    });
    matches = (data as typeof matches) || null;
  } catch {
    matches = null;
  }

  const top = matches?.[0];
  if (top && top.confidence >= 0.8 && top.society_id) {
    const inviteCheck = await checkInviteGate(top.society_id, top.society_name || name, options?.inviteCode);
    if (!inviteCheck.ok) return inviteCheck;
    return {
      ok: true,
      societyId: top.society_id,
      matched: true,
      societyName: top.society_name || name,
    };
  }

  return { ok: false, error: SOCIETY_NOT_IN_REGISTRY };
}

async function checkInviteGate(
  societyId: string,
  societyName: string,
  inviteCode?: string,
): Promise<ResolveSocietyOk | ResolveSocietyInviteNeeded | ResolveSocietyFail> {
  const { data: society, error } = await supabase
    .from('societies')
    .select('id, name, invite_code, is_verified, is_active')
    .eq('id', societyId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message || 'Could not verify society' };
  }

  if (!society || society.is_verified !== true || society.is_active !== true) {
    return { ok: false, error: SOCIETY_NOT_IN_REGISTRY };
  }

  const required = (society?.invite_code || '').trim();
  if (!required) {
    return {
      ok: true,
      societyId,
      matched: true,
      societyName: society?.name || societyName,
    };
  }

  const provided = (inviteCode || '').trim();
  if (!provided || provided.toLowerCase() !== required.toLowerCase()) {
    return {
      ok: false,
      error: 'invite_required',
      societyId,
      societyName: society?.name || societyName,
      inviteRequired: true,
    };
  }

  return {
    ok: true,
    societyId,
    matched: true,
    societyName: society?.name || societyName,
  };
}

/** Persist membership on the user profile (staging uses membership RPC). */
export async function assignSocietyIdToProfile(
  userId: string,
  societyId: string,
  inviteCode?: string,
): Promise<{ ok: true } | { ok: false; error: string; inviteRequired?: boolean }> {
  return assignMembership(userId, societyId, inviteCode);
}
