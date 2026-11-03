// @ts-nocheck
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type CartSkeletonProps = {
  className?: string;
  lines?: number;
};

export function CartSkeleton({ className, lines = 3 }: CartSkeletonProps) {
  return (
    <div
      className={cn('space-y-4', className)}
      data-testid="cart-skeleton"
      aria-busy
      aria-label="Loading cart"
    >
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="flex gap-3 rounded-2xl border border-border/60 bg-card p-3"
        >
          <Skeleton className="h-20 w-20 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4 rounded-md" />
            <Skeleton className="h-3 w-1/2 rounded-md" />
            <div className="flex items-center justify-between pt-1">
              <Skeleton className="h-8 w-24 rounded-full" />
              <Skeleton className="h-4 w-14 rounded-md" />
            </div>
          </div>
        </div>
      ))}
      <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
        <Skeleton className="h-4 w-1/3 rounded-md" />
        <Skeleton className="h-3 w-full rounded-md" />
        <Skeleton className="h-3 w-2/3 rounded-md" />
        <Skeleton className="h-12 w-full rounded-2xl mt-2" />
      </div>
    </div>
  );
}

type CheckoutSkeletonProps = {
  className?: string;
};

export function CheckoutSkeleton({ className }: CheckoutSkeletonProps) {
  return (
    <div
      className={cn('space-y-5', className)}
      data-testid="checkout-skeleton"
      aria-busy
      aria-label="Loading checkout"
    >
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-2 flex-1 rounded-full" />
        ))}
      </div>
      <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
        <Skeleton className="h-4 w-1/2 rounded-md" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
      <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
        <Skeleton className="h-4 w-1/3 rounded-md" />
        <Skeleton className="h-3 w-full rounded-md" />
        <Skeleton className="h-3 w-4/5 rounded-md" />
        <Skeleton className="h-12 w-full rounded-2xl" />
      </div>
    </div>
  );
}
