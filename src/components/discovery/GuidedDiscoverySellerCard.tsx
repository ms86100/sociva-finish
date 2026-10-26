import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Leaf, MapPin, Phone } from 'lucide-react';
import { ProductWithSeller } from '@/components/product/ProductListingCard';
import { useCurrency } from '@/hooks/useCurrency';
import { resolveListingAction } from '@/lib/commerce-mode';
import { shouldShowMonetaryPrice } from '@/lib/marketplace-constants';
import { displaySellerStoreName } from '@/lib/seller-journey';
import { optimizedImageUrl } from '@/utils/imageHelpers';
import { listingPlaceChip } from '@/lib/location-label-resolver';
import { cn } from '@/lib/utils';
import type { CategoryConfig } from '@/types/categories';

interface GuidedDiscoverySellerCardProps {
  products: ProductWithSeller[];
  categoryLabel?: string;
  categoryConfigs?: CategoryConfig[];
  onOpenListing: (product: ProductWithSeller) => void;
}

function sellerAvatarCandidates(lead: ProductWithSeller | undefined, featured: ProductWithSeller | undefined): string[] {
  if (!lead) return [];
  const urls = [
    lead.seller_profile_image_url,
    (lead as any).seller?.profile_image_url,
    (lead as any).seller_cover_image_url,
    (lead as any).seller?.cover_image_url,
    featured?.image_url,
    lead.image_url,
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const url = String(raw || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

export function GuidedDiscoverySellerCard({
  products,
  categoryLabel,
  categoryConfigs = [],
  onOpenListing,
}: GuidedDiscoverySellerCardProps) {
  const { formatPrice } = useCurrency();
  const [showMore, setShowMore] = useState(false);
  const [avatarIndex, setAvatarIndex] = useState(0);

  const lead = products[0];
  const featured = useMemo(
    () => products.find((item) => item.image_url) || lead,
    [products, lead],
  );
  const avatarPool = useMemo(
    () => sellerAvatarCandidates(lead, featured),
    [lead, featured],
  );
  const avatarKey = avatarPool.join('|');

  useEffect(() => {
    setAvatarIndex(0);
  }, [lead?.seller_id, avatarKey]);

  if (!lead || !featured) return null;

  const sellerKey = lead.seller_id || lead.id;
  const name = displaySellerStoreName(lead.seller_name) || 'Neighbor';
  const place = listingPlaceChip(lead.society_name);
  const extras = products.filter((item) => item.id !== featured.id);
  const rating = Number(lead.seller_rating) || 0;
  const reviews = Number(lead.seller_reviews) || 0;
  const topRated = rating >= 4.5 && reviews > 0;
  const openNow = lead.seller_is_available !== false && lead.seller_vacation_mode !== true;
  const avatarSrc = avatarPool[avatarIndex] || null;
  const coverSrc = String(
    (lead as any).seller_cover_image_url
    || (lead as any).seller?.cover_image_url
    || featured.image_url
    || '',
  ).trim() || null;

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
          'mt-3.5 flex w-full items-center gap-3 border-t border-border/60 pt-3.5 text-left active:scale-[0.99]',
          hidden && 'hidden',
        )}
      >
        <div className="h-[4.75rem] w-[4.75rem] shrink-0 overflow-hidden rounded-[16px] bg-muted ring-1 ring-black/5">
          {photo ? (
            <img
              src={optimizedImageUrl(photo, { width: 240, quality: 84 })}
              alt=""
              className="h-full w-full object-cover"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
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
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-3.5 py-2 text-[12px] font-bold text-primary-foreground shadow-[0_8px_18px_-8px_hsl(var(--primary)/0.85)]">
          <Phone size={12} strokeWidth={2.6} />
          Contact
        </span>
      </button>
    );
  };

  return (
    <div
      id={`contact-seller-${sellerKey}`}
      className="contact-seller-card scroll-mt-24 overflow-hidden rounded-[20px] border border-border/70 bg-card shadow-[0_16px_40px_-22px_rgba(15,23,42,0.4)] dark:shadow-none"
      data-testid={`seller-card-${sellerKey}`}
    >
      <div className="relative h-[4.75rem] overflow-hidden bg-gradient-to-br from-emerald-900 via-zinc-800 to-zinc-900">
        {coverSrc ? (
          <img
            src={optimizedImageUrl(coverSrc, { width: 720, quality: 72 })}
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-center opacity-80"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/55 to-transparent" />
        <div className="absolute right-3 top-3 flex items-center gap-1.5">
          {openNow && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/95 px-2.5 py-1 text-[9px] font-extrabold tracking-[0.08em] text-white shadow-sm">
              OPEN
            </span>
          )}
          {topRated && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50/95 px-2.5 py-1 text-[9px] font-extrabold tracking-[0.08em] text-primary shadow-sm dark:bg-primary/20">
              <Leaf size={10} />
              TOP RATED
            </span>
          )}
        </div>
      </div>

      <div className="relative -mt-8 px-4 pb-4">
        <div className="flex items-end gap-3">
          <div className="h-[4.25rem] w-[4.25rem] overflow-hidden rounded-full bg-muted ring-[3px] ring-card shadow-[0_10px_24px_-12px_rgba(15,23,42,0.55)]">
            {avatarSrc ? (
              <img
                src={optimizedImageUrl(avatarSrc, { width: 160, quality: 82 })}
                alt=""
                className="h-full w-full object-cover"
                onError={() => {
                  if (avatarIndex + 1 < avatarPool.length) {
                    setAvatarIndex((index) => index + 1);
                    return;
                  }
                  setAvatarIndex(avatarPool.length);
                }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/25 to-muted text-lg font-extrabold text-primary">
                {name.slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 pb-1">
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
        </div>

        {renderListing(featured, false)}
        {extras.map((product) => renderListing(product, !showMore))}
        {extras.length > 0 && (
          <button
            type="button"
            data-testid={`seller-more-${lead.seller_id || lead.id}`}
            onClick={() => setShowMore((open) => !open)}
            className="mt-3 w-full rounded-full bg-muted/60 py-2 text-center text-[12px] font-bold text-primary"
          >
            {showMore ? 'Show less' : `${extras.length} more`}
          </button>
        )}
      </div>
    </div>
  );
}
