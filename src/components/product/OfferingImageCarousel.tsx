import { useRef, useState, useEffect } from 'react';
import { resolveOfferingImages, type OfferingImageSource } from '@/lib/offering-images';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { cn } from '@/lib/utils';

interface OfferingImageCarouselProps {
  source: OfferingImageSource | null | undefined;
  alt: string;
  fallbackIcon?: string;
  className?: string;
  imgClassName?: string;
}

/**
 * Detail-page gallery: single image when only one; swipeable carousel for 2-5.
 * Cards should keep using primaryOfferingImage - not this component.
 */
export function OfferingImageCarousel({
  source,
  alt,
  fallbackIcon = '🛍️',
  className,
  imgClassName,
}: OfferingImageCarouselProps) {
  const images = resolveOfferingImages(source);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    scrollerRef.current?.scrollTo({ left: 0 });
  }, [images.join('|')]);

  if (images.length === 0) {
    return (
      <div className={cn('w-full h-full flex items-center justify-center bg-muted', className)}>
        <DynamicIcon name={fallbackIcon} size={72} />
      </div>
    );
  }

  if (images.length === 1) {
    return (
      <div className={cn('w-full h-full', className)}>
        <img
          src={images[0]}
          alt={alt}
          className={cn('w-full h-full object-contain', imgClassName)}
          loading="eager"
        />
      </div>
    );
  }

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el || el.clientWidth <= 0) return;
    const next = Math.round(el.scrollLeft / el.clientWidth);
    setIndex(Math.max(0, Math.min(images.length - 1, next)));
  };

  return (
    <div className={cn('relative w-full h-full', className)}>
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="flex w-full h-full overflow-x-auto snap-x snap-mandatory scrollbar-hide"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {images.map((url, i) => (
          <div key={`${url}-${i}`} className="w-full h-full shrink-0 snap-center snap-always">
            <img
              src={url}
              alt={`${alt} (${i + 1}/${images.length})`}
              className={cn('w-full h-full object-contain', imgClassName)}
              loading={i === 0 ? 'eager' : 'lazy'}
              draggable={false}
            />
          </div>
        ))}
      </div>
      <div className="absolute bottom-3 right-3 z-[5] rounded-full bg-background/80 backdrop-blur-sm px-2 py-0.5 text-[11px] font-semibold tabular-nums border border-border/40">
        {index + 1}/{images.length}
      </div>
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[5] flex gap-1.5">
        {images.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Photo ${i + 1}`}
            className={cn(
              'w-1.5 h-1.5 rounded-full transition-colors',
              i === index ? 'bg-primary' : 'bg-background/70 border border-border/50',
            )}
            onClick={() => {
              const el = scrollerRef.current;
              if (!el) return;
              el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
              setIndex(i);
            }}
          />
        ))}
      </div>
    </div>
  );
}
