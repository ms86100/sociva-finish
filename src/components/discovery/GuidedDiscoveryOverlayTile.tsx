import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { curatedCuisineArt, curatedMealArt } from '@/lib/food-chip-art';
import { optimizedImageUrl } from '@/utils/imageHelpers';
import type { GuidedDiscoveryTile } from '@/lib/guided-discovery';

function tileFallbackArt(tile: GuidedDiscoveryTile): string | null {
  if (tile.kind === 'meal') return curatedMealArt(tile.id);
  if (tile.kind === 'cuisine' && tile.id.startsWith('cuisine:')) {
    return curatedCuisineArt(tile.id.slice('cuisine:'.length));
  }
  if (tile.id === 'breakfast' || tile.id === 'lunch' || tile.id === 'dinner' || tile.id === 'snack') {
    return curatedMealArt(tile.id);
  }
  return null;
}

export function GuidedDiscoveryOverlayTile({
  tile,
  selected,
  compact,
  showEta,
  service,
  cinematic,
  onSelect,
}: {
  tile: GuidedDiscoveryTile;
  selected: boolean;
  compact?: boolean;
  showEta?: boolean;
  service?: boolean;
  /** Book page: richer photo tile with sheen + soft zoom */
  cinematic?: boolean;
  onSelect: (id: string) => void;
}) {
  const caption = compact
    ? (showEta && tile.eta ? tile.eta.replace(/^Delivers in /i, '').replace(/^Ready in /i, '') : null)
    : (showEta && tile.eta ? tile.eta : tile.subtitle);

  const preferred = tile.imageUrl || tileFallbackArt(tile);
  const [src, setSrc] = useState(preferred);

  if (compact) {
    // Food Room aisle: large photo cards so Breakfast / South Indian read at a glance.
    return (
      <button
        type="button"
        data-testid={`guided-discovery-tile-${tile.id}`}
        aria-pressed={selected}
        onClick={() => onSelect(tile.id)}
        className={cn(
          'group relative flex w-[7.25rem] shrink-0 flex-col overflow-hidden rounded-[20px] text-left',
          'bg-zinc-900 shadow-[0_14px_32px_-18px_rgba(15,23,42,0.55)]',
          'active:scale-[0.98] transition-transform',
          selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
        )}
      >
        <span className="relative aspect-[4/5] w-full overflow-hidden">
          {src ? (
            <img
              src={optimizedImageUrl(src, { width: 280, quality: 76 })}
              alt=""
              className="h-full w-full object-cover object-center transition-transform duration-500 group-active:scale-105"
              onError={() => {
                const fallback = tileFallbackArt(tile);
                if (fallback && src !== fallback) {
                  setSrc(fallback);
                  return;
                }
                setSrc(null);
              }}
            />
          ) : (
            <span className="block h-full w-full bg-gradient-to-br from-primary/30 to-zinc-800" />
          )}
          <span className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-transparent" />
          <span className="absolute inset-x-0 bottom-0 space-y-0.5 p-2.5 pt-8">
            <span className="block truncate text-[12px] font-extrabold leading-tight text-white">
              {tile.label}
            </span>
            {caption && (
              <span className="block truncate text-[10px] font-semibold text-white/80">
                {caption}
              </span>
            )}
          </span>
          {selected && (
            <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
              <ChevronRight size={13} strokeWidth={2.8} />
            </span>
          )}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      data-testid={`guided-discovery-tile-${tile.id}`}
      aria-pressed={selected}
      onClick={() => onSelect(tile.id)}
      className={cn(
        'group relative overflow-hidden bg-zinc-900 text-left active:scale-[0.98] transition-transform',
        service ? 'aspect-[3/2] rounded-[22px]' : 'aspect-[4/3] rounded-[20px]',
        cinematic
          ? 'shadow-[0_18px_40px_-20px_rgba(15,23,42,0.55)] ring-1 ring-white/10'
          : 'shadow-[0_10px_24px_-14px_rgba(15,23,42,0.35)] dark:shadow-none',
        selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
      )}
    >
      {src ? (
        <img
          src={optimizedImageUrl(src, { width: 640, quality: 84 })}
          alt=""
          className={cn(
            'h-full w-full object-cover object-center',
            cinematic && 'transition-transform duration-700 ease-out group-hover:scale-105 group-active:scale-105',
          )}
          onError={() => {
            const fallback = tileFallbackArt(tile);
            if (fallback && src !== fallback) setSrc(fallback);
          }}
        />
      ) : (
        <div className="h-full w-full bg-gradient-to-br from-primary/20 to-zinc-800" />
      )}
      <div className={cn(
        'absolute inset-0',
        cinematic
          ? 'bg-gradient-to-t from-black via-black/45 to-black/5'
          : 'bg-gradient-to-t from-black/80 via-black/25 to-transparent',
      )} />
      {cinematic && <span className="book-tile-sheen" aria-hidden />}
      <div className={cn(
        'absolute inset-x-0 bottom-0 flex items-end gap-2',
        service ? 'p-3' : 'p-2.5',
        cinematic && 'p-3.5',
      )}>
        <div className="min-w-0 flex-1">
          <p className={cn(
            'font-extrabold text-white leading-tight drop-shadow-sm',
            service ? 'text-[14px] line-clamp-2' : 'text-[12px] truncate',
            cinematic && 'text-[15px] tracking-tight',
          )}>
            {tile.label}
          </p>
          {caption && (
            <p className={cn(
              'mt-0.5 text-[11px] text-white/90 line-clamp-2',
              cinematic && 'text-white/80',
            )}>
              {caption}
            </p>
          )}
        </div>
        <span className={cn(
          'mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm',
          cinematic && 'h-8 w-8 shadow-[0_8px_18px_-6px_rgba(16,185,129,0.85)] ring-1 ring-white/25',
        )}>
          <ChevronRight size={cinematic ? 16 : 15} strokeWidth={2.6} />
        </span>
      </div>
    </button>
  );
}
