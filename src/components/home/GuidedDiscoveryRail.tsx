import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { hapticSelection } from '@/lib/haptics';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';
import {
  GUIDED_DISCOVERY_HEADING,
  type GuidedDiscoveryHub,
} from '@/lib/guided-discovery';
import homeFoodArt from '@/assets/categories/home-food.jpg';

interface GuidedDiscoveryRailProps {
  hubs: GuidedDiscoveryHub[];
  className?: string;
}

/** Mockup shows Home Food + Restaurant Food as a fixed 2-up grid. */
const LOBBY_ROOM_IDS = ['home_food', 'restaurant_food'] as const;

export function GuidedDiscoveryRail({ hubs, className }: GuidedDiscoveryRailProps) {
  if (hubs.length === 0) return null;

  const lobbyRooms = LOBBY_ROOM_IDS
    .map((id) => hubs.find((hub) => hub.id === id))
    .filter((hub): hub is GuidedDiscoveryHub => !!hub);
  const rooms = lobbyRooms.length >= 2 ? lobbyRooms : hubs.slice(0, 2);
  if (rooms.length === 0) return null;

  return (
    <section
      className={cn('pt-3 pb-1', className)}
      data-testid="guided-discovery-rail"
      aria-label={GUIDED_DISCOVERY_HEADING}
    >
      <div className="flex items-center justify-between gap-2 px-4 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-extrabold tracking-[0.14em] text-primary shrink-0">NEW</span>
          <h2 className="font-extrabold text-[17px] tracking-tight text-foreground truncate">
            {GUIDED_DISCOVERY_HEADING}
          </h2>
        </div>
        <Link
          to="/categories"
          className="text-xs font-bold flex items-center gap-0.5 text-primary hover:underline shrink-0"
        >
          See all <ChevronRight size={14} />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 px-4" data-testid="guided-discovery-rooms-grid">
        {rooms.map((hub) => {
          const photo = hub.imageUrl
            || (hub.id === 'home_food' ? homeFoodArt : null);
          return (
            <Link
              key={hub.id}
              to={hub.href}
              data-testid={`guided-discovery-hub-${hub.id}`}
              onClick={() => hapticSelection()}
              className="group relative overflow-hidden rounded-[20px] bg-muted active:scale-[0.98] transition-transform"
            >
              <div className="relative aspect-[4/5] overflow-hidden">
                {photo ? (
                  <img
                    src={typeof photo === 'string' && photo.startsWith('http')
                      ? optimizedImageUrl(photo, { width: 420, quality: 76 })
                      : photo}
                    alt=""
                    className="h-full w-full object-cover object-[center_42%] transition-transform duration-300 group-active:scale-105"
                    onError={handleImageError}
                  />
                ) : (
                  <div className="h-full w-full bg-gradient-to-br from-primary/25 to-muted" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 flex items-end gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-extrabold leading-snug text-white">
                      {hub.title}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-white/90 line-clamp-2">
                      {hub.subtitle}
                    </p>
                  </div>
                  <span className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
                    <ChevronRight size={16} strokeWidth={2.6} />
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
