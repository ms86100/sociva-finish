import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { hapticSelection } from '@/lib/haptics';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';
import neighborHero from '@/assets/sociva-neighbor-hero.jpg';

const COPY = {
  home_food: {
    eyebrow: 'IN YOUR SOCIETY',
    line1: 'Fresh homemade,',
    line2: 'by neighbors you know.',
  },
  restaurant_food: {
    eyebrow: 'NEARBY KITCHENS',
    line1: 'Local favorites,',
    line2: 'plated for your tower.',
  },
} as const;

/**
 * Full-bleed Room hero - ken-burns photo, gold CTA, staggered copy reveal.
 */
export function GuidedRoomHero({
  hubId,
  imageUrl,
  onOrderNow,
  className,
}: {
  hubId: 'home_food' | 'restaurant_food';
  imageUrl?: string | null;
  onOrderNow: () => void;
  className?: string;
}) {
  const copy = COPY[hubId];
  const photo = imageUrl || neighborHero;
  const remote = typeof photo === 'string' && photo.startsWith('http');

  return (
    <div className={cn('relative', className)} data-testid="guided-room-hero">
      <button
        type="button"
        onClick={() => {
          hapticSelection();
          onOrderNow();
        }}
        className="relative block w-full overflow-hidden bg-zinc-900 text-left active:scale-[0.995] transition-transform"
      >
        <div className="relative aspect-[4/3] sm:aspect-[5/3] w-full">
          <img
            src={remote ? optimizedImageUrl(photo, { width: 1100, quality: 80 }) : photo}
            alt=""
            className="guided-room-ken-burns absolute inset-0 h-full w-full object-cover object-[center_32%]"
            onError={handleImageError}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-black/10" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/15 to-transparent" />
          <div className="guided-room-hero-sheen" aria-hidden />
          <div className="guided-room-hero-grain" aria-hidden />
          <div className="relative z-10 flex h-full flex-col justify-end px-5 pb-6 pt-12">
            <p className="guided-room-fade-1 text-[10px] font-extrabold tracking-[0.2em] text-[#F5C542]">
              {copy.eyebrow}
            </p>
            <p className="guided-room-fade-2 mt-2 max-w-[17rem] text-[24px] font-extrabold leading-[1.12] text-white tracking-tight">
              <span className="block">{copy.line1}</span>
              <span className="guided-room-hero-punch">{copy.line2}</span>
            </p>
            <span className="guided-room-fade-3 mt-4 inline-flex w-fit items-center gap-1.5 rounded-full bg-[#F5C542] px-4 py-2.5 text-[13px] font-extrabold text-zinc-900 shadow-[0_12px_28px_-8px_rgba(245,197,66,0.9)]">
              Order Now
              <ArrowRight size={14} strokeWidth={2.6} className="guided-room-cta-arrow" />
            </span>
          </div>
        </div>
      </button>
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-background"
        aria-hidden
      />
    </div>
  );
}
