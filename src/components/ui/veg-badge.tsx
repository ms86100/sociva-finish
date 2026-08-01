// @ts-nocheck
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface VegBadgeProps {
  isVeg: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const VegBadge = forwardRef<HTMLDivElement, VegBadgeProps>(
  function VegBadge({ isVeg, size = 'md', className }, ref) {
    const sizeClasses = {
      sm: 'w-3 h-3 border',
      md: 'w-4 h-4 border-[1.5px]',
      lg: 'w-5 h-5 border-2',
    };

    const dotSizes = {
      sm: 'w-1.5 h-1.5',
      md: 'w-2 h-2',
      lg: 'w-2.5 h-2.5',
    };

    return (
      <div
        ref={ref}
        className={cn(
          'flex items-center justify-center rounded-sm',
          isVeg ? 'border-veg' : 'border-non-veg',
          sizeClasses[size],
          className
        )}
      >
        <div
          className={cn(
            'rounded-full',
            isVeg ? 'bg-veg' : 'bg-non-veg',
            dotSizes[size]
          )}
        />
      </div>
    );
  }
);
