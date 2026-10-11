import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

type Row = { source_product_id: string; target_product_id: string; target_variant_id: string | null; undone_at: string | null };
const table: { rows: Row[]; fail: boolean } = { rows: [], fail: false };

vi.mock('@/integrations/supabase/client', () => {
  const query = () => {
    const filters: ((r: Row) => boolean)[] = [];
    const chain: any = {
      select: () => chain,
      in: (col: keyof Row, ids: string[]) => { filters.push((r) => ids.includes(r[col] as string)); return chain; },
      is: (col: keyof Row) => { filters.push((r) => r[col] == null); return chain; },
      not: (col: keyof Row) => { filters.push((r) => r[col] != null); return chain; },
      then: (done: (v: unknown) => unknown) => done(table.fail
        ? { data: null, error: { message: 'relation "product_size_merges" does not exist' } }
        : { data: table.rows.filter((r) => filters.every((f) => f(r))), error: null }),
    };
    return chain;
  };
  return { supabase: { from: () => query() } };
});

import { fetchMergedAwayProductIds, remapMergedLines, resolveMergedProductId } from '@/lib/product-merges';
import { resolveReorderLines } from '@/lib/reorder';
import { fetchVariantCounts } from '@/lib/product-variants';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

beforeEach(() => {
  table.fail = false;
  table.rows = [
    // Amla: the 250 g listing became the product; 500 g and 1 kg became its sizes.
    { source_product_id: 'amla-250', target_product_id: 'amla-250', target_variant_id: 'v-250', undone_at: null },
    { source_product_id: 'amla-500', target_product_id: 'amla-250', target_variant_id: 'v-500', undone_at: null },
    { source_product_id: 'amla-1kg', target_product_id: 'amla-250', target_variant_id: 'v-1kg', undone_at: null },
    // Lemon was grouped and then undone.
    { source_product_id: 'lemon-500', target_product_id: 'lemon-250', target_variant_id: 'lv-500', undone_at: '2026-10-11T00:00:00Z' },
  ];
});

describe('reorder after listings were grouped into sizes', () => {
  it('moves old listings to the product at the matching size', async () => {
    const lines = await remapMergedLines([
      { product_id: 'amla-500', quantity: 2, unit_price: 350 },
      { product_id: 'curd', quantity: 1 },
    ]);
    expect(lines).toEqual([
      { product_id: 'amla-250', variant_id: 'v-500', quantity: 2, unit_price: 350 },
      { product_id: 'curd', quantity: 1 },
    ]);
  });

  it('gives an unsized line on the kept listing its own size', async () => {
    const lines = await remapMergedLines([{ product_id: 'amla-250', quantity: 1 }]);
    expect(lines).toEqual([{ product_id: 'amla-250', variant_id: 'v-250', quantity: 1 }]);
  });

  it('combines lines that land on the same product and size', async () => {
    const lines = await remapMergedLines([
      { product_id: 'amla-1kg', quantity: 1 },
      { product_id: 'amla-250', variant_id: 'v-1kg', quantity: 2 },
    ]);
    expect(lines).toEqual([{ product_id: 'amla-250', variant_id: 'v-1kg', quantity: 3 }]);
  });

  it('sends a size that was split back out to its listing again', async () => {
    const lines = await remapMergedLines([{ product_id: 'lemon-250', variant_id: 'lv-500', quantity: 1, unit_price: 350 }]);
    expect(lines).toEqual([{ product_id: 'lemon-500', quantity: 1 }]);
  });

  it('leaves lines alone when nothing was grouped or the table is missing', async () => {
    const input = [{ product_id: 'curd', quantity: 1 }];
    expect(await remapMergedLines(input)).toBe(input);
    table.fail = true;
    const grouped = [{ product_id: 'amla-500', quantity: 1 }];
    expect(await remapMergedLines(grouped)).toBe(grouped);
  });

  it('applies through resolveReorderLines', async () => {
    const lines = await resolveReorderLines([{ product_id: 'amla-500', quantity: 1, unit_price: 350 }]);
    expect(lines).toEqual([{ product_id: 'amla-250', variant_id: 'v-500', quantity: 1 }]);
  });

  it('is used by both reorder entry points', () => {
    expect(read('src/lib/reorder.ts')).toMatch(/remapMergedLines/);
    expect(read('src/components/home/ReorderLastOrder.tsx')).toMatch(/remapMergedLines/);
  });
});

describe('links and seller list after grouping', () => {
  it('redirects a shared link for a hidden listing to the product', async () => {
    expect(await resolveMergedProductId('amla-1kg')).toBe('amla-250');
    expect(await resolveMergedProductId('amla-250')).toBeNull();
    expect(await resolveMergedProductId('lemon-500')).toBeNull();
    expect(read('src/pages/ProductDeepLinkPage.tsx')).toMatch(/resolveMergedProductId/);
  });

  it('hides listings that live on as a size, but not the kept product', async () => {
    const ids = await fetchMergedAwayProductIds(['amla-250', 'amla-500', 'amla-1kg', 'lemon-500', 'curd']);
    expect([...ids].sort()).toEqual(['amla-1kg', 'amla-500']);
    expect(read('src/hooks/useSellerProducts.ts')).toMatch(/fetchMergedAwayProductIds/);
  });

  it('counts live sizes per product for the seller list', async () => {
    (table.rows as unknown[]) = [
      { product_id: 'amla-250', archived_at: null },
      { product_id: 'amla-250', archived_at: null },
      { product_id: 'amla-250', archived_at: '2026-10-11T00:00:00Z' },
      { product_id: 'mango-500', archived_at: null },
    ];
    expect(await fetchVariantCounts(['amla-250', 'mango-500', 'punjabi'])).toEqual({ 'amla-250': 2, 'mango-500': 1 });
    table.fail = true;
    expect(await fetchVariantCounts(['amla-250'])).toEqual({});
    expect(read('src/pages/SellerProductsPage.tsx')).toMatch(/fetchVariantCounts/);
  });
});
