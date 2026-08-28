export const HOME_SELLER_LOCATION_HINT =
  'Selling from home? Select your home address or enter your society/locality name.';

export const FREE_DELIVERY_NOTICE =
  'Delivery is free for customers. Sellers cannot charge a separate delivery fee.';

export const SELLING_RADIUS_HELPER =
  'Customers within this distance can discover your products.';

export function isSellerDeliveryMode(mode: string | null | undefined): boolean {
  return mode === 'seller_delivery' || mode === 'pickup_and_seller_delivery';
}

export function sellingRadiusCopy(km: number, fulfillmentMode: string | null | undefined): string {
  const distance = Number.isFinite(km) && km > 0 ? km : 1;
  const discovery = `Your products can be discovered up to ${distance} km away.`;
  if (isSellerDeliveryMode(fulfillmentMode)) {
    return `${discovery} You will be responsible for delivering orders within this area.`;
  }
  return `${discovery} Customers within this distance can find your store.`;
}

export function formatStoreLocationLabel(
  label?: string | null,
  formattedAddress?: string | null,
): string | null {
  const candidates = [label, formattedAddress];
  for (const value of candidates) {
    const trimmed = (value || '').trim();
    if (!trimmed) continue;
    if (/^location set/i.test(trimmed)) continue;
    if (/with a pin/i.test(trimmed)) continue;
    if (/^📍/.test(trimmed) && trimmed.length <= 6) continue;
    return trimmed;
  }
  return null;
}

/** True when selected store type requires a mandatory license upload before submit. */
export function onboardingLicenseMandatory(
  groupRow: { requires_license?: boolean; license_mandatory?: boolean } | null | undefined,
  selectedCategories: string[],
  configs: Array<{ category: string; requires_license?: boolean; license_mandatory?: boolean }>,
): boolean {
  if (groupRow?.requires_license && groupRow?.license_mandatory) return true;
  return configs
    .filter((c) => selectedCategories.includes(c.category))
    .some((c) => c.requires_license && c.license_mandatory);
}

export const LICENSE_ONBOARDING_HINT =
  'Your progress is saved automatically. You can leave and come back anytime to upload your license.';

export function licenseStatusBlocksOnboarding(status: string | null): boolean {
  return !status || status === 'rejected';
}
