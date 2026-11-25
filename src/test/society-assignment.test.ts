import { describe, expect, it } from 'vitest';
import { hasAssignedSociety } from '@/lib/society-assignment';

describe('hasAssignedSociety', () => {
  it('treats profile society_id as assigned', () => {
    expect(hasAssignedSociety({ societyId: 'soc-a' })).toBe(true);
  });

  it('treats active membership as assigned even without profile society_id', () => {
    expect(
      hasAssignedSociety({
        societyId: null,
        membership: { status: 'active', societyId: 'soc-a' },
      }),
    ).toBe(true);
  });

  it('treats pending membership as assigned so join is not repeated', () => {
    expect(
      hasAssignedSociety({
        societyId: null,
        membership: { status: 'pending', societyId: 'soc-a' },
      }),
    ).toBe(true);
  });

  it('does not treat rejected or empty membership as assigned', () => {
    expect(
      hasAssignedSociety({
        societyId: null,
        membership: { status: 'rejected', societyId: 'soc-a' },
      }),
    ).toBe(false);
    expect(hasAssignedSociety({ societyId: null, membership: { status: 'none', societyId: null } })).toBe(false);
  });

  it('treats effectiveSocietyId as assigned for returning residents', () => {
    expect(hasAssignedSociety({ societyId: null, effectiveSocietyId: 'soc-a' })).toBe(true);
  });
});
