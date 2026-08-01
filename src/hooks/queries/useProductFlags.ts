// @ts-nocheck
import { supabase } from '@/integrations/supabase/client';
import { ProductWithSeller } from '@/components/product/ProductListingCard';

/**
 * Given a list of products from the RPC (which lacks is_bestseller, is_recommended, is_urgent),
 * batch-fetch the real flags from the products table and merge them back.
 */
export async function mergeProductFlags(products: ProductWithSeller[]): Promise<ProductWithSeller[]> {
  if (products.length === 0) return products;

  const ids = [...new Set(products.map(p => p.id))];
  if (ids.length === 0) return products;

  const { data: flags, error } = await supabase
    .from('products')
    .select('id, is_bestseller, is_recommended, is_urgent')
    .in('id', ids);

  if (error || !flags) return products;

  const flagMap = new Map<string, { is_bestseller: boolean; is_recommended: boolean; is_urgent: boolean }>();
  for (const f of flags as any[]) {
    flagMap.set(f.id, {
      is_bestseller: f.is_bestseller ?? false,
      is_recommended: f.is_recommended ?? false,
      is_urgent: f.is_urgent ?? false,
    });
  }

  return products.map(p => {
    const f = flagMap.get(p.id);
    return f ? { ...p, ...f } : p;
  });
}
