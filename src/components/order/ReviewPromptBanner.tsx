// @ts-nocheck
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, X } from 'lucide-react';
import { ReviewForm } from '@/components/review/ReviewForm';
import { slideUp } from '@/lib/motion-variants';

export function ReviewPromptBanner() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: prompts } = useQuery({
    queryKey: ['review-prompts', user?.id],
    queryFn: async () => {
      // Try smart prompts first (time-delayed)
      const { data, error } = await supabase.rpc('get_pending_review_prompts');
      if (!error && data && (data as any[]).length > 0) {
        // Mark as shown
        const ids = (data as any[]).map((p: any) => p.id);
        await supabase
          .from('review_prompts')
          .update({ status: 'shown' } as any)
          .in('id', ids);
        return data as any[];
      }

      // Fallback: check for any unreviewed delivered orders
      const { data: orders } = await supabase
        .from('orders')
        .select('id, seller_id, status, created_at, seller:seller_profiles!orders_seller_id_fkey(business_name)')
        .eq('buyer_id', user!.id)
        .in('status', ['delivered', 'completed'] as any)
        .order('created_at', { ascending: false })
        .limit(3);

      if (!orders || orders.length === 0) return null;

      const orderIds = orders.map(o => o.id);
      const { data: reviews } = await supabase
        .from('reviews')
        .select('order_id')
        .eq('buyer_id', user!.id)
        .in('order_id', orderIds);

      const reviewedSet = new Set((reviews || []).map(r => r.order_id));
      const unreviewed = orders.find(o => !reviewedSet.has(o.id));
      if (!unreviewed) return null;

      return [{
        id: null,
        order_id: unreviewed.id,
        seller_id: unreviewed.seller_id,
        seller_name: (unreviewed as any).seller?.business_name || 'Seller',
      }];
    },
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });

  const handleDismiss = async (promptId: string | null) => {
    if (promptId) {
      await supabase
        .from('review_prompts')
        .update({ status: 'dismissed' } as any)
        .eq('id', promptId);
    }
    queryClient.invalidateQueries({ queryKey: ['review-prompts'] });
  };

  const handleReviewSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['review-prompts'] });
    queryClient.invalidateQueries({ queryKey: ['unreviewed-order'] });
  };

  if (!prompts || prompts.length === 0) return null;

  const prompt = prompts[0];

  return (
    <AnimatePresence>
      <motion.div
        variants={slideUp}
        initial="hidden"
        animate="show"
        exit="hidden"
        className="bg-warning/10 border border-warning/20 rounded-xl p-3 mb-3"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Star className="text-warning shrink-0" size={18} />
            <div>
              <p className="text-sm font-semibold">Rate your recent order</p>
              <p className="text-[11px] text-muted-foreground">
                from {prompt.seller_name || 'a seller'} — help your community!
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <ReviewForm
              orderId={prompt.order_id}
              sellerId={prompt.seller_id}
              sellerName={prompt.seller_name || 'Seller'}
              onSuccess={handleReviewSuccess}
            />
            <button
              onClick={() => handleDismiss(prompt.id)}
              className="p-1.5 rounded-full hover:bg-muted transition-colors"
              aria-label="Dismiss"
            >
              <X size={14} className="text-muted-foreground" />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
