// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export function useProductFavorites() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['product-favorites', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('product_favorites' as any)
        .select('product_id')
        .eq('user_id', user.id);
      if (error) throw error;
      return (data as any[])?.map((d: any) => d.product_id as string) || [];
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });
}

export function useProductFavoritesList() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['product-favorites-list', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('product_favorites' as any)
        .select(`
          product_id,
          created_at
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;

      if (!data || (data as any[]).length === 0) return [];

      const productIds = (data as any[]).map((d: any) => d.product_id);
      const { data: products, error: pErr } = await supabase
        .from('products')
        .select(`
          id, name, price, image_url, is_veg, category, seller_id,
          seller:seller_profiles!products_seller_id_fkey(business_name)
        `)
        .in('id', productIds)
        .eq('is_available', true);

      if (pErr) throw pErr;
      return (products || []).map((p: any) => ({
        ...p,
        seller_name: p.seller?.business_name || '',
      }));
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });
}
