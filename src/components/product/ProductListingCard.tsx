// @ts-nocheck
import { useMemo, memo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Minus, Clock, Check, Star } from 'lucide-react';
import { useHaptics } from '@/hooks/useHaptics';
import { Badge } from '@/components/ui/badge';
import { VegBadge } from '@/components/ui/veg-badge';
import { useCart } from '@/hooks/useCart';
import { ProductActionType } from '@/types/Database';
import { NotifyMeButton } from './NotifyMeButton';
import { ACTION_CONFIG, deriveActionType, getCommercePriceLabel, shouldShowMonetaryPrice } from '@/lib/marketplace-constants';
import { formatLeadTime } from '@/lib/lead-time';
import { useCardAnalytics } from '@/hooks/useCardAnalytics';
import { MARKETPLACE_FALLBACKS, type MarketplaceConfig } from '@/hooks/useMarketplaceConfig';
import type { BadgeConfigRow } from '@/hooks/useBadgeConfig';
import type { CategoryConfig } from '@/types/categories';
import { cn } from '@/lib/utils';
import { resolveProductAvailability } from '@/lib/product-availability';
import { listingDiscountPercent, listingGlanceFacts, listingGlanceKind } from '@/lib/listing-glance';
import { useCurrency } from '@/hooks/useCurrency';
import { useMarketplaceLabels } from '@/hooks/useMarketplaceLabels';
import { computeStoreStatus, formatStoreClosedMessage, type StoreAvailability } from '@/lib/store-availability';
import { ProductFavoriteButton } from '@/components/favorite/ProductFavoriteButton';
import { useAuth } from '@/contexts/AuthContext';
import { optimizedImageUrl, imageSrcSet, handleImageError } from '@/utils/imageHelpers';
import { displaySellerStoreName } from '@/lib/seller-journey';
import { SellerLocationLine } from '@/components/location/SellerLocationLine';
import { listingPlaceChip } from '@/lib/location-label-resolver';

export interface ProductWithSeller {
  id: string; seller_id: string; name: string; price: number; image_url: string | null; category: string;
  is_veg: boolean | null; is_available: boolean; is_bestseller: boolean; is_recommended: boolean; is_urgent: boolean;
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
  const showVegBadge = (catConfig?.formHints?.showVegToggle ?? false) && (product.is_veg === true || product.is_veg === false);
  const placeholderEmoji = catConfig?.formHints?.placeholderEmoji || mc.labels.defaultPlaceholderEmoji;

  const { ref: cardRef, onCardClick: trackClick, onAddClick: trackAdd } = useCardAnalytics(
    { productId: product.id, category: product.category, price: product.price, sellerId: product.seller_id, layout: resolvedLayout },
    !viewOnly,
  );

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    trackAdd();
    if (!isCartAction) {
      if (onTap) onTap(product);
      return;
    }
    impact('medium');
    void (async () => {
      const ok = await addItem(product as any);
      if (ok) {
        setJustAdded(true);
        setTimeout(() => setJustAdded(false), 600);
      }
    })();
  };
  const handleIncrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!canIncrement) return;
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

  const availability = useMemo(
    () => resolveProductAvailability(product),
    [product.is_available, product.stock_quantity],
  );
  const isUnavailable = availability.state !== 'available';
  const availabilityOverlayLabel = availability.overlayLabel;
  const storeAvailability = useMemo((): StoreAvailability => computeStoreStatus(product.seller_availability_start, product.seller_availability_end, product.seller_operating_days, product.seller_is_available ?? true), [product.seller_availability_start, product.seller_availability_end, product.seller_operating_days, product.seller_is_available]);
  const isStoreClosed = storeAvailability.status !== 'open';
  const storeClosedMessage = isStoreClosed ? formatStoreClosedMessage(storeAvailability) : '';
  const isContactAction = !ACTION_CONFIG[actionType]?.isCart;
  const priceLabel = getCommercePriceLabel(actionType, product.price, formatPrice);
  const showMoney = shouldShowMonetaryPrice(actionType, product.price);
  const effectiveStoreClosed = isContactAction ? false : isStoreClosed;

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
  const discountPct = listingDiscountPercent(product.price, product.mrp, product.discount_percentage);
  const glanceKind = listingGlanceKind(actionType);
  const glanceFacts = listingGlanceFacts({
    serving_size: product.serving_size,
    unit_type: product.unit_type,
    price_per_unit: product.price_per_unit,
    stock_quantity: product.stock_quantity,
    prep_time_minutes: product.prep_time_minutes,
    delivery_time_text: product.delivery_time_text,
    service_duration_minutes: product.service_duration_minutes,
    fulfillment_mode: product.fulfillment_mode,
    service_scope: product.service_scope,
    description: product.description,
    avg_response_minutes: (product as any).avg_response_minutes,
    visit_charge: product.visit_charge,
    seller_is_available: product.seller_is_available ?? !isStoreClosed,
  }, glanceKind);
  const isServiceLayout = resolvedLayout === 'service';
  const serviceStartingPrice = product.minimum_charge ?? product.visit_charge ?? product.price;

  const distanceLabel = useMemo(() => {
    const distKm = product.distance_km ?? (product as any).distance_km;
    if (distKm != null) return distKm < 1 ? ml.label('label_distance_m_format').replace('{distance}', String(Math.round(distKm * 1000))) : ml.label('label_distance_km_format').replace('{distance}', String(Math.round(distKm * 10) / 10));
    return null;
  }, [product.distance_km, (product as any).distance_km, ml]);

  const locationLabel = useMemo(() => {
    const rawPlace = product.society_name ?? (product as any).society_name;
    const shortPlace = listingPlaceChip(rawPlace);
    if (shortPlace && distanceLabel) return `${shortPlace} · ${distanceLabel}`;
    if (shortPlace) return shortPlace;
    if (distanceLabel) return distanceLabel;
    return null;
  }, [product.society_name, (product as any).society_name, distanceLabel]);

  const placeholderBg = catConfig?.color ? `${catConfig.color}10` : undefined;
  const showRating = product.seller_rating != null && product.seller_rating > 0;

  const [imgLoaded, setImgLoaded] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  const handleAddWithFeedback = useCallback((e: React.MouseEvent) => {
    handleAdd(e);
  }, [handleAdd]);

  const fallbackCatImage = catConfig?.imageUrl || (catConfig as any)?.image_url || null;
  const imgSrc = (product.image_url || fallbackCatImage)
    ? optimizedImageUrl(product.image_url || fallbackCatImage, { width: 480, quality: 85 })
    : '';
  const imgSrcSet = (product.image_url || fallbackCatImage)
    ? imageSrcSet(product.image_url || fallbackCatImage, 85)
    : '';

  return (
    <motion.div
      ref={cardRef}
      onClick={handleCardClick}
      whileTap={{ scale: 0.985 }}
      variants={{ hidden: { opacity: 0, y: 12, scale: 0.98 }, show: { opacity: 1, y: 0, scale: 1 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 28 }}
      className={cn(
        'group/card w-full min-w-0 rounded-2xl cursor-pointer flex flex-col relative',
        'glass-card',
        'transition-[box-shadow,border-color,transform] duration-200 ease-out',
        'hover:shadow-elevated hover:border-border/70',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        compact ? 'h-[260px]' : 'h-full',
        isUnavailable && 'opacity-45 grayscale-[40%]',
        isStoreClosed && !isUnavailable && 'opacity-55 grayscale-[25%]',
        className
      )}
      style={{ contentVisibility: 'auto', containIntrinsicSize: compact ? '110px 240px' : '110px 260px' }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardClick(); } }}
    >
      {/* Image - square frame + CSS cover (matches seller 1:1 crop, never stretches) */}
      <div className="relative shrink-0">
        <div className={cn(
          'relative w-full overflow-hidden product-image-bg rounded-t-2xl',
          compact ? 'h-[120px]' : 'aspect-square'
        )}>
          {(product.image_url || fallbackCatImage) && !imgLoaded && (
            <div className="absolute inset-0 product-image-shimmer" aria-hidden />
          )}

          {(product.image_url || fallbackCatImage) ? (
            <img
              src={imgSrc}
              srcSet={imgSrcSet || undefined}
              sizes="(max-width: 640px) 33vw, (max-width: 1024px) 25vw, 220px"
              alt={product.name}
              className={cn(
                'absolute inset-0 w-full h-full object-cover object-center transition-[opacity,transform] duration-500 ease-out',
                'group-hover/card:scale-[1.04]',
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
              <span className={cn(compact ? 'text-3xl' : 'text-4xl')} aria-hidden>{placeholderEmoji}</span>
              {!compact && (
                <span className="text-[8px] text-muted-foreground font-medium max-w-[80%] text-center line-clamp-1 px-1">
                  {product.name}
                </span>
              )}
            </div>
          )}

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

          {isUnavailable && (
            <div className="absolute inset-0 bg-background/55 flex items-center justify-center backdrop-blur-[1.5px] z-[5]">
              <span className="text-[10px] font-bold text-muted-foreground bg-card/95 px-3 py-1.5 rounded-full uppercase tracking-wider shadow-sm border border-border/50">
                {availabilityOverlayLabel || mc.labels.outOfStock}
              </span>
            </div>
          )}

          {isStoreClosed && !isUnavailable && (
            <div className="absolute inset-0 bg-background/55 flex items-center justify-center backdrop-blur-[1.5px] z-[5]">
              <span className="text-[11px] font-bold text-warning-foreground bg-warning/90 px-3 py-1.5 rounded-full tracking-wide shadow-sm border border-warning/40 flex items-center gap-1 max-w-[90%] truncate">
                <Clock size={11} className="shrink-0" />
                <span className="truncate">{storeClosedMessage}</span>
              </span>
            </div>
          )}

          {badges.length > 0 && (
            <div className="absolute top-1.5 left-1.5 flex flex-col gap-1 z-10 max-w-[70%]">
              {badges.slice(0, 1).map((b, i) => (
                <Badge
                  key={i}
                  className={cn(
                    'text-[9px] leading-none px-1.5 py-0.5 font-bold rounded-md border-0 shadow-sm truncate',
                    b.color
                  )}
                >
                  {b.label}
                </Badge>
              ))}
            </div>
          )}

          {hasDiscount && discountPct > 0 && (
            <div className="absolute top-1.5 right-1.5 z-10">
              <span className="bg-badge-discount text-primary-foreground text-[8px] font-extrabold px-1.5 py-0.5 rounded-md shadow-sm tracking-wide">
                {discountPct}% OFF
              </span>
            </div>
          )}

          {user && !viewOnly && (
            <div
              className={cn(
                'absolute z-10',
                hasDiscount && discountPct > 0 ? 'top-8 right-1' : 'top-1 right-1'
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <ProductFavoriteButton
                productId={product.id}
                size="sm"
                className="bg-card/80 backdrop-blur-md shadow-sm border border-white/15 text-foreground"
              />
            </div>
          )}

          {showVegBadge && (
            <div className="absolute bottom-1.5 left-1.5 z-10">
              <VegBadge isVeg={product.is_veg} size="sm" />
            </div>
          )}

          {product.accepts_preorders && (
            <div className={cn('absolute z-10', showVegBadge ? 'bottom-1.5 left-7' : 'bottom-1.5 left-1.5')}>
              <span className="bg-card/90 text-foreground text-[8px] font-bold px-1.5 py-0.5 rounded-md shadow-sm border border-border/50 flex items-center gap-0.5 backdrop-blur-sm">
                <Clock size={8} className="text-primary" />
                Pre-order
              </span>
            </div>
          )}
        </div>

        {/* ADD lives under the photo - never covers the dish */}
        {!viewOnly && !isUnavailable && !effectiveStoreClosed && (
          <div className="flex justify-end px-1.5 -mt-3.5 relative z-20 pointer-events-none">
            <div className="pointer-events-auto">
              {isCartAction && quantity > 0 ? (
                <div className="flex items-center bg-primary/95 backdrop-blur-md rounded-xl overflow-hidden shadow-cta border border-primary/80 animate-stepper-pop">
                  <motion.button
                    whileTap={{ scale: 0.88 }}
                    onClick={handleDecrement}
                    aria-label="Decrease quantity"
                    className="px-2 py-1.5 text-primary-foreground min-w-[32px] min-h-[32px] flex items-center justify-center touch-manipulation"
                  >
                    <Minus size={13} strokeWidth={3} />
                  </motion.button>
                  <AnimatePresence mode="popLayout">
                    <motion.span
                      key={quantity}
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.6, opacity: 0 }}
                      transition={{ duration: 0.14 }}
                      className="font-extrabold text-xs text-primary-foreground px-0.5 tabular-nums min-w-[18px] text-center"
                    >
                      {quantity}
                    </motion.span>
                  </AnimatePresence>
                  <motion.button
                    whileTap={{ scale: 0.88 }}
                    onClick={handleIncrement}
                    disabled={!canIncrement}
                    aria-label={canIncrement ? 'Increase quantity' : `Only ${stockLimit} available`}
                    className={cn(
                      'px-2 py-1.5 text-primary-foreground min-w-[32px] min-h-[32px] flex items-center justify-center touch-manipulation',
                      !canIncrement && 'opacity-40 cursor-not-allowed'
                    )}
                  >
                    <Plus size={13} strokeWidth={3} />
                  </motion.button>
                </div>
              ) : (
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  onClick={handleAddWithFeedback}
                  aria-label={isCartAction ? 'Add to cart' : actionConfig.shortLabel}
                  className={cn(
                    'bg-card/95 backdrop-blur-md text-primary font-extrabold text-[10px] px-2.5 py-1.5 rounded-xl',
                    'border-[1.5px] border-primary shadow-sm',
                    'hover:bg-primary hover:text-primary-foreground',
                    'transition-colors uppercase tracking-wide',
                    'min-h-[32px] min-w-[48px] flex items-center justify-center gap-0.5',
                    'touch-manipulation'
                  )}
                >
                  {justAdded ? (
                    <><Check size={11} strokeWidth={3} /> ADDED</>
                  ) : (
                    isCartAction ? 'ADD' : actionConfig.shortLabel
                  )}
                </motion.button>
              )}
            </div>
          </div>
        )}
      </div>

      {compact ? (
        <div className={cn(
          'h-[112px] overflow-hidden px-2.5 pb-2.5',
          !viewOnly && !isUnavailable && !isStoreClosed ? 'pt-6' : 'pt-3'
        )}>
          <div className="flex h-full flex-col overflow-hidden">
            <div className="min-h-[20px] flex items-baseline gap-1.5 overflow-hidden flex-wrap">
              {!showMoney ? (
                <span className="text-sm font-medium text-primary leading-none">{priceLabel}</span>
              ) : (
                <>
                  <span className="font-extrabold text-[15px] text-foreground leading-none tracking-tight tabular-nums">
                    {isServiceLayout && <span className="text-[10px] font-semibold text-muted-foreground mr-1">From</span>}
                    {formatPrice(isServiceLayout ? serviceStartingPrice : product.price)}
                  </span>
                  {hasDiscount && (
                    <span className="text-[11px] text-muted-foreground/80 line-through leading-none tabular-nums">
                      {formatPrice(product.mrp!)}
                    </span>
                  )}
                </>
              )}
            </div>

            {glanceFacts.length > 0 && (
              <div className="mt-0.5 overflow-hidden">
                <span className="block text-[10px] font-medium text-muted-foreground truncate leading-none">
                  {glanceFacts.join(' · ')}
                </span>
              </div>
            )}

            <h4 className="mt-1 h-[34px] overflow-hidden font-semibold leading-snug text-foreground text-[12px] line-clamp-2">
              {product.name}
            </h4>
            {isCartAction && quantity > 0 && !canIncrement && product.stock_quantity != null && (
              <p className="text-[11px] text-warning font-medium mt-0.5">Only {product.stock_quantity} left</p>
            )}
          </div>
        </div>
      ) : (
        <div className={cn(
          'flex flex-1 flex-col min-h-0 overflow-hidden px-2 sm:px-2.5 pb-1.5',
          !viewOnly && !isUnavailable && !isStoreClosed ? 'pt-3' : 'pt-1.5'
        )}>
          {/* Natural flow: price -> optional glance (collapses when empty) -> title reserved for footer align */}
          <div className="flex flex-col gap-0.5 shrink-0" data-slot="listing-price-group">
            <div className="min-h-[15px] flex items-baseline gap-1 overflow-hidden">
              {!showMoney ? (
                <span className="text-xs font-medium text-primary leading-none truncate">{priceLabel}</span>
              ) : (
                <>
                  <span className="font-extrabold text-[13px] sm:text-[14px] text-foreground leading-none tracking-tight tabular-nums">
                    {isServiceLayout && <span className="text-[9px] font-semibold text-muted-foreground mr-0.5">From</span>}
                    {formatPrice(isServiceLayout ? serviceStartingPrice : product.price)}
                  </span>
                  {hasDiscount && (
                    <span className="text-[10px] text-muted-foreground/80 line-through leading-none tabular-nums">
                      {formatPrice(product.mrp!)}
                    </span>
                  )}
                </>
              )}
            </div>

            {glanceFacts.length > 0 && (
              <div className="overflow-hidden" data-slot="listing-glance">
                <span className="block text-[9px] font-medium text-muted-foreground truncate leading-none">
                  {glanceFacts.join(' · ')}
                </span>
              </div>
            )}
          </div>

          <h4
            data-slot="listing-title"
            className="mt-0.5 h-[2.4em] overflow-hidden font-semibold leading-[1.2] text-foreground text-[11px] sm:text-[12px] line-clamp-2 shrink-0"
          >
            {product.name}
          </h4>

          {/* Immediately under title - no mt-auto empty band */}
          <div className="mt-0.5 shrink-0 space-y-0" data-slot="listing-footer">
            <div
              data-slot="listing-store"
              className="h-[14px] flex items-center gap-1 min-w-0 overflow-hidden"
            >
              {product.seller_name ? (
                <>
                  <span className="text-[10px] font-medium text-foreground truncate min-w-0 flex-1 leading-none">
                    {displaySellerStoreName(product.seller_name)}
                  </span>
                  {showRating && (
                    <span className="inline-flex items-center gap-0.5 shrink-0 text-[9px] font-bold text-foreground tabular-nums leading-none">
                      <Star size={9} className="text-rating-star fill-rating-star" />
                      {Number(product.seller_rating).toFixed(1)}
                    </span>
                  )}
                </>
              ) : null}
            </div>

            <div data-slot="listing-location" className="h-[13px] overflow-hidden">
              {locationLabel ? (
                <SellerLocationLine
                  text={locationLabel}
                  clamp={1}
                  iconSize={9}
                  className="h-full"
                  textClassName="text-[9px] truncate whitespace-nowrap break-normal leading-[13px]"
                />
              ) : null}
            </div>
          </div>
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

      {!viewOnly && isUnavailable && (<NotifyMeButton productId={product.id} />)}
    </motion.div>
  );
}

export const ProductListingCard = memo(ProductListingCardInner);
