// @ts-nocheck
import { supabase } from '@/integrations/supabase/client';

export interface ResolvedProduct {
  id: string;
  name: string;
  price: number;
  mrp: number | null;
  image_url: string | null;
  category: string | null;
  is_veg: boolean | null;
  is_available: boolean;
  is_bestseller: boolean;
  stock_quantity: number | null;
  low_stock_threshold: number | null;
  seller_id: string;
}

interface ResolveOptions {
  sourceType: 'category' | 'search' | 'manual';
  sourceValue: string | null;
  sectionId?: string;
  fallbackMode?: 'hide' | 'popular';
  limit?: number;
  societyId?: string;
  buyerLat?: number;
  buyerLng?: number;
  bannerId?: string;
}

/**
 * Resolves products for a banner section based on source type.
 */
export async function resolveProducts(options: ResolveOptions): Promise<ResolvedProduct[]> {
  const {
    sourceType, sourceValue, sectionId,
    fallbackMode = 'hide', limit = 20,
    societyId, buyerLat, buyerLng, bannerId,
  } = options;

  let products: ResolvedProduct[] = [];

  if (sourceType === 'manual' && sectionId) {
    products = await fetchManual(sectionId, limit, societyId, buyerLat, buyerLng, bannerId);
  } else if (societyId) {
    products = await fetchViaRpc(sourceType, sourceValue, societyId, buyerLat, buyerLng, limit, bannerId);
  } else {
    if (sourceType === 'category' && sourceValue) {
      products = await fetchByCategory(sourceValue, limit);
    } else if (sourceType === 'search' && sourceValue) {
      products = await fetchBySearch(sourceValue, limit);
    }
  }

  if (products.length === 0 && fallbackMode === 'popular') {
    if (societyId) {
      products = await fetchViaRpc('popular', null, societyId, buyerLat, buyerLng, limit, bannerId);
    } else {
      products = await fetchPopular(limit);
    }
  }

  return products;
}

/**
 * Batch-resolves all sections' products for a banner in a single RPC call.
 * Returns a Map of sectionId -> ResolvedProduct[].
 */
export async function resolveBannerSections(options: {
  bannerId: string;
  societyId?: string;
  buyerLat?: number;
  buyerLng?: number;
  limitPerSection?: number;
}): Promise<Map<string, ResolvedProduct[]>> {
  const { bannerId, societyId, buyerLat, buyerLng, limitPerSection = 20 } = options;

  const { data, error } = await supabase.rpc('resolve_banner_section_products', {
    p_banner_id: bannerId,
    p_society_id: societyId ?? null,
    p_buyer_lat: buyerLat ?? null,
    p_buyer_lng: buyerLng ?? null,
    p_limit_per_section: limitPerSection,
  });

  const result = new Map<string, ResolvedProduct[]>();

  if (error || !data) return result;

  for (const row of data as any[]) {
    const sectionId = row.section_id;
    if (!result.has(sectionId)) {
      result.set(sectionId, []);
    }
    result.get(sectionId)!.push({
      id: row.product_id,
      name: row.product_name,
      price: row.product_price,
      mrp: row.product_mrp,
      image_url: row.product_image_url,
      category: row.product_category,
      is_veg: row.product_is_veg,
      is_available: row.product_is_available,
      is_bestseller: row.product_is_bestseller,
      stock_quantity: row.product_stock_quantity,
      low_stock_threshold: row.product_low_stock_threshold,
      seller_id: row.product_seller_id,
    });
  }

  return result;
}

/** Society-aware resolution via server-side RPC */
async function fetchViaRpc(
  mode: string,
  value: string | null,
  societyId: string,
  buyerLat?: number,
  buyerLng?: number,
  limit: number = 20,
  bannerId?: string,
): Promise<ResolvedProduct[]> {
  const { data } = await supabase.rpc('resolve_banner_products', {
    p_mode: mode,
    p_value: value || '',
    p_society_id: societyId,
    p_buyer_lat: buyerLat ?? null,
    p_buyer_lng: buyerLng ?? null,
    p_limit: limit,
    p_banner_id: bannerId ?? null,
  });

  return (data as ResolvedProduct[]) || [];
}

/** Manual section: fetch product IDs from join table, then validate eligibility */
async function fetchManual(
  sectionId: string,
  limit: number,
  societyId?: string,
  buyerLat?: number,
  buyerLng?: number,
  bannerId?: string,
): Promise<ResolvedProduct[]> {
  const { data } = await supabase
    .from('banner_section_products')
    .select(`
      display_order,
      product:products!inner(id, name, price, mrp, image_url, category, is_veg, is_available, is_bestseller, stock_quantity, low_stock_threshold, seller_id)
    `)
    .eq('section_id', sectionId)
    .order('display_order', { ascending: true })
    .limit(limit);

  if (!data) return [];

  let products = data
    .map((row: any) => row.product as ResolvedProduct)
    .filter((p: ResolvedProduct) => p.is_available && (p.stock_quantity ?? 0) > 0);

  if (societyId && products.length > 0) {
    const eligibleIds = new Set<string>();
    const { data: eligible } = await supabase.rpc('resolve_banner_products', {
      p_mode: 'popular',
      p_value: '',
      p_society_id: societyId,
      p_buyer_lat: buyerLat ?? null,
      p_buyer_lng: buyerLng ?? null,
      p_limit: 1000,
      p_banner_id: bannerId ?? null,
    });
    if (eligible) {
      for (const p of eligible as any[]) {
        eligibleIds.add(p.id);
      }
    }
    products = products.filter(p => eligibleIds.has(p.id));
  }

  return products;
}

// ── Legacy fallback functions (used when no society context) ──

async function fetchByCategory(category: string, limit: number): Promise<ResolvedProduct[]> {
  const { data } = await supabase
    .from('products')
    .select('id, name, price, mrp, image_url, category, is_veg, is_available, is_bestseller, stock_quantity, low_stock_threshold, seller_id')
    .eq('category', category)
    .eq('is_available', true)
    .eq('approval_status', 'approved')
    .gt('stock_quantity', 0)
    .order('is_bestseller', { ascending: false })
    .order('is_recommended', { ascending: false })
    .order('price', { ascending: true })
    .limit(limit);

  return (data as ResolvedProduct[]) || [];
}

async function fetchBySearch(keyword: string, limit: number): Promise<ResolvedProduct[]> {
  const { data } = await supabase.rpc('search_products_fts', {
    _query: keyword,
    _limit: limit * 3,
  });

  if (!data) return [];

  return (data as any[])
    .filter((p: any) => p.is_available && p.approval_status === 'approved' && (p.stock_quantity ?? 0) > 0)
    .slice(0, limit)
    .map((p: any): ResolvedProduct => ({
      id: p.id,
      name: p.name,
      price: p.price,
      mrp: p.mrp,
      image_url: p.image_url,
      category: p.category,
      is_veg: p.is_veg,
      is_available: p.is_available,
      is_bestseller: p.is_bestseller,
      stock_quantity: p.stock_quantity,
      low_stock_threshold: p.low_stock_threshold,
      seller_id: p.seller_id,
    }));
}

async function fetchPopular(limit: number): Promise<ResolvedProduct[]> {
  const { data } = await supabase
    .from('products')
    .select('id, name, price, mrp, image_url, category, is_veg, is_available, is_bestseller, stock_quantity, low_stock_threshold, seller_id')
    .eq('is_available', true)
    .eq('approval_status', 'approved')
    .gt('stock_quantity', 0)
    .eq('is_bestseller', true)
    .order('price', { ascending: true })
    .limit(limit);

  return (data as ResolvedProduct[]) || [];
}
