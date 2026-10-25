import { Star, Plus, Clock, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCart } from '@/hooks/useCart';
import { useCurrency } from '@/hooks/useCurrency';
import { useHaptics } from '@/hooks/useHaptics';
import { ProductWithSeller } from '@/components/product/ProductListingCard';
import { ACTION_CONFIG, deriveActionType, shouldShowMonetaryPrice } from '@/lib/marketplace-constants';
import { guidedListingEta } from '@/lib/guided-discovery';
import { displaySellerStoreName } from '@/lib/seller-journey';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';
import { openVariantPicker } from '@/lib/variant-picker-store';
import { useVariantProductIds } from '@/hooks/useProductVariants';
import type { CategoryConfig } from '@/types/categories';
import type { ProductActionType } from '@/types/Database';

interface GuidedDiscoveryProductRowProps {
  product: ProductWithSeller;
  categoryConfigs?: CategoryConfig[];
  onTap: (product: ProductWithSeller) => void;
  dense?: boolean;
}

function serviceDurationLabel(product: ProductWithSeller): string | null {
  const duration = Number(product.service_duration_minutes);
  if (Number.isFinite(duration) && duration > 0) return `${Math.round(duration)} min`;
  const scope = product.service_scope?.trim();
  if (scope && scope.length <= 18) return scope;
  return null;
}

export function GuidedDiscoveryProductRow({
  product,
  categoryConfigs = [],
  onTap,
  dense = false,
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
  const eta = isBook ? serviceDurationLabel(product) : guidedListingEta(product);
  const showMoney = shouldShowMonetaryPrice(actionType, product.price);
  const ctaLabel = isBook ? 'Book now' : action.shortLabel;

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
        data-testid={`card-${product.id}`}
        data-action={actionType}
        onClick={() => onTap(product)}
        className="w-full rounded-[20px] bg-card border border-border p-3.5 text-left shadow-[0_10px_28px_-16px_rgba(15,23,42,0.28)] dark:shadow-none active:scale-[0.99] transition-transform"
      >
        <div className="flex items-center gap-3.5">
          <div className="relative h-[88px] w-[88px] shrink-0 overflow-hidden rounded-[14px] bg-muted">
            {product.image_url ? (
              <img
                src={optimizedImageUrl(product.image_url, { width: 280, quality: 84 })}
                alt=""
                className="h-full w-full object-cover"
                onError={handleImageError}
              />
            ) : (
              <div className="h-full w-full bg-gradient-to-br from-muted to-secondary" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-[15px] font-extrabold leading-tight text-foreground line-clamp-2">
                {product.name}
              </p>
              {eta && (
                <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  {eta}
                </span>
              )}
            </div>
            {product.description ? (
              <p className="mt-1 text-[12px] text-muted-foreground line-clamp-1">{product.description}</p>
            ) : sellerName ? (
              <p className="mt-1 text-[12px] text-muted-foreground truncate">By {sellerName}</p>
            ) : null}
            <div className="mt-2.5 flex items-center justify-between gap-2">
              {showMoney ? (
                <p className="text-[17px] font-extrabold tabular-nums text-foreground">{formatPrice(product.price)}</p>
              ) : <span />}
              <span
                onClick={runAction}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-xl px-3.5 py-2 text-[12px] font-bold active:scale-95 transition-transform',
                  isBook
                    ? 'bg-primary text-primary-foreground shadow-[0_6px_14px_-4px_hsl(var(--primary)/0.55)]'
                    : 'border-2 border-primary text-primary',
                )}
              >
                {ctaLabel}
                {isBook && <ArrowRight size={13} />}
              </span>
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
      className={cn(
        'w-full rounded-[20px] bg-card border border-border text-left shadow-[0_8px_24px_-18px_rgba(15,23,42,0.22)] dark:shadow-none active:scale-[0.99] transition-transform',
        dense ? 'p-2' : 'p-3',
      )}
    >
      <div className={cn('flex', dense ? 'items-stretch gap-2' : 'items-center gap-3')}>
        <div className={cn(
          'relative shrink-0 overflow-hidden rounded-[14px] bg-muted',
          dense ? 'h-16 w-16' : 'h-[104px] w-[104px]',
        )}>
          {product.image_url ? (
            <img
              src={optimizedImageUrl(product.image_url, { width: dense ? 200 : 280, quality: 84 })}
              alt=""
              className="h-full w-full object-cover"
              onError={handleImageError}
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-muted to-secondary" />
          )}
        </div>
        <div className="min-w-0 flex-1 py-0.5 flex flex-col">
          <p className={cn(
            'font-extrabold leading-tight text-foreground line-clamp-2',
            dense ? 'text-[12px]' : 'text-[15px]',
          )}>
            {product.name}
          </p>
          {sellerName && (
            <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
              By {sellerName}
            </p>
          )}
          {rating > 0 && (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-foreground">
              <Star size={11} className="fill-amber-400 text-amber-400" />
              {rating.toFixed(1)}
              {reviews > 0 && (
                <span className="font-medium text-muted-foreground">({reviews})</span>
              )}
            </p>
          )}
          <div className="mt-1 min-w-0">
            {showMoney && (
              <p className={cn('font-extrabold tabular-nums text-foreground', dense ? 'text-[13px]' : 'text-[16px]')}>
                {formatPrice(product.price)}
              </p>
            )}
            {eta && (
              <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock size={10} />
                {eta}
              </p>
            )}
          </div>
        </div>
        <span
          onClick={runAction}
          className={cn(
            'shrink-0 flex items-center justify-center rounded-full bg-primary text-primary-foreground active:scale-95',
            dense ? 'mt-auto h-7 w-7' : 'h-10 w-10',
          )}
        >
          <Plus size={dense ? 14 : 18} strokeWidth={3} />
        </span>
      </div>
    </button>
  );
}
