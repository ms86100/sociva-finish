// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { jitteredStaleTime } from '@/lib/query-utils';

export interface Subcategory {
  id: string;
  category_config_id: string;
  slug: string;
  display_name: string;
  display_order: number | null;
  icon: string | null;
  is_active: boolean;
  image_url: string | null;
  color: string | null;
  name_placeholder: string | null;
  description_placeholder: string | null;
  price_label: string | null;
  duration_label: string | null;
  show_veg_toggle: boolean | null;
  show_duration_field: boolean | null;
  supports_addons: boolean | null;
  supports_recurring: boolean | null;
  supports_staff_assignment: boolean | null;
}

export function useSubcategories(categoryConfigId?: string | null) {
  return useQuery({
    queryKey: ['subcategories', categoryConfigId || 'all'],
    queryFn: async () => {
      let q = supabase
        .from('subcategories')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (categoryConfigId) {
        q = q.eq('category_config_id', categoryConfigId);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as Subcategory[];
    },
    staleTime: jitteredStaleTime(10 * 60 * 1000),
    enabled: true,
  });
}
