import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchAllProductIdsWithVariants,
  fetchProductVariants,
  VARIANT_PRODUCT_IDS_QUERY_KEY,
  type ProductVariant,
} from '@/lib/product-variants';

const EMPTY_IDS = new Set<string>();
const EMPTY_VARIANTS: ProductVariant[] = [];

/** Products that currently sell by size (backend-driven, cached for 5 minutes). */
export function useVariantProductIds(): Set<string> {
  const { data } = useQuery({
    queryKey: VARIANT_PRODUCT_IDS_QUERY_KEY,
    queryFn: fetchAllProductIdsWithVariants,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
  return data ?? EMPTY_IDS;
}

/** Same set as useVariantProductIds, awaited at action time (reorder) so it is never stale-empty. */
export function useLoadVariantProductIds(): () => Promise<Set<string>> {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      queryClient
        .fetchQuery({
          queryKey: VARIANT_PRODUCT_IDS_QUERY_KEY,
          queryFn: fetchAllProductIdsWithVariants,
          staleTime: 5 * 60 * 1000,
        })
        .catch(() => EMPTY_IDS),
    [queryClient],
  );
}

export function productVariantsQueryKey(productId: string | null | undefined) {
  return ['product-variants', productId ?? null] as const;
}

/** Live sizes of one product in seller order (inactive sizes included so buyers see them as unavailable). */
export function useProductVariants(productId: string | null | undefined, enabled = true) {
  const query = useQuery({
    queryKey: productVariantsQueryKey(productId),
    queryFn: () => fetchProductVariants(productId as string),
    enabled: enabled && !!productId,
    staleTime: 30 * 1000,
  });
  return { ...query, variants: query.data ?? EMPTY_VARIANTS };
}
