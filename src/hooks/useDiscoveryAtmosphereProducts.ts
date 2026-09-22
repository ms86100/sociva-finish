/**
 * Decorative marketplace atmosphere for location discovery (not “near you”).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type AtmosphereProduct = {
  id: string;
  name: string;
  price: number;
  image_url: string;
  action_type: string | null;
};

export function useDiscoveryAtmosphereProducts(enabled = true) {
  return useQuery({
    queryKey: ['discovery-atmosphere-products'],
    enabled,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<AtmosphereProduct[]> => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, price, image_url, action_type')
        .eq('approval_status', 'approved')
        .eq('is_available', true)
        .not('image_url', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(12);

      if (error) {
        console.warn('[discovery-atmosphere]', error.message);
        return [];
      }

      return ((data || []) as AtmosphereProduct[]).filter((p) => !!p.image_url);
    },
  });
}
