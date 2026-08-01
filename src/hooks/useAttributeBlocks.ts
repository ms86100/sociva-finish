// @ts-nocheck
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AttributeBlock {
  id: string;
  block_type: string;
  display_name: string;
  description: string | null;
  icon: string | null;
  category_hints: string[];
  schema: Record<string, any>;
  renderer_type: 'key_value' | 'table' | 'tags' | 'badge_list' | 'text';
  display_order: number;
  is_active: boolean;
  block_key: string;
}

export interface SellerFormConfig {
  id: string;
  seller_id: string;
  category: string | null;
  blocks: { block_type: string; display_order: number }[];
}

export interface BlockData {
  type: string;
  data: Record<string, any>;
}

export function useBlockLibrary() {
  return useQuery({
    queryKey: ['attribute-block-library'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attribute_block_library')
        .select('*')
        .eq('is_active', true)
        .order('display_order');
      if (error) throw error;
      // Map default_config → schema for compatibility
      return (data || []).map((row: any) => ({
        ...row,
        schema: row.default_config || row.schema || {},
        category_hints: row.category_hints || row.applicable_categories || [],
      })) as AttributeBlock[];
    },
    staleTime: 10 * 60 * 1000,
  });
}

export function useSellerFormConfig(sellerId: string | null, category: string | null) {
  return useQuery({
    queryKey: ['seller-form-config', sellerId, category],
    queryFn: async () => {
      if (!sellerId) return null;
      const { data } = await supabase
        .from('seller_form_configs')
        .select('*')
        .eq('seller_id', sellerId)
        .or(`category.eq.${category},category.is.null`)
        .order('category', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      return data as unknown as SellerFormConfig | null;
    },
    enabled: !!sellerId,
  });
}

export function useSaveFormConfig(sellerId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ category, blocks }: { category: string | null; blocks: { block_type: string; display_order: number }[] }) => {
      if (!sellerId) throw new Error('No seller');

      const query = supabase
        .from('seller_form_configs')
        .select('id')
        .eq('seller_id', sellerId);
      
      if (category === null) {
        query.is('category', null);
      } else {
        query.eq('category', category);
      }
      
      const { data: existing } = await query.maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('seller_form_configs')
          .update({ blocks: blocks as any, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('seller_form_configs')
          .insert({ seller_id: sellerId, category, blocks: blocks as any });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seller-form-config', sellerId] });
    },
  });
}

/** Filter blocks strictly by category. Returns empty if no category. */
export function filterByCategory(blocks: AttributeBlock[], category: string | null): AttributeBlock[] {
  if (!category) return [];
  return blocks.filter(b => b.category_hints.includes(category));
}
