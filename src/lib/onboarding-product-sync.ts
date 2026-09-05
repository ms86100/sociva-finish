import { supabase } from '@/integrations/supabase/client';
import { friendlyError } from '@/lib/utils';
import type { DraftProductActionRow } from '@/lib/onboarding-state';

export interface SyncProductsResult {
  ok: boolean;
  updatedCount: number;
  error?: string;
  needsServiceListing?: string[];
}

/**
 * Synchronize draft/pending product action types to match the store default.
 * Does not touch approved/live products.
 */
export async function syncDraftProductsToStoreAction(
  sellerId: string,
  newActionType: string,
  products: DraftProductActionRow[],
): Promise<SyncProductsResult> {
  const toUpdate = products.filter(
    (p) =>
      p.id &&
      p.action_type &&
      p.action_type !== newActionType &&
      (!p.approval_status || p.approval_status === 'draft' || p.approval_status === 'pending'),
  );

  if (toUpdate.length === 0) {
    return { ok: true, updatedCount: 0 };
  }

  const ids = toUpdate.map((p) => p.id!);
  const { error } = await supabase
    .from('products')
    .update({ action_type: newActionType } as any)
    .eq('seller_id', sellerId)
    .in('id', ids)
    .in('approval_status', ['draft', 'pending'] as any);

  if (error) {
    return { ok: false, updatedCount: 0, error: friendlyError(error) };
  }

  return { ok: true, updatedCount: toUpdate.length };
}

/** After syncing to a bookable action, find products still missing service_listings. */
export async function findProductsMissingServiceListings(
  sellerId: string,
  productIds: string[],
): Promise<string[]> {
  if (productIds.length === 0) return [];
  const { data: listings } = await supabase
    .from('service_listings')
    .select('product_id')
    .in('product_id', productIds);
  const listed = new Set((listings || []).map((r: any) => r.product_id));
  return productIds.filter((id) => !listed.has(id));
}

export function normalizeSeedOfferingNames(
  ...groups: Array<string[] | string | undefined | null>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    const list = Array.isArray(group) ? group : group ? [group] : [];
    for (const raw of list) {
      const name = String(raw || '').trim();
      if (name.length < 2) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

/**
 * Offerings the seller named that are not yet saved as catalog products.
 * Exact name matches consume a seed. Renamed products (saved under a different
 * name than the seed) also consume leftover seeds 1:1 so editing "Daily Tiffin"
 * → "Rajma Chawal" does not leave a phantom pending offering.
 */
export function pendingOfferingNamesForProducts(
  seedNames: string[],
  productNames: Array<string | undefined | null>,
): string[] {
  const seeds = normalizeSeedOfferingNames(seedNames);
  const products = productNames
    .map((n) => String(n || '').trim())
    .filter((n) => n.length > 0);
  const seedKeys = new Set(seeds.map((n) => n.toLowerCase()));
  const exactHave = new Set(products.map((n) => n.toLowerCase()));

  const remaining = seeds.filter((n) => !exactHave.has(n.toLowerCase()));
  const unmatchedProductCount = products.filter((n) => !seedKeys.has(n.toLowerCase())).length;

  let absorb = unmatchedProductCount;
  return remaining.filter(() => {
    if (absorb > 0) {
      absorb -= 1;
      return false;
    }
    return true;
  });
}

/** Drop leftover product-form names from a previous store/session. */
export function isStaleDraftProductName(
  restoredName: string | undefined | null,
  seedNames: string[],
): boolean {
  const name = String(restoredName || '').trim().toLowerCase();
  if (!name || seedNames.length === 0) return false;
  return !seedNames.some((seed) => seed.trim().toLowerCase() === name);
}

/**
 * Price-required categories reject price 0. Skip the insert unless we know
 * the category allows a priceless draft.
 */
export function shouldSkipPricelessDraftInsert(
  requiresPrice: boolean | null | undefined,
): boolean {
  return requiresPrice !== false;
}

export function isPriceRequirementError(message: string | undefined): boolean {
  return /price is required/i.test(message || '');
}

export interface EnsureDraftProductsResult {
  ok: boolean;
  inserted: number;
  pendingNames?: string[];
  skippedPriceRequirement?: boolean;
  error?: string;
}

export async function ensureDraftProductsForOfferings(opts: {
  sellerId: string;
  names: string[];
  category: string;
  actionType: string;
  subcategoryId?: string | null;
}): Promise<EnsureDraftProductsResult> {
  const names = normalizeSeedOfferingNames(opts.names);
  if (names.length === 0 || !opts.category) return { ok: true, inserted: 0 };

  const { data: existing, error: readErr } = await supabase
    .from('products')
    .select('id, name')
    .eq('seller_id', opts.sellerId);
  if (readErr) return { ok: false, inserted: 0, error: friendlyError(readErr) };

  const have = new Set((existing || []).map((p: any) => String(p.name || '').trim().toLowerCase()));
  const toInsert = names.filter((n) => !have.has(n.toLowerCase()));
  if (toInsert.length === 0) return { ok: true, inserted: 0 };

  const [{ data: categoryRow }, { data: actionRow }] = await Promise.all([
    supabase
      .from('category_config')
      .select('requires_price')
      .eq('category', opts.category)
      .maybeSingle(),
    supabase
      .from('action_type_workflow_map')
      .select('requires_price')
      .eq('action_type', opts.actionType)
      .maybeSingle(),
  ]);

  const categoryRequires = (categoryRow as { requires_price?: boolean } | null)?.requires_price;
  const actionRequires = (actionRow as { requires_price?: boolean } | null)?.requires_price;
  const knownAllowsPriceless = categoryRequires === false && actionRequires !== true;

  if (shouldSkipPricelessDraftInsert(knownAllowsPriceless ? false : true)) {
    return {
      ok: true,
      inserted: 0,
      skippedPriceRequirement: true,
      pendingNames: toInsert,
    };
  }

  const rows = toInsert.map((name) => ({
    seller_id: opts.sellerId,
    name,
    price: 0,
    description: '',
    category: opts.category,
    approval_status: 'draft',
    action_type: opts.actionType,
    subcategory_id: opts.subcategoryId || null,
    is_available: true,
  }));

  const { error } = await supabase.from('products').insert(rows as any);
  if (error) {
    const message = friendlyError(error);
    if (isPriceRequirementError(message)) {
      return {
        ok: true,
        inserted: 0,
        skippedPriceRequirement: true,
        pendingNames: toInsert,
      };
    }
    return { ok: false, inserted: 0, pendingNames: toInsert, error: message };
  }
  return { ok: true, inserted: toInsert.length };
}
