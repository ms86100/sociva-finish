import { beforeEach, describe, expect, it, vi } from 'vitest';
import { filterApprovedSocieties, SOCIETY_NOT_IN_REGISTRY } from '@/lib/approved-societies';

const rpc = vi.fn();
const eq = vi.fn();
const from = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}));

import { fetchApprovedSocieties, submitSocietyRegistryRequest } from '@/lib/approved-societies';

describe('approved societies', () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
    eq.mockReset();
  });

  it('filters the admin-approved list by name and pincode', () => {
    const rows = [
      { id: 'a', name: 'Shriram Greenfield Phase-2, Tower H', city: 'Bommenahalli', pincode: '560049' },
      { id: 'b', name: 'Palm Breeze Apartments', city: 'Bangalore', pincode: '560001' },
    ];
    expect(filterApprovedSocieties(rows, 'greenfield').map((s) => s.id)).toEqual(['a']);
    expect(filterApprovedSocieties(rows, '560001').map((s) => s.id)).toEqual(['b']);
    expect(filterApprovedSocieties(rows, 'x')).toEqual([]);
  });

  it('loads only verified active societies', async () => {
    const order = vi.fn(async () => ({ data: [{ id: 'soc-1', name: 'Live' }], error: null }));
    const eqVerified = vi.fn(() => ({ order }));
    eq.mockReturnValue({ eq: eqVerified });
    from.mockReturnValue({ select: () => ({ eq }) });

    const rows = await fetchApprovedSocieties();
    expect(rows).toEqual([{ id: 'soc-1', name: 'Live' }]);
    expect(from).toHaveBeenCalledWith('societies');
    expect(eq).toHaveBeenCalledWith('is_active', true);
    expect(eqVerified).toHaveBeenCalledWith('is_verified', true);
  });

  it('submits a registry request instead of creating a society', async () => {
    rpc.mockResolvedValue({ data: { ok: true, id: 'req-1' }, error: null });
    const result = await submitSocietyRegistryRequest({
      name: 'New Enclave',
      city: 'Pune',
      pincode: '411001',
    });
    expect(result).toEqual({ ok: true, id: 'req-1' });
    expect(rpc).toHaveBeenCalledWith(
      'submit_society_registry_request',
      expect.objectContaining({ _name: 'New Enclave', _city: 'Pune', _pincode: '411001' }),
    );
  });

  it('keeps the registry-only copy for unmatched maps pins', () => {
    expect(SOCIETY_NOT_IN_REGISTRY).toMatch(/approved society registry/i);
  });
});
