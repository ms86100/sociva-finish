// @ts-nocheck
import { Skeleton } from '@/components/ui/skeleton';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface ProductCardSkeletonProps {
  count?: number;
  /** Match listing grids: 2 on phone, 3/4 on larger */
  className?: string;
  /** Compact carousel-style fixed height cards */
  compact?: boolean;
}

export function ProductCardSkeleton({ count = 6, className, compact = false }: ProductCardSkeletonProps) {
  return (
    <motion.div
      key="skeleton"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        compact
          ? 'flex gap-3 overflow-hidden'
          : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 sm:gap-3',
        className
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'rounded-2xl border border-border/60 bg-card overflow-hidden shadow-card',
            compact && 'w-[160px] shrink-0 h-[260px]'
          )}
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <Skeleton className={cn('rounded-none', compact ? 'h-[148px]' : 'aspect-[4/5] sm:aspect-square')} />
          <div className="p-2.5 space-y-2">
            <Skeleton className="h-4 w-1/2 rounded-md" />
            <Skeleton className="h-3 w-full rounded-md" />
            <Skeleton className="h-3 w-4/5 rounded-md" />
            <Skeleton className="h-2.5 w-2/3 rounded-md" />
          </div>
        </div>
      ))}
    </motion.div>
  );
}
