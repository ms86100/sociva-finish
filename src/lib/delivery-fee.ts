/**
 * Platform delivery fee — must match create_multi_vendor_orders /
 * resolve_platform_delivery_fee on the server.
 */
export function resolvePlatformDeliveryFee(opts: {
  fulfillmentType: string | null | undefined;
  cartSubtotal: number;
  baseDeliveryFee: number;
  freeDeliveryThreshold: number;
}): number {
  if ((opts.fulfillmentType || 'delivery') !== 'delivery') return 0;
  const base = Number.isFinite(opts.baseDeliveryFee) ? Math.max(0, opts.baseDeliveryFee) : 0;
  const threshold = Number.isFinite(opts.freeDeliveryThreshold)
    ? Math.max(0, opts.freeDeliveryThreshold)
    : 0;
  if (opts.cartSubtotal >= threshold) return 0;
  return base;
}

/** Normalise system_settings jsonb / string values to a plain string. */
export function settingValueToString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'string' || typeof parsed === 'number' || typeof parsed === 'boolean') {
        return String(parsed);
      }
    } catch {
      // plain string
    }
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function parseSettingNumber(raw: string | null | undefined, fallback: number): number {
  if (raw == null || raw === '') return fallback;
  const str = settingValueToString(raw).trim();
  if (!str) return fallback;
  const n = Number(str);
  return Number.isFinite(n) ? n : fallback;
}
