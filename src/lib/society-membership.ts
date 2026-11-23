import { IS_STAGING_SUPABASE, supabase } from '@/integrations/supabase/client';

export type MembershipRequestResult =
  | { ok: true; status: string; societyId: string; membershipId?: string }
  | { ok: false; error: string; inviteRequired?: boolean };

function isMissingRpc(message: string | undefined): boolean {
  return /could not find the function|schema cache|PGRST202|does not exist/i.test(message || '');
}

/**
 * Staging: join only through request_society_membership (approved registry + invite).
 * Production: unchanged client profile update until the RPC is promoted.
 */
export async function requestSocietyMembership(
  userId: string,
  societyId: string,
  inviteCode?: string,
): Promise<MembershipRequestResult> {
  if (IS_STAGING_SUPABASE) {
    const { data, error } = await supabase.rpc('request_society_membership' as never, {
      _society_id: societyId,
      _invite_code: inviteCode?.trim() || null,
    } as never);
    // Staging never PATCHes profiles.society_id from the client.
    if (error) {
      const msg = error.message || 'Could not request membership';
      if (/invite_required/i.test(msg)) {
        return { ok: false, error: 'invite_required', inviteRequired: true };
      }
      return { ok: false, error: msg };
    }
    const payload = (data || {}) as {
      ok?: boolean;
      status?: string;
      society_id?: string;
      membership_id?: string;
    };
    return {
      ok: true,
      status: payload.status || 'pending',
      societyId: payload.society_id || societyId,
      membershipId: payload.membership_id,
    };
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({ society_id: societyId })
    .eq('id', userId)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Profile update did not apply' };
  return { ok: true, status: 'assigned', societyId };
}

export async function assignSocietyIdToProfile(
  userId: string,
  societyId: string,
  inviteCode?: string,
): Promise<{ ok: true } | { ok: false; error: string; inviteRequired?: boolean }> {
  const result = await requestSocietyMembership(userId, societyId, inviteCode);
  if (!result.ok) {
    return result.inviteRequired
      ? { ok: false, error: result.error, inviteRequired: true }
      : { ok: false, error: result.error };
  }
  return { ok: true };
}

export function isVisitorRpcAvailable(): boolean {
  return IS_STAGING_SUPABASE;
}

export type OwnMembershipStatus = 'active' | 'pending' | 'rejected' | 'suspended' | 'removed' | 'none';

export type OwnMembership = {
  status: OwnMembershipStatus;
  societyId: string | null;
};

export async function fetchOwnMembership(userId: string): Promise<OwnMembership> {
  if (!IS_STAGING_SUPABASE || !userId) {
    return { status: 'none', societyId: null };
  }

  const { data: active } = await supabase.rpc('get_user_society_id' as never, {
    _user_id: userId,
  } as never);
  if (active) return { status: 'active', societyId: String(active) };

  const { data } = await supabase
    .from('society_memberships' as never)
    .select('society_id, status')
    .eq('user_id', userId)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as { society_id?: string; status?: OwnMembershipStatus } | null;
  if (!row?.status) return { status: 'none', societyId: null };
  return { status: row.status, societyId: row.society_id || null };
}

export type MembershipDecision = 'active' | 'rejected' | 'suspended' | 'removed';

export type PendingMembership = {
  id: string;
  user_id: string;
  society_id: string;
  status: OwnMembershipStatus;
  requested_at?: string | null;
  name?: string | null;
  phone?: string | null;
  block?: string | null;
  flat_number?: string | null;
};

export type DecideMembershipResult =
  | { ok: true; status: string; membershipId: string }
  | { ok: false; error: string; missing?: boolean };

function verificationToDecision(status: string): MembershipDecision | null {
  if (status === 'approved') return 'active';
  if (status === 'rejected') return 'rejected';
  if (status === 'suspended') return 'suspended';
  return null;
}

export async function decideSocietyMembership(
  membershipId: string,
  decision: MembershipDecision,
): Promise<DecideMembershipResult> {
  if (!IS_STAGING_SUPABASE) {
    return { ok: false, error: 'membership_rpc_unavailable' };
  }
  const { data, error } = await supabase.rpc('decide_society_membership' as never, {
    _membership_id: membershipId,
    _decision: decision,
  } as never);
  if (error) return { ok: false, error: error.message || 'Could not update membership' };
  const payload = (data || {}) as { ok?: boolean; status?: string; membership_id?: string };
  return {
    ok: true,
    status: payload.status || decision,
    membershipId: payload.membership_id || membershipId,
  };
}

export async function findPendingMembershipForUser(userId: string): Promise<PendingMembership | null> {
  const { data } = await supabase
    .from('society_memberships' as never)
    .select('id, user_id, society_id, status, requested_at')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as PendingMembership | null) || null;
}

export async function decideMembershipForUser(
  userId: string,
  verificationStatus: string,
): Promise<DecideMembershipResult> {
  const decision = verificationToDecision(verificationStatus);
  if (!decision) return { ok: false, error: 'unsupported_decision' };

  if (!IS_STAGING_SUPABASE) {
    const { error } = await supabase
      .from('profiles')
      .update({ verification_status: verificationStatus })
      .eq('id', userId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, status: verificationStatus, membershipId: userId };
  }

  const pending = await findPendingMembershipForUser(userId);
  if (!pending) return { ok: false, error: 'no_membership', missing: true };
  return decideSocietyMembership(pending.id, decision);
}

export async function listPendingMemberships(societyId?: string): Promise<PendingMembership[]> {
  let query = supabase
    .from('society_memberships' as never)
    .select('id, user_id, society_id, status, requested_at')
    .eq('status', 'pending');
  if (societyId) query = query.eq('society_id', societyId);
  const { data, error } = await query.order('requested_at', { ascending: false }).limit(200);
  if (error || !data) return [];
  const rows = data as PendingMembership[];
  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, name, phone, block, flat_number')
    .in('id', userIds);
  const byId = new Map((profiles || []).map((p: { id: string }) => [p.id, p]));
  return rows.map((row) => {
    const profile = byId.get(row.user_id) as
      | { name?: string; phone?: string; block?: string; flat_number?: string }
      | undefined;
    return {
      ...row,
      name: profile?.name || null,
      phone: profile?.phone || null,
      block: profile?.block || null,
      flat_number: profile?.flat_number || null,
    };
  });
}

export { isMissingRpc, verificationToDecision };
