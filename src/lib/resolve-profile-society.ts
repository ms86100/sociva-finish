import { supabase } from '@/integrations/supabase/client';

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
 * 2. Otherwise resolves or creates society via resolveOrCreateSocietyForProfile,
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
  if (address.society_id) {
    const inviteCheck = await checkInviteGate(
      address.society_id,
      address.building_name || 'Society',
      options?.inviteCode,
    );
    if (!inviteCheck.ok) return inviteCheck;

    const assigned = await assignSocietyIdToProfile(userId, address.society_id);
    if (!assigned.ok) {
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

  const assigned = await assignSocietyIdToProfile(userId, resolved.societyId);
  if (!assigned.ok) {
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

function slugFromName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
  return `${base || 'society'}-${Date.now()}`;
}

/**
 * Match an existing society or create one (same rules as auth Google/new-society path).
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

  const slug = slugFromName(name);
  const { data: validateData, error: validateError } = await supabase.functions.invoke('validate-society', {
    body: {
      new_society: {
        name,
        slug,
        address: input.address || '',
        city: input.city || '',
        state: input.state || '',
        pincode: input.pincode || '',
        latitude: input.latitude || 0,
        longitude: input.longitude || 0,
        google_place_id: input.google_place_id || null,
      },
    },
  });

  if (validateError) {
    return { ok: false, error: validateError.message || 'Could not set up your society' };
  }
  if (validateData?.error) {
    return { ok: false, error: String(validateData.error) };
  }

  const societyId = validateData?.society?.id as string | undefined;
  if (!societyId) {
    return { ok: false, error: 'Failed to set up your society. Please try again.' };
  }

  // Matched-via-create path (validate-society auto-merge) may still hit invite gate
  if (validateData?.matched) {
    const inviteCheck = await checkInviteGate(
      societyId,
      validateData?.society?.name || name,
      options?.inviteCode,
    );
    if (!inviteCheck.ok) return inviteCheck;
  }

  return {
    ok: true,
    societyId,
    matched: !!validateData?.matched,
    societyName: validateData?.society?.name || name,
  };
}

async function checkInviteGate(
  societyId: string,
  societyName: string,
  inviteCode?: string,
): Promise<ResolveSocietyOk | ResolveSocietyInviteNeeded | ResolveSocietyFail> {
  const { data: society, error } = await supabase
    .from('societies')
    .select('id, name, invite_code')
    .eq('id', societyId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message || 'Could not verify society' };
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

/** Persist membership on the user profile. */
export async function assignSocietyIdToProfile(
  userId: string,
  societyId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from('profiles')
    .update({ society_id: societyId })
    .eq('id', userId)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Profile update did not apply' };
  return { ok: true };
}
