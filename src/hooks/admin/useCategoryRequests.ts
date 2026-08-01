// @ts-nocheck
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface CategoryRequestRow {
  id: string;
  seller_id: string | null;
  requested_by: string;
  requested_name: string;
  normalized_name: string | null;
  parent_group_hint: string | null;
  parent_group_slug: string | null;
  parent_category_slug: string | null;
  parent_category_config_id: string | null;
  request_kind: 'category' | 'subcategory';
  example_product: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'merged' | 'duplicate';
  admin_notes: string | null;
  rejection_reason: string | null;
  suggested_alternatives: string[] | null;
  merge_target_category: string | null;
  merge_target_subcategory_id: string | null;
  created_category: string | null;
  created_subcategory_id: string | null;
  resolved_category: string | null;
  draft_product_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  requester?: { display_name: string | null; phone: string | null } | null;
}

export function useCategoryRequests(status?: string) {
  return useQuery({
    queryKey: ['admin', 'category-requests', status ?? 'all'],
    queryFn: async () => {
      let q = supabase
        .from('category_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (status && status !== 'all') q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as CategoryRequestRow[];
      // Hydrate requester profiles in a single round-trip
      const ids = Array.from(new Set(rows.map(r => r.requested_by).filter(Boolean)));
      if (ids.length) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, display_name, phone')
          .in('id', ids);
        const map = new Map((profiles ?? []).map((p: any) => [p.id, p]));
        rows.forEach(r => { r.requester = map.get(r.requested_by) ?? null; });
      }
      return rows;
    },
    staleTime: 30_000,
  });
}

export function useCategoryRequestCounts() {
  return useQuery({
    queryKey: ['admin', 'category-requests', 'counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('category_requests')
        .select('status');
      if (error) throw error;
      const counts: Record<string, number> = { pending: 0, approved: 0, rejected: 0, merged: 0, duplicate: 0 };
      (data ?? []).forEach((r: any) => { counts[r.status] = (counts[r.status] ?? 0) + 1; });
      return counts;
    },
    staleTime: 30_000,
  });
}

async function notifySeller(args: {
  userId: string;
  title: string;
  body: string;
  actionUrl: string | null;
  type: string;
  data?: Record<string, any>;
}) {
  await supabase.from('user_notifications').insert({
    user_id: args.userId,
    title: args.title,
    body: args.body,
    type: args.type,
    action_url: args.actionUrl,
    data: args.data ?? {},
  });
}

async function relinkDraft(draftId: string | null, _sellerUserId: string, newSlug: string) {
  if (!draftId) return;
  await supabase
    .from('products')
    .update({ category: newSlug, updated_at: new Date().toISOString() })
    .eq('id', draftId);
}

/** Append approved category to draft/pending/approved seller profiles for the requester. */
async function appendCategoryToSellerProfiles(
  userId: string,
  categorySlug: string,
  parentGroup?: string | null,
) {
  const { data: profiles } = await supabase
    .from('seller_profiles')
    .select('id, categories, primary_group, verification_status')
    .eq('user_id', userId)
    .in('verification_status', ['draft', 'pending', 'approved']);

  for (const p of profiles || []) {
    if (parentGroup && p.primary_group && p.primary_group !== parentGroup) continue;
    const cats = Array.isArray(p.categories) ? [...p.categories] : [];
    if (cats.includes(categorySlug)) continue;
    cats.push(categorySlug);
    await supabase.from('seller_profiles').update({ categories: cats }).eq('id', p.id);
  }
}

async function resolveCategoryActionUrl(
  request: CategoryRequestRow,
  categorySlug: string,
): Promise<string> {
  if (request.draft_product_id) {
    return `/seller/products/${request.draft_product_id}/edit`;
  }
  const { data: profiles } = await supabase
    .from('seller_profiles')
    .select('id, verification_status')
    .eq('user_id', request.requested_by)
    .in('verification_status', ['draft', 'pending'])
    .limit(1);
  if (profiles && profiles.length > 0) {
    return '/become-seller';
  }
  return `/seller/products/new?category=${categorySlug}`;
}

interface ApproveAsNewArgs {
  request: CategoryRequestRow;
  category: string;
  displayName: string;
  parentGroup: string;
  icon: string;
  color?: string;
  defaultActionType?: string;
  layoutType?: string;
}

export function useApproveAsNewCategory() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (args: ApproveAsNewArgs) => {
      // 1. Create the new category_config row (idempotent on slug)
      const { error: insertErr } = await supabase.from('category_config').insert({
        category: args.category,
        display_name: args.displayName,
        parent_group: args.parentGroup,
        icon: args.icon,
        color: args.color ?? '#888888',
        layout_type: args.layoutType ?? 'ecommerce',
        is_active: true,
        default_action_type: args.defaultActionType ?? 'add_to_cart',
      });
      if (insertErr && !`${insertErr.message}`.includes('duplicate')) throw insertErr;

      // 2. Update the request row
      const { error: updErr } = await supabase
        .from('category_requests')
        .update({
          status: 'approved',
          created_category: args.category,
          resolved_category: args.category,
          reviewed_by: user?.id ?? null,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', args.request.id);
      if (updErr) throw updErr;

      // 3. Relink seller draft if present + append category to store
      await relinkDraft(args.request.draft_product_id, args.request.requested_by, args.category);
      await appendCategoryToSellerProfiles(
        args.request.requested_by,
        args.category,
        args.parentGroup,
      );

      // 4. Notify seller
      const actionUrl = await resolveCategoryActionUrl(args.request, args.category);
      await notifySeller({
        userId: args.request.requested_by,
        type: 'category_request_approved',
        title: 'Your category is live',
        body: `"${args.displayName}" is now available. ${actionUrl === '/become-seller' ? 'Resume onboarding to use it.' : args.request.draft_product_id ? 'Continue your draft.' : 'Add your product now.'}`,
        actionUrl,
        data: { request_id: args.request.id, category: args.category },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'category-requests'] });
      qc.invalidateQueries({ queryKey: ['category-configs'] });
      toast.success('Category approved and seller notified');
    },
    onError: (e: any) => toast.error('Approval failed', { description: e?.message }),
  });
}

interface MergeArgs {
  request: CategoryRequestRow;
  targetCategory: string;
  targetDisplayName: string;
}

export function useMergeCategoryRequest() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ request, targetCategory, targetDisplayName }: MergeArgs) => {
      const { error } = await supabase
        .from('category_requests')
        .update({
          status: 'merged',
          merge_target_category: targetCategory,
          resolved_category: targetCategory,
          reviewed_by: user?.id ?? null,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', request.id);
      if (error) throw error;

      await relinkDraft(request.draft_product_id, request.requested_by, targetCategory);
      await appendCategoryToSellerProfiles(
        request.requested_by,
        targetCategory,
        request.parent_group_slug || request.parent_group_hint,
      );

      const actionUrl = await resolveCategoryActionUrl(request, targetCategory);
      await notifySeller({
        userId: request.requested_by,
        type: 'category_request_approved',
        title: 'Use this existing category',
        body: `We've matched "${request.requested_name}" to "${targetDisplayName}". ${actionUrl === '/become-seller' ? 'Resume onboarding to use it.' : request.draft_product_id ? 'Continue your draft.' : 'Add your product now.'}`,
        actionUrl,
        data: { request_id: request.id, category: targetCategory, merged: true },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'category-requests'] });
      toast.success('Merged and seller notified');
    },
    onError: (e: any) => toast.error('Merge failed', { description: e?.message }),
  });
}

interface RejectArgs {
  request: CategoryRequestRow;
  reason: string;
  suggestedAlternatives?: string[];
}

export function useRejectCategoryRequest() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ request, reason, suggestedAlternatives }: RejectArgs) => {
      const { error } = await supabase
        .from('category_requests')
        .update({
          status: 'rejected',
          rejection_reason: reason,
          suggested_alternatives: suggestedAlternatives ?? null,
          reviewed_by: user?.id ?? null,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', request.id);
      if (error) throw error;

      const alts = (suggestedAlternatives ?? []).join(',');
      const { data: profiles } = await supabase
        .from('seller_profiles')
        .select('id')
        .eq('user_id', request.requested_by)
        .in('verification_status', ['draft', 'pending'])
        .limit(1);
      const actionUrl = profiles?.length
        ? '/become-seller'
        : alts
          ? `/seller/products/new?suggested=${encodeURIComponent(alts)}`
          : '/seller/category-requests';
      await notifySeller({
        userId: request.requested_by,
        type: 'category_request_rejected',
        title: 'Category request not approved',
        body: `"${request.requested_name}" wasn't added. Reason: ${reason}${alts ? ' — see suggested alternatives.' : ''}`,
        actionUrl,
        data: { request_id: request.id, reason, suggested_alternatives: suggestedAlternatives ?? [] },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'category-requests'] });
      toast.success('Request rejected and seller notified');
    },
    onError: (e: any) => toast.error('Reject failed', { description: e?.message }),
  });
}

/* ──────────── Subcategory approvals ──────────── */

interface ApproveSubcatArgs {
  request: CategoryRequestRow;
  parentCategoryConfigId: string;
  parentCategorySlug: string;
  parentCategoryDisplayName: string;
  slug: string;
  displayName: string;
  icon?: string;
}

export function useApproveAsNewSubcategory() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (args: ApproveSubcatArgs) => {
      // 1. Create the new subcategory row (idempotent on (category_config_id, slug))
      const { data: inserted, error: insertErr } = await supabase
        .from('subcategories')
        .insert({
          category_config_id: args.parentCategoryConfigId,
          slug: args.slug,
          display_name: args.displayName,
          icon: args.icon ?? null,
          is_active: true,
        })
        .select('id')
        .single();

      let subcategoryId = inserted?.id as string | undefined;

      if (insertErr) {
        if (`${insertErr.message}`.toLowerCase().includes('duplicate')) {
          // Fetch existing row instead
          const { data: existing } = await supabase
            .from('subcategories')
            .select('id')
            .eq('category_config_id', args.parentCategoryConfigId)
            .eq('slug', args.slug)
            .maybeSingle();
          subcategoryId = existing?.id;
        } else {
          throw insertErr;
        }
      }
      if (!subcategoryId) throw new Error('Failed to resolve subcategory id');

      // 2. Update the request row
      const { error: updErr } = await supabase
        .from('category_requests')
        .update({
          status: 'approved',
          created_subcategory_id: subcategoryId,
          reviewed_by: user?.id ?? null,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', args.request.id);
      if (updErr) throw updErr;

      // 3. Notify seller
      await notifySeller({
        userId: args.request.requested_by,
        type: 'category_request_approved',
        title: 'Your subcategory is live',
        body: `"${args.displayName}" is now available under ${args.parentCategoryDisplayName}. Add your product now.`,
        actionUrl: `/seller/products/new?category=${args.parentCategorySlug}&subcategory=${subcategoryId}`,
        data: {
          request_id: args.request.id,
          subcategory_id: subcategoryId,
          category: args.parentCategorySlug,
          kind: 'subcategory',
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'category-requests'] });
      qc.invalidateQueries({ queryKey: ['subcategories'] });
      qc.invalidateQueries({ queryKey: ['resolved-category-aliases'] });
      toast.success('Subcategory approved and seller notified');
    },
    onError: (e: any) => toast.error('Approval failed', { description: e?.message }),
  });
}

interface MergeSubcatArgs {
  request: CategoryRequestRow;
  parentCategorySlug: string;
  targetSubcategoryId: string;
  targetSubcategoryName: string;
}

export function useMergeSubcategoryRequest() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ request, parentCategorySlug, targetSubcategoryId, targetSubcategoryName }: MergeSubcatArgs) => {
      const { error } = await supabase
        .from('category_requests')
        .update({
          status: 'merged',
          merge_target_subcategory_id: targetSubcategoryId,
          reviewed_by: user?.id ?? null,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', request.id);
      if (error) throw error;

      await notifySeller({
        userId: request.requested_by,
        type: 'category_request_approved',
        title: 'Use this existing subcategory',
        body: `We've matched "${request.requested_name}" to "${targetSubcategoryName}". Add your product now.`,
        actionUrl: `/seller/products/new?category=${parentCategorySlug}&subcategory=${targetSubcategoryId}`,
        data: {
          request_id: request.id,
          subcategory_id: targetSubcategoryId,
          category: parentCategorySlug,
          kind: 'subcategory',
          merged: true,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'category-requests'] });
      qc.invalidateQueries({ queryKey: ['resolved-category-aliases'] });
      toast.success('Merged and seller notified');
    },
    onError: (e: any) => toast.error('Merge failed', { description: e?.message }),
  });
}
