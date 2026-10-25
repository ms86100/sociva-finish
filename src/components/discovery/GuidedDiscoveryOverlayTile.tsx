import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';
import type { GuidedDiscoveryTile } from '@/lib/guided-discovery';

export function GuidedDiscoveryOverlayTile({
  tile,
  selected,
  compact,
  showEta,
  service,
  onSelect,
}: {
  tile: GuidedDiscoveryTile;
  selected: boolean;
  compact?: boolean;
  showEta?: boolean;
  service?: boolean;
  onSelect: (id: string) => void;
}) {
  const caption = compact
    ? (showEta && tile.eta ? tile.eta.replace(/^Delivers in /i, '').replace(/^Ready in /i, '') : null)
    : (showEta && tile.eta ? tile.eta : tile.subtitle);
  return (
    <button
      type="button"
      data-testid={`guided-discovery-tile-${tile.id}`}
      aria-pressed={selected}
      onClick={() => onSelect(tile.id)}
      className={cn(
        'relative overflow-hidden bg-muted text-left active:scale-[0.98] transition-transform shadow-[0_10px_24px_-14px_rgba(15,23,42,0.35)] dark:shadow-none',
        compact
          ? 'w-[28vw] min-w-[108px] max-w-[132px] shrink-0 aspect-[3/4] rounded-2xl'
          : service
            ? 'aspect-[3/2] rounded-[20px]'
            : 'aspect-[4/3] rounded-[20px]',
        selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
      )}
    >
      {tile.imageUrl ? (
        <img
          src={optimizedImageUrl(tile.imageUrl, { width: compact ? 280 : 640, quality: 84 })}
          alt=""
          className="h-full w-full object-cover"
          onError={handleImageError}
        />
      ) : (
        <div className="h-full w-full bg-gradient-to-br from-primary/20 to-muted" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
      <div className={cn(
        'absolute inset-x-0 bottom-0 flex items-end gap-2',
        service ? 'p-3' : 'p-2.5',
      )}>
        <div className="min-w-0 flex-1">
          <p className={cn(
            'font-extrabold text-white leading-tight drop-shadow-sm',
            service ? 'text-[14px] line-clamp-2' : 'text-[12px] truncate',
          )}>
            {tile.label}
          </p>
          {caption && (
            <p className="mt-0.5 text-[11px] text-white/90 line-clamp-2">{caption}</p>
          )}
        </div>
        {!compact && (
          <span className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
            <ChevronRight size={15} strokeWidth={2.6} />
          </span>
        )}
      </div>
    </button>
  );
}
