// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useEmblaCarousel from 'embla-carousel-react';
import { ArrowRight } from 'lucide-react';
import { hapticSelection } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import { useEffectiveFeatures } from '@/hooks/useEffectiveFeatures';
import { useHelpHubMode } from '@/hooks/queries/useHelpHub';
import { useAuth } from '@/contexts/AuthContext';
import neighborHero from '@/assets/sociva-neighbor-hero.jpg';
import rideHero from '@/assets/sociva-ride-hero.jpg';
import helpHero from '@/assets/sociva-help-hero.jpg';
import {
  NEIGHBOR_HEADLINE,
  NeighborTypewriterHeadline,
} from '@/components/home/NeighborMakesBanner';

const AUTOPLAY_MS = 5500;

type SlideId = 'neighbor' | 'ride' | 'help';

type DiscoverySlide = {
  id: SlideId;
  image: string;
  objectPosition: string;
  headline?: string;
  line1: string;
  line2: string;
  cta: string;
  href: string;
  testId: string;
  typewriter?: boolean;
};

const BASE_SLIDES: DiscoverySlide[] = [
  {
    id: 'neighbor',
    image: neighborHero,
    objectPosition: 'center 30%',
    headline: NEIGHBOR_HEADLINE,
    line1: 'What Your Neighbor Makes,',
    line2: 'No App Can Deliver.',
    cta: 'Order Now',
    href: '/explore/home_food',
    testId: 'guided-discovery-home-food-hero',
    typewriter: true,
  },
  {
    id: 'ride',
    image: rideHero,
    objectPosition: 'center 40%',
    headline: 'Empty Seats Are Wasted Miles. Share the Ride Home.',
    line1: 'Empty Seats Are Wasted Miles.',
    line2: 'Share the Ride Home.',
    cta: 'Find a ride',
    href: '/cleaner-city',
    testId: 'home-discovery-ride-hero',
  },
  {
    id: 'help',
    image: helpHero,
    objectPosition: 'center 35%',
    headline: 'Good Help Lives Next Door. Find It. Recommend It.',
    line1: 'Good Help Lives Next Door.',
    line2: 'Find It. Recommend It.',
    cta: 'Find Help',
    href: '/help-hub/find',
    testId: 'home-discovery-help-hero',
  },
];

function useCarouselAutoplay(emblaApi: any, interval: number, enabled: boolean) {
  useEffect(() => {
    if (!emblaApi || !enabled) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduced) return;

    let id: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      stop();
      id = setInterval(() => emblaApi.scrollNext(), interval);
    };
    const stop = () => {
      if (id) clearInterval(id);
      id = undefined;
    };

    start();
    emblaApi.on('pointerDown', stop);
    emblaApi.on('pointerUp', start);
    return () => {
      stop();
      emblaApi.off('pointerDown', stop);
      emblaApi.off('pointerUp', start);
    };
  }, [emblaApi, interval, enabled]);
}

/**
 * Home lobby hero carousel: Neighbor food + Sociva Ride + Help Recommendation.
 * Ride/Help slides are society feature-gated.
 */
export function HomeDiscoveryCarousel({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { isFeatureEnabled, isLoading } = useEffectiveFeatures();
  const { forcedDemo } = useHelpHubMode();
  const { effectiveSocietyId } = useAuth();

  const slides = useMemo(() => {
    const rideEnabled = !isLoading && isFeatureEnabled('cleaner_city');
    const helpEnabled =
      forcedDemo ||
      (!isLoading &&
        (isFeatureEnabled('helphub') ||
          (isFeatureEnabled('worker_marketplace') && !!effectiveSocietyId)));

    return BASE_SLIDES.filter((slide) => {
      if (slide.id === 'ride') return rideEnabled;
      if (slide.id === 'help') return helpEnabled;
      return true;
    });
  }, [isFeatureEnabled, isLoading, forcedDemo, effectiveSocietyId]);

  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: slides.length > 1,
    align: 'start',
    duration: 28,
  });
  const [activeIndex, setActiveIndex] = useState(0);

  useCarouselAutoplay(emblaApi, AUTOPLAY_MS, slides.length > 1);

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setActiveIndex(emblaApi.selectedScrollSnap());
    onSelect();
    emblaApi.on('select', onSelect);
    emblaApi.on('reInit', onSelect);
    return () => {
      emblaApi.off('select', onSelect);
      emblaApi.off('reInit', onSelect);
    };
  }, [emblaApi]);

  useEffect(() => {
    emblaApi?.reInit();
  }, [emblaApi, slides.length]);

  const openSlide = useCallback(
    (href: string) => {
      hapticSelection();
      navigate(href);
    },
    [navigate],
  );

  if (slides.length === 0) return null;

  return (
    <div className={cn('px-4 pt-2', className)} data-testid="home-discovery-carousel">
      <div className="overflow-hidden rounded-[20px]" ref={emblaRef}>
        <div className="flex">
          {slides.map((slide) => (
            <div key={slide.id} className="min-w-0 shrink-0 grow-0 basis-full">
              <button
                type="button"
                onClick={() => openSlide(slide.href)}
                className="relative w-full overflow-hidden rounded-[20px] aspect-[2/1] bg-zinc-900 text-left active:scale-[0.99] transition-transform"
                data-testid={slide.testId}
              >
                <img
                  src={slide.image}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  style={{ objectPosition: slide.objectPosition }}
                />
                <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/45 to-transparent" />
                <div className="neighbor-banner-sheen" aria-hidden />
                <div className="relative z-10 flex h-full max-w-[70%] flex-col justify-center pl-4 pr-2 py-3">
                  {slide.typewriter ? (
                    <NeighborTypewriterHeadline />
                  ) : (
                    <p
                      className="neighbor-banner-headline text-[17px] sm:text-[18px] font-extrabold leading-[1.2] text-white"
                      aria-label={slide.headline}
                    >
                      <span className="neighbor-banner-line">{slide.line1}</span>
                      <span className="neighbor-banner-punch neighbor-banner-punch-ready">
                        {slide.line2}
                      </span>
                    </p>
                  )}
                  <span className="mt-3 inline-flex w-fit items-center gap-1 rounded-full bg-[#F5C542] px-3.5 py-1.5 text-[12px] font-extrabold text-zinc-900">
                    {slide.cta}
                    <ArrowRight size={13} strokeWidth={2.5} />
                  </span>
                </div>
              </button>
            </div>
          ))}
        </div>
      </div>

      {slides.length > 1 ? (
        <div className="mt-2.5 flex justify-center gap-1.5" data-testid="home-discovery-carousel-dots">
          {slides.map((slide, idx) => (
            <button
              key={slide.id}
              type="button"
              aria-label={`Go to ${slide.cta} slide`}
              onClick={() => {
                hapticSelection();
                emblaApi?.scrollTo(idx);
              }}
              className="flex min-h-[24px] min-w-[24px] items-center justify-center"
            >
              <span
                className={cn(
                  'rounded-full transition-all duration-300',
                  idx === activeIndex ? 'h-1.5 w-5 bg-primary' : 'h-1.5 w-1.5 bg-border',
                )}
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
