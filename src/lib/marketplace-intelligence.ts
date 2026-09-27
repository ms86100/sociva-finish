/**
 * Pure helpers for seller intelligence. Safe to unit test.
 * Sellers see aggregates. Admins see identity. Amplitude gets name, never phone or email.
 */

export type OrderStatusBucket =
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'open'
  | 'failed'
  | 'other';

const COMPLETED = new Set(['delivered', 'completed', 'buyer_received']);
const OPEN = new Set([
  'placed',
  'pending',
  'accepted',
  'confirmed',
  'preparing',
  'ready',
  'on_the_way',
  'picked_up',
  'en_route',
  'at_gate',
  'arrived',
  'payment_pending',
  'assigned',
  'scheduled',
  'in_progress',
  'enquired',
  'quoted',
]);
const OUT_FOR_DELIVERY = new Set(['picked_up', 'on_the_way', 'en_route', 'at_gate', 'arrived']);
const FAILED = new Set(['failed', 'returned', 'no_show']);

export function classifyOrderBucket(
  status: string | null | undefined,
  rejectionReason?: string | null,
): OrderStatusBucket {
  const value = String(status || '').toLowerCase();
  if (COMPLETED.has(value)) return 'completed';
  if (value === 'rejected') return 'rejected';
  if (value === 'cancelled') {
    return String(rejectionReason || '').trim() ? 'rejected' : 'cancelled';
  }
  if (FAILED.has(value)) return 'failed';
  if (OPEN.has(value)) return 'open';
  return 'other';
}

export function isOutForDelivery(status: string | null | undefined): boolean {
  return OUT_FOR_DELIVERY.has(String(status || '').toLowerCase());
}

/** One product view per person per UTC day. Two timestamps on that day share a key. */
export function productViewDayKey(userId: string, productId: string, viewedAt: Date): string {
  const day = viewedAt.toISOString().slice(0, 10);
  return `${userId}|${productId}|${day}`;
}

export function conversionPercent(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

export type OnboardingStage =
  | 'started'
  | 'category_selected'
  | 'product_added'
  | 'store_details'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'hold'
  | 'live'
  | 'first_order';

export function onboardingStageFromStep(step: number | null | undefined): OnboardingStage {
  const value = Number(step) || 1;
  if (value >= 4) return 'store_details';
  if (value === 3) return 'product_added';
  return 'category_selected';
}

export function stageFromSellerStore(store: {
  verification_status?: string | null;
  business_name?: string | null;
  is_available?: boolean | null;
} | null | undefined): string | null {
  if (!store) return null;
  const name = store.business_name || '';
  if (/^\[HOLD\]/i.test(name)) return 'hold';
  if (/^\[ARCHIVED\]/i.test(name)) return 'archived';
  const status = String(store.verification_status || '').toLowerCase();
  if (status === 'approved' && store.is_available) return 'live';
  if (status === 'approved') return 'approved';
  if (status === 'rejected') return 'rejected';
  if (status === 'pending') return 'submitted';
  if (status === 'draft') return 'store_details';
  return status || null;
}

const BUYER_IDENTITY_KEYS = /^(viewer_id|user_id|buyer_id|buyer_name|phone|email)$/i;

/** Drop buyer identity keys from a seller-facing payload. Search terms stay. */
export function stripBuyerIdentity<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripBuyerIdentity(item)) as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (BUYER_IDENTITY_KEYS.test(key)) continue;
      out[key] = stripBuyerIdentity(child);
    }
    return out as T;
  }
  return value;
}

const BLOCKED_IDENTIFY_KEYS = /phone|email|otp|password|token/i;

/** Traits safe to send to Amplitude. Name is allowed. Phone and email are not. */
export function identifyTraitsForAmplitude(
  traits: Record<string, string | number | boolean | null | undefined>,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(traits)) {
    if (BLOCKED_IDENTIFY_KEYS.test(key)) continue;
    if (value === undefined) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) continue;
      out[key] = trimmed;
      continue;
    }
    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}
