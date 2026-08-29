/**
 * resolveOrCreateSocietyForProfile — match vs create + invite gate.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const invoke = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select, update: vi.fn(() => ({ eq: vi.fn(() => ({ select: vi.fn(() => ({ maybeSingle })) })) })) }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    from: (...args: unknown[]) => from(...args),
  },
}));

import {
  resolveOrCreateSocietyForProfile,
  assignSocietyIdToProfile,
} from '@/lib/resolve-profile-society';

describe('resolveOrCreateSocietyForProfile', () => {
  beforeEach(() => {
    rpc.mockReset();
    invoke.mockReset();
    maybeSingle.mockReset();
    from.mockClear();
    select.mockClear();
    eq.mockClear();
  });

  it('rejects empty name', async () => {
    const result = await resolveOrCreateSocietyForProfile({ name: '  ' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/required/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('uses high-confidence resolve_society match without invite', async () => {
    rpc.mockResolvedValue({
      data: [{ society_id: 'soc-1', society_name: 'Green Heights', confidence: 0.95 }],
      error: null,
    });
    maybeSingle.mockResolvedValue({
      data: { id: 'soc-1', name: 'Green Heights', invite_code: null },
      error: null,
    });

    const result = await resolveOrCreateSocietyForProfile({
      name: 'Green Heights',
      latitude: 12.9,
      longitude: 77.6,
    });

    expect(result).toEqual({
      ok: true,
      societyId: 'soc-1',
      matched: true,
      societyName: 'Green Heights',
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('requires invite code when matched society is invite-locked', async () => {
    rpc.mockResolvedValue({
      data: [{ society_id: 'soc-2', society_name: 'Private Towers', confidence: 0.9 }],
      error: null,
    });
    maybeSingle.mockResolvedValue({
      data: { id: 'soc-2', name: 'Private Towers', invite_code: 'AB12CD' },
      error: null,
    });

    const blocked = await resolveOrCreateSocietyForProfile({ name: 'Private Towers' });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.error).toBe('invite_required');
      expect(blocked.inviteRequired).toBe(true);
    }

    const joined = await resolveOrCreateSocietyForProfile(
      { name: 'Private Towers' },
      { inviteCode: 'ab12cd' },
    );
    expect(joined).toEqual({
      ok: true,
      societyId: 'soc-2',
      matched: true,
      societyName: 'Private Towers',
    });
  });

  it('creates a society via validate-society when no strong match', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    invoke.mockResolvedValue({
      data: { valid: true, society: { id: 'new-9', name: 'Sunrise Enclave' } },
      error: null,
    });

    const result = await resolveOrCreateSocietyForProfile({
      name: 'Sunrise Enclave',
      address: 'MG Road',
      pincode: '560001',
      latitude: 12.97,
      longitude: 77.59,
    });

    expect(result).toEqual({
      ok: true,
      societyId: 'new-9',
      matched: false,
      societyName: 'Sunrise Enclave',
    });
    expect(invoke).toHaveBeenCalledWith(
      'validate-society',
      expect.objectContaining({
        body: expect.objectContaining({
          new_society: expect.objectContaining({ name: 'Sunrise Enclave' }),
        }),
      }),
    );
  });
});

describe('assignSocietyIdToProfile', () => {
  beforeEach(() => {
    maybeSingle.mockReset();
  });

  it('updates profiles.society_id', async () => {
    maybeSingle.mockResolvedValue({ data: { id: 'user-1' }, error: null });
    const result = await assignSocietyIdToProfile('user-1', 'soc-1');
    expect(result).toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith('profiles');
  });
});
