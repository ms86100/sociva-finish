export const SERVICE_LOCATION_OPTIONS = [
  { value: 'at_seller', label: 'At Seller Location' },
  { value: 'at_store', label: 'At Store Location' },
  { value: 'home_visit', label: 'Home Visit' },
  { value: 'online', label: 'Online' },
] as const;

export type ServiceLocationValue = (typeof SERVICE_LOCATION_OPTIONS)[number]['value'];

export function serviceLocationLabel(value: string | null | undefined): string {
  const match = SERVICE_LOCATION_OPTIONS.find((o) => o.value === value);
  return match?.label || (value ? value.replace(/_/g, ' ') : 'At Seller Location');
}

export function normalizeServiceLocationTypes(
  row?: { location_types?: string[] | null; location_type?: string | null } | null,
): string[] {
  if (row?.location_types?.length) return [...row.location_types];
  if (row?.location_type) return [row.location_type];
  return ['at_seller'];
}

export function primaryServiceLocationType(types: string[]): string {
  return types[0] || 'at_seller';
}

export function serviceLocationNeedsAddress(locationType: string | null | undefined): boolean {
  return locationType === 'home_visit' || locationType === 'at_buyer';
}

/** Map service location → orders.fulfillment_type (self_pickup | delivery | seller_delivery). */
export function serviceLocationToFulfillmentType(
  locationType: string | null | undefined,
): 'self_pickup' | 'delivery' | 'seller_delivery' {
  if (locationType === 'home_visit' || locationType === 'at_buyer') return 'seller_delivery';
  // at_store / at_seller / online / unknown → pickup-style fulfillment on the order row
  return 'self_pickup';
}
