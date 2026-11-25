export type MembershipLike = {
  status?: string | null;
  societyId?: string | null;
};

/** True when the user already belongs to a society and must not be sent through join. */
export function hasAssignedSociety(opts: {
  societyId?: string | null;
  effectiveSocietyId?: string | null;
  membership?: MembershipLike | null;
}): boolean {
  if (opts.societyId) return true;
  if (opts.effectiveSocietyId) return true;
  const status = opts.membership?.status || 'none';
  if (!opts.membership?.societyId) return false;
  return status === 'active' || status === 'pending';
}
