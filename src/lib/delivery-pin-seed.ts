export type SocietyPinSeed = {
  name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  pincode?: string | null;
  address?: string | null;
};

export type BrowsingPinSeed = {
  lat?: number;
  lng?: number;
  label?: string;
  fullAddress?: string;
  secondaryLabel?: string;
};

export type DeliveryAddressSeed = {
  latitude: number | null;
  longitude: number | null;
  full_address: string;
  building_name: string;
  pincode: string;
};

export function seedFromSociety(society: SocietyPinSeed | null | undefined): DeliveryAddressSeed | null {
  if (!society?.name?.trim()) return null;
  return {
    latitude: typeof society.latitude === 'number' ? society.latitude : null,
    longitude: typeof society.longitude === 'number' ? society.longitude : null,
    full_address: society.address?.trim() || '',
    building_name: society.name.trim(),
    pincode: society.pincode?.trim() || '',
  };
}

export function seedFromBrowsingLocation(browsingLocation: BrowsingPinSeed | null | undefined): DeliveryAddressSeed | null {
  if (!browsingLocation?.lat || !browsingLocation?.lng) return null;
  return {
    latitude: browsingLocation.lat,
    longitude: browsingLocation.lng,
    full_address: browsingLocation.fullAddress || browsingLocation.secondaryLabel || browsingLocation.label || '',
    building_name: browsingLocation.label || '',
    pincode: '',
  };
}

/**
 * First-time join: pin the joined society, never a leftover device browse pin.
 * Later "add address": browse pin is fine for marketplace checkout.
 */
export function seedDeliveryAddress(args: {
  society?: SocietyPinSeed | null;
  browsingLocation?: BrowsingPinSeed | null;
  preferSociety: boolean;
}): DeliveryAddressSeed | null {
  const fromSociety = seedFromSociety(args.society);
  const fromBrowse = seedFromBrowsingLocation(args.browsingLocation);
  if (args.preferSociety) return fromSociety || fromBrowse;
  return fromBrowse || fromSociety;
}
