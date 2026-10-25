import { useState } from 'react';
import { BadgeCheck, Leaf, MapPin } from 'lucide-react';
import { ProductWithSeller } from '@/components/product/ProductListingCard';
import { useCurrency } from '@/hooks/useCurrency';
import { resolveListingAction } from '@/lib/commerce-mode';
import { shouldShowMonetaryPrice } from '@/lib/marketplace-constants';
import { displaySellerStoreName } from '@/lib/seller-journey';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';
import { listingPlaceChip } from '@/lib/location-label-resolver';
import { cn } from '@/lib/utils';
import type { CategoryConfig } from '@/types/categories';

interface GuidedDiscoverySellerCardProps {
  products: ProductWithSeller[];
  categoryLabel?: string;
  categoryConfigs?: CategoryConfig[];
  onOpenListing: (product: ProductWithSeller) => void;
}

export function GuidedDiscoverySellerCard({
  products,
  categoryLabel,
  categoryConfigs = [],
  onOpenListing,
}: GuidedDiscoverySellerCardProps) {
  const { formatPrice } = useCurrency();
  const [showMore, setShowMore] = useState(false);
  const lead = products[0];
  if (!lead) return null;
  const name = displaySellerStoreName(lead.seller_name) || 'Neighbor';
  const place = listingPlaceChip(lead.society_name);
  const avatar = lead.seller_profile_image_url || lead.image_url;
  const featured = products.find((item) => item.image_url) || lead;
  const extras = products.filter((item) => item.id !== featured.id);
  const rating = Number(lead.seller_rating) || 0;
  const reviews = Number(lead.seller_reviews) || 0;
  const topRated = rating >= 4.5 && reviews > 0;

  const renderListing = (product: ProductWithSeller, hidden: boolean) => {
    const photo = product.image_url || featured.image_url;
    const money = shouldShowMonetaryPrice(
      resolveListingAction(product.action_type, product.category, categoryConfigs),
      product.price,
    );
    return (
      <button
        key={product.id}
        type="button"
        data-testid={`card-${product.id}`}
        data-action={resolveListingAction(product.action_type, product.category, categoryConfigs)}
        onClick={() => onOpenListing(product)}
        className={cn(
          'mt-3.5 flex w-full items-center gap-3 border-t border-border/70 pt-3.5 text-left active:scale-[0.99]',
          hidden && 'hidden',
        )}
      >
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-[14px] bg-muted">
          {photo ? (
            <img
              src={optimizedImageUrl(photo, { width: 240, quality: 84 })}
              alt=""
              className="h-full w-full object-cover"
              onError={handleImageError}
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-foreground line-clamp-1">{product.name}</p>
          {product.description && (
            <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground line-clamp-2">{product.description}</p>
          )}
          {money && (
            <p className="mt-1.5 text-[16px] font-extrabold tabular-nums text-foreground">
              {formatPrice(product.price)}
            </p>
          )}
        </div>
        <span className="shrink-0 rounded-xl border-2 border-primary px-3.5 py-2 text-[12px] font-bold text-primary">
          Contact
        </span>
      </button>
    );
  };

  return (
    <div className="rounded-[20px] border border-border bg-card p-4 shadow-[0_10px_28px_-16px_rgba(15,23,42,0.28)] dark:shadow-none">
      <div className="flex items-start gap-3">
        <div className="h-14 w-14 overflow-hidden rounded-full bg-muted ring-2 ring-background">
          {avatar ? (
            <img
              src={optimizedImageUrl(avatar, { width: 140, quality: 82 })}
              alt=""
              className="h-full w-full object-cover"
              onError={handleImageError}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm font-bold text-muted-foreground">
              {name.slice(0, 1)}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 min-w-0">
            <p className="text-[16px] font-extrabold text-foreground truncate">{name}</p>
            {lead.seller_verified && (
              <BadgeCheck size={16} className="shrink-0 text-primary" aria-label="Verified seller" />
            )}
          </div>
          {categoryLabel && (
            <p className="mt-0.5 text-[12px] text-muted-foreground truncate">{categoryLabel}</p>
          )}
          {place && (
            <p className="mt-0.5 flex items-center gap-1 text-[12px] text-muted-foreground truncate">
              <MapPin size={12} className="shrink-0" />
              {place}
            </p>
          )}
        </div>
        {topRated && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[9px] font-extrabold tracking-[0.08em] text-primary dark:bg-primary/15">
            <Leaf size={10} />
            TOP RATED
          </span>
        )}
      </div>
      {renderListing(featured, false)}
      {extras.map((product) => renderListing(product, !showMore))}
      {extras.length > 0 && (
        <button
          type="button"
          data-testid={`seller-more-${lead.seller_id || lead.id}`}
          onClick={() => setShowMore((open) => !open)}
          className="mt-3 w-full text-center text-[12px] font-bold text-primary"
        >
          {showMore ? 'Show less' : `${extras.length} more`}
        </button>
      )}
    </div>
  );
}
