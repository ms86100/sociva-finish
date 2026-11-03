// @ts-nocheck
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type ProductDetailSkeletonProps = {
  className?: string;
};

/** Matches ProductDetailSheet geometry: hero gallery + title + price + CTA. */
export function ProductDetailSkeleton({ className }: ProductDetailSkeletonProps) {
  return (
    <div
      className={cn('flex flex-col gap-4 pb-8', className)}
      data-testid="product-detail-skeleton"
      aria-busy
      aria-label="Loading product"
    >
      <Skeleton className="aspect-[4/3] w-full rounded-none sm:rounded-2xl" />
      <div className="flex gap-2 px-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-14 shrink-0 rounded-xl" />
        ))}
      </div>
      <div className="space-y-3 px-4">
        <Skeleton className="h-3 w-24 rounded-md" />
        <Skeleton className="h-6 w-4/5 rounded-md" />
        <Skeleton className="h-4 w-1/3 rounded-md" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <div className="flex gap-2 pt-2">
          <Skeleton className="h-10 w-20 rounded-full" />
          <Skeleton className="h-10 w-20 rounded-full" />
          <Skeleton className="h-10 w-20 rounded-full" />
        </div>
        <Skeleton className="h-12 w-full rounded-2xl mt-4" />
      </div>
    </div>
  );
}
