import { supabase } from '@/integrations/supabase/client';

/** One purchasable size of an Add to Cart product (row of public.product_variants). */
export interface ProductVariant {
  id: string;
  product_id: string;
  label: string;
  price: number;
  compare_at_price: number | null;
  stock_quantity: number | null;
  low_stock_threshold: number | null;
  is_active: boolean;
  sort_order: number;
  image_url: string | null;
  archived_at: string | null;
}

export const VARIANT_PRODUCT_IDS_QUERY_KEY = ['variant-product-ids'] as const;

const VARIANT_COLUMNS =
  'id, product_id, label, price, compare_at_price, stock_quantity, low_stock_threshold, is_active, sort_order, image_url, archived_at';

// product_variants is newer than the generated Supabase types.
const db = supabase as unknown as { from: (table: string) => any };

function normalize(row: any): ProductVariant {
  return {
    ...row,
    price: Number(row.price),
    compare_at_price: row.compare_at_price == null ? null : Number(row.compare_at_price),
    stock_quantity: row.stock_quantity == null ? null : Number(row.stock_quantity),
    low_stock_threshold: row.low_stock_threshold == null ? null : Number(row.low_stock_threshold),
    sort_order: Number(row.sort_order ?? 0),
  };
}

export function cartLineKey(productId: string, variantId?: string | null): string {
  return `${productId}::${variantId ?? ''}`;
}

export function isVariantLive(v: Pick<ProductVariant, 'is_active' | 'archived_at'>): boolean {
  return v.is_active && !v.archived_at;
}

export function isVariantPurchasable(v: ProductVariant): boolean {
  return isVariantLive(v) && (v.stock_quantity == null || v.stock_quantity > 0);
}

/**
 * A cart line for a size behaves like the product at that size's price and stock,
 * so totals, coupon math and the checkout unit_price all use the size values.
 */
export function applyVariantToProduct<T extends Record<string, any>>(product: T, variant: ProductVariant | null | undefined): T {
  if (!variant) return product;
  return {
    ...product,
    price: variant.price,
    mrp: variant.compare_at_price,
    stock_quantity: variant.stock_quantity,
    image_url: variant.image_url || product.image_url,
  };
}

/** Live sizes of one product, in seller order. Missing table (pre-migration) reads as no sizes. */
export async function fetchProductVariants(productId: string): Promise<ProductVariant[]> {
  const { data, error } = await db
    .from('product_variants')
    .select(VARIANT_COLUMNS)
    .eq('product_id', productId)
    .is('archived_at', null)
    .order('sort_order', { ascending: true })
    .order('price', { ascending: true });
  if (error) return [];
  return (data || []).map(normalize);
}

export async function fetchVariantsByIds(ids: string[]): Promise<Map<string, ProductVariant>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, ProductVariant>();
  if (unique.length === 0) return map;
  const { data, error } = await db.from('product_variants').select(VARIANT_COLUMNS).in('id', unique);
  if (error) return map;
  for (const row of data || []) map.set(row.id, normalize(row));
  return map;
}

/** Product ids (from the given list) that have at least one live size. */
export async function fetchProductIdsWithVariants(productIds: string[]): Promise<Set<string>> {
  const unique = [...new Set(productIds.filter(Boolean))];
  const result = new Set<string>();
  if (unique.length === 0) return result;
  const { data, error } = await db
    .from('product_variants')
    .select('product_id')
    .in('product_id', unique)
    .is('archived_at', null);
  if (error) return result;
  for (const row of data || []) result.add(row.product_id);
  return result;
}

/** Number of non-archived sizes per product, for the seller's product list. */
export async function fetchVariantCounts(productIds: string[]): Promise<Record<string, number>> {
  const unique = [...new Set(productIds.filter(Boolean))];
  const counts: Record<string, number> = {};
  if (unique.length === 0) return counts;
  const { data, error } = await db
    .from('product_variants')
    .select('product_id')
    .in('product_id', unique)
    .is('archived_at', null);
  if (error) return counts;
  for (const row of data || []) counts[row.product_id] = (counts[row.product_id] || 0) + 1;
  return counts;
}

/**
 * All products that sell by size. Matches the cart trigger: any non-archived size,
 * even one switched off, means a cart line must name a size. Cached by the caller.
 */
export async function fetchAllProductIdsWithVariants(): Promise<Set<string>> {
  const { data, error } = await db
    .from('product_variants')
    .select('product_id')
    .is('archived_at', null);
  if (error) return new Set();
  return new Set((data || []).map((row: { product_id: string }) => row.product_id));
}

/** Buyer-facing copy for size errors raised by the cart triggers and checkout. */
export function variantErrorMessage(error: unknown): string | null {
  const msg = String((error as any)?.message || error || '');
  if (msg.includes('VARIANT_REQUIRED')) return 'Please choose a size for this item.';
  if (msg.includes('VARIANT_NOT_AVAILABLE')) return 'This size is no longer available.';
  if (msg.includes('VARIANT_IN_USE')) return 'This size is in carts or orders. Turn it off instead of deleting it.';
  if (msg.includes('SIZES_DISABLED')) return 'Sizes are not available yet. Save the product without sizes for now.';
  if (msg.includes('PRODUCT_MERGED')) return 'This listing is now a size of another product. Change it from that product.';
  if (msg.includes('VARIANTS_NOT_SUPPORTED') && msg.includes('before changing how it is sold')) {
    return "Remove this product's sizes before changing how it is sold.";
  }
  if (msg.includes('VARIANTS_NOT_SUPPORTED')) return 'Sizes are only available for Add to Cart products.';
  return null;
}
