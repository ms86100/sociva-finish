// @ts-nocheck
import { useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Minus, Star, Award, Clock, Check } from 'lucide-react';
import { hapticSelection, hapticImpact } from '@/lib/haptics';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { VegBadge } from '@/components/ui/veg-badge';
import { Badge } from '@/components/ui/badge';
import { Product, ProductActionType } from '@/types/Database';
import { ACTION_CONFIG } from '@/lib/marketplace-constants';
import { useCart } from '@/hooks/useCart';
import { cn } from '@/lib/utils';
import { useCurrency } from '@/hooks/useCurrency';
import { resolveProductAvailability } from '@/lib/product-availability';
import { computeStoreStatus, formatStoreClosedMessage } from '@/lib/store-availability';
import { optimizedImageUrl, imageSrcSet, handleImageError } from '@/utils/imageHelpers';

interface ProductCardProps {
  product: Product;
  variant?: 'horizontal' | 'vertical';
  onTap?: (product: Product) => void;
}

export function ProductCard({ product, variant = 'horizontal', onTap }: ProductCardProps) {
  const { items, addItem, updateQuantity } = useCart();
  const { formatPrice } = useCurrency();
  const [justAdded, setJustAdded] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const actionType: ProductActionType = (product.action_type as ProductActionType) || 'add_to_cart';
  const actionConfig = ACTION_CONFIG[actionType] || ACTION_CONFIG.add_to_cart;
  const isCartAction = actionConfig.isCart;
  const isContactAction = actionType === 'contact_seller';

  const cartItem = isCartAction ? items.find((item) => item.product_id === product.id) : null;
  const quantity = cartItem?.quantity || 0;
  const stockLimit = (product as any).stock_quantity != null ? (product as any).stock_quantity : 99;

  const seller = (product as any)?.seller;
  const storeAvailability = useMemo(() => {
    const p = product as any;
    return computeStoreStatus(
      p.seller_availability_start ?? seller?.availability_start,
      p.seller_availability_end ?? seller?.availability_end,
      p.seller_operating_days ?? seller?.operating_days,
      p.seller_is_available ?? seller?.is_available ?? true
    );
  }, [product, seller?.availability_start, seller?.availability_end, seller?.operating_days, seller?.is_available]);

  const isStoreClosed = storeAvailability.status !== 'open';
  const storeClosedMessage = isStoreClosed ? formatStoreClosedMessage(storeAvailability) : '';
  const effectiveStoreClosed = isContactAction ? false : isStoreClosed;
  const isStockEmpty = stockLimit <= 0 && (product as any).stock_quantity != null;
  const availability = resolveProductAvailability({
    is_available: product.is_available,
    stock_quantity: (product as any).stock_quantity,
  });
  const isDisabled = !availability.canOrder || effectiveStoreClosed;
  const canIncrement = quantity < stockLimit && !effectiveStoreClosed;
  const hasDiscount = (product as any).mrp && (product as any).mrp > product.price;

  const handleAdd = useCallback(() => {
    if (!isCartAction) { hapticSelection(); if (onTap) onTap(product); return; }
    if (quantity === 0) {
      setJustAdded(true);
      setTimeout(() => setJustAdded(false), 600);
    }
    hapticImpact('medium');
    addItem(product);
  }, [isCartAction, onTap, product, addItem, quantity]);

  const handleIncrement = () => {
    if (!canIncrement) return;
    hapticImpact('light');
    updateQuantity(product.id, quantity + 1);
  };
  const handleDecrement = () => { hapticImpact('light'); updateQuantity(product.id, quantity - 1); };

  const imageEl = (width: number, className?: string) => (
    <>
      {product.image_url && !imgLoaded && (
        <div className="absolute inset-0 product-image-shimmer" aria-hidden />
      )}
      {product.image_url ? (
        <img
          src={optimizedImageUrl(product.image_url, { width, quality: 78 })}
          srcSet={imageSrcSet(product.image_url, 78) || undefined}
          sizes={`${width}px`}
          alt={product.name}
          className={cn('w-full h-full object-cover transition-opacity duration-400', imgLoaded ? 'opacity-100' : 'opacity-0', className)}
          loading="lazy"
          decoding="async"
          onLoad={() => setImgLoaded(true)}
          onError={handleImageError}
        />
      ) : (
        <div className="w-full h-full bg-muted flex items-center justify-center"><span className="text-3xl" aria-hidden>🛍️</span></div>
      )}
    </>
  );

  if (variant === 'vertical') {
    return (
      <Card className={cn(
        'overflow-hidden rounded-2xl border-border/60 shadow-card',
        isStoreClosed && !product.is_available ? '' : isStoreClosed ? 'opacity-60 grayscale-[30%]' : ''
      )}>
        <div className="relative aspect-[4/3] product-image-bg">
          {imageEl(400)}
          {availability.state !== 'available' && (
            <div className="absolute inset-0 bg-foreground/45 flex items-center justify-center backdrop-blur-[1px]">
              <span className="text-background text-sm font-medium bg-foreground/80 px-3 py-1.5 rounded-full">
                {availability.overlayLabel}
              </span>
            </div>
          )}
          {isStoreClosed && product.is_available && (
            <div className="absolute inset-0 bg-background/40 flex items-center justify-center">
              <span className="text-[9px] font-bold text-muted-foreground bg-card/90 px-2 py-1 rounded-full uppercase tracking-wider flex items-center gap-1 border border-border/50">
                <Clock size={9} />{storeClosedMessage || 'Closed'}
              </span>
            </div>
          )}
          <AnimatePresence>
            {justAdded && (
              <motion.div
                className="absolute inset-0 bg-success/20 flex items-center justify-center z-10"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                  className="w-11 h-11 rounded-full bg-card/95 shadow-md flex items-center justify-center"
                >
                  <Check size={22} className="text-success" strokeWidth={3} />
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="absolute top-2 left-2 flex flex-col gap-1">
            {product.is_bestseller && (<Badge className="bg-warning text-warning-foreground text-[10px] px-1.5 rounded-md"><Star size={10} className="mr-0.5 fill-current" />Bestseller</Badge>)}
            {product.is_recommended && (<Badge className="bg-success text-success-foreground text-[10px] px-1.5 rounded-md"><Award size={10} className="mr-0.5" />Recommended</Badge>)}
          </div>
          {hasDiscount && (
            <span className="absolute top-2 right-2 bg-badge-discount text-primary-foreground text-[9px] font-extrabold px-2 py-1 rounded-md shadow-sm">
              {Math.round((((product as any).mrp - product.price) / (product as any).mrp) * 100)}% OFF
            </span>
          )}
        </div>
        <CardContent className="p-3">
          <div className="flex items-start gap-2">
            <VegBadge isVeg={product.is_veg} size="sm" className="mt-1" />
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-sm line-clamp-2 leading-snug">{product.name}</h4>
              <div className="flex items-baseline gap-1.5 mt-1.5 flex-wrap">
                <p className="text-base font-extrabold text-foreground tabular-nums">{isContactAction ? 'Contact for price' : formatPrice(product.price)}</p>
                {hasDiscount && (
                  <span className="text-xs text-muted-foreground line-through tabular-nums">{formatPrice((product as any).mrp)}</span>
                )}
                {(product as any).stock_quantity != null && (product as any).stock_quantity > 0 && (
                  <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
                    {(product as any).stock_quantity} left
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="mt-3">
            {isCartAction && quantity > 0 && !effectiveStoreClosed ? (
              <div className="flex items-center justify-center gap-3 border-[1.5px] border-primary rounded-xl bg-primary/5">
                <Button size="sm" variant="ghost" className="h-11 w-11 p-0 text-primary touch-manipulation" onClick={handleDecrement} aria-label="Decrease quantity"><Minus size={16} /></Button>
                <AnimatePresence mode="popLayout">
                  <motion.span
                    key={quantity}
                    initial={{ scale: 0.6, opacity: 0, y: 6 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.6, opacity: 0, y: -6 }}
                    transition={{ duration: 0.15 }}
                    className="font-semibold text-primary w-6 text-center tabular-nums"
                  >
                    {quantity}
                  </motion.span>
                </AnimatePresence>
                <Button size="sm" variant="ghost" className="h-11 w-11 p-0 text-primary touch-manipulation" onClick={handleIncrement} disabled={!canIncrement} aria-label="Increase quantity"><Plus size={16} /></Button>
              </div>
            ) : (
              <Button variant="outline" className="w-full h-11 border-primary text-primary hover:bg-primary hover:text-primary-foreground font-bold rounded-xl touch-manipulation" onClick={handleAdd} disabled={isDisabled}>
                {effectiveStoreClosed ? (<><Clock size={14} className="mr-1" /> {storeClosedMessage || 'Closed'}</>) : (<>{isCartAction && <Plus size={14} className="mr-1" />}{justAdded ? 'ADDED' : actionConfig.shortLabel}</>)}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={cn('flex gap-3 py-3.5 border-b border-border/70 last:border-0', isStoreClosed && 'opacity-60')}>
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <VegBadge isVeg={product.is_veg} size="sm" className="mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-semibold text-[14px] leading-snug line-clamp-2">{product.name}</h4>
              {product.is_bestseller && (<Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-warning/20 text-warning-foreground rounded-md"><Star size={10} className="mr-0.5 fill-warning text-warning" />Bestseller</Badge>)}
              {product.is_recommended && (<Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-success/20 text-success rounded-md">Recommended</Badge>)}
              {(product as any).avg_response_minutes != null && (product as any).avg_response_minutes > 0 && (product as any).avg_response_minutes <= 15 && (
                <span className="text-[9px] px-1 py-0.5 rounded-md bg-success/10 text-success flex items-center gap-0.5 shrink-0">⚡~{(product as any).avg_response_minutes}m</span>
              )}
            </div>
            {product.description && (<p className="text-sm text-muted-foreground line-clamp-2 mt-1">{product.description}</p>)}
            <div className="flex items-baseline gap-1.5 mt-2 flex-wrap">
              <p className="font-extrabold text-base tabular-nums">{isContactAction ? 'Contact for price' : formatPrice(product.price)}</p>
              {hasDiscount && (
                <span className="text-xs text-muted-foreground line-through tabular-nums">{formatPrice((product as any).mrp)}</span>
              )}
              {(product as any).stock_quantity != null && (product as any).stock_quantity > 0 && (
                <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
                  {(product as any).stock_quantity} left
                </span>
              )}
            </div>
            {isStoreClosed && (<p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-1"><Clock size={9} /> {storeClosedMessage || 'Store closed'}</p>)}
          </div>
        </div>
      </div>
      <div className="flex flex-col items-center gap-2 shrink-0">
        <div className="relative w-[88px] h-[88px] rounded-xl overflow-hidden product-image-bg shadow-sm">
          {imageEl(176)}
          <AnimatePresence>
            {justAdded && (
              <motion.div
                className="absolute inset-0 bg-success/25 flex items-center justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                >
                  <Check size={20} className="text-success" strokeWidth={3} />
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {isCartAction && quantity > 0 && !isStoreClosed ? (
          <div className="flex items-center gap-1 -mt-4 relative z-10 bg-primary rounded-xl px-1.5 shadow-cta animate-stepper-pop">
            <Button size="sm" variant="ghost" className="h-9 w-9 p-0 text-primary-foreground hover:bg-primary-foreground/20 touch-manipulation" onClick={handleDecrement} aria-label="Decrease quantity"><Minus size={14} /></Button>
            <AnimatePresence mode="popLayout">
              <motion.span
                key={quantity}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="font-semibold text-primary-foreground w-4 text-center tabular-nums"
              >
                {quantity}
              </motion.span>
            </AnimatePresence>
            <Button size="sm" variant="ghost" className="h-9 w-9 p-0 text-primary-foreground hover:bg-primary-foreground/20 touch-manipulation" onClick={handleIncrement} disabled={!canIncrement} aria-label="Increase quantity"><Plus size={14} /></Button>
          </div>
        ) : (
          <Button
            variant="outline"
            className="w-full h-9 border-[1.5px] border-primary text-primary hover:bg-primary hover:text-primary-foreground -mt-4 relative z-10 bg-card shadow-sm font-extrabold text-[11px] uppercase tracking-wide rounded-xl touch-manipulation"
            onClick={handleAdd}
            disabled={isDisabled}
          >
            {effectiveStoreClosed ? 'Closed' : (justAdded ? 'ADDED' : (isCartAction ? 'ADD' : actionConfig.shortLabel))}
          </Button>
        )}
      </div>
    </div>
  );
}
