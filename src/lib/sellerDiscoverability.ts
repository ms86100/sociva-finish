import { supabase } from '@/integrations/supabase/client';
import { hasPreciseCoordinates, SELLER_UNAVAILABLE_NEARBY } from '@/lib/buyerLocation';

const creditRpc = (name: string, args?: Record<string, unknown>) =>
  supabase.rpc(name as never, args as never) as PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;

export async function buyerCanOrderFromSeller(
  sellerId: string | null | undefined,
  lat: number | null | undefined,
  lng: number | null | undefined,
): Promise<{ ok: boolean; reason?: string; message: string }> {
  if (!sellerId) {
    return { ok: false, reason: 'unavailable', message: SELLER_UNAVAILABLE_NEARBY };
  }
  if (!hasPreciseCoordinates(lat, lng)) {
    return { ok: false, reason: 'buyer_location', message: 'Precise location required' };
  }
  const { data, error } = await creditRpc('buyer_can_order_from_seller', {
    p_seller_id: sellerId,
    p_buyer_lat: lat,
    p_buyer_lng: lng,
  });
  if (error) {
    return { ok: false, reason: 'unavailable', message: SELLER_UNAVAILABLE_NEARBY };
  }
  const row = (data || {}) as { ok?: boolean; reason?: string };
  if (row.ok) return { ok: true, message: '' };
  if (row.reason === 'buyer_location') {
    return { ok: false, reason: 'buyer_location', message: 'Precise location required' };
  }
  return { ok: false, reason: row.reason || 'unavailable', message: SELLER_UNAVAILABLE_NEARBY };
}

export async function filterDiscoverableProductIds(
  productIds: string[],
  lat: number | null | undefined,
  lng: number | null | undefined,
): Promise<Set<string>> {
  if (productIds.length === 0 || !hasPreciseCoordinates(lat, lng)) return new Set();
  const { data, error } = await creditRpc('filter_discoverable_product_ids', {
    p_product_ids: productIds,
    p_buyer_lat: lat,
    p_buyer_lng: lng,
  });
  if (error || !Array.isArray(data)) return new Set();
  return new Set((data as string[]).filter(Boolean));
}

export async function filterDiscoverableSellerIds(
  sellerIds: string[],
  lat: number | null | undefined,
  lng: number | null | undefined,
): Promise<Set<string>> {
  if (sellerIds.length === 0 || !hasPreciseCoordinates(lat, lng)) return new Set();
  const { data, error } = await creditRpc('filter_discoverable_seller_ids', {
    p_seller_ids: sellerIds,
    p_buyer_lat: lat,
    p_buyer_lng: lng,
  });
  if (error || !Array.isArray(data)) return new Set();
  return new Set((data as string[]).filter(Boolean));
}
