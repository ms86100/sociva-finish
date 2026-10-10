import { Building2, CalendarCheck, ShoppingBag, Wrench, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSocietyEntryVisible } from '@/hooks/useSocietyEntryVisible';
import {
  resolveCommerceMode,
  type CategoryActionConfig,
  type CommerceMode,
} from '@/lib/commerce-mode';
import { cn } from '@/lib/utils';

type ListingLike = { action_type?: string | null; category?: string | null };

export type CommerceModeCounts = Record<CommerceMode, number>;

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

const MODE_TILES: {
  mode: CommerceMode;
  to: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  className: string;
  tone: string;
}[] = [
  {
    mode: 'shop',
    to: '/shop',
    label: 'Shop',
    hint: 'Add to cart',
    icon: ShoppingBag,
    className: 'col-start-1 row-start-1 row-span-2',
    tone: 'bg-mode-shop text-mode-shop-foreground',
  },
  {
    mode: 'book',
    to: '/book',
    label: 'Book',
    icon: CalendarCheck,
    className: 'col-start-2 row-start-1',
    tone: 'bg-mode-book text-mode-book-foreground',
  },
  {
    mode: 'services',
    to: '/services',
    label: 'Services',
    icon: Wrench,
    className: 'col-start-2 row-start-2',
    tone: 'bg-mode-services text-mode-services-foreground',
  },
];

export function CommerceModeTiles({ counts }: { counts: CommerceModeCounts }) {
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
        return (
          <Link
            key={tile.mode}
            to={tile.to}
            data-testid={`commerce-mode-tile-${tile.mode}`}
            aria-label={count > 0 ? `${tile.label}, ${count} listings` : tile.label}
            className={cn(
              'flex min-w-0 flex-col justify-between rounded-2xl p-3 active:scale-[0.98] motion-reduce:transition-none',
              tile.tone,
              tile.className,
            )}
          >
            <Icon size={tile.mode === 'shop' ? 22 : 16} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold leading-tight">{tile.label}</span>
              {tile.hint && (
                <span className="block truncate text-[11px] leading-tight opacity-90">{tile.hint}</span>
              )}
              {count > 0 && (
                <span
                  className="block text-[11px] font-semibold tabular-nums leading-tight opacity-90"
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
          className="col-start-3 row-start-1 row-span-2 flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-card px-1 text-center text-foreground active:scale-[0.98] motion-reduce:transition-none"
        >
          <Building2 size={16} aria-hidden="true" />
          <span className="text-[11px] font-bold leading-tight">Society</span>
        </Link>
      )}
    </div>
  );
}
