import { supabase } from '@/integrations/supabase/client';
import { normalizeTaxonomyKey } from '@/lib/taxonomy-normalize';

export interface ProposeSubcategoryResult {
  subcategoryId: string;
  displayName: string;
  slug: string;
  createdNew: boolean;
  categorySlug: string;
  parentGroup: string;
}

function proposeErrorMessage(err: unknown): string {
  const raw = String((err as any)?.message || (err as any)?.error_description || err || '').trim();
  if (!raw) return 'Could not add subcategory. Please try again.';
  if (/normalized_name|generated column/i.test(raw)) {
    return 'Could not add subcategory (server taxonomy update needed). Please try again in a moment.';
  }
  if (/not authenticated|JWT/i.test(raw)) return 'Please sign in again, then add the subcategory.';
  if (/too short|invalid subcategory/i.test(raw)) return 'Enter a clearer subcategory name (at least 2 characters).';
  if (/category not found/i.test(raw)) return 'That category is unavailable. Go back and pick another.';
  // PostgREST often prefixes with long codes — keep the human part short.
  const cleaned = raw.replace(/^[{[].*|code["']?\s*:\s*["']?\w+["']?/i, '').trim();
  return cleaned.length > 8 && cleaned.length < 160 ? cleaned : 'Could not add subcategory. Please try again.';
}

/** Prefer existing subcategory; otherwise create user-proposed via RPC. */
export async function proposeOrReuseSubcategory(input: {
  categoryConfigId: string;
  displayName: string;
  sellerId?: string | null;
  draftProductId?: string | null;
}): Promise<ProposeSubcategoryResult> {
  const name = String(input.displayName || '').trim();
  if (name.length < 2) throw new Error('Enter a subcategory name');
  if (!input.categoryConfigId) throw new Error('Category is required');

  const { data, error } = await supabase.rpc('propose_subcategory', {
    p_category_config_id: input.categoryConfigId,
    p_display_name: name,
    p_seller_id: input.sellerId || null,
    p_draft_product_id: input.draftProductId || null,
  });

  if (error) throw new Error(proposeErrorMessage(error));
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.subcategory_id) throw new Error('Could not create subcategory');

  return {
    subcategoryId: row.subcategory_id,
    displayName: row.display_name,
    slug: row.slug,
    createdNew: !!row.created_new,
    categorySlug: row.category_slug,
    parentGroup: row.parent_group,
  };
}

export { normalizeTaxonomyKey };
