import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { hapticSelection } from '@/lib/haptics';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';
import {
  GUIDED_DISCOVERY_HEADING,
  GUIDED_DISCOVERY_HUB_PANEL,
  type GuidedDiscoveryHub,
} from '@/lib/guided-discovery';

interface GuidedDiscoveryRailProps {
  hubs: GuidedDiscoveryHub[];
  className?: string;
}

export function GuidedDiscoveryRail({ hubs, className }: GuidedDiscoveryRailProps) {
  if (hubs.length === 0) return null;

  return (
    <section
      className={cn('pt-3 pb-2', className)}
      data-testid="guided-discovery-rail"
      aria-label={GUIDED_DISCOVERY_HEADING}
    >
      <div className="flex items-center justify-between gap-2 px-4 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-extrabold tracking-[0.14em] text-primary">NEW</span>
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
      <div className="taste-rail-scroll scrollbar-hide">
        <div className="flex w-max items-stretch gap-3 px-4 pr-5">
          {hubs.map((hub) => (
            <Link
              key={hub.id}
              to={hub.href}
              data-testid={`guided-discovery-hub-${hub.id}`}
              onClick={() => hapticSelection()}
              className="group relative w-[48vw] max-w-[210px] min-w-[176px] shrink-0 overflow-hidden rounded-[22px] bg-muted ring-1 ring-black/[0.08] shadow-[0_12px_28px_-18px_rgba(15,23,42,0.55)] active:scale-[0.98] transition-transform"
            >
              <div className="relative aspect-[4/5] overflow-hidden">
                {hub.imageUrl ? (
                  <img
                    src={optimizedImageUrl(hub.imageUrl, { width: 420, quality: 74 })}
                    alt=""
                    className="h-full w-full object-cover transition-transform duration-300 group-active:scale-105"
                    onError={handleImageError}
                  />
                ) : (
                  <div className="h-full w-full bg-gradient-to-br from-primary/20 to-muted" />
                )}
                <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/35 to-transparent" />
                <div className={cn(
                  'absolute bottom-2.5 left-2.5 right-2.5 rounded-2xl border border-black/[0.06] px-3 py-2.5 pr-10 shadow-sm',
                  GUIDED_DISCOVERY_HUB_PANEL[hub.id],
                )}>
                  <p className="text-[13px] font-extrabold leading-snug text-foreground whitespace-normal break-words line-clamp-2">
                    {hub.title}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground whitespace-normal break-words line-clamp-2">
                    {hub.subtitle}
                  </p>
                  <span className="absolute top-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                    <ChevronRight size={15} strokeWidth={2.6} />
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
