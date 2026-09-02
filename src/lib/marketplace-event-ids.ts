const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PostgREST rejects non-UUID values on uuid columns with HTTP 400. */
export function isMarketplaceUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function canRecordMarketplaceEvent(productId: unknown, sellerId: unknown): boolean {
  return isMarketplaceUuid(productId) && isMarketplaceUuid(sellerId);
}
