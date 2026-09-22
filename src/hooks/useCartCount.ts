// @ts-nocheck
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { guestCartItemCount, readGuestCart } from '@/lib/guest-cart';

/**
 * Lightweight hook that returns total quantity of items in cart.
 * Guests use localStorage cart; signed-in users use the shared cart-count cache.
 */
export function useCartCount() {
  const { user, isSessionRestored } = useAuth();
  const [guestVersion, setGuestVersion] = useState(0);

  useEffect(() => {
    if (user) return;
    const bump = () => setGuestVersion((v) => v + 1);
    window.addEventListener('sociva:guest-cart', bump);
    window.addEventListener('storage', bump);
    return () => {
      window.removeEventListener('sociva:guest-cart', bump);
      window.removeEventListener('storage', bump);
    };
  }, [user]);

  const { data: itemCount = 0 } = useQuery({
    queryKey: ['cart-count', user?.id],
    queryFn: async () => {
      if (!user) return 0;
      const { data, error } = await supabase
        .from('cart_items')
        .select('quantity, product:products!inner(id)')
        .eq('user_id', user.id);
      if (error) return 0;
      return (data || []).reduce((sum, row) => sum + (row.quantity || 0), 0);
    },
    enabled: isSessionRestored && !!user,
    staleTime: 2 * 60 * 1000,
  });

  if (!user) {
    // guestVersion forces re-read after local cart mutations
    void guestVersion;
    return guestCartItemCount(readGuestCart());
  }

  return itemCount;
}
