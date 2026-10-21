// @ts-nocheck
import { useMemo } from 'react';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { filterDiscoverableProductIds } from '@/lib/sellerDiscoverability';
import { useCart } from '@/hooks/useCart';
import { RefreshCw, Plus, Check, CalendarCheck, Phone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { notify } from '@/lib/notify';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { listingBelongsToMode, type CommerceMode } from '@/lib/commerce-mode';

export interface BuyAgainProduct {
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

const MODE_COPY: Record<CommerceMode, { title: string; times: (n: number) => string }> = {
  shop: {
    title: 'Order again',
    times: (n) => `Ordered ${n} ${n === 1 ? 'time' : 'times'}`,
  },
  book: {
    title: 'Book again',
    times: (n) => `Booked ${n} ${n === 1 ? 'time' : 'times'}`,
  },
  services: {
    title: 'Contact again',
    times: (n) => `Contacted ${n} ${n === 1 ? 'time' : 'times'}`,
  },
};

interface BuyAgainRowProps {
  mode?: CommerceMode;
  onOpenListing?: (product: BuyAgainProduct) => void;
}

export function BuyAgainRow({ mode = 'shop', onOpenListing }: BuyAgainRowProps) {
  const { user } = useAuth();
  const { browsingLocation } = useBrowsingLocation();
  const { items, addItem } = useCart();
  const { configs: categoryConfigs } = useCategoryConfigs();
  const copy = MODE_COPY[mode];

  const { data: products = [] } = useQuery({
    queryKey: ['buy-again', user?.id, browsingLocation?.lat, browsingLocation?.lng],
    queryFn: async (): Promise<BuyAgainProduct[]> => {
      if (!user) return [];

      const { data: rpcData, error: rpcError } = await supabase.rpc('get_user_frequent_products', {
        _user_id: user.id,
        _limit: 20,
      });

      if (!rpcError && rpcData && rpcData.length > 0) {
        const mapped = rpcData.map((r: any) => ({
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
        const allowed = await filterDiscoverableProductIds(
          mapped.map((p: BuyAgainProduct) => p.id),
          browsingLocation?.lat,
          browsingLocation?.lng,
        );
        return mapped.filter((p: BuyAgainProduct) => allowed.has(p.id));
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

      const ranked = Object.values(freq)
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);
      const allowed = await filterDiscoverableProductIds(
        ranked.map((p) => p.id),
        browsingLocation?.lat,
        browsingLocation?.lng,
      );
      return ranked.filter((p) => allowed.has(p.id));
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

  const modeProducts = useMemo(
    () => products.filter((p) => listingBelongsToMode(p, mode, categoryConfigs)),
    [products, categoryConfigs, mode],
  );

  const minItems = mode === 'shop' ? 3 : 1;
  const ordered = useMemo(
    () => [...modeProducts].sort((a, b) => b.order_count - a.order_count).slice(0, 8),
    [modeProducts],
  );

  if (ordered.length < minItems) return null;

  const isInCart = (productId: string) => items.some((i) => i.product_id === productId);

  const handleQuickAdd = async (product: BuyAgainProduct) => {
    if (isInCart(product.id)) return;
    if (!product.seller_id) {
      notify.block('Cannot add this item - missing seller info');
      return;
    }
    await addItem({
      id: product.id,
      seller_id: product.seller_id,
      name: product.name,
      price: product.price,
      image_url: product.image_url,
      category: product.category as any,
      action_type: product.action_type,
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

  const handleTap = (product: BuyAgainProduct) => {
    if (mode === 'shop') {
      void handleQuickAdd(product);
      return;
    }
    onOpenListing?.(product);
  };

  return (
    <div className="mt-4 mb-2" data-testid={`buy-again-${mode}`}>
      <div className="flex items-center gap-2 px-4 mb-3">
        <div className="w-7 h-7 rounded-xl bg-primary/10 flex items-center justify-center">
          <RefreshCw size={13} className="text-primary" />
        </div>
        <h3 className="font-extrabold text-base text-foreground tracking-tight">{copy.title}</h3>
      </div>

      <div className="flex gap-3 overflow-x-auto scrollbar-hide px-4 pb-2">
        {ordered.map((product, index) => {
          const inCart = mode === 'shop' && isInCart(product.id);
          const times = product.order_count > 0 ? product.order_count : 1;
          return (
            <motion.button
              key={product.id}
              type="button"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              onClick={() => handleTap(product)}
              className="shrink-0 w-[168px] text-left rounded-2xl bg-card border border-border overflow-hidden"
            >
              <div className="relative aspect-[4/3] bg-muted">
                {product.image_url ? (
                  <img
                    src={optimizedImageUrl(product.image_url, { width: 320, quality: 70 })}
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
                  'absolute bottom-2 right-2 w-7 h-7 rounded-full flex items-center justify-center shadow-sm',
                  inCart ? 'bg-primary' : 'bg-primary/90'
                )}>
                  {mode === 'shop' && inCart ? (
                    <Check size={14} className="text-primary-foreground" />
                  ) : mode === 'book' ? (
                    <CalendarCheck size={14} className="text-primary-foreground" />
                  ) : mode === 'services' ? (
                    <Phone size={14} className="text-primary-foreground" />
                  ) : (
                    <Plus size={14} className="text-primary-foreground" />
                  )}
                </div>
              </div>
              <div className="px-2.5 py-2">
                <p className="text-[13px] font-semibold text-foreground line-clamp-2 leading-tight">{product.name}</p>
                <p className="text-[11px] text-muted-foreground mt-1">{copy.times(times)}</p>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
