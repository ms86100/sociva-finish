// @ts-nocheck
import { motion } from 'framer-motion';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export type ProductGridSkeletonVariant = 'food' | 'general' | 'service';

type ProductGridSkeletonProps = {
  count?: number;
  className?: string;
  compact?: boolean;
  variant?: ProductGridSkeletonVariant;
};

/**
 * Content-shaped product grid placeholders. No fake titles or prices - only geometry.
 * food: taller image + price/chip rows
 * general: square image + 2 text rows + CTA strip
 * service: wider text bias, shorter image
 */
export function ProductGridSkeleton({
  count = 6,
  className,
  compact = false,
  variant = 'general',
}: ProductGridSkeletonProps) {
  const imageAspect =
    variant === 'service'
      ? 'aspect-[16/10]'
      : variant === 'food'
        ? 'aspect-[4/5] sm:aspect-square'
        : 'aspect-square';

  return (
    <motion.div
      key="product-grid-skeleton"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        compact
          ? 'flex gap-3 overflow-hidden'
          : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 sm:gap-3',
        className,
      )}
      data-testid="product-grid-skeleton"
      data-variant={variant}
      aria-busy
      aria-label="Loading products"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'rounded-2xl border border-border/60 bg-card overflow-hidden shadow-card',
            compact && 'w-[160px] shrink-0',
          )}
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <Skeleton
            className={cn('rounded-none', compact ? 'h-[148px]' : imageAspect)}
          />
          <div className="p-2.5 space-y-2">
            {variant === 'food' && (
              <>
                <Skeleton className="h-3 w-1/3 rounded-md" />
                <Skeleton className="h-3.5 w-full rounded-md" />
                <Skeleton className="h-3 w-4/5 rounded-md" />
                <div className="flex items-center justify-between pt-1">
                  <Skeleton className="h-4 w-12 rounded-md" />
                  <Skeleton className="h-8 w-8 rounded-full" />
                </div>
              </>
            )}
            {variant === 'general' && (
              <>
                <Skeleton className="h-4 w-1/2 rounded-md" />
                <Skeleton className="h-3 w-full rounded-md" />
                <Skeleton className="h-3 w-4/5 rounded-md" />
                <Skeleton className="h-2.5 w-2/3 rounded-md" />
              </>
            )}
            {variant === 'service' && (
              <>
                <Skeleton className="h-4 w-3/4 rounded-md" />
                <Skeleton className="h-3 w-full rounded-md" />
                <Skeleton className="h-3 w-1/2 rounded-md" />
                <Skeleton className="h-8 w-full rounded-xl mt-1" />
              </>
            )}
          </div>
        </div>
      ))}
    </motion.div>
  );
}
