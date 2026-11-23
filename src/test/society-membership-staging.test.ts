import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const from = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  IS_STAGING_SUPABASE: true,
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}));

import { decideMembershipForUser, decideSocietyMembership, fetchOwnMembership, requestSocietyMembership } from '@/lib/society-membership';
import { ensureProfileSocietyFromAddress, resolveOrCreateSocietyForProfile } from '@/lib/resolve-profile-society';

describe('staging membership', () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
  });

  it('joins through request_society_membership RPC', async () => {
    rpc.mockResolvedValue({
      data: { ok: true, status: 'pending', society_id: 'soc-a', membership_id: 'm1' },
      error: null,
    });
    const result = await requestSocietyMembership('user-1', 'soc-a', 'CODE');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe('pending');
    expect(rpc).toHaveBeenCalledWith(
      'request_society_membership',
      expect.objectContaining({ _society_id: 'soc-a', _invite_code: 'CODE' }),
    );
    expect(from).not.toHaveBeenCalled();
  });

  it('treats get_user_society_id as the only active society', async () => {
    rpc.mockResolvedValue({ data: 'soc-active', error: null });
    const membership = await fetchOwnMembership('user-1');
    expect(membership).toEqual({ status: 'active', societyId: 'soc-active' });
    expect(from).not.toHaveBeenCalled();
  });

  it('keeps an existing pending membership instead of inventing a society', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({
              maybeSingle: async () => ({
                data: { society_id: 'soc-pending', status: 'pending' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    });
    const result = await ensureProfileSocietyFromAddress('user-1', {
      building_name: 'Unknown Layout',
      pincode: '94043',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.societyId).toBe('soc-pending');
  });

  it('approves residents through decide_society_membership RPC', async () => {
    rpc.mockResolvedValue({
      data: { ok: true, status: 'active', membership_id: 'm1' },
      error: null,
    });
    const result = await decideSocietyMembership('m1', 'active');
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'decide_society_membership',
      expect.objectContaining({ _membership_id: 'm1', _decision: 'active' }),
    );
  });

  it('resolves a pending membership for a user before profile-only approve', async () => {
    rpc.mockResolvedValue({
      data: { ok: true, status: 'active', membership_id: 'm9' },
      error: null,
    });
    from.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data: { id: 'm9', user_id: 'user-1', society_id: 'soc-a', status: 'pending' },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    });
    const result = await decideMembershipForUser('user-1', 'approved');
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'decide_society_membership',
      expect.objectContaining({ _membership_id: 'm9', _decision: 'active' }),
    );
  });

  it('does not create a society when Maps has no approved match', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const result = await resolveOrCreateSocietyForProfile({
      name: 'Unknown Layout',
      latitude: 12.9,
      longitude: 77.6,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/approved society registry/i);
  });
});
