// @ts-nocheck
import { Skeleton } from '@/components/ui/skeleton';
import { ProductGridSkeleton } from './ProductGridSkeleton';
import { cn } from '@/lib/utils';

type SellerStorefrontSkeletonProps = {
  className?: string;
};

export function SellerStorefrontSkeleton({ className }: SellerStorefrontSkeletonProps) {
  return (
    <div
      className={cn('space-y-4', className)}
      data-testid="seller-storefront-skeleton"
      aria-busy
      aria-label="Loading store"
    >
      <Skeleton className="h-36 w-full rounded-2xl" />
      <div className="flex items-center gap-3 px-1">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-1/2 rounded-md" />
          <Skeleton className="h-3 w-2/3 rounded-md" />
        </div>
      </div>
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-20 shrink-0 rounded-full" />
        ))}
      </div>
      <ProductGridSkeleton count={4} variant="general" />
    </div>
  );
}

type CategoryPageSkeletonProps = {
  className?: string;
};

export function CategoryPageSkeleton({ className }: CategoryPageSkeletonProps) {
  return (
    <div
      className={cn('space-y-4', className)}
      data-testid="category-page-skeleton"
      aria-busy
      aria-label="Loading category"
    >
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-16 shrink-0 rounded-2xl" />
        ))}
      </div>
      <ProductGridSkeleton count={6} variant="food" />
    </div>
  );
}

type SellerRowSkeletonProps = {
  count?: number;
  className?: string;
};

export function SellerRowSkeleton({ count = 3, className }: SellerRowSkeletonProps) {
  return (
    <div
      className={cn('space-y-3', className)}
      data-testid="seller-row-skeleton"
      aria-busy
      aria-label="Loading sellers"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex gap-3 rounded-2xl border border-border/60 bg-card p-3"
        >
          <Skeleton className="h-16 w-16 shrink-0 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3 rounded-md" />
            <Skeleton className="h-3 w-full rounded-md" />
            <Skeleton className="h-3 w-1/3 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

type OrdersSkeletonProps = {
  className?: string;
  count?: number;
};

export function OrdersSkeleton({ className, count = 4 }: OrdersSkeletonProps) {
  return (
    <div
      className={cn('space-y-3', className)}
      data-testid="orders-skeleton"
      aria-busy
      aria-label="Loading orders"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-border/60 bg-card p-4 space-y-3"
        >
          <div className="flex justify-between">
            <Skeleton className="h-4 w-28 rounded-md" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-full rounded-md" />
          <Skeleton className="h-3 w-2/3 rounded-md" />
        </div>
      ))}
    </div>
  );
}

type ProfileSkeletonProps = {
  className?: string;
};

export function ProfileSkeleton({ className }: ProfileSkeletonProps) {
  return (
    <div
      className={cn('space-y-5', className)}
      data-testid="profile-skeleton"
      aria-busy
      aria-label="Loading profile"
    >
      <div className="flex items-center gap-4">
        <Skeleton className="h-20 w-20 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-1/2 rounded-md" />
          <Skeleton className="h-3 w-2/3 rounded-md" />
        </div>
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-xl" />
      ))}
    </div>
  );
}

type NotificationsSkeletonProps = {
  className?: string;
  count?: number;
};

export function NotificationsSkeleton({ className, count = 6 }: NotificationsSkeletonProps) {
  return (
    <div
      className={cn('space-y-2', className)}
      data-testid="notifications-skeleton"
      aria-busy
      aria-label="Loading notifications"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex gap-3 rounded-xl p-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-3/4 rounded-md" />
            <Skeleton className="h-3 w-full rounded-md" />
            <Skeleton className="h-2.5 w-16 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}
