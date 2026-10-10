// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Store, Users, ShoppingBag, Phone } from 'lucide-react';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';
import { useCurrency } from '@/hooks/useCurrency';
import { VegBadge } from '@/components/ui/veg-badge';
import { cn } from '@/lib/utils';
import type { TopProduct } from '@/hooks/queries/useStoreDiscovery';
import {
  getCommercePriceLabel,
  isCartPricedAction,
  shouldShowMonetaryPrice,
} from '@/lib/marketplace-constants';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { resolveListingAction } from '@/lib/commerce-mode';

export function sanitizeSellerName(name: string): string {
  const stripped = (name || '').replace(/^\[(ARCHIVED|HOLD)\]\s*/i, '').trim();
  return /^\d+$/.test(stripped) ? '' : stripped;
}

export interface RichSellerCardProps {
  id: string;
  name: string;
  profileImage: string | null;
  coverImage: string | null;
  categories: string[] | null;
  topProducts: TopProduct[];
  totalReviews: number;
  isFeatured: boolean;
  groupLabel?: string | null;
  compact?: boolean;
  /** fill: one card uses the row. pair: two cards share the row. grid: three-up cells. */
  span?: 'fixed' | 'fill' | 'pair' | 'grid';
  onProductTap?: (product: TopProduct) => void;
  /** Force contact/service presentation even if products are mixed. */
  serviceMode?: boolean;
}

export function RichSellerCard({
  id,
  name,
  profileImage,
  coverImage,
  categories,
  topProducts,
  totalReviews,
  isFeatured,
  groupLabel,
  compact = false,
  span = 'fixed',
  onProductTap,
  serviceMode = false,
}: RichSellerCardProps) {
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const sanitized = sanitizeSellerName(name);

  const { configs: categoryConfigs } = useCategoryConfigs();
  const resolvedActions = useMemo(
    () => new Map(topProducts.map((p) => [p.id, resolveListingAction(p.action_type, p.category, categoryConfigs)])),
    [topProducts, categoryConfigs],
  );
  const pricedProducts = topProducts.filter((p) => shouldShowMonetaryPrice(resolvedActions.get(p.id), p.price));
  const minPrice = pricedProducts.length > 0 ? Math.min(...pricedProducts.map((p) => p.price)) : null;
  const dominantAction = (topProducts[0] && resolvedActions.get(topProducts[0].id)) || 'contact_seller';
  const isServiceCard = serviceMode || (topProducts.length > 0 && pricedProducts.length === 0);
  const footerLabel = isServiceCard
    ? getCommercePriceLabel(dominantAction, null, formatPrice)
    : minPrice !== null
      ? `From ${formatPrice(minPrice)}`
      : '\u00A0';
  const productSlots = [topProducts[0] ?? null, topProducts[1] ?? null] as const;
  const productFallbackImage = productSlots.find((product) => product?.image_url)?.image_url || null;
  const heroSources = [coverImage, profileImage, productFallbackImage].filter((src): src is string => !!src);
  const [heroAttempt, setHeroAttempt] = useState(0);
  useEffect(() => { setHeroAttempt(0); }, [coverImage, profileImage, productFallbackImage]);
  const heroImage = heroSources[heroAttempt] || null;
  const isNew = totalReviews === 0;
  const cardWidth = span === 'fixed'
    ? (compact ? 'w-[188px] sm:w-[200px]' : 'w-[200px] sm:w-[212px]')
    : 'w-full';
  const categoryLine = (categories || [])
    .slice(0, 1)
    .map((cat) => cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
    .join('');

  if (span === 'grid') {
    return (
      <motion.div
        whileTap={{ scale: 0.97 }}
        onClick={() => navigate(`/seller/${id}`)}
        className="h-full min-w-0 rounded-2xl overflow-hidden cursor-pointer flex flex-col bg-card border border-border/60 shadow-card"
      >
        <div className="relative aspect-[4/3] shrink-0 bg-muted overflow-hidden">
          {heroImage ? (
            <img
              src={optimizedImageUrl(heroImage, { width: 320, quality: 75 })}
              alt={sanitized}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={() => setHeroAttempt((attempt) => attempt + 1)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-muted text-lg font-bold text-muted-foreground">
              {(sanitized.charAt(0) || 'S').toUpperCase()}
            </div>
          )}
          <span className="absolute bottom-1 right-1 text-[9px] font-semibold bg-background/85 backdrop-blur-sm text-foreground px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            {isNew ? (<><Store size={9} />New</>) : (<><Users size={9} />{totalReviews}</>)}
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-0.5 px-2 pt-1.5 pb-2 min-h-[72px]">
          <p className="font-bold text-foreground text-[12px] leading-tight line-clamp-2">{sanitized}</p>
          {categoryLine && (
            <p className="text-[10px] text-muted-foreground truncate">{categoryLine}</p>
          )}
          <p className={cn(
            'mt-auto text-[11px] font-semibold truncate',
            isServiceCard ? 'text-primary' : 'text-success tabular-nums',
          )}>
            {footerLabel}
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <div className={cn(
      'snap-start flex flex-col gap-1 h-full',
      span === 'fill' ? 'w-full min-w-0' : span === 'pair' ? 'w-full min-w-0' : 'shrink-0',
    )}>
      {groupLabel && (
        <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground bg-secondary px-2 py-0.5 rounded-full self-start truncate max-w-full">
          {groupLabel}
        </span>
      )}
      <motion.div
        whileTap={{ scale: 0.97 }}
        onClick={() => navigate(`/seller/${id}`)}
        className={cn(
          'rounded-2xl overflow-hidden cursor-pointer flex flex-col',
          compact ? 'h-[268px]' : 'h-[280px]',
          'bg-card border border-border/60 shadow-card',
          'transition-[box-shadow,border-color,transform] duration-200 ease-out hover:shadow-elevated hover:border-border',
          cardWidth,
        )}
      >
        <div className="relative h-20 shrink-0 bg-muted overflow-hidden">
          {heroImage ? (
            <img
              src={optimizedImageUrl(heroImage, { width: 400, quality: 75 })}
              alt={sanitized}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={() => setHeroAttempt((attempt) => attempt + 1)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-muted text-2xl font-bold text-muted-foreground">
              {(sanitized.charAt(0) || 'S').toUpperCase()}
            </div>
          )}

          {isFeatured && (
            <span className="absolute top-1.5 left-1.5 text-[10px] font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">
              Featured
            </span>
          )}

          <span className="absolute bottom-1 right-1 text-[10px] font-semibold bg-background/80 backdrop-blur-sm text-foreground px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
            {isNew ? (<><Store size={10} />New</>) : (<><Users size={10} />{totalReviews} {totalReviews === 1 ? 'review' : 'reviews'}</>)}
          </span>
        </div>

        <div className="flex flex-1 flex-col min-h-0 px-2 pt-1.5 pb-2">
          <p className="font-bold text-foreground text-[13px] leading-tight line-clamp-2 h-9">
            {sanitized}
          </p>
          <div className="flex gap-1 mt-1 h-5 overflow-hidden">
            {(categories || []).slice(0, 2).map(cat => (
              <span
                key={cat}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground truncate max-w-[88px]"
              >
                {cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </span>
            ))}
          </div>

          <div className="mt-auto pt-1.5">
            <div className="flex gap-1.5 h-[84px]">
              {productSlots.map((product, idx) => (
                product ? (
                  <ProductMini
                    key={product.id}
                    product={product}
                    actionType={resolvedActions.get(product.id)}
                    onTap={onProductTap ? (e) => { e.stopPropagation(); onProductTap(product); } : undefined}
                  />
                ) : (
                  <div
                    key={`empty-${idx}`}
                    className="flex-1 min-w-0 rounded-lg bg-muted/20"
                    aria-hidden
                  />
                )
              ))}
            </div>
            <p className={cn(
              'text-[12px] font-semibold mt-1 px-0.5 h-4 flex items-center gap-1',
              isServiceCard ? 'text-primary' : 'text-success tabular-nums',
            )}>
              {isServiceCard && <Phone size={10} className="shrink-0" />}
              <span className="truncate">{footerLabel}</span>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function ProductMini({ product, actionType, onTap }: { product: TopProduct; actionType?: string; onTap?: (e: React.MouseEvent) => void }) {
  const { formatPrice } = useCurrency();
  const label = getCommercePriceLabel(actionType, product.price, formatPrice);
  const showPrice = shouldShowMonetaryPrice(actionType, product.price);
  return (
    <div
      onClick={onTap}
      className={cn('flex-1 min-w-0 rounded-lg bg-muted/50 overflow-hidden flex flex-col', onTap && 'cursor-pointer')}
    >
      {product.image_url ? (
        <img
          src={optimizedImageUrl(product.image_url, { width: 150, quality: 70 })}
          alt={product.name}
          className="w-full h-12 shrink-0 object-cover"
          loading="lazy"
          decoding="async"
          onError={handleImageError}
        />
      ) : (
        <div className="w-full h-12 shrink-0 flex items-center justify-center bg-muted">
          {isCartPricedAction(actionType) ? (
            <ShoppingBag size={14} className="text-muted-foreground" />
          ) : (
            <Phone size={14} className="text-muted-foreground" />
          )}
        </div>
      )}
      <div className="px-1 py-0.5 min-h-0">
        <p className="text-[12px] text-foreground font-medium line-clamp-1">{product.name}</p>
        <div className="flex items-center gap-0.5">
          {product.is_veg !== null && <VegBadge isVeg={product.is_veg} size="sm" />}
          <span className={cn(
            'text-[11px] font-bold truncate',
            showPrice ? 'text-foreground tabular-nums' : 'text-primary',
          )}>
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}
