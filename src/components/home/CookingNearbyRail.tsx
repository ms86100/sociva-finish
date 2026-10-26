import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { hapticSelection } from '@/lib/haptics';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';
import {
  COOKING_NEARBY_HEADING,
  type CookingNearbyKitchen,
} from '@/lib/cooking-nearby';

interface CookingNearbyRailProps {
  kitchens: CookingNearbyKitchen[];
  className?: string;
  /** Room pages get a larger story strip + open pulse. */
  variant?: 'home' | 'room';
}

/**
 * Story circles with a full green ring. Ring sits on an outer shell so
 * overflow-x scroll never clips the top of the border.
 */
export function CookingNearbyRail({ kitchens, className, variant = 'home' }: CookingNearbyRailProps) {
  if (kitchens.length === 0) return null;
  const room = variant === 'room';

  return (
    <section
      className={cn(room ? 'pt-1 pb-4' : 'pt-2 pb-5', className)}
      data-testid="cooking-nearby-rail"
      aria-label={COOKING_NEARBY_HEADING}
    >
      <div className={cn('px-4 mb-3', room && 'mb-3.5')}>
        <h2 className={cn(
          'font-extrabold tracking-tight text-foreground',
          room ? 'text-[18px]' : 'text-[17px]',
        )}>
          {COOKING_NEARBY_HEADING}
        </h2>
        {room && (
          <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
            Kitchens in your society right now
          </p>
        )}
      </div>
      <div className="taste-rail-scroll scrollbar-hide">
        {/* pt/pb keeps the full green ring inside the scrollport */}
        <div className={cn(
          'flex w-max items-start px-4 pr-5 pt-1.5 pb-1',
          room ? 'gap-4' : 'gap-3.5',
        )}>
          {kitchens.map((kitchen) => (
            <Link
              key={kitchen.sellerId}
              to={kitchen.href}
              data-testid={`cooking-nearby-${kitchen.sellerId}`}
              onClick={() => hapticSelection()}
              className={cn(
                'flex shrink-0 flex-col items-center gap-1 active:scale-95 transition-transform',
                room ? 'w-[5.35rem]' : 'w-[4.85rem]',
              )}
            >
              <span
                className={cn(
                  'relative flex shrink-0 items-center justify-center rounded-full',
                  room ? 'h-[4.35rem] w-[4.35rem] p-[3px]' : 'h-[3.85rem] w-[3.85rem] p-[2.5px]',
                  kitchen.open ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                  kitchen.open && room && 'cooking-nearby-open-pulse',
                )}
                aria-hidden={!kitchen.open}
              >
                <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-muted ring-2 ring-background">
                  {kitchen.imageUrl ? (
                    <img
                      src={optimizedImageUrl(kitchen.imageUrl, { width: 140, quality: 74 })}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={handleImageError}
                    />
                  ) : (
                    <span className="text-[13px] font-extrabold text-primary">
                      {kitchen.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </span>
              </span>
              <span className={cn(
                'mt-0.5 w-full truncate text-center font-bold leading-tight text-foreground',
                room ? 'text-[12px]' : 'text-[12px]',
              )}>
                {kitchen.name}
              </span>
              {kitchen.open ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold leading-none text-emerald-600">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-[2px] bg-emerald-500" aria-hidden />
                  Open
                </span>
              ) : (
                <span className="text-[11px] font-semibold leading-none text-muted-foreground">Closed</span>
              )}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
