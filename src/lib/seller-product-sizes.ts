import { supabase } from '@/integrations/supabase/client';
import { fetchProductVariants, variantErrorMessage, type ProductVariant } from '@/lib/product-variants';

/** One editable row of the seller size table. Numbers stay strings until save. */
export interface SizeRow {
  key: string;
  id: string | null;
  label: string;
  price: string;
  compare_at_price: string;
  stock_quantity: string;
  is_active: boolean;
}

export interface ParsedSize {
  id: string | null;
  label: string;
  price: number;
  compare_at_price: number | null;
  stock_quantity: number | null;
  is_active: boolean;
  sort_order: number;
}

// Mirrors product_variants_label_len.
export const SIZE_LABEL_MAX = 40;

// product_variants is newer than the generated Supabase types.
const db = supabase as unknown as { from: (table: string) => any };

let rowSeq = 0;
function nextKey(): string {
  rowSeq += 1;
  return `size-${Date.now()}-${rowSeq}`;
}

export function emptySizeRow(): SizeRow {
  return { key: nextKey(), id: null, label: '', price: '', compare_at_price: '', stock_quantity: '', is_active: true };
}

export function sizeRowsFromVariants(variants: ProductVariant[]): SizeRow[] {
  return variants.map((v) => ({
    key: nextKey(),
    id: v.id,
    label: v.label,
    price: String(v.price),
    compare_at_price: v.compare_at_price == null ? '' : String(v.compare_at_price),
    stock_quantity: v.stock_quantity == null ? '' : String(v.stock_quantity),
    is_active: v.is_active,
  }));
}

export async function loadSizeRows(productId: string): Promise<SizeRow[]> {
  return sizeRowsFromVariants(await fetchProductVariants(productId));
}

/** Rows the seller left completely empty are ignored rather than treated as errors. */
function isBlankRow(r: SizeRow): boolean {
  return !r.label.trim() && !r.price.trim() && !r.compare_at_price.trim() && !r.stock_quantity.trim();
}

/** Same rules as the product_variants check constraints and live-label unique index. */
export function validateSizeRows(rows: SizeRow[]): { error: string | null; sizes: ParsedSize[] } {
  const sizes: ParsedSize[] = [];
  const seen = new Set<string>();
  const used = rows.filter((r) => !isBlankRow(r));
  for (let i = 0; i < used.length; i += 1) {
    const r = used[i];
    const label = r.label.trim();
    const n = i + 1;
    if (!label) return { error: `Size ${n}: enter a size name, like 250 g or 1 kg`, sizes: [] };
    if (label.length > SIZE_LABEL_MAX) return { error: `Size ${n}: keep the name to ${SIZE_LABEL_MAX} characters or fewer`, sizes: [] };
    const dedupe = label.toLowerCase();
    if (seen.has(dedupe)) return { error: `"${label}" is listed twice. Each size needs its own name.`, sizes: [] };
    seen.add(dedupe);
    const price = parseFloat(r.price);
    if (!Number.isFinite(price) || price <= 0) return { error: `${label}: enter a price above 0`, sizes: [] };
    let compareAt: number | null = null;
    if (r.compare_at_price.trim()) {
      compareAt = parseFloat(r.compare_at_price);
      if (!Number.isFinite(compareAt) || compareAt < price) return { error: `${label}: MRP must be at least the price`, sizes: [] };
    }
    let stock: number | null = null;
    if (r.stock_quantity.trim()) {
      stock = Number(r.stock_quantity);
      if (!Number.isInteger(stock) || stock < 0) return { error: `${label}: stock must be a whole number, 0 or more`, sizes: [] };
    }
    sizes.push({
      id: r.id,
      label,
      price: Math.round(price * 100) / 100,
      compare_at_price: compareAt == null ? null : Math.round(compareAt * 100) / 100,
      stock_quantity: stock,
      is_active: r.is_active,
      sort_order: i,
    });
  }
  return { error: null, sizes };
}

/** What the seller preview should show while the size table is being edited. */
export function previewSizePricing(rows: SizeRow[]): {
  price: number | null;
  from: boolean;
  hasSizes: boolean;
  noneActive: boolean;
} {
  const used = rows.filter((r) => r.label.trim() || r.price.trim());
  const activePrices = used
    .filter((r) => r.is_active)
    .map((r) => parseFloat(r.price))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (used.length === 0) return { price: null, from: false, hasSizes: false, noneActive: false };
  if (activePrices.length === 0) return { price: null, from: false, hasSizes: true, noneActive: true };
  return {
    price: Math.min(...activePrices),
    from: activePrices.length > 1,
    hasSizes: true,
    noneActive: false,
  };
}

export interface ReviewedSize {
  label: string;
  price: number;
  compare_at_price: number | null;
}

/**
 * The size fields that send an approved product back to admin review. Stock, on/off and
 * order are left out, matching the parent product where stock and availability skip review.
 */
export function reviewedSizes(sizes: ReviewedSize[]): ReviewedSize[] {
  return sizes
    .map((s) => ({ label: s.label, price: Number(s.price), compare_at_price: s.compare_at_price == null ? null : Number(s.compare_at_price) }))
    .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
}

export function sizesNeedReview(before: ReviewedSize[], after: ReviewedSize[]): boolean {
  return JSON.stringify(reviewedSizes(before)) !== JSON.stringify(reviewedSizes(after));
}

export function lowestActiveSizePrice(sizes: ParsedSize[]): number | null {
  const prices = sizes.filter((s) => s.is_active).map((s) => s.price);
  return prices.length ? Math.min(...prices) : null;
}

/**
 * Write the size table for a saved product. Removed sizes are deleted; a size that a
 * cart or order still points at cannot be deleted (VARIANT_IN_USE), so it is archived.
 * Returns the number of removed sizes that had to be archived.
 */
export async function syncProductSizes(
  productId: string,
  sizes: ParsedSize[],
  originalIds: string[],
): Promise<{ archived: number }> {
  const keptIds = new Set(sizes.map((s) => s.id).filter(Boolean) as string[]);
  let archived = 0;

  for (const id of originalIds.filter((x) => !keptIds.has(x))) {
    const { error } = await db.from('product_variants').delete().eq('id', id);
    if (!error) continue;
    if (!String(error.message || '').includes('VARIANT_IN_USE')) throw error;
    const { error: archiveErr } = await db
      .from('product_variants')
      .update({ archived_at: new Date().toISOString(), is_active: false })
      .eq('id', id);
    if (archiveErr) throw archiveErr;
    archived += 1;
  }

  for (const s of sizes.filter((x) => x.id)) {
    const { error } = await db
      .from('product_variants')
      .update({
        label: s.label,
        price: s.price,
        compare_at_price: s.compare_at_price,
        stock_quantity: s.stock_quantity,
        is_active: s.is_active,
        sort_order: s.sort_order,
      })
      .eq('id', s.id);
    if (error) throw error;
  }

  const inserts = sizes
    .filter((x) => !x.id)
    .map((s) => ({
      product_id: productId,
      label: s.label,
      price: s.price,
      compare_at_price: s.compare_at_price,
      stock_quantity: s.stock_quantity,
      is_active: s.is_active,
      sort_order: s.sort_order,
    }));
  if (inserts.length > 0) {
    const { error } = await db.from('product_variants').insert(inserts);
    if (error) throw error;
  }

  return { archived };
}

export function sizeSaveErrorMessage(error: unknown): string {
  const known = variantErrorMessage(error);
  if (known) return known;
  const msg = String((error as any)?.message || '');
  if (msg.includes('product_variants_product_label_live_key') || (error as any)?.code === '23505') {
    return 'Two sizes have the same name. Rename one and save again.';
  }
  return 'Sizes could not be saved. Open the product and try again.';
}
