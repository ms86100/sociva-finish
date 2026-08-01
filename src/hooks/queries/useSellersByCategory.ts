// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface SellerInCategory {
  seller_id: string;
  business_name: string;
  profile_image_url: string | null;
  rating: number;
  completed_order_count: number;
  fulfillment_mode: string | null;
  is_available: boolean;
  min_price: number;
  product_count: number;
}

export interface CategoryWithSellers {
  category: string;
  displayName: string;
  icon: string;
  sellers: SellerInCategory[];
}

export function useSellersByCategory(societyId?: string | null) {
  return useQuery({
    queryKey: ['sellers-by-category', societyId],
    queryFn: async (): Promise<CategoryWithSellers[]> => {
      // Fetch category configs for display info
      const { data: configs } = await supabase
        .from('category_config')
        .select('category, display_name, icon, display_order')
        .eq('is_active', true)
        .order('display_order');

      // Fetch approved products with seller info
      let query = supabase
        .from('products')
        .select(`
          category, price, seller_id,
          seller:seller_profiles!products_seller_id_fkey(
            id, business_name, profile_image_url, rating,
            completed_order_count, fulfillment_mode, is_available,
            verification_status, society_id
          )
        `)
        .eq('is_available', true)
        .eq('approval_status', 'approved');

      if (societyId) {
        query = query.eq('seller.society_id', societyId);
      }

      const { data: products, error } = await query;
      if (error) throw error;

      const approved = (products || []).filter(
        (p: any) => p.seller?.verification_status === 'approved'
      );

      // Group: category -> seller_id -> aggregated info
      const catSellerMap: Record<string, Record<string, SellerInCategory>> = {};

      for (const p of approved as any[]) {
        const cat = p.category || 'other';
        if (!catSellerMap[cat]) catSellerMap[cat] = {};

        const sid = p.seller.id;
        if (!catSellerMap[cat][sid]) {
          catSellerMap[cat][sid] = {
            seller_id: sid,
            business_name: p.seller.business_name,
            profile_image_url: p.seller.profile_image_url,
            rating: p.seller.rating || 0,
            completed_order_count: p.seller.completed_order_count || 0,
            fulfillment_mode: p.seller.fulfillment_mode,
            is_available: p.seller.is_available,
            min_price: p.price,
            product_count: 0,
          };
        }

        catSellerMap[cat][sid].min_price = Math.min(catSellerMap[cat][sid].min_price, p.price);
        catSellerMap[cat][sid].product_count++;
      }

      // Build ordered result
      const configMap = new Map(
        (configs || []).map((c: any) => [c.category, c])
      );
      const configOrder = new Map(
        (configs || []).map((c: any, i: number) => [c.category, c.display_order ?? i])
      );

      const result: CategoryWithSellers[] = [];

      for (const [cat, sellersMap] of Object.entries(catSellerMap)) {
        const sellerList = Object.values(sellersMap).sort((a, b) => a.min_price - b.min_price);
        if (sellerList.length > 0) {
          const cfg = configMap.get(cat);
          result.push({
            category: cat,
            displayName: cfg?.display_name || cat,
            icon: cfg?.icon || '📦',
            sellers: sellerList,
          });
        }
      }

      // Sort by config display_order
      result.sort((a, b) => {
        const orderA = configOrder.get(a.category) ?? 999;
        const orderB = configOrder.get(b.category) ?? 999;
        return orderA - orderB;
      });

      return result;
    },
    enabled: !!societyId,
    staleTime: 5 * 60 * 1000,
  });
}
