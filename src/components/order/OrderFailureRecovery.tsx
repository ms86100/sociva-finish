// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShoppingBag, ArrowRight } from 'lucide-react';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';
import { cardEntrance, staggerContainer } from '@/lib/motion-variants';

interface OrderFailureRecoveryProps {
  orderId: string;
  orderStatus: string;
}

export function OrderFailureRecovery({ orderId, orderStatus }: OrderFailureRecoveryProps) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const isCancelled = ['cancelled', 'rejected', 'auto_cancelled'].includes(orderStatus);

  const { data: suggestions } = useQuery({
    queryKey: ['order-suggestions-recovery', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('order_suggestions')
        .select('id, seller_id, product_ids, title, description, is_dismissed, suggestion_type')
        .eq('user_id', user!.id)
        .eq('is_dismissed', false)
        .order('created_at', { ascending: false })
        .limit(3);

      if (!data || data.length === 0) return [];

      const sellerIds = [...new Set(data.map(s => s.seller_id).filter(Boolean))];
      if (sellerIds.length === 0) return [];

      const { data: sellers } = await supabase
        .from('seller_profiles')
        .select('id, business_name, cover_image_url, rating')
        .in('id', sellerIds);

      const sellerMap = new Map((sellers || []).map(s => [s.id, s]));

      return data.map(s => ({
        ...s,
        seller: sellerMap.get(s.seller_id),
      }));
    },
    enabled: isCancelled && !!user?.id,
    staleTime: 60_000,
  });

  if (!isCancelled || !suggestions || suggestions.length === 0) return null;

  return (
    <motion.div
      variants={cardEntrance}
      initial="hidden"
      animate="show"
      className="bg-accent/5 border border-accent/20 rounded-xl p-4"
    >
      <div className="flex items-center gap-2 mb-3">
        <ShoppingBag size={16} className="text-accent" />
        <p className="text-sm font-semibold">Similar items available</p>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Your order was cancelled, but we found alternatives for you
      </p>

      <motion.div
        className="space-y-2"
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        {suggestions.map((s: any) => (
          <motion.button
            key={s.id}
            variants={cardEntrance}
            whileTap={{ scale: 0.97 }}
            onClick={() => navigate(`/seller/${s.seller_id}`)}
            className="w-full flex items-center gap-3 bg-card border border-border rounded-lg p-2.5 transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-muted overflow-hidden shrink-0">
              {s.seller?.cover_image_url ? (
                <img
                  src={optimizedImageUrl(s.seller.cover_image_url, { width: 80, quality: 70 })}
                  alt={s.seller?.business_name}
                  className="w-full h-full object-cover"
                  onError={handleImageError}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-lg">🏪</div>
              )}
            </div>
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-medium truncate">{s.seller?.business_name || s.title || 'Seller'}</p>
              {s.description && (
                <p className="text-[11px] text-muted-foreground truncate">{s.description}</p>
              )}
              {!s.description && s.seller?.rating > 0 && (
                <p className="text-[11px] text-muted-foreground">⭐ {Number(s.seller.rating).toFixed(1)}</p>
              )}
            </div>
            <ArrowRight size={14} className="text-muted-foreground shrink-0" />
          </motion.button>
        ))}
      </motion.div>
    </motion.div>
  );
}
