// @ts-nocheck
import { useMemo } from 'react';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/hooks/useCart';
import { useCurrency } from '@/hooks/useCurrency';
import { RefreshCw, Plus, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { notify } from '@/lib/notify';

interface BuyAgainProduct {
  id: string;
  name: string;
  price: number;
  image_url: string | null;
  seller_id: string;
  seller_name: string;
  order_count: number;
  category: string;
  action_type: string | null;
}

interface GroupedCategory {
  category: string;
  products: BuyAgainProduct[];
  totalOrders: number;
}

export function BuyAgainRow() {
  const { user } = useAuth();
  const { items, addItem } = useCart();
  const { formatPrice } = useCurrency();

  const { data: products = [] } = useQuery({
    queryKey: ['buy-again', user?.id],
    queryFn: async (): Promise<BuyAgainProduct[]> => {
      if (!user) return [];

      const { data: rpcData, error: rpcError } = await supabase.rpc('get_user_frequent_products', {
        _user_id: user.id,
        _limit: 20,
      });

      if (!rpcError && rpcData && rpcData.length > 0) {
        return rpcData.map((r: any) => ({
          id: r.product_id,
          name: r.product_name,
          price: r.price,
          image_url: r.image_url,
          seller_id: r.seller_id || '',
          seller_name: r.seller_name || '',
          order_count: Number(r.order_count) || 0,
          category: r.category || '',
          action_type: r.action_type || null,
        }));
      }

      if (rpcError) console.warn('[BuyAgain] RPC error, using fallback:', rpcError.message);

      const { data, error } = await supabase
        .from('order_items')
        .select(`
          product_id, quantity,
          product:products!inner(id, name, price, image_url, is_available, seller_id, category, action_type,
            seller:seller_profiles!products_seller_id_fkey(business_name)
          ),
          order:orders!inner(buyer_id, status)
        `)
        .eq('order.buyer_id', user.id)
        .eq('order.status', 'completed')
        .eq('product.is_available', true)
        .limit(100);

      if (error || !data) return [];

      const freq: Record<string, BuyAgainProduct & { count: number }> = {};
      for (const item of data) {
        const p = (item as any).product;
        if (!p) continue;
        const pid = p.id;
        if (!freq[pid]) {
          freq[pid] = {
            id: pid,
            name: p.name,
            price: p.price,
            image_url: p.image_url,
            seller_id: p.seller_id || '',
            seller_name: p.seller?.business_name || '',
            order_count: 0,
            category: p.category || '',
            action_type: p.action_type || null,
            count: 0,
          };
        }
        freq[pid].count += 1;
        freq[pid].order_count = freq[pid].count;
      }

      return Object.values(freq)
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

  // Filter out bookable/non-cart products — they don't belong in "Buy Again"
  const cartableProducts = useMemo(() =>
    products.filter(p => !p.action_type || ['add_to_cart', 'buy_now'].includes(p.action_type)),
    [products]
  );

  // Group products by category
  const grouped = useMemo((): GroupedCategory[] => {
    const map: Record<string, BuyAgainProduct[]> = {};
    for (const p of cartableProducts) {
      const cat = p.category || 'Other';
      if (!map[cat]) map[cat] = [];
      map[cat].push(p);
    }
    return Object.entries(map)
      .map(([category, prods]) => ({
        category,
        products: prods.sort((a, b) => b.order_count - a.order_count),
        totalOrders: prods.reduce((s, p) => s + p.order_count, 0),
      }))
      .sort((a, b) => b.totalOrders - a.totalOrders)
      .slice(0, 8);
  }, [cartableProducts]);

  if (cartableProducts.length < 3) return null;

  const isInCart = (productId: string) => items.some(i => i.product_id === productId);

  const handleQuickAdd = async (product: BuyAgainProduct) => {
    if (isInCart(product.id)) return;
    if (!product.seller_id) {
      notify.block('Cannot add this item — missing seller info');
      return;
    }
    await addItem({
      id: product.id,
      seller_id: product.seller_id,
      name: product.name,
      price: product.price,
      image_url: product.image_url,
      category: product.category as any,
      is_veg: true,
      is_available: true,
      is_bestseller: false,
      is_recommended: false,
      is_urgent: false,
      description: null,
      created_at: '',
      updated_at: '',
    });
  };

  return (
    <div className="mt-5 mb-6">
      <div className="flex items-center gap-2 px-4 mb-3">
        <div className="w-7 h-7 rounded-xl bg-primary/10 flex items-center justify-center">
          <RefreshCw size={13} className="text-primary" />
        </div>
        <h3 className="font-extrabold text-base text-foreground tracking-tight">Frequently bought</h3>
      </div>

      <div className="flex gap-3 overflow-x-auto scrollbar-hide px-4 pb-2">
        {grouped.map((group, gi) => {
          const displayProducts = group.products.slice(0, 2);
          const moreCount = group.products.length - 2;

          return (
            <motion.div
              key={group.category}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: gi * 0.06 }}
              className="shrink-0 w-[140px]"
            >
              {/* Card with teal/green tint */}
              <div className="rounded-2xl bg-[hsl(var(--buyagain-card-bg))] border border-[hsl(var(--buyagain-card-border))] p-2.5 space-y-2">
                {/* Product thumbnails grid */}
                <div className="grid grid-cols-2 gap-1.5">
                  {displayProducts.map((product) => {
                    const inCart = isInCart(product.id);
                    return (
                      <button
                        key={product.id}
                        onClick={() => handleQuickAdd(product)}
                        className="relative aspect-square rounded-xl bg-white dark:bg-card overflow-hidden border border-border/40"
                      >
                        {product.image_url ? (
                          <img
                            src={optimizedImageUrl(product.image_url, { width: 150, quality: 70 })}
                            alt={product.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            decoding="async"
                            onError={handleImageError}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-lg">🛒</div>
                        )}
                        <div className={cn(
                          'absolute bottom-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center shadow-sm',
                          inCart ? 'bg-primary' : 'bg-primary/90'
                        )}>
                          {inCart ? (
                            <Check size={10} className="text-primary-foreground" />
                          ) : (
                            <Plus size={10} className="text-primary-foreground" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* +N more badge */}
                {moreCount > 0 && (
                  <div className="text-center">
                   <span className="text-[10px] font-bold text-[hsl(var(--buyagain-badge-text))] bg-[hsl(var(--buyagain-badge-bg))] px-2 py-0.5 rounded-full">
                      +{moreCount} more
                    </span>
                  </div>
                )}
              </div>

              {/* Category label below */}
              <p className="text-[11px] font-semibold text-foreground text-center mt-1.5 line-clamp-2 leading-tight">
                {group.category}
              </p>
              <p className="text-[9px] text-muted-foreground text-center mt-0.5">
                {group.totalOrders}× ordered
              </p>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
