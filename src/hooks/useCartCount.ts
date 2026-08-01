// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Lightweight hook that returns total quantity of items in cart.
 * The cart-count cache is also seeded by useCart after every mutation,
 * so this hook and useCart always share the same source of truth.
 * The queryFn here serves as a fallback/initial fetch for components
 * that mount before CartProvider (e.g. BottomNav).
 */
export function useCartCount() {
  const { user, isSessionRestored } = useAuth();

  const { data: itemCount = 0 } = useQuery({
    queryKey: ['cart-count', user?.id],
    queryFn: async () => {
      if (!user) return 0;
      const { data, error } = await supabase
        .from('cart_items')
        .select('quantity, product:products!inner(is_available)')
        .eq('user_id', user.id)
        .eq('product.is_available', true);
      if (error) return 0;
      return (data || []).reduce((sum, row) => sum + (row.quantity || 0), 0);
    },
    enabled: isSessionRestored && !!user,
    staleTime: 2 * 60 * 1000,
  });

  return itemCount;
}
