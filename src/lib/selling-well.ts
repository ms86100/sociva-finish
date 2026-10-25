/** Listing cards that sold, with a cap so one store cannot fill the rail. */

export interface SellingWellListing {
  id: string;
  seller_id?: string | null;
  completed_order_count?: number | null;
}

export function listingsSellingWell<T extends SellingWellListing>(
  products: readonly T[],
  options?: {
    maxPerSeller?: number;
    minSellers?: number;
    limit?: number;
  },
): T[] {
  const maxPerSeller = options?.maxPerSeller ?? 2;
  const minSellers = options?.minSellers ?? 2;
  const limit = options?.limit ?? 8;
  const ranked = products
    .filter((product) => (product.completed_order_count || 0) > 0)
    .slice()
    .sort((a, b) => (b.completed_order_count || 0) - (a.completed_order_count || 0));

  const perSeller = new Map<string, number>();
  const out: T[] = [];
  for (const product of ranked) {
    const key = product.seller_id || product.id;
    const taken = perSeller.get(key) || 0;
    if (taken >= maxPerSeller) continue;
    perSeller.set(key, taken + 1);
    out.push(product);
    if (out.length >= limit) break;
  }

  if (perSeller.size < minSellers) return [];
  return out;
}
