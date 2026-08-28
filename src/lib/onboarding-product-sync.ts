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
