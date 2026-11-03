// @ts-nocheck
import {
  ProductGridSkeleton,
  type ProductGridSkeletonVariant,
} from '@/components/placeholders/ProductGridSkeleton';

interface ProductCardSkeletonProps {
  count?: number;
  className?: string;
  compact?: boolean;
  variant?: ProductGridSkeletonVariant;
}

/** @deprecated Prefer ProductGridSkeleton; kept as a thin alias for existing imports. */
export function ProductCardSkeleton({
  count = 6,
  className,
  compact = false,
  variant = 'general',
}: ProductCardSkeletonProps) {
  return (
    <ProductGridSkeleton
      count={count}
      className={className}
      compact={compact}
      variant={variant}
    />
  );
}
