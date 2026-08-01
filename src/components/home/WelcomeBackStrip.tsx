// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Package, RotateCcw } from 'lucide-react';
import { useCart } from '@/hooks/useCart';
import { toast } from 'sonner';
import { jitteredStaleTime } from '@/lib/query-utils';
import { slideFromLeft, pulseRing } from '@/lib/motion-variants';

export function WelcomeBackStrip() {
  const { user } = useAuth();
  const { addItem } = useCart();

  const { data: lastOrder } = useQuery({
    queryKey: ['last-order-context', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('orders')
        .select('id, status, created_at, seller:seller_profiles!orders_seller_id_fkey(business_name)')
        .eq('buyer_id', user!.id)
        .in('status', ['completed', 'delivered'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as { id: string; status: string; created_at: string; seller: { business_name: string } | null } | null;
    },
    enabled: !!user?.id,
    staleTime: jitteredStaleTime(5 * 60_000),
  });

  if (!lastOrder?.seller) return null;

  const dateLabel = format(new Date(lastOrder.created_at), 'MMM d');

  const handleReorder = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const { data: items } = await supabase
        .from('order_items')
        .select('product_id, quantity, product:products!inner(id, name, price, image_url, is_available, seller_id, category, is_veg)')
        .eq('order_id', lastOrder.id);

      if (!items || items.length === 0) {
        toast.error('Could not load order items');
        return;
      }

      let added = 0;
      for (const item of items) {
        const p = (item as any).product;
        if (!p?.is_available) continue;
        await addItem({
          id: p.id, seller_id: p.seller_id, name: p.name, price: p.price,
          image_url: p.image_url, category: p.category, is_veg: p.is_veg ?? true,
          is_available: true, is_bestseller: false, is_recommended: false,
          is_urgent: false, description: null, created_at: '', updated_at: '',
        });
        added++;
      }
      toast.success(`${added} item${added !== 1 ? 's' : ''} added to cart`);
    } catch {
      toast.error('Failed to reorder');
    }
  };

  return (
    <motion.div
      variants={slideFromLeft}
      initial="hidden"
      animate="show"
      className="mx-4 mt-2 flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 text-xs"
    >
      <Link
        to={`/orders/${lastOrder.id}`}
        className="flex items-center gap-2 flex-1 min-w-0 active:scale-[0.99] transition-transform"
      >
        <Package size={14} className="text-muted-foreground shrink-0" />
        <span className="text-muted-foreground truncate">
          Last order: <span className="font-medium text-foreground">{lastOrder.seller.business_name}</span> · {dateLabel}
        </span>
      </Link>
      <motion.button
        variants={pulseRing}
        initial="idle"
        animate="pulse"
        onClick={handleReorder}
        className="shrink-0 flex items-center gap-1 text-primary font-semibold px-2 py-1 rounded-lg hover:bg-primary/10 transition-colors"
      >
        <RotateCcw size={12} />
        Reorder
      </motion.button>
    </motion.div>
  );
}
