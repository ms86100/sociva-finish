import { supabase } from '@/integrations/supabase/client';
import { cartLineKey } from '@/lib/product-variants';

/**
 * One row of public.product_size_merges: an old pack-size listing and the product and
 * size that replaced it when an admin grouped listings into sizes.
 */
export interface ProductMerge {
  source_product_id: string;
  target_product_id: string;
  target_variant_id: string | null;
}

export interface MergeableLine {
  product_id: string;
  quantity: number;
  variant_id?: string | null;
  unit_price?: number | null;
}

const MERGE_COLUMNS = 'source_product_id, target_product_id, target_variant_id';

// product_size_merges is newer than the generated Supabase types.
const db = supabase as unknown as { from: (table: string) => any };

async function readMerges(column: 'source_product_id' | 'target_variant_id', ids: string[], undone: boolean): Promise<ProductMerge[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return [];
  try {
    let query = db.from('product_size_merges').select(MERGE_COLUMNS).in(column, unique);
    query = undone ? query.not('undone_at', 'is', null) : query.is('undone_at', null);
    const { data, error } = await query;
    // Missing table (pre-migration) reads as no merges.
    if (error || !Array.isArray(data)) return [];
    return data as ProductMerge[];
  } catch {
    return [];
  }
}

/** Live merges keyed by the old listing id. */
export async function fetchActiveMerges(productIds: string[]): Promise<Map<string, ProductMerge>> {
  const rows = await readMerges('source_product_id', productIds, false);
  return new Map(rows.map((row) => [row.source_product_id, row]));
}

/** Where a shared link to an old listing should go now, or null if it was not grouped. */
export async function resolveMergedProductId(productId: string): Promise<string | null> {
  const merge = (await fetchActiveMerges([productId])).get(productId);
  return merge && merge.target_product_id !== productId ? merge.target_product_id : null;
}

/**
 * Point order lines at what can be bought today: a line for an old listing moves to the
 * product and size that replaced it, and a line for a size that was split back out moves
 * to its listing again. Lines that land on the same product and size are combined.
 */
export async function remapMergedLines<T extends MergeableLine>(lines: T[]): Promise<T[]> {
  if (lines.length === 0) return lines;

  const sizedIds = lines.map((l) => l.variant_id).filter(Boolean) as string[];
  const split = new Map((await readMerges('target_variant_id', sizedIds, true)).map((row) => [row.target_variant_id as string, row]));
  const unsplit = lines.map((line) => {
    const row = line.variant_id ? split.get(line.variant_id) : undefined;
    if (!row) return line;
    const { variant_id: _variant, unit_price: _price, ...rest } = line;
    return { ...rest, product_id: row.source_product_id } as T;
  });

  const merged = await fetchActiveMerges(unsplit.filter((l) => !l.variant_id).map((l) => l.product_id));
  if (split.size === 0 && merged.size === 0) return lines;

  const out = new Map<string, T>();
  for (const line of unsplit) {
    const row = !line.variant_id ? merged.get(line.product_id) : undefined;
    const next = row?.target_variant_id
      ? ({ ...line, product_id: row.target_product_id, variant_id: row.target_variant_id } as T)
      : line;
    const key = cartLineKey(next.product_id, next.variant_id);
    const prev = out.get(key);
    out.set(key, prev ? { ...prev, quantity: prev.quantity + next.quantity } : next);
  }
  return [...out.values()];
}

/** Old listings that now live on as a size of another product; sellers manage them there. */
export async function fetchMergedAwayProductIds(productIds: string[]): Promise<Set<string>> {
  const merges = await fetchActiveMerges(productIds);
  return new Set([...merges.values()].filter((m) => m.target_product_id !== m.source_product_id).map((m) => m.source_product_id));
}
