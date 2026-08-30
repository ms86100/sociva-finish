// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';
import { supabase } from '@/integrations/supabase/client';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { filterDiscoverableProductIds } from '@/lib/sellerDiscoverability';
import { useCart } from '@/hooks/useCart';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { useCurrency } from '@/hooks/useCurrency';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { ACTION_CONFIG, deriveActionType } from '@/lib/marketplace-constants';
import { computeStoreStatus } from '@/lib/store-availability';
import { Eye, Plus, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

export function resolveRecentlyViewedAction(
  productActionType: string | null | undefined,
  categoryTransactionType: string | null | undefined,
  categoryFlags?: { supportsCart?: boolean; enquiryOnly?: boolean } | null,
) {
  return deriveActionType(productActionType, categoryTransactionType, categoryFlags);
}

export function canQuickAddRecentlyViewed(
  actionType: keyof typeof ACTION_CONFIG,
  actionResolved = true,
): boolean {
  return actionResolved && ACTION_CONFIG[actionType]?.isCart === true;
}

export function RecentlyViewedRow() {
  const { recentIds } = useRecentlyViewed();
  const { items, addItem } = useCart();
  const { formatPrice } = useCurrency();
  const { configs: categoryConfigs } = useCategoryConfigs();
  const { browsingLocation } = useBrowsingLocation();
  const navigate = useNavigate();

  const { data: products = [] } = useQuery({
    queryKey: ['recently-viewed-products', recentIds, browsingLocation?.lat, browsingLocation?.lng],
    queryFn: async () => {
      if (recentIds.length === 0) return [];
      const { data } = await supabase
        .from('products')
        .select('id, name, price, image_url, seller_id, is_available, is_veg, category, is_bestseller, is_recommended, is_urgent, description, created_at, updated_at, action_type, seller_profiles!inner(is_available, availability_start, availability_end, operating_days)')
        .in('id', recentIds)
        .eq('is_available', true)
        .eq('approval_status', 'approved');
      if (!data) return [];
      const allowed = await filterDiscoverableProductIds(
        data.map((p) => p.id),
        browsingLocation?.lat,
        browsingLocation?.lng,
      );
      return recentIds
        .map(id => data.find(p => p.id === id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p) && allowed.has(p.id));
    },
    enabled: recentIds.length > 0,
    staleTime: 2 * 60_000,
  });

  if (products.length === 0) return null;

  const isInCart = (id: string) => items.some(i => i.product_id === id);

  const isStoreClosed = (product: any) => {
    const seller = product.seller_profiles;
    if (!seller) return false;
    const status = computeStoreStatus(
      seller.availability_start,
      seller.availability_end,
      seller.operating_days,
      seller.is_available
    );
    return status.status !== 'open';
  };

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 px-4 mb-3">
        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
          <Eye size={14} className="text-primary" />
        </div>
        <h3 className="section-header">Recently Viewed</h3>
      </div>
      <div className="flex gap-2.5 overflow-x-auto scrollbar-hide px-4 pb-2">
        {products.map((product, i) => {
          const categoryConfig = categoryConfigs.find(config => config.category === product.category);
          const hasCanonicalProductAction = Boolean(
            (product as any).action_type && (product as any).action_type in ACTION_CONFIG,
          );
          const actionType = resolveRecentlyViewedAction(
            (product as any).action_type,
            categoryConfig?.transactionType,
            categoryConfig ? {
              supportsCart: categoryConfig.behavior.supportsCart,
              enquiryOnly: categoryConfig.behavior.enquiryOnly,
            } : null,
          );
          const isActionResolved = hasCanonicalProductAction || Boolean(categoryConfig);
          const isCartAction = canQuickAddRecentlyViewed(actionType, isActionResolved);
          const inCart = isCartAction && isInCart(product.id);
          const closed = isStoreClosed(product);
          return (
            <motion.button
              key={product.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => {
                if (!isCartAction) {
                  navigate(`/product/${product.id}`);
                  return;
                }
                if (!inCart && !closed) addItem({ ...product, action_type: actionType } as any);
              }}
              disabled={isCartAction && closed}
              className={cn(
                'shrink-0 w-[100px] rounded-2xl border bg-card overflow-hidden text-left transition-all duration-200 shadow-sm',
                isCartAction && closed ? 'border-border opacity-60 cursor-not-allowed' :
                inCart ? 'border-primary/30 shadow-card' : 'border-border active:scale-[0.96] hover:shadow-card hover:border-primary/20'
              )}
            >
              <div className="aspect-square bg-secondary relative overflow-hidden">
                {product.image_url || categoryConfig?.imageUrl ? (
                  <img src={optimizedImageUrl(product.image_url || categoryConfig?.imageUrl, { width: 200, quality: 70 })} alt={product.name} className="w-full h-full object-cover" loading="lazy" decoding="async" onError={handleImageError} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xl">📦</div>
                )}
                {isCartAction && closed ? (
                  <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                    <span className="text-[9px] font-bold text-destructive bg-background/80 px-1.5 py-0.5 rounded-full">Closed</span>
                  </div>
                ) : (
                  <div className={cn(
                    'absolute bottom-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center shadow-md transition-all',
                    inCart ? 'bg-primary scale-110' : 'bg-primary hover:scale-110'
                  )}>
                    {inCart ? <Check size={11} className="text-primary-foreground" /> : isCartAction ? <Plus size={11} className="text-primary-foreground" /> : <Eye size={11} className="text-primary-foreground" />}
                  </div>
                )}
              </div>
              <div className="px-2 py-2">
                <p className="text-[11px] font-semibold text-foreground line-clamp-2 leading-tight">{product.name}</p>
                <p className="text-[11px] font-bold text-primary mt-1">{formatPrice(product.price)}</p>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
