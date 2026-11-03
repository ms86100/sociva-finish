// @ts-nocheck
import { Skeleton } from '@/components/ui/skeleton';
import { ProductGridSkeleton } from './ProductGridSkeleton';
import { cn } from '@/lib/utils';

type SearchResultsSkeletonProps = {
  className?: string;
  count?: number;
};

export function SearchResultsSkeleton({ className, count = 6 }: SearchResultsSkeletonProps) {
  return (
    <div
      className={cn('space-y-4', className)}
      data-testid="search-results-skeleton"
      aria-busy
      aria-label="Loading search results"
    >
      <div className="flex gap-2 overflow-hidden px-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-24 shrink-0 rounded-full" />
        ))}
      </div>
      <ProductGridSkeleton count={count} variant="general" />
    </div>
  );
}
