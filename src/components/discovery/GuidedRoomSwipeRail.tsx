import { useState } from 'react';
import { ChevronRight, Plus, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCart } from '@/hooks/useCart';
import { useCurrency } from '@/hooks/useCurrency';
import { useHaptics } from '@/hooks/useHaptics';
import { ProductWithSeller } from '@/components/product/ProductListingCard';
import { ACTION_CONFIG, deriveActionType, shouldShowMonetaryPrice } from '@/lib/marketplace-constants';
import { guidedListingEta } from '@/lib/guided-discovery';
import { displaySellerStoreName } from '@/lib/seller-journey';
import { listingArtFallback, listingDisplayArt } from '@/lib/food-chip-art';
import { optimizedImageUrl } from '@/utils/imageHelpers';
import { openVariantPicker } from '@/lib/variant-picker-store';
import { useVariantProductIds } from '@/hooks/useProductVariants';
import { hasRailDensity } from '@/lib/discovery-density';
import type { CategoryConfig } from '@/types/categories';
import type { ProductActionType } from '@/types/Database';

interface GuidedRoomSwipeRailProps {
  title: string;
  products: ProductWithSeller[];
  onProductTap: (product: ProductWithSeller) => void;
  categoryConfigs?: CategoryConfig[];
  testId?: string;
  /** Alternating soft panels so rails feel like scenes, not one flat list. */
  tone?: 'plain' | 'warm' | 'cool';
}

/**
 * Cinematic horizontal swipe rail - portrait photo cards with overlay copy.
 */
export function GuidedRoomSwipeRail({
  title,
  products,
  onProductTap,
  categoryConfigs = [],
  testId,
  tone = 'plain',
}: GuidedRoomSwipeRailProps) {
  if (!hasRailDensity(products.length)) return null;

  return (
    <section
      className={cn(
        'mt-5 py-5',
        tone === 'warm' && 'bg-gradient-to-b from-amber-50/70 via-amber-50/25 to-transparent dark:from-amber-950/25 dark:via-amber-950/10',
        tone === 'cool' && 'bg-gradient-to-b from-emerald-50/60 via-emerald-50/20 to-transparent dark:from-emerald-950/20 dark:via-emerald-950/10',
      )}
      data-testid={testId || 'guided-room-swipe-rail'}
    >
      <div className="mb-3.5 flex items-end justify-between gap-2 px-4">
        <div>
          <h3 className="font-extrabold text-[18px] tracking-tight text-foreground">
            {title}
          </h3>
          <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
            Swipe for more in your society
          </p>
        </div>
        <span className="mb-0.5 inline-flex items-center gap-0.5 text-[11px] font-bold text-primary">
          See
          <ChevronRight size={13} className="guided-room-rail-nudge" />
        </span>
      </div>
      <div className="taste-rail-scroll scrollbar-hide snap-x snap-mandatory">
        <div className="flex w-max items-stretch gap-3.5 px-4 pr-8 pb-1">
          {products.map((product) => (
            <SwipeCard
              key={product.id}
              product={product}
              categoryConfigs={categoryConfigs}
              onTap={onProductTap}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function SwipeCard({
  product,
  categoryConfigs,
  onTap,
}: {
  product: ProductWithSeller;
  categoryConfigs: CategoryConfig[];
  onTap: (product: ProductWithSeller) => void;
}) {
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
  const hasSizes = isCart && sizedProductIds.has(product.id);
  const showMoney = shouldShowMonetaryPrice(actionType, product.price);
  const sellerName = displaySellerStoreName(product.seller_name);
  const eta = guidedListingEta(product);
  const rating = product.seller_rating || 0;
  const preferred = listingDisplayArt(product);
  const [src, setSrc] = useState(preferred);

  const runAdd = async (event: React.MouseEvent) => {
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

  return (
    <button
      type="button"
      data-testid={`room-swipe-card-${product.id}`}
      onClick={() => onTap(product)}
      className={cn(
        'group relative flex w-[12rem] shrink-0 snap-start flex-col overflow-hidden rounded-[24px] text-left',
        'bg-zinc-900 shadow-[0_22px_48px_-24px_rgba(15,23,42,0.65)]',
        'ring-1 ring-black/5',
        'active:scale-[0.985] transition-transform duration-200',
      )}
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden">
        {src ? (
          <img
            src={optimizedImageUrl(src, { width: 480, quality: 80 })}
            alt=""
            className="h-full w-full object-cover object-center transition-transform duration-700 ease-out group-hover:scale-105 group-active:scale-105"
            onError={() => {
              const fallback = listingArtFallback(product);
              if (fallback && src !== fallback) setSrc(fallback);
            }}
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-zinc-700 to-zinc-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/5" />
        {rating > 0 && (
          <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-0.5 rounded-full bg-black/50 px-2 py-1 text-[10px] font-bold text-white backdrop-blur-md">
            <Star size={10} className="fill-amber-400 text-amber-400" />
            {rating.toFixed(1)}
          </span>
        )}
        {isCart && (
          <span
            role="button"
            tabIndex={0}
            onClick={runAdd}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                void runAdd(event as unknown as React.MouseEvent);
              }
            }}
            className="absolute right-2.5 top-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_10px_22px_-6px_hsl(var(--primary)/0.95)] active:scale-95"
          >
            <Plus size={16} strokeWidth={3} />
          </span>
        )}
        <div className="absolute inset-x-0 bottom-0 space-y-0.5 p-3.5 pt-12">
          <p className="line-clamp-2 text-[14px] font-extrabold leading-snug text-white drop-shadow-sm">
            {product.name}
          </p>
          {sellerName ? (
            <p className="truncate text-[11px] font-medium text-white/75">By {sellerName}</p>
          ) : null}
          <div className="flex items-baseline justify-between gap-2 pt-1.5">
            {showMoney ? (
              <span className="text-[16px] font-extrabold tabular-nums text-white">
                {formatPrice(product.price)}
              </span>
            ) : <span />}
            {eta ? (
              <span className="truncate rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white/90 backdrop-blur-sm">
                {eta}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}
