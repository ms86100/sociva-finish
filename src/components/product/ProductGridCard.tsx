// @ts-nocheck
import { useNavigate } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Minus, Store, Clock, Check } from 'lucide-react';
import { hapticSelection, hapticImpact } from '@/lib/haptics';
import { Badge } from '@/components/ui/badge';
import { VegBadge } from '@/components/ui/veg-badge';
import { useCart } from '@/hooks/useCart';
import { Product, ProductActionType } from '@/types/Database';
import { ACTION_CONFIG, deriveActionType } from '@/lib/marketplace-constants';
import { cn } from '@/lib/utils';
import { useCurrency } from '@/hooks/useCurrency';
import { computeStoreStatus, formatStoreClosedMessage } from '@/lib/store-availability';
import { useCategoryConfig } from '@/hooks/queries/useCategoryConfig';
import { optimizedImageUrl, imageSrcSet, handleImageError } from '@/utils/imageHelpers';

export interface ProductWithSeller extends Product {
  seller_name?: string;
  seller_rating?: number;
  seller_id: string;
  fulfillment_mode?: string | null;
  delivery_note?: string | null;
  seller_availability_start?: string | null;
  seller_availability_end?: string | null;
  seller_operating_days?: string[] | null;
  seller_is_available?: boolean | null;
}

interface ProductGridCardProps {
  product: ProductWithSeller;
  behavior?: any;
  onTap?: (product: ProductWithSeller) => void;
  className?: string;
  viewOnly?: boolean;
}

export function ProductGridCard({ product, behavior, onTap, className, viewOnly = false }: ProductGridCardProps) {
  const navigate = useNavigate();
  const { items, addItem, updateQuantity } = useCart();
  const { formatPrice } = useCurrency();
  const [imgLoaded, setImgLoaded] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  const { data: categoryConfigs } = useCategoryConfig();
  const catCfg = categoryConfigs?.find(c => c.category === product.category);
  const actionType: ProductActionType = deriveActionType(product.action_type as string, catCfg?.transactionType ?? null, catCfg ? { supportsCart: catCfg.behavior.supportsCart, enquiryOnly: catCfg.behavior.enquiryOnly } : null);
  const actionConfig = ACTION_CONFIG[actionType];
  const isCartAction = actionConfig.isCart;
  const showVegBadge = catCfg?.formHints?.showVegToggle ?? false;
  const placeholderEmoji = catCfg?.formHints?.placeholderEmoji || '📦';

  const cartItem = isCartAction ? items.find((item) => item.product_id === product.id) : null;
  const quantity = cartItem?.quantity || 0;
  const stockLimit = (product as any).stock_quantity != null ? (product as any).stock_quantity : 99;
  const canIncrement = quantity < stockLimit;

  const storeAvailability = useMemo(() => {
    return computeStoreStatus(
      product.seller_availability_start || (product as any)?.seller?.availability_start,
      product.seller_availability_end || (product as any)?.seller?.availability_end,
      product.seller_operating_days || (product as any)?.seller?.operating_days,
      product.seller_is_available ?? (product as any)?.seller?.is_available ?? true
    );
  }, [product.seller_availability_start, product.seller_availability_end, product.seller_operating_days, product.seller_is_available]);

  const isStoreClosed = storeAvailability.status !== 'open';
  const storeClosedMessage = isStoreClosed ? formatStoreClosedMessage(storeAvailability) : '';

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!isCartAction) { if (onTap) onTap(product); return; }
    hapticImpact('medium');
    if (quantity === 0) {
      setJustAdded(true);
      setTimeout(() => setJustAdded(false), 600);
    }
    addItem(product);
  };
  const handleIncrement = (e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault(); hapticImpact('light'); updateQuantity(product.id, quantity + 1); };
  const handleDecrement = (e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault(); hapticImpact('light'); updateQuantity(product.id, quantity - 1); };
  const handleCardClick = () => { hapticSelection(); if (onTap) { onTap(product); } else { navigate(`/seller/${product.seller_id}`); } };

  const isOutOfStock = !product.is_available || ((product as any).stock_quantity != null && (product as any).stock_quantity <= 0);
  const hasDiscount = (product as any).mrp && (product as any).mrp > product.price;
  const discountPct = (product as any).discount_percentage || (hasDiscount ? Math.round((((product as any).mrp - product.price) / (product as any).mrp) * 100) : 0);
  const showAdd = !viewOnly && !isOutOfStock && !isStoreClosed;

  return (
    <div
      onClick={handleCardClick}
      className={cn(
        'group/grid bg-card rounded-2xl border border-border/60 shadow-card cursor-pointer flex flex-col h-full relative overflow-hidden',
        'transition-[box-shadow,border-color,transform] duration-200 ease-out active:scale-[0.985]',
        'hover:shadow-elevated hover:border-border',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        isOutOfStock && 'opacity-50 grayscale-[40%]',
        isStoreClosed && !isOutOfStock && 'opacity-60 grayscale-[30%]',
        className
      )}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardClick(); } }}
    >
      <div className="relative p-2 pb-0">
        <div className="relative aspect-[4/3] rounded-xl overflow-hidden product-image-bg">
          {product.image_url && !imgLoaded && (
            <div className="absolute inset-0 product-image-shimmer" aria-hidden />
          )}
          {product.image_url ? (
            <img
              src={optimizedImageUrl(product.image_url, { width: 400, quality: 78 })}
              srcSet={imageSrcSet(product.image_url, 78) || undefined}
              sizes="(max-width: 640px) 46vw, 220px"
              alt={product.name}
              className={cn(
                'w-full h-full object-cover transition-[opacity,transform] duration-500',
                'group-hover/grid:scale-[1.03]',
                imgLoaded ? 'opacity-100' : 'opacity-0'
              )}
              loading="lazy"
              decoding="async"
              onLoad={() => setImgLoaded(true)}
              onError={handleImageError}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-muted">
              <span className="text-3xl" aria-hidden>{placeholderEmoji}</span>
            </div>
          )}

          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-card/70 via-card/15 to-transparent"
            aria-hidden
          />

          <AnimatePresence>
            {justAdded && (
              <motion.div
                className="absolute inset-0 bg-success/20 flex items-center justify-center z-10"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <Check size={22} className="text-success" strokeWidth={3} />
              </motion.div>
            )}
          </AnimatePresence>

          {isOutOfStock && (
            <div className="absolute inset-0 bg-background/60 flex items-center justify-center rounded-xl z-[5]">
              <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider bg-card/90 px-2 py-1 rounded-full border border-border/50">Out of stock</span>
            </div>
          )}
          {isStoreClosed && !isOutOfStock && (
            <div className="absolute inset-0 bg-background/40 flex items-center justify-center rounded-xl z-[5]">
              <span className="text-[8px] font-bold text-muted-foreground bg-card/90 px-1.5 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1 max-w-[90%] truncate border border-border/50">
                <Clock size={8} className="shrink-0" />{storeClosedMessage || 'Closed'}
              </span>
            </div>
          )}
          {product.is_bestseller && (
            <Badge className="absolute top-1.5 left-1.5 bg-badge-new text-primary-foreground text-[8px] px-1.5 py-0.5 font-bold shadow-sm rounded-md border-0 z-10">
              Bestseller
            </Badge>
          )}
          {hasDiscount && discountPct > 0 && (
            <span className="absolute top-1.5 right-1.5 z-10 bg-badge-discount text-primary-foreground text-[8px] font-extrabold px-1.5 py-0.5 rounded-md shadow-sm">
              {discountPct}% OFF
            </span>
          )}
          {(product as any).accepts_preorders && !product.is_bestseller && (
            <Badge className="absolute top-1.5 left-1.5 z-10 bg-card/90 text-foreground text-[8px] px-1.5 py-0.5 font-bold shadow-sm rounded-md border border-border/50">
              Pre-order{(product as any).lead_time_hours ? ` · ${(product as any).lead_time_hours}hr` : ''}
            </Badge>
          )}
          {showVegBadge && (
            <div className="absolute bottom-1.5 left-1.5 z-10">
              <VegBadge isVeg={product.is_veg} size="sm" />
            </div>
          )}
        </div>

        {showAdd && (
          <div className="absolute -bottom-3.5 right-3 z-10">
            {isCartAction && quantity > 0 ? (
              <div className="flex items-center bg-primary rounded-xl overflow-hidden shadow-cta animate-stepper-pop">
                <button
                  onClick={handleDecrement}
                  aria-label="Decrease quantity"
                  className="px-3 py-2 text-primary-foreground min-w-[44px] min-h-[40px] flex items-center justify-center touch-manipulation"
                >
                  <Minus size={14} strokeWidth={3} />
                </button>
                <span className="font-bold text-sm text-primary-foreground min-w-[24px] text-center tabular-nums">{quantity}</span>
                <button
                  onClick={handleIncrement}
                  disabled={!canIncrement}
                  aria-label="Increase quantity"
                  className={cn('px-3 py-2 text-primary-foreground min-w-[44px] min-h-[40px] flex items-center justify-center touch-manipulation', !canIncrement && 'opacity-40')}
                >
                  <Plus size={14} strokeWidth={3} />
                </button>
              </div>
            ) : (
              <button
                onClick={handleAdd}
                aria-label={isCartAction ? 'Add to cart' : actionConfig.shortLabel}
                className="bg-card text-primary font-extrabold text-[11px] px-5 py-2 rounded-xl border-[1.5px] border-primary shadow-sm hover:bg-primary hover:text-primary-foreground transition-colors uppercase tracking-wide active:scale-95 min-h-[40px] touch-manipulation"
              >
                {justAdded ? 'ADDED' : (isCartAction ? 'ADD' : actionConfig.shortLabel)}
              </button>
            )}
          </div>
        )}
      </div>

      <div className={cn('px-2.5 pb-2.5 flex flex-col flex-1 min-w-0', showAdd ? 'pt-5' : 'pt-2.5')}>
        <h4 className="font-semibold text-[12px] leading-snug line-clamp-2 text-foreground mb-0.5">{product.name}</h4>
        {product.seller_name && (
          <div className="flex items-center gap-1 mt-0.5 min-w-0">
            <Store size={9} className="text-muted-foreground shrink-0" />
            <span className="text-[10px] text-muted-foreground truncate">{product.seller_name}</span>
          </div>
        )}
        <div className="flex-1 min-h-0.5" />
        <div className="flex items-baseline gap-1.5 mt-auto pt-1">
          <span className="font-extrabold text-sm text-foreground leading-none tabular-nums">{formatPrice(product.price)}</span>
          {hasDiscount && (
            <span className="text-[10px] text-muted-foreground/80 line-through tabular-nums">{formatPrice((product as any).mrp)}</span>
          )}
        </div>
      </div>
    </div>
  );
}
