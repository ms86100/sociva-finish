import { describe, expect, it } from 'vitest';
import { featurePlainName, friendlyPackageLabel } from '@/lib/feature-catalog-copy';

describe('feature catalog copy', () => {
  it('maps pilot slug to a builder-facing label', () => {
    expect(friendlyPackageLabel('sociva_pilot_ops')).toBe('Sociva Pilot Ops');
    expect(friendlyPackageLabel('sociva_core')).toBe('Sociva Core');
  });

  it('uses Indian RWA names for ops keys', () => {
    expect(featurePlainName('parcel_management')).toBe('Parcels at the gate');
    expect(featurePlainName('visitor_management')).toBe('Visitor passes');
    expect(featurePlainName('maintenance')).toBe('Maintenance dues');
  });
});
