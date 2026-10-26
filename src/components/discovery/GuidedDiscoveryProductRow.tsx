import { useState } from 'react';
import { Star, Plus, Clock, ArrowRight, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCart } from '@/hooks/useCart';
import { useCurrency } from '@/hooks/useCurrency';
import { useHaptics } from '@/hooks/useHaptics';
import { ProductWithSeller } from '@/components/product/ProductListingCard';
import { ACTION_CONFIG, deriveActionType, shouldShowMonetaryPrice } from '@/lib/marketplace-constants';
import { guidedListingEta } from '@/lib/guided-discovery';
import { displaySellerStoreName } from '@/lib/seller-journey';
import { listingArtFallback, listingDisplayArt } from '@/lib/food-chip-art';
import { listingDiscountPercent } from '@/lib/listing-glance';
import { listingPlaceChip } from '@/lib/location-label-resolver';
import { listingTrustLabel, listingTrustShowsStar } from '@/lib/listing-trust';
import { optimizedImageUrl } from '@/utils/imageHelpers';
import { openVariantPicker } from '@/lib/variant-picker-store';
import { useVariantProductIds } from '@/hooks/useProductVariants';
import type { CategoryConfig } from '@/types/categories';
import type { ProductActionType } from '@/types/Database';

function ListingThumb({
  product,
  width,
  className,
}: {
  product: ProductWithSeller;
  width: number;
  className?: string;
}) {
  const preferred = listingDisplayArt(product);
  const [src, setSrc] = useState(preferred);
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return <div className={cn('h-full w-full bg-gradient-to-br from-muted to-secondary', className)} />;
  }

  return (
    <img
      src={optimizedImageUrl(src, { width, quality: 80 })}
      alt=""
      className={cn('h-full w-full object-cover object-center', className)}
      onError={() => {
        const fallback = listingArtFallback(product);
        if (fallback && src !== fallback) {
          setSrc(fallback);
          return;
        }
        setFailed(true);
      }}
    />
  );
}

interface GuidedDiscoveryProductRowProps {
  product: ProductWithSeller;
  categoryConfigs?: CategoryConfig[];
  onTap: (product: ProductWithSeller) => void;
  dense?: boolean;
  /** Stagger enter animation from live list order */
  index?: number;
}

function serviceDurationLabel(product: ProductWithSeller): string | null {
  const duration = Number(product.service_duration_minutes);
  if (Number.isFinite(duration) && duration > 0) return `${Math.round(duration)} min`;
  const scope = product.service_scope?.trim();
  if (scope && scope.length <= 18) return scope;
  return null;
}

function distanceChip(km: number | null | undefined): string | null {
  if (km == null || !Number.isFinite(Number(km))) return null;
  const value = Number(km);
  if (value < 0) return null;
  if (value < 1) return `${Math.round(value * 1000)} m`;
  return `${Math.round(value * 10) / 10} km`;
}

export function GuidedDiscoveryProductRow({
  product,
  categoryConfigs = [],
  onTap,
  dense = false,
  index = 0,
}: GuidedDiscoveryProductRowProps) {
  const { addItem } = useCart();
  const { formatPrice } = useCurrency();
  const { impact } = useHaptics();
  const sizedProductIds = useVariantProductIds();

  const catCfg = categoryConfigs.find((config) => config.category === product.category);
  const actionType: ProductActionType = deriveActionType(
    product.action_type as string,
    catCfg?.transactionType,
    catCfg ? { supportsCart: catCfg.behavior?.supportsCart, enquiryOnly: catCfg.behavior?.enquiryOnly } : null,
  );
  const action = ACTION_CONFIG[actionType];
  const isCart = action.isCart;
  const isBook = actionType === 'book' || actionType === 'schedule_visit';
  const hasSizes = isCart && sizedProductIds.has(product.id);
  const sellerName = displaySellerStoreName(product.seller_name);
  const rating = product.seller_rating || 0;
  const reviews = product.seller_reviews || 0;
  const completedOrders = product.completed_order_count || 0;
  const trustInput = { rating, reviews, completedOrders };
  const trustLabel = listingTrustLabel(trustInput);
  const showStar = listingTrustShowsStar(trustInput);
  const eta = isBook ? serviceDurationLabel(product) : guidedListingEta(product);
  const showMoney = shouldShowMonetaryPrice(actionType, product.price);
  const ctaLabel = isBook ? 'Book now' : action.shortLabel;
  const place = listingPlaceChip(product.society_name);
  const distance = distanceChip(product.distance_km);
  const placeLine = [place, distance].filter(Boolean).join(' · ') || null;
  const discountPct = listingDiscountPercent(
    product.price,
    product.mrp,
    product.discount_percentage,
  );
  const openNow = product.seller_is_available === true && product.seller_vacation_mode !== true;
  const serving = String(product.serving_size || '').trim() || null;
  const unitHint = String(product.unit_type || '').trim();
  const servingLabel = serving
    || (unitHint && product.price_per_unit != null
      ? `${formatPrice(product.price_per_unit)} / ${unitHint}`
      : null);
  const enterStyle = {
    animationDelay: `${Math.min(index, 12) * 45}ms`,
  } as React.CSSProperties;

  const runAction = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!isCart) {
      onTap(product);
      return;
    }
    impact('medium');
    if (hasSizes) {
      openVariantPicker(product as any);
      return;
    }
    await addItem(product as any);
  };

  if (isBook || (!isCart && !dense)) {
    return (
      <button
        type="button"
        id={isBook ? `book-listing-${product.id}` : undefined}
        data-testid={`card-${product.id}`}
        data-action={actionType}
        onClick={() => onTap(product)}
        className={cn(
          'w-full rounded-[22px] bg-card border border-border/80 p-3.5 text-left scroll-mt-24 active:scale-[0.99] transition-transform dark:border-white/12',
          isBook
            ? 'book-listing-card relative overflow-hidden shadow-[0_16px_40px_-20px_rgba(15,23,42,0.4)] dark:shadow-none'
            : 'shadow-[0_10px_28px_-16px_rgba(15,23,42,0.28)] dark:shadow-none',
        )}
      >
        {isBook && (
          <span
            className="pointer-events-none absolute inset-y-3 left-0 w-1 rounded-full bg-gradient-to-b from-primary via-teal-400 to-primary/30"
            aria-hidden
          />
        )}
        <div className="flex items-center gap-3.5">
          <div className="relative h-[96px] w-[96px] shrink-0 overflow-hidden rounded-[18px] bg-muted ring-1 ring-black/5 shadow-inner dark:ring-white/10">
            <ListingThumb product={product} width={280} />
            {isBook && product.seller_is_available === true && product.seller_vacation_mode !== true && (
              <span className="absolute left-1.5 top-1.5 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-white shadow-sm">
                OPEN
              </span>
            )}
            {isBook && showStar && (
              <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-0.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
                <Star size={9} className="fill-amber-400 text-amber-400" />
                {rating.toFixed(1)}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-[15px] font-extrabold leading-tight text-foreground line-clamp-2">
                {product.name}
              </p>
              {eta && (
                <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
                  <Clock size={10} strokeWidth={2.6} />
                  {eta}
                </span>
              )}
            </div>
            {product.description ? (
              <p className="mt-1 text-[12px] text-muted-foreground line-clamp-1">{product.description}</p>
            ) : sellerName ? (
              <p className="mt-1 text-[12px] text-muted-foreground truncate">By {sellerName}</p>
            ) : null}
            {isBook && sellerName && product.description ? (
              <p className="mt-0.5 text-[11px] font-semibold text-muted-foreground truncate">
                By {sellerName}
              </p>
            ) : null}
            {(placeLine || (isBook && trustLabel && !showStar)) && (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground truncate">
                {placeLine ? (
                  <>
                    <MapPin size={10} className="shrink-0 opacity-70" />
                    <span className="truncate">{placeLine}</span>
                  </>
                ) : (
                  <span className="truncate">{trustLabel}</span>
                )}
              </p>
            )}
            <div className="mt-2.5 flex items-center justify-between gap-2">
              {showMoney ? (
                <p className="text-[17px] font-extrabold tabular-nums text-foreground">{formatPrice(product.price)}</p>
              ) : <span />}
              <span
                onClick={runAction}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-full px-3.5 py-2 text-[12px] font-bold active:scale-95 transition-transform',
                  isBook
                    ? 'bg-primary text-primary-foreground shadow-[0_10px_22px_-8px_hsl(var(--primary)/0.85)]'
                    : 'rounded-xl border-2 border-primary text-primary',
                )}
              >
                {ctaLabel}
                {isBook && <ArrowRight size={13} strokeWidth={2.6} className="book-cta-arrow" />}
              </span>
            </div>
          </div>
        </div>
      </button>
    );
  }

  if (dense) {
    return (
      <button
        type="button"
        data-testid={`card-${product.id}`}
        data-action={actionType}
        onClick={() => onTap(product)}
        className="group relative flex h-full w-full flex-col overflow-hidden rounded-[20px] bg-zinc-900 text-left shadow-[0_16px_36px_-22px_rgba(15,23,42,0.55)] ring-1 ring-black/5 dark:ring-white/10 active:scale-[0.99] transition-transform"
      >
        <div className="relative aspect-[4/5] w-full shrink-0 overflow-hidden bg-muted">
          <ListingThumb
            product={product}
            width={400}
            className="transition-transform duration-500 group-active:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-transparent" />
          {showStar && (
            <span className="absolute left-2 top-2 inline-flex items-center gap-0.5 rounded-full bg-black/45 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
              <Star size={9} className="fill-amber-400 text-amber-400" />
              {rating.toFixed(1)}
            </span>
          )}
          {!showStar && trustLabel && (
            <span className="absolute left-2 top-2 rounded-full bg-black/45 px-1.5 py-0.5 text-[10px] font-bold text-white/90 backdrop-blur-sm">
              {trustLabel}
            </span>
          )}
          {discountPct > 0 && (
            <span className="absolute left-2 bottom-[4.5rem] rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-extrabold text-zinc-900">
              {discountPct}% off
            </span>
          )}
          <span
            onClick={runAction}
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_8px_18px_-6px_hsl(var(--primary)/0.9)] active:scale-95"
          >
            <Plus size={15} strokeWidth={3} />
          </span>
          <div className="absolute inset-x-0 bottom-0 space-y-0.5 p-2.5 pt-8">
            <p className="line-clamp-2 text-[12px] font-extrabold leading-snug text-white">
              {product.name}
            </p>
            {sellerName ? (
              <p className="truncate text-[10px] text-white/75">By {sellerName}</p>
            ) : null}
            <div className="flex items-baseline justify-between gap-1 pt-1">
              {showMoney ? (
                <span className="text-[13px] font-extrabold tabular-nums text-white">
                  {formatPrice(product.price)}
                </span>
              ) : <span />}
              {eta ? (
                <span className="inline-flex items-center gap-0.5 truncate rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold text-white/90">
                  <Clock size={9} />
                  {eta}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      data-testid={`card-${product.id}`}
      data-action={actionType}
      onClick={() => onTap(product)}
      style={enterStyle}
      className="food-listing-card food-listing-card-enter group relative w-full overflow-hidden rounded-[24px] border border-border/70 bg-card p-0 text-left shadow-[0_18px_42px_-24px_rgba(15,23,42,0.42)] dark:border-white/12 dark:shadow-none active:scale-[0.99] transition-transform"
    >
      <span className="food-listing-sheen" aria-hidden />
      <div className="relative flex items-stretch gap-0">
        <div className="relative h-[132px] w-[124px] shrink-0 overflow-hidden bg-muted">
          <ListingThumb
            product={product}
            width={360}
            className="transition-transform duration-700 group-active:scale-[1.06]"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-card/40 dark:to-card/50" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/15" />
          {discountPct > 0 && (
            <span className="absolute left-2 top-2 rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-zinc-900 shadow-sm">
              {discountPct}% off
            </span>
          )}
          {showStar && (
            <span className="absolute bottom-2 left-2 inline-flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
              <Star size={9} className="fill-amber-400 text-amber-400" />
              {rating.toFixed(1)}
              {reviews > 0 && (
                <span className="font-semibold text-white/80">({reviews})</span>
              )}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 px-3.5 py-3 flex flex-col">
          <p className="text-[15px] font-extrabold leading-tight tracking-tight text-foreground line-clamp-2">
            {product.name}
          </p>
          {sellerName && (
            <p className="mt-1 text-[12px] font-semibold text-muted-foreground truncate">
              {sellerName}
            </p>
          )}
          {placeLine && (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground truncate">
              <MapPin size={10} className="shrink-0 opacity-70" />
              <span className="truncate">{placeLine}</span>
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {trustLabel && (
              <span
                className={cn(
                  'inline-flex max-w-full items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold',
                  showStar
                    ? 'bg-amber-500/12 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {showStar && <Star size={9} className="fill-amber-400 text-amber-400" />}
                <span className="truncate">{trustLabel}</span>
              </span>
            )}
            {eta && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                <Clock size={9} strokeWidth={2.6} />
                {eta}
              </span>
            )}
            {servingLabel && (
              <span className="inline-flex max-w-[7.5rem] truncate rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                {servingLabel}
              </span>
            )}
            {openNow && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 food-open-dot" />
                Open
              </span>
            )}
          </div>

          <div className="mt-auto flex items-end justify-between gap-2 pt-2.5">
            <div className="min-w-0">
              {showMoney && (
                <div className="flex items-baseline gap-1.5">
                  <p className="text-[18px] font-extrabold tabular-nums text-foreground">
                    {formatPrice(product.price)}
                  </p>
                  {product.mrp != null && product.mrp > product.price && (
                    <span className="text-[11px] font-medium tabular-nums text-muted-foreground line-through">
                      {formatPrice(product.mrp)}
                    </span>
                  )}
                </div>
              )}
            </div>
            <span
              onClick={runAction}
              aria-label={hasSizes ? 'Choose size' : 'Add to cart'}
              className="shrink-0 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_12px_24px_-10px_hsl(var(--primary)/0.9)] ring-2 ring-primary/15 active:scale-95 transition-transform"
            >
              <Plus size={18} strokeWidth={3} />
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
