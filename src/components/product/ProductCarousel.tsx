// @ts-nocheck
import useEmblaCarousel from 'embla-carousel-react';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { ProductListingCard, ProductWithSeller } from './ProductListingCard';
import { CategoryBehavior } from '@/types/categories';
import { cn } from '@/lib/utils';
import { useCallback, useEffect, useState } from 'react';
import { useCurrency } from '@/hooks/useCurrency';

interface ProductCarouselProps {
  title: string;
  itemCount?: number;
  emoji?: string;
  products: ProductWithSeller[];
  behavior?: CategoryBehavior | null;
  onSeeAll?: () => void;
  onProductTap?: (product: ProductWithSeller) => void;
  variant?: 'compact' | 'featured';
  tone?: 'default' | 'festival';
  accentColor?: string;
  className?: string;
}

export function ProductCarousel({
  title,
  itemCount,
  emoji,
  products,
  behavior,
  onSeeAll,
  onProductTap,
  variant = 'compact',
  tone = 'default',
  accentColor,
  className,
}: ProductCarouselProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: 'start',
    dragFree: true,
    containScroll: 'trimSnaps',
  });
  const { formatPrice } = useCurrency();

  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on('select', onSelect);
    emblaApi.on('reInit', onSelect);
    return () => { emblaApi.off('select', onSelect); };
  }, [emblaApi, onSelect]);

  if (products.length === 0) return null;

  const minPrice = Math.min(...products.map((p) => p.price));
  const cardWidth = variant === 'compact' ? 'w-[160px]' : 'w-[200px]';
  const festival = tone === 'festival';

  return (
    <div className={cn('', className)}>
      {/* Header — bold title left, "see all" right */}
      <div className="flex items-center justify-between px-4 mb-3">
        <h3 className={cn(
          'font-extrabold text-base flex items-center gap-2 tracking-tight min-w-0',
          festival ? 'text-white' : 'text-foreground'
        )}>
          {emoji && <span className="text-lg shrink-0">{emoji}</span>}
          <span className="truncate">{title}</span>
          {itemCount !== undefined && (
            <span className={cn('text-xs font-normal shrink-0', festival ? 'text-white/55' : 'text-muted-foreground')}>({itemCount})</span>
          )}
          <span className="text-xs font-semibold text-success ml-1 shrink-0 whitespace-nowrap">From {formatPrice(minPrice)}</span>
        </h3>
        {onSeeAll && (
          <button
            onClick={onSeeAll}
            className={cn(
              'text-sm font-semibold flex items-center gap-0.5 hover:underline shrink-0 ml-2 min-h-[36px] touch-manipulation',
              !festival && 'text-primary'
            )}
            style={festival ? { color: accentColor || '#f5d76e' } : undefined}
          >
            see all <ChevronRight size={16} />
          </button>
        )}
      </div>

      {/* Carousel with nav arrows */}
      <div className="relative group">
        <div ref={emblaRef} className="overflow-hidden">
          <div className="flex gap-3 sm:gap-3.5 pl-4 pr-2 items-stretch">
            {products.map((product) => (
              <div key={product.id} className={cn('shrink-0 flex', cardWidth)}>
                <ProductListingCard
                  product={product}
                  onTap={onProductTap}
                  compact
                />
              </div>
            ))}
          </div>
        </div>

        {/* Prev/Next arrows — Amazon-style */}
        {canScrollPrev && (
          <button
            onClick={() => emblaApi?.scrollPrev()}
            className="absolute left-1 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-card border border-border shadow-md flex items-center justify-center text-foreground hover:bg-muted transition-colors opacity-0 group-hover:opacity-100"
          >
            <ChevronLeft size={18} />
          </button>
        )}
        {canScrollNext && (
          <button
            onClick={() => emblaApi?.scrollNext()}
            className="absolute right-1 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-card border border-border shadow-md flex items-center justify-center text-foreground hover:bg-muted transition-colors opacity-0 group-hover:opacity-100"
          >
            <ChevronRight size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
