// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Returns every approved or merged category request as a searchable alias.
 *
 * Categories: alias text → resolved category slug.
 * Subcategories: alias text → resolved subcategory id (used inside the
 * SubcategoryPickerDialog so a merged/approved subcategory request — e.g.
 * "makhana" → Namkeen & Chips — becomes findable). Subcategory aliases also
 * bubble up as parent-category aliases so the top-level CategorySearchPicker
 * surfaces "Snacks" when the seller types "makhana".
 *
 * RLS only exposes resolved rows to authenticated users, so this is safe
 * to fetch broadly across the marketplace.
 */
export interface ResolvedCategoryAlias {
  alias: string;                              // lowercased requested_name
  resolvedSlug: string | null;                // category slug
  resolvedSubcategoryId: string | null;       // subcategory id, when applicable
  kind: 'category' | 'subcategory';
}

export interface ResolvedAliasIndex {
  list: ResolvedCategoryAlias[];
  /** alias → first matched category slug (covers both kinds via bubble-up) */
  aliasToCategorySlug: Record<string, string>;
}

async function fetchResolvedAliases(): Promise<ResolvedAliasIndex> {
  const { data, error } = await supabase
    .from('category_requests')
    .select('requested_name, created_category, merge_target_category, created_subcategory_id, merge_target_subcategory_id, parent_category_slug, request_kind, status')
    .in('status', ['approved', 'merged']);

  if (error) {
    console.warn('[resolved-category-aliases] fetch failed', error);
    return { list: [], aliasToCategorySlug: {} };
  }

  const list: ResolvedCategoryAlias[] = [];
  const subcatIdsNeedingParent: string[] = [];

  for (const r of data ?? []) {
    const row = r as any;
    const name = row.requested_name?.trim().toLowerCase();
    if (!name) continue;
    const kind = (row.request_kind ?? 'category') as 'category' | 'subcategory';
    if (kind === 'subcategory') {
      const resolvedSubId = row.created_subcategory_id || row.merge_target_subcategory_id;
      if (!resolvedSubId) continue;
      list.push({ alias: name, resolvedSlug: row.parent_category_slug ?? null, resolvedSubcategoryId: resolvedSubId, kind });
      if (!row.parent_category_slug) subcatIdsNeedingParent.push(resolvedSubId);
    } else {
      const resolved = row.created_category || row.merge_target_category;
      if (!resolved) continue;
      list.push({ alias: name, resolvedSlug: resolved, resolvedSubcategoryId: null, kind });
    }
  }

  // Hydrate parent category slug for subcategory aliases that didn't carry it.
  if (subcatIdsNeedingParent.length > 0) {
    const { data: subRows, error: subErr } = await supabase
      .from('subcategories')
      .select('id, category_config:category_config_id(category)')
      .in('id', subcatIdsNeedingParent);
    if (subErr) {
      console.warn('[resolved-category-aliases] subcat parent lookup failed', subErr);
    } else {
      const parentBySubId = new Map<string, string>();
      for (const s of subRows ?? []) {
        const slug = (s as any).category_config?.category;
        if (slug) parentBySubId.set((s as any).id, slug);
      }
      for (const a of list) {
        if (a.kind === 'subcategory' && !a.resolvedSlug && a.resolvedSubcategoryId) {
          a.resolvedSlug = parentBySubId.get(a.resolvedSubcategoryId) ?? null;
        }
      }
    }
  }

  const aliasToCategorySlug: Record<string, string> = {};
  for (const a of list) {
    if (a.resolvedSlug && !aliasToCategorySlug[a.alias]) {
      aliasToCategorySlug[a.alias] = a.resolvedSlug;
    }
  }

  if (typeof console !== 'undefined') {
    console.info(`[resolved-category-aliases] hydrated ${list.length} aliases (${Object.keys(aliasToCategorySlug).length} unique)`);
  }

  return { list, aliasToCategorySlug };
}

export function useResolvedCategoryAliases() {
  const query = useQuery({
    queryKey: ['resolved-category-aliases'],
    queryFn: fetchResolvedAliases,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
  });
  // Backward-compatible: `.data` historically was the list. Expose both.
  return {
    ...query,
    data: query.data?.list ?? [],
    index: query.data ?? { list: [], aliasToCategorySlug: {} },
  } as const;
}
