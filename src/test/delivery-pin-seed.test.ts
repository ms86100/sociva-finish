import { describe, expect, it } from 'vitest';
import { seedDeliveryAddress, seedFromBrowsingLocation, seedFromSociety } from '@/lib/delivery-pin-seed';

describe('delivery pin seed', () => {
  const lakeview = {
    name: 'Lakeview Proof Residency',
    latitude: 18.52,
    longitude: 73.85,
    pincode: '411014',
    address: 'Pune',
  };
  const leftoverBrowse = {
    lat: 13.08,
    lng: 77.64,
    label: 'Shriram Greenfield Phase-2, Tower H',
    fullAddress: 'Bommenahalli',
  };

  it('does not treat leftover browse coords as the joined society', () => {
    const seed = seedDeliveryAddress({
      society: lakeview,
      browsingLocation: leftoverBrowse,
      preferSociety: true,
    });
    expect(seed?.building_name).toBe('Lakeview Proof Residency');
    expect(seed?.pincode).toBe('411014');
    expect(seed?.latitude).toBe(18.52);
  });

  it('lets checkout reuse a browse pin when the user already has a society', () => {
    const seed = seedDeliveryAddress({
      society: lakeview,
      browsingLocation: leftoverBrowse,
      preferSociety: false,
    });
    expect(seed?.building_name).toBe('Shriram Greenfield Phase-2, Tower H');
  });

  it('returns null when there is no society name and no browse pin', () => {
    expect(seedFromSociety(null)).toBeNull();
    expect(seedFromBrowsingLocation(null)).toBeNull();
    expect(seedDeliveryAddress({ preferSociety: true })).toBeNull();
  });
});
