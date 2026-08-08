// @ts-nocheck
import { useMemo, memo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Minus, Clock, MapPin, AlertTriangle, Check, Star, Zap } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { useHaptics } from '@/hooks/useHaptics';
import { Badge } from '@/components/ui/badge';
import { VegBadge } from '@/components/ui/veg-badge';
import { useCart } from '@/hooks/useCart';
import { ProductActionType } from '@/types/database';
import { NotifyMeButton } from './NotifyMeButton';
import { ACTION_CONFIG, deriveActionType } from '@/lib/marketplace-constants';
import { useCardAnalytics } from '@/hooks/useCardAnalytics';
import { MARKETPLACE_FALLBACKS, type MarketplaceConfig } from '@/hooks/useMarketplaceConfig';
import type { BadgeConfigRow } from '@/hooks/useBadgeConfig';
import type { CategoryConfig } from '@/types/categories';
import { cn } from '@/lib/utils';
import { useCurrency } from '@/hooks/useCurrency';
import { useMarketplaceLabels } from '@/hooks/useMarketplaceLabels';
import { computeStoreStatus, formatStoreClosedMessage, type StoreAvailability } from '@/lib/store-availability';
import { SellerTrustBadge } from '@/components/trust/SellerTrustBadge';
import { ProductFavoriteButton } from '@/components/favorite/ProductFavoriteButton';
import { useAuth } from '@/contexts/AuthContext';
import { optimizedImageUrl, imageSrcSet, handleImageError } from '@/utils/imageHelpers';

export interface ProductWithSeller {
  id: string; seller_id: string; name: string; price: number; image_url: string | null; category: string;
  is_veg: boolean; is_available: boolean; is_bestseller: boolean; is_recommended: boolean; is_urgent: boolean;
  description: string | null; action_type?: ProductActionType | string | null; contact_phone?: string | null;
  mrp?: number | null; brand?: string | null; unit_type?: string | null; price_per_unit?: string | null;
  stock_quantity?: number | null; serving_size?: string | null; spice_level?: string | null; cuisine_type?: string | null;
  service_scope?: string | null; visit_charge?: number | null; minimum_charge?: number | null;
  delivery_time_text?: string | null; tags?: string[] | null; discount_percentage?: number | null;
  service_duration_minutes?: number | null; prep_time_minutes?: number | null; warranty_period?: string | null;
  lead_time_hours?: number | null; accepts_preorders?: boolean;
  seller_name?: string; seller_rating?: number; seller_reviews?: number; seller_verified?: boolean;
  completed_order_count?: number; fulfillment_mode?: string | null; delivery_note?: string | null;
  seller_availability_start?: string | null; seller_availability_end?: string | null;
  seller_operating_days?: string[] | null; seller_is_available?: boolean;
  society_name?: string | null; distance_km?: number | null;
  created_at: string; updated_at: string; [key: string]: any;
}

type CardLayout = 'auto' | 'ecommerce' | 'food' | 'service';

interface ProductListingCardProps {
  product: ProductWithSeller; layout?: CardLayout; onTap?: (product: ProductWithSeller) => void;
  onNavigate?: (path: string) => void; className?: string; viewOnly?: boolean;
  categoryConfigs?: CategoryConfig[]; marketplaceConfig?: MarketplaceConfig;
  badgeConfigs?: BadgeConfigRow[]; socialProofCount?: number;
  onViewClick?: () => void;
  compact?: boolean;
}

function ProductListingCardInner({ product, layout = 'auto', onTap, onNavigate, className, viewOnly = false, categoryConfigs = [], marketplaceConfig, badgeConfigs = [], socialProofCount, onViewClick, compact = false }: ProductListingCardProps) {
  const { user } = useAuth();
  const { items, addItem, updateQuantity } = useCart();
  const { impact, selectionChanged } = useHaptics();
  const { formatPrice } = useCurrency();
  const ml = useMarketplaceLabels();
  const mc = marketplaceConfig || MARKETPLACE_FALLBACKS;

  const actionType: ProductActionType = useMemo(() => {
    const catCfg = categoryConfigs.find(c => c.category === product.category);
    return deriveActionType(product.action_type as string, catCfg?.transactionType, catCfg ? { supportsCart: catCfg?.behavior?.supportsCart, enquiryOnly: catCfg?.behavior?.enquiryOnly } : null);
  }, [product.action_type, product.category, categoryConfigs]);
  const actionConfig = ACTION_CONFIG[actionType];
  const isCartAction = actionConfig.isCart;
  const cartItem = isCartAction ? items.find((item) => item.product_id === product.id) : null;
  const quantity = cartItem?.quantity || 0;
  const stockLimit = product.stock_quantity != null ? product.stock_quantity : 99;
  const canIncrement = quantity < stockLimit;

  const catConfig = useMemo(() => categoryConfigs.find(c => c.category === product.category) || null, [categoryConfigs, product.category]);
  const resolvedLayout = useMemo((): 'ecommerce' | 'food' | 'service' => { if (layout !== 'auto') return layout as any; return catConfig?.layoutType || 'ecommerce'; }, [layout, catConfig]);
  const showVegBadge = catConfig?.formHints?.showVegToggle ?? false;
  const placeholderEmoji = catConfig?.formHints?.placeholderEmoji || mc.labels.defaultPlaceholderEmoji;

  const { ref: cardRef, onCardClick: trackClick, onAddClick: trackAdd } = useCardAnalytics({ productId: product.id, category: product.category, price: product.price, sellerId: product.seller_id, layout: resolvedLayout });

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    trackAdd();
    if (!isCartAction) {
      if (onTap) onTap(product);
      return;
    }
    impact('medium');
    addItem(product as any);
  };
  const handleIncrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    impact('light');
    updateQuantity(product.id, quantity + 1);
  };
  const handleDecrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    impact('light');
    updateQuantity(product.id, quantity - 1);
  };
  const handleCardClick = () => { selectionChanged(); trackClick(); if (onTap) onTap(product); else onNavigate?.(`/seller/${product.seller_id}`); };

  const isOutOfStock = !product.is_available || (product.stock_quantity != null && product.stock_quantity <= 0);
  const isSellerInactive = useMemo(() => { if (!(product as any).last_active_at) return false; return Date.now() - new Date((product as any).last_active_at).getTime() > 7 * 24 * 60 * 60 * 1000; }, [(product as any).last_active_at]);

  const storeAvailability = useMemo((): StoreAvailability => computeStoreStatus(product.seller_availability_start, product.seller_availability_end, product.seller_operating_days, product.seller_is_available ?? true), [product.seller_availability_start, product.seller_availability_end, product.seller_operating_days, product.seller_is_available]);
  const isStoreClosed = storeAvailability.status !== 'open';
  const storeClosedMessage = isStoreClosed ? formatStoreClosedMessage(storeAvailability) : '';

  const isLowStock = mc.enableScarcity && product.stock_quantity != null && product.stock_quantity > 0 && product.stock_quantity <= mc.lowStockThreshold;

  const badges = useMemo(() => {
    const result: { label: string; color: string }[] = [];
    for (const bc of badgeConfigs) {
      if (result.length >= mc.maxBadgesPerCard) break;
      if (!bc.layout_visibility.includes(resolvedLayout)) continue;
      if (bc.tag_key === 'bestseller' && product.is_bestseller) result.push({ label: bc.badge_label, color: bc.color });
      else if (bc.tag_key === 'low_stock' && isLowStock) result.push({ label: bc.badge_label.replace('{stock}', String(product.stock_quantity)), color: mc.enablePulseAnimation ? `${bc.color} animate-low-stock-pulse` : bc.color });
      else if (product.tags?.includes(bc.tag_key) && bc.tag_key !== 'bestseller' && bc.tag_key !== 'low_stock') result.push({ label: bc.badge_label, color: bc.color });
    }
    return result;
  }, [badgeConfigs, product, resolvedLayout, isLowStock, mc]);

  const hasDiscount = product.mrp && product.mrp > product.price;
  const discountPct = product.discount_percentage || (hasDiscount ? Math.round(((product.mrp! - product.price) / product.mrp!) * 100) : 0);
  const deliveryText = product.delivery_time_text || (product.prep_time_minutes ? mc.labels.prepTimeFormat.replace('{value}', String(product.prep_time_minutes)) : null);
  const variantText = product.unit_type ? (product.price_per_unit || product.unit_type) : (product.serving_size || null);
  const isServiceLayout = resolvedLayout === 'service';
  const serviceStartingPrice = product.minimum_charge ?? product.visit_charge ?? product.price;
  const serviceDuration = product.service_duration_minutes ? `${product.service_duration_minutes} min` : null;
  const responseMinutes = Number((product as any).avg_response_minutes) > 0 ? Number((product as any).avg_response_minutes) : null;
  const serviceAvailabilityLabel = isStoreClosed ? storeClosedMessage : 'Available now';

  const distanceLabel = useMemo(() => {
    const distKm = product.distance_km ?? (product as any).distance_km;
    if (distKm != null) return distKm < 1 ? ml.label('label_distance_m_format').replace('{distance}', String(Math.round(distKm * 1000))) : ml.label('label_distance_km_format').replace('{distance}', String(Math.round(distKm * 10) / 10));
    return null;
  }, [product.distance_km, (product as any).distance_km, ml]);

  const locationLabel = useMemo(() => {
    const socName = product.society_name ?? (product as any).society_name;
    if (socName) return distanceLabel ? `${socName} · ${distanceLabel}` : socName;
    if (distanceLabel) return `${ml.label('label_nearby')} · ${distanceLabel}`;
    return null;
  }, [product.society_name, (product as any).society_name, distanceLabel]);

  const activityLabel = useMemo(() => { if (!(product as any).last_active_at) return ''; return formatSellerActivity((product as any).last_active_at, ml); }, [(product as any).last_active_at, ml]);
  const onTimeBadgeMinOrders = ml.threshold('on_time_badge_min_orders');

  const placeholderBg = catConfig?.color ? `${catConfig.color}10` : undefined;
  const showRating = product.seller_rating != null && product.seller_rating > 0;

  const [imgLoaded, setImgLoaded] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  const handleAddWithFeedback = useCallback((e: React.MouseEvent) => {
    handleAdd(e);
    if (isCartAction) {
      setJustAdded(true);
      setTimeout(() => setJustAdded(false), 600);
    }
  }, [handleAdd, isCartAction]);

  const imgSrc = product.image_url ? optimizedImageUrl(product.image_url, { width: 400, quality: 78 }) : '';
  const imgSrcSet = product.image_url ? imageSrcSet(product.image_url, 78) : '';

  return (
    <motion.div
      ref={cardRef}
      onClick={handleCardClick}
      whileTap={{ scale: 0.985 }}
      variants={{ hidden: { opacity: 0, y: 12, scale: 0.98 }, show: { opacity: 1, y: 0, scale: 1 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 28 }}
      className={cn(
        'group/card w-full min-w-0 bg-card rounded-2xl cursor-pointer flex flex-col relative overflow-hidden',
        'border border-border/60 shadow-card',
        'transition-[box-shadow,border-color,transform] duration-200 ease-out',
        'hover:shadow-elevated hover:border-border',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        compact ? 'h-[260px]' : 'h-full',
        isOutOfStock && 'opacity-45 grayscale-[40%]',
        isStoreClosed && !isOutOfStock && 'opacity-55 grayscale-[25%]',
        className
      )}
      style={{ contentVisibility: 'auto', containIntrinsicSize: compact ? '160px 260px' : '160px 280px' }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardClick(); } }}
    >
      {/* Image */}
      <div className="relative shrink-0">
        <div className={cn(
          'relative w-full overflow-hidden product-image-bg',
          compact ? 'h-[148px]' : 'aspect-[4/5] sm:aspect-square'
        )}>
          {/* Shimmer placeholder until image loads */}
          {product.image_url && !imgLoaded && (
            <div className="absolute inset-0 product-image-shimmer" aria-hidden />
          )}

          {product.image_url ? (
            <img
              src={imgSrc}
              srcSet={imgSrcSet || undefined}
              sizes="(max-width: 640px) 46vw, (max-width: 1024px) 30vw, 200px"
              alt={product.name}
              className={cn(
                'w-full h-full object-cover transition-[opacity,transform] duration-500 ease-out',
                'group-hover/card:scale-[1.03]',
                imgLoaded ? 'opacity-100' : 'opacity-0'
              )}
              loading="lazy"
              decoding="async"
              onLoad={() => setImgLoaded(true)}
              onError={handleImageError}
            />
          ) : (
            <div
              className="w-full h-full flex flex-col items-center justify-center gap-1.5"
              style={{
                background: placeholderBg
                  ? `linear-gradient(160deg, ${placeholderBg}, hsl(var(--muted)))`
                  : 'linear-gradient(160deg, hsl(var(--muted)), hsl(var(--card)))',
              }}
            >
              <span className={cn(compact ? 'text-4xl' : 'text-5xl')} aria-hidden>{placeholderEmoji}</span>
              {!compact && (
                <span className="text-[9px] text-muted-foreground font-medium max-w-[80%] text-center line-clamp-1 px-2">
                  {product.name}
                </span>
              )}
            </div>
          )}

          {/* Soft bottom scrub so ADD button reads cleanly */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card/80 via-card/20 to-transparent"
            aria-hidden
          />

          <AnimatePresence>
            {justAdded && (
              <motion.div
                className="absolute inset-0 bg-success/20 flex items-center justify-center z-20"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.28 }}
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 16 }}
                  className="w-11 h-11 rounded-full bg-card/95 shadow-md flex items-center justify-center"
                >
                  <Check size={22} className="text-success" strokeWidth={3} />
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {isOutOfStock && (
            <div className="absolute inset-0 bg-background/55 flex items-center justify-center backdrop-blur-[1.5px] z-[5]">
              <span className="text-[10px] font-bold text-muted-foreground bg-card/95 px-3 py-1.5 rounded-full uppercase tracking-wider shadow-sm border border-border/50">
                {mc.labels.outOfStock}
              </span>
            </div>
          )}

          {isStoreClosed && !isOutOfStock && (
            <div className="absolute inset-0 bg-background/45 flex items-center justify-center backdrop-blur-[1.5px] z-[5]">
              <span className="text-[10px] font-bold text-muted-foreground bg-card/95 px-3 py-1.5 rounded-full uppercase tracking-wider shadow-sm border border-border/50 flex items-center gap-1 max-w-[90%] truncate">
                <Clock size={10} className="shrink-0" />
                <span className="truncate">{storeClosedMessage}</span>
              </span>
            </div>
          )}

          {/* Badges — top left */}
          {badges.length > 0 && (
            <div className="absolute top-2 left-2 flex flex-col gap-1 z-10 max-w-[70%]">
              {badges.map((b, i) => (
                <Badge
                  key={i}
                  className={cn(
                    'text-[8px] leading-none px-2 py-0.5 font-bold rounded-md border-0 shadow-sm truncate',
                    b.color
                  )}
                >
                  {b.label}
                </Badge>
              ))}
            </div>
          )}

          {/* Discount — top right */}
          {hasDiscount && discountPct > 0 && (
            <div className="absolute top-2 right-2 z-10">
              <span className="bg-badge-discount text-primary-foreground text-[9px] font-extrabold px-2 py-1 rounded-md shadow-sm tracking-wide">
                {discountPct}% OFF
              </span>
            </div>
          )}

          {/* Favorite — always available; sits below discount when both present */}
          {user && (
            <div
              className={cn(
                'absolute right-1.5 z-10',
                hasDiscount && discountPct > 0 ? 'top-9' : 'top-1.5'
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <ProductFavoriteButton
                productId={product.id}
                size="sm"
                className="bg-card/90 backdrop-blur-md shadow-sm border border-border/40 text-foreground"
              />
            </div>
          )}

          {showVegBadge && (
            <div className="absolute bottom-2.5 left-2 z-10">
              <VegBadge isVeg={product.is_veg} size="sm" />
            </div>
          )}

          {product.accepts_preorders && (
            <div className={cn('absolute z-10', showVegBadge ? 'bottom-2.5 left-8' : 'bottom-2.5 left-2')}>
              <span className="bg-card/90 text-foreground text-[8px] font-bold px-2 py-0.5 rounded-md shadow-sm border border-border/50 flex items-center gap-1 backdrop-blur-sm">
                <Clock size={8} className="text-primary" />
                Pre-order{product.lead_time_hours ? ` · ${product.lead_time_hours}hr` : ''}
              </span>
            </div>
          )}
        </div>

        {/* ADD / quantity stepper — overlapping image edge */}
        {!viewOnly && !isOutOfStock && !isStoreClosed && (
          <div className="absolute -bottom-4 right-2 z-20">
            {isCartAction && quantity > 0 ? (
              <div className="flex items-center bg-primary rounded-xl overflow-hidden shadow-cta border border-primary animate-stepper-pop">
                <motion.button
                  whileTap={{ scale: 0.88 }}
                  onClick={handleDecrement}
                  aria-label="Decrease quantity"
                  className="px-2.5 py-2 text-primary-foreground min-w-[40px] min-h-[36px] flex items-center justify-center touch-manipulation"
                >
                  <Minus size={15} strokeWidth={3} />
                </motion.button>
                <AnimatePresence mode="popLayout">
                  <motion.span
                    key={quantity}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    transition={{ duration: 0.14 }}
                    className="font-extrabold text-sm text-primary-foreground px-1 tabular-nums min-w-[22px] text-center"
                  >
                    {quantity}
                  </motion.span>
                </AnimatePresence>
                <motion.button
                  whileTap={{ scale: 0.88 }}
                  onClick={handleIncrement}
                  disabled={!canIncrement}
                  aria-label="Increase quantity"
                  className={cn(
                    'px-2.5 py-2 text-primary-foreground min-w-[40px] min-h-[36px] flex items-center justify-center touch-manipulation',
                    !canIncrement && 'opacity-40 cursor-not-allowed'
                  )}
                >
                  <Plus size={15} strokeWidth={3} />
                </motion.button>
              </div>
            ) : (
              <motion.button
                whileTap={{ scale: 0.94 }}
                onClick={handleAddWithFeedback}
                aria-label={isCartAction ? 'Add to cart' : actionConfig.shortLabel}
                className={cn(
                  'bg-card text-primary font-extrabold text-[11px] px-3.5 py-2 rounded-xl',
                  'border-[1.5px] border-primary shadow-sm',
                  'hover:bg-primary hover:text-primary-foreground',
                  'transition-colors uppercase tracking-wide',
                  'min-h-[36px] min-w-[56px] flex items-center justify-center gap-1',
                  'touch-manipulation'
                )}
              >
                {justAdded ? (
                  <><Check size={12} strokeWidth={3} /> ADDED</>
                ) : (
                  isCartAction ? 'ADD' : actionConfig.shortLabel
                )}
              </motion.button>
            )}
          </div>
        )}
      </div>

      {compact ? (
        <div className={cn(
          'h-[112px] overflow-hidden px-2.5 pb-2.5',
          !viewOnly && !isOutOfStock && !isStoreClosed ? 'pt-6' : 'pt-3'
        )}>
          <div className="flex h-full flex-col overflow-hidden">
            <div className="min-h-[20px] flex items-baseline gap-1.5 overflow-hidden">
              <span className="font-extrabold text-[15px] text-foreground leading-none tracking-tight tabular-nums">
                {isServiceLayout && <span className="text-[10px] font-semibold text-muted-foreground mr-1">From</span>}
                {formatPrice(isServiceLayout ? serviceStartingPrice : product.price)}
              </span>
              {hasDiscount && (
                <span className="text-[11px] text-muted-foreground/80 line-through leading-none tabular-nums">
                  {formatPrice(product.mrp!)}
                </span>
              )}
            </div>

            <div className="mt-0.5 h-[14px] overflow-hidden">
              {isServiceLayout ? (
                <span className="block text-[9px] font-medium text-muted-foreground truncate">
                  {[serviceDuration, responseMinutes ? `~${responseMinutes}m response` : null, serviceAvailabilityLabel].filter(Boolean).join(' · ')}
                </span>
              ) : variantText && (
                <span className="block text-[10px] font-medium text-muted-foreground line-clamp-1">{variantText}</span>
              )}
            </div>

            <h4 className="mt-1 h-[34px] overflow-hidden font-semibold leading-snug text-foreground text-[12px] line-clamp-2">
              {product.name}
            </h4>
          </div>
        </div>
      ) : (
        <div className={cn(
          'flex flex-1 flex-col min-h-0 overflow-hidden px-2.5 sm:px-3 pb-3',
          !viewOnly && !isOutOfStock && !isStoreClosed ? 'pt-6' : 'pt-3'
        )}>
          {/* Price row */}
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="font-extrabold text-[15px] sm:text-base text-foreground leading-none tracking-tight tabular-nums">
              {isServiceLayout && <span className="text-[10px] font-semibold text-muted-foreground mr-1">From</span>}
              {formatPrice(isServiceLayout ? serviceStartingPrice : product.price)}
            </span>
            {hasDiscount && (
              <span className="text-[11px] text-muted-foreground/80 line-through leading-none tabular-nums">
                {formatPrice(product.mrp!)}
              </span>
            )}
            {hasDiscount && discountPct > 0 && (
              <span className="text-[10px] font-bold text-badge-discount leading-none">
                {discountPct}% off
              </span>
            )}
          </div>

          {variantText && (
            <span className="text-[10px] font-medium text-muted-foreground mt-0.5 line-clamp-1">{variantText}</span>
          )}

          <h4 className="font-semibold leading-snug text-foreground text-[12px] sm:text-[13px] line-clamp-2 mt-1 min-h-[2lh]">
            {product.name}
          </h4>

          {isServiceLayout && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-[9px] font-semibold text-muted-foreground">
              {serviceDuration && <span className="inline-flex items-center gap-0.5"><Clock size={9} />{serviceDuration}</span>}
              {responseMinutes && <span className="inline-flex items-center gap-0.5"><Zap size={9} />~{responseMinutes}m response</span>}
              <span className={cn('inline-flex items-center gap-0.5', isStoreClosed ? 'text-muted-foreground' : 'text-success')}>
                <span className={cn('w-1.5 h-1.5 rounded-full', isStoreClosed ? 'bg-muted-foreground' : 'bg-success')} />
                {serviceAvailabilityLabel}
              </span>
            </div>
          )}

          {product.description && (
            <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{product.description}</p>
          )}

          {/* Store + trust row */}
          {product.seller_name && (
            <div className="flex items-center gap-1 mt-1.5 overflow-hidden min-w-0">
              <span
                className={cn(
                  'text-[10px] truncate min-w-0',
                  product.distance_km && product.distance_km > 0 ? 'text-foreground font-medium' : 'text-muted-foreground'
                )}
              >
                {product.seller_name}
              </span>
              {showRating && (
                <span className="inline-flex items-center gap-0.5 shrink-0 text-[9px] font-bold text-foreground bg-secondary px-1.5 py-0.5 rounded-md">
                  <Star size={8} className="text-rating-star fill-rating-star" />
                  {Number(product.seller_rating).toFixed(1)}
                </span>
              )}
              {product.seller_verified && (
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-md bg-primary/10 text-primary shrink-0">
                  Verified
                </span>
              )}
              {(product as any).is_same_society && (
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-md bg-success/10 text-success shrink-0">
                  Your society
                </span>
              )}
              {product.seller_id && <SellerTrustBadge sellerId={product.seller_id} size="sm" />}
              {(product as any).avg_response_minutes != null && (product as any).avg_response_minutes > 0 && (product as any).avg_response_minutes <= 15 && (
                <span className="text-[9px] px-1 py-0.5 rounded-md bg-success/10 text-success flex items-center gap-0.5 shrink-0">
                  ⚡~{(product as any).avg_response_minutes}m
                </span>
              )}
            </div>
          )}

          {deliveryText && (
            <div className="flex items-center gap-1 mt-1">
              <Clock size={10} className="text-primary shrink-0" />
              <span className="text-[10px] font-semibold text-primary truncate">{deliveryText}</span>
            </div>
          )}

          {(activityLabel || isSellerInactive) && (
            <div className="flex items-center gap-1 mt-0.5">
              {isSellerInactive ? (
                <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-destructive/10 text-destructive flex items-center gap-0.5">
                  <AlertTriangle size={8} />Store may be unresponsive
                </span>
              ) : activityLabel ? (
                <span className="text-[9px] text-muted-foreground">{activityLabel}</span>
              ) : null}
            </div>
          )}

          {locationLabel && (
            <div
              className={cn(
                'flex items-center gap-1 mt-1 min-w-0',
                (product as any).seller_latitude && (product as any).seller_longitude && 'cursor-pointer hover:text-primary transition-colors'
              )}
              onClick={(e) => {
                const lat = (product as any).seller_latitude;
                const lng = (product as any).seller_longitude;
                if (lat && lng) {
                  e.stopPropagation();
                  e.preventDefault();
                  window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`, '_blank');
                }
              }}
              title={(product as any).seller_latitude ? 'Open in Google Maps' : undefined}
            >
              <MapPin size={9} className="shrink-0 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground leading-tight truncate">
                {locationLabel}
              </span>
            </div>
          )}
        </div>
      )}

      {viewOnly && (
        <div className="px-3 pb-3">
          <button
            onClick={(e) => { e.stopPropagation(); if (onViewClick) { onViewClick(); } else { onNavigate?.(`/seller/${product.seller_id}`); } }}
            className="w-full border-[1.5px] border-primary text-primary font-bold text-xs py-2.5 rounded-xl hover:bg-primary hover:text-primary-foreground transition-colors duration-200 min-h-[44px] touch-manipulation"
          >
            {onViewClick ? 'View Details' : mc.labels.viewButton}
          </button>
        </div>
      )}

      {!viewOnly && isOutOfStock && (<NotifyMeButton productId={product.id} />)}
    </motion.div>
  );
}

function formatSellerActivity(lastActiveAt: string, ml: ReturnType<typeof useMarketplaceLabels>): string {
  try {
    const d = new Date(lastActiveAt);
    if (isNaN(d.getTime())) return '';
    return ml.label('label_active_ago').replace('{time}', formatDistanceToNowStrict(d, { addSuffix: false }));
  } catch {
    return '';
  }
}

export const ProductListingCard = memo(ProductListingCardInner);
