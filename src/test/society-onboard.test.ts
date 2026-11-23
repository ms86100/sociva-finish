import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.fn();
const rpc = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  IS_STAGING_SUPABASE: true,
  supabase: {
    from: (...args: unknown[]) => from(...args),
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

import { assignPackageToSociety, createSocietyRecord, slugifyLabel } from '@/lib/society-onboard';

function chain(result: { data: unknown; error: unknown }) {
  const api: Record<string, unknown> = {};
  const self = () => api;
  api.select = self;
  api.insert = () => ({ select: () => ({ single: async () => result }) });
  api.update = () => ({ eq: async () => result });
  api.eq = self;
  api.limit = () => ({ maybeSingle: async () => result });
  api.order = () => ({ limit: () => ({ maybeSingle: async () => result }) });
  api.maybeSingle = async () => result;
  api.single = async () => result;
  return api;
}

describe('society onboard', () => {
  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
  });

  it('slugifies society names without unicode dashes', () => {
    expect(slugifyLabel('Shriram Greenfield Phase 2')).toBe('shriram-greenfield-phase-2');
  });

  it('creates a society as unverified until admin approval', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'societies') {
        return chain({ data: { id: 'soc-new' }, error: null });
      }
      return chain({ data: null, error: null });
    });
    const result = await createSocietyRecord({ name: 'Shriram Greenfield' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.id).toBe('soc-new');
    expect(from).toHaveBeenCalledWith('societies');
  });

  it('assigns a package through the rate-limited admin RPC', async () => {
    rpc.mockResolvedValue({ data: { builder_id: 'builder-1' }, error: null });

    const result = await assignPackageToSociety({
      societyId: 'soc-a',
      packageId: 'pkg-pilot',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.id).toBe('builder-1');
    expect(rpc).toHaveBeenCalledWith('admin_assign_society_package', {
      _society_id: 'soc-a',
      _package_id: 'pkg-pilot',
      _builder_id: null,
    });
  });

  it('relinks an existing society to a newly created builder', async () => {
    rpc.mockResolvedValue({ data: { builder_id: 'new-builder' }, error: null });

    const result = await assignPackageToSociety({
      societyId: 'soc-a',
      packageId: 'pkg-pilot',
      builderId: 'new-builder',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.id).toBe('new-builder');
    expect(rpc).toHaveBeenCalledWith('admin_assign_society_package', {
      _society_id: 'soc-a',
      _package_id: 'pkg-pilot',
      _builder_id: 'new-builder',
    });
  });
});
