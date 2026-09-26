const IN_STORE_MODES = new Set([
  'self_pickup',
  'pickup_and_seller_delivery',
  'pickup_and_platform_delivery',
  'at_store',
  'both',
]);

export function effectiveHomeService(opts: {
  sellerHome?: boolean | null;
  productHome?: boolean | null;
}): boolean {
  if (opts.productHome === false) return false;
  if (opts.productHome === true) return true;
  return opts.sellerHome === true;
}

/** One buyer-facing line. Empty when home service is off. */
export function homeServiceBuyerLabel(opts: {
  sellerHome?: boolean | null;
  productHome?: boolean | null;
  fulfillmentMode?: string | null;
  category?: string | null;
}): string | null {
  if (!effectiveHomeService(opts)) return null;
  const mode = opts.fulfillmentMode || 'self_pickup';
  if (!IN_STORE_MODES.has(mode)) return 'Home service available';
  if (opts.category === 'salon') return 'Available at salon and home';
  return 'Available at store and home';
}
