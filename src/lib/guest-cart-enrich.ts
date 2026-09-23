/**
 * Guest marketplace cards store a flat product snapshot (seller_name, optional
 * fulfillment_mode) without nested `product.seller`. Cart checkout reads
 * seller.fulfillment_mode / payment configs — hydrate those for guests.
 */

import { supabase } from '@/integrations/supabase/client';
import type { Product } from '@/types/Database';
import type { GuestCartLine } from '@/lib/guest-cart';

export const GUEST_SELLER_SELECT =
  'id, business_name, user_id, is_available, availability_start, availability_end, operating_days, profile_image_url, cover_image_url, primary_group, accepts_cod, accepts_upi, upi_id, upi_verification_status, fulfillment_mode, minimum_order_amount, daily_order_limit, packaging_fee, pickup_payment_config, delivery_payment_config, store_location_label, latitude, longitude, society:societies(name, latitude, longitude)';

type SellerRow = Record<string, unknown>;

/** Attach a minimal seller object from flat discovery fields when nested seller is missing. */
export function normalizeGuestProductSeller(product: Product | null | undefined): Product | null {
  if (!product || typeof product !== 'object') return product ?? null;
  const p = product as Product & {
    seller?: SellerRow | null;
    seller_name?: string | null;
    fulfillment_mode?: string | null;
    accepts_cod?: boolean | null;
    accepts_upi?: boolean | null;
  };
  if (p.seller && typeof p.seller === 'object' && (p.seller as SellerRow).id) {
    const seller = p.seller as SellerRow;
    if (!seller.business_name && p.seller_name) {
      return {
        ...p,
        seller: { ...seller, business_name: p.seller_name },
      } as Product;
    }
    return p;
  }
  if (!p.seller_id) return p;
  return {
    ...p,
    seller: {
      id: p.seller_id,
      business_name: p.seller_name || 'Seller',
      fulfillment_mode: p.fulfillment_mode || null,
      accepts_cod: p.accepts_cod ?? null,
      accepts_upi: p.accepts_upi ?? null,
    },
  } as Product;
}

export function guestCartNeedsSellerHydration(lines: GuestCartLine[]): boolean {
  return lines.some((line) => {
    const p = line.product as Product & { seller?: SellerRow | null };
    if (!p?.seller_id) return false;
    const seller = p.seller;
    if (!seller || typeof seller !== 'object') return true;
    return seller._guestHydrated !== true;
  });
}

export async function fetchSellersForGuestCart(
  sellerIds: string[],
): Promise<Map<string, SellerRow>> {
  const unique = [...new Set(sellerIds.filter(Boolean))];
  const map = new Map<string, SellerRow>();
  if (unique.length === 0) return map;

  const { data, error } = await supabase
    .from('seller_profiles')
    .select(GUEST_SELLER_SELECT)
    .in('id', unique);

  if (error) {
    console.warn('[guest-cart] seller hydrate failed', error.message);
    return map;
  }
  for (const row of data || []) {
    if (row?.id) map.set(String(row.id), row as SellerRow);
  }
  return map;
}

export function applySellerHydration(
  lines: GuestCartLine[],
  sellers: Map<string, SellerRow>,
): GuestCartLine[] {
  return lines.map((line) => {
    const normalized = normalizeGuestProductSeller(line.product);
    if (!normalized?.seller_id) {
      return { ...line, product: normalized || line.product };
    }
    const fetched = sellers.get(normalized.seller_id);
    if (!fetched) {
      // Mark attempted hydrate so we don't refetch forever when seller row is missing
      const existing = (normalized as Product & { seller?: SellerRow }).seller || {};
      return {
        ...line,
        product: {
          ...normalized,
          seller: { ...existing, _guestHydrated: true },
        } as Product,
      };
    }
    const existing = (normalized as Product & { seller?: SellerRow }).seller || {};
    return {
      ...line,
      product: {
        ...normalized,
        seller: {
          ...existing,
          ...fetched,
          business_name:
            fetched.business_name ||
            existing.business_name ||
            (normalized as Product & { seller_name?: string }).seller_name ||
            'Seller',
          _guestHydrated: true,
        },
      } as Product,
    };
  });
}
