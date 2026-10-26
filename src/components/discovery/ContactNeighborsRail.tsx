import { cn } from '@/lib/utils';
import { hapticSelection } from '@/lib/haptics';
import { optimizedImageUrl } from '@/utils/imageHelpers';
import { displaySellerStoreName } from '@/lib/seller-journey';

export interface ContactNeighbor {
  sellerId: string;
  name: string;
  imageUrl: string | null;
  open: boolean;
  listingCount: number;
}

interface ContactNeighborsRailProps {
  neighbors: ContactNeighbor[];
  onSelect: (sellerId: string) => void;
  className?: string;
  title?: string;
  subtitle?: string;
  testId?: string;
}

/**
 * Quick visual strip so Contact / Book feel like choosing neighbors, not a dump of cards.
 */
export function ContactNeighborsRail({
  neighbors,
  onSelect,
  className,
  title = 'Neighbors to message',
  subtitle = 'Tap a face to jump to their listings',
  testId = 'contact-neighbors-rail',
}: ContactNeighborsRailProps) {
  if (neighbors.length < 2) return null;

  return (
    <section
      className={cn('pt-1 pb-1', className)}
      data-testid={testId}
      aria-label={title}
    >
      <div className="mb-2.5 px-4">
        <h2 className="text-[17px] font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
          {title}
        </h2>
        <p className="mt-0.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
          {subtitle}
        </p>
      </div>
      <div className="taste-rail-scroll scrollbar-hide">
        <div className="flex w-max items-start gap-3.5 px-4 pr-5 pt-1.5 pb-1">
          {neighbors.map((neighbor) => {
            const label = displaySellerStoreName(neighbor.name) || 'Neighbor';
            return (
              <button
                key={neighbor.sellerId}
                type="button"
                data-testid={`contact-neighbor-${neighbor.sellerId}`}
                onClick={() => {
                  hapticSelection();
                  onSelect(neighbor.sellerId);
                }}
                className="flex w-[4.85rem] shrink-0 flex-col items-center gap-1 active:scale-95 transition-transform"
              >
                <span
                  className={cn(
                    'relative flex h-[3.85rem] w-[3.85rem] shrink-0 items-center justify-center rounded-full p-[2.5px]',
                    neighbor.open ? 'bg-emerald-500 contact-neighbor-open-pulse' : 'bg-muted-foreground/35',
                  )}
                >
                  <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-muted ring-2 ring-background">
                    {neighbor.imageUrl ? (
                      <img
                        src={optimizedImageUrl(neighbor.imageUrl, { width: 140, quality: 74 })}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={(event) => {
                          event.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : (
                      <span className="text-[13px] font-extrabold text-primary">
                        {label.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </span>
                </span>
                <span className="mt-0.5 w-full truncate text-center text-[12px] font-bold leading-tight text-foreground">
                  {label}
                </span>
                {neighbor.open ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold leading-none text-emerald-600">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-[2px] bg-emerald-500" aria-hidden />
                    Open
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold leading-none text-muted-foreground">
                    {neighbor.listingCount} {neighbor.listingCount === 1 ? 'service' : 'services'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
