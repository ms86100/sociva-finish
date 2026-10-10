import { Building2, CalendarCheck, ShoppingBag, Wrench, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSocietyEntryVisible } from '@/hooks/useSocietyEntryVisible';
import { SELLER_LISTING_CAP } from '@/hooks/queries/useCommerceModeListings';
import {
  resolveCommerceMode,
  type CategoryActionConfig,
  type CommerceMode,
} from '@/lib/commerce-mode';
import { cn } from '@/lib/utils';

type ListingLike = { action_type?: string | null; category?: string | null };

export type CommerceModeCounts = Record<CommerceMode, number>;

/** True when the loaded page is the full set for that mode. A capped seller is not a total. */
export type ModeCountTrust = Record<CommerceMode, boolean>;

/** Bento height. Kept under 168px so products can still clear the first screen. */
export const COMMERCE_MODE_TILES_HEIGHT_PX = 152;

/** Counts from inventory the caller already loaded. A mode at 0 stays unlabeled. */
export function countListingsByMode(
  listings: readonly ListingLike[],
  categoryConfigs?: readonly CategoryActionConfig[] | null,
): CommerceModeCounts {
  const counts: CommerceModeCounts = { shop: 0, book: 0, services: 0 };
  for (const listing of listings) {
    counts[resolveCommerceMode(listing, categoryConfigs)] += 1;
  }
  return counts;
}

/**
 * A mode count is trustworthy only when no seller in that mode hit the shared
 * per-seller page cap. Otherwise the number is a subset, not the mode total.
 */
export function modeCountsAreComplete(
  sellers: readonly { matching_products?: readonly ListingLike[] | null }[],
  categoryConfigs?: readonly CategoryActionConfig[] | null,
): ModeCountTrust {
  const complete: ModeCountTrust = { shop: true, book: true, services: true };
  for (const seller of sellers) {
    const products = seller.matching_products;
    if (!Array.isArray(products) || products.length < SELLER_LISTING_CAP) continue;
    for (const product of products) {
      complete[resolveCommerceMode(product, categoryConfigs)] = false;
    }
  }
  return complete;
}

const MODE_TILES: {
  mode: CommerceMode;
  to: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  className: string;
  chip: string;
  countTone: string;
}[] = [
  {
    mode: 'shop',
    to: '/shop',
    label: 'Shop',
    hint: 'Add to cart',
    icon: ShoppingBag,
    className: 'col-start-1 row-start-1 row-span-2',
    chip: 'bg-mode-shop/15 text-mode-shop-ink',
    countTone: 'text-mode-shop-ink',
  },
  {
    mode: 'book',
    to: '/book',
    label: 'Book',
    icon: CalendarCheck,
    className: 'col-start-2 row-start-1',
    chip: 'bg-mode-book/15 text-mode-book-ink',
    countTone: 'text-mode-book-ink',
  },
  {
    mode: 'services',
    to: '/services',
    label: 'Services',
    icon: Wrench,
    className: 'col-start-2 row-start-2',
    chip: 'bg-mode-services/15 text-mode-services-ink',
    countTone: 'text-mode-services-ink',
  },
];

const TILE_SURFACE =
  'flex min-w-0 flex-col justify-between rounded-2xl border border-border bg-card p-3 text-foreground active:scale-[0.98] active:border-foreground/20 motion-reduce:transition-none';

export function CommerceModeTiles({
  counts,
  complete = { shop: true, book: true, services: true },
}: {
  counts: CommerceModeCounts;
  complete?: ModeCountTrust;
}) {
  const societyVisible = useSocietyEntryVisible();

  return (
    <div
      data-testid="commerce-mode-tiles"
      style={{ height: COMMERCE_MODE_TILES_HEIGHT_PX }}
      className={cn(
        'mx-4 grid gap-2',
        societyVisible
          ? 'grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.78fr)]'
          : 'grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]',
      )}
    >
      {MODE_TILES.map((tile) => {
        const Icon = tile.icon;
        const count = counts[tile.mode];
        const showCount = count > 0 && complete[tile.mode];
        return (
          <Link
            key={tile.mode}
            to={tile.to}
            data-testid={`commerce-mode-tile-${tile.mode}`}
            aria-label={showCount ? `${tile.label}, ${count} listings` : tile.label}
            className={cn(TILE_SURFACE, tile.className)}
          >
            <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', tile.chip)}>
              <Icon size={18} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold leading-tight">{tile.label}</span>
              {tile.hint && (
                <span className="block truncate text-[11px] leading-tight text-muted-foreground">{tile.hint}</span>
              )}
              {showCount && (
                <span
                  className={cn('block text-[11px] font-semibold tabular-nums leading-tight', tile.countTone)}
                  data-testid={`commerce-mode-tile-count-${tile.mode}`}
                >
                  {count}
                </span>
              )}
            </span>
          </Link>
        );
      })}
      {societyVisible && (
        <Link
          to="/society"
          data-testid="commerce-mode-tile-society"
          aria-label="Society"
          className={cn(TILE_SURFACE, 'col-start-3 row-start-1 row-span-2 items-center justify-center gap-1 px-1 text-center')}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-foreground">
            <Building2 size={16} aria-hidden="true" />
          </span>
          <span className="text-[11px] font-bold leading-tight">Society</span>
        </Link>
      )}
    </div>
  );
}
