import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { jitteredStaleTime } from '@/lib/query-utils';

export interface ProductFacetRow {
  id: string;
  tags: string[] | null;
  cuisine_type: string | null;
  subcategory_id: string | null;
  stock_quantity: number | null;
  serving_size: string | null;
  unit_type: string | null;
  price_per_unit: string | null;
  prep_time_minutes: number | null;
  service_duration_minutes: number | null;
  delivery_time_text: string | null;
  service_scope: string | null;
  description: string | null;
  minimum_charge: number | null;
  visit_charge: number | null;
}

/** Overlay glance/filter fields from products onto a marketplace/search row. */
export function applyProductFacetRow<T extends Record<string, any>>(product: T, row?: ProductFacetRow | null): T {
  if (!row) return product;
  return {
    ...product,
    tags: row.tags || product.tags,
    cuisine_type: row.cuisine_type || product.cuisine_type,
    subcategory_id: row.subcategory_id || product.subcategory_id,
    stock_quantity: row.stock_quantity ?? product.stock_quantity,
    serving_size: row.serving_size ?? product.serving_size,
    unit_type: row.unit_type ?? product.unit_type,
    price_per_unit: row.price_per_unit ?? product.price_per_unit,
    prep_time_minutes: row.prep_time_minutes ?? product.prep_time_minutes,
    service_duration_minutes: row.service_duration_minutes ?? product.service_duration_minutes,
    delivery_time_text: row.delivery_time_text ?? product.delivery_time_text,
    service_scope: row.service_scope ?? product.service_scope,
    description: row.description ?? product.description,
    minimum_charge: row.minimum_charge ?? product.minimum_charge,
    visit_charge: row.visit_charge ?? product.visit_charge,
  };
}

export function useProductFacets(productIds: string[], enabled = true) {
  const unique = [...new Set(productIds.filter(Boolean))].sort();
  const idsKey = unique.join(',');

  return useQuery({
    queryKey: ['product-facets', idsKey],
    queryFn: async (): Promise<Record<string, ProductFacetRow>> => {
      if (unique.length === 0) return {};
      const { data, error } = await supabase
        .from('products')
        .select('id, tags, cuisine_type, subcategory_id, stock_quantity, serving_size, unit_type, price_per_unit, prep_time_minutes, service_duration_minutes, delivery_time_text, service_scope, description, minimum_charge, visit_charge')
        .in('id', unique);
      if (error) {
        console.error('Product facets load failed:', error);
        return {};
      }
      const map: Record<string, ProductFacetRow> = {};
      for (const row of data || []) {
        map[(row as ProductFacetRow).id] = row as ProductFacetRow;
      }
      return map;
    },
    enabled: enabled && unique.length > 0,
    staleTime: jitteredStaleTime(5 * 60 * 1000),
  });
}
