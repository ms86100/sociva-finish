// @ts-nocheck
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface OrderSuggestion {
  id: string;
  user_id: string;
  seller_id: string | null;
  suggestion_type: string;
  title: string;
  description: string | null;
  product_ids: string[] | null;
  is_dismissed: boolean;
  expires_at: string | null;
  metadata: any;
  created_at: string;
  products?: { name: string; image_url: string | null; price: number }[];
  seller?: { business_name: string };
}

export function useOrderSuggestions() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['order-suggestions', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_suggestions')
        .select('id, user_id, seller_id, product_ids, reason, is_dismissed, created_at')
        .eq('user_id', user!.id)
        .eq('is_dismissed', false)
        .order('created_at', { ascending: false })
        .limit(3);

      if (error) throw error;
      if (!data || data.length === 0) return [];

      // Batch fetch products and sellers
      const productIds = [...new Set((data as any[]).flatMap(s => s.product_ids || []).filter(Boolean))];
      const sellerIds = [...new Set((data as any[]).map(s => s.seller_id).filter(Boolean))];

      const [productsRes, sellersRes] = await Promise.all([
        productIds.length > 0
          ? supabase.from('products').select('id, name, image_url, price').in('id', productIds)
          : { data: [] },
        sellerIds.length > 0
          ? supabase.from('seller_profiles').select('id, business_name').in('id', sellerIds)
          : { data: [] },
      ]);

      const productMap = new Map((productsRes.data || []).map((p: any) => [p.id, p]));
      const sellerMap = new Map((sellersRes.data || []).map((s: any) => [s.id, s]));

      return (data as any[]).map(s => ({
        ...s,
        products: (s.product_ids || []).map((pid: string) => productMap.get(pid)).filter(Boolean),
        seller: sellerMap.get(s.seller_id) || undefined,
      })) as OrderSuggestion[];
    },
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });
}

export function useDismissSuggestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await supabase
        .from('order_suggestions')
        .update({ is_dismissed: true } as any)
        .eq('id', id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-suggestions'] });
    },
  });
}

// Legacy alias — kept for backward compat
export function useMarkSuggestionActed() {
  return useDismissSuggestion();
}
