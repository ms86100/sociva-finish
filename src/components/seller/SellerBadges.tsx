// @ts-nocheck
import { Shield, Award, Star, Clock, Package } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SellerBadgesProps {
  isVerified?: boolean;
  isTopSeller?: boolean;
  rating?: number;
  totalOrders?: number;
  responseTime?: string;
  size?: 'sm' | 'md';
  showStats?: boolean;
}

export function SellerBadges({
  isVerified = false,
  isTopSeller = false,
  rating = 0,
  totalOrders = 0,
  responseTime,
  size = 'sm',
  showStats = false,
}: SellerBadgesProps) {
  const iconSize = size === 'sm' ? 12 : 14;
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs';
  
  const isHighlyRated = rating >= 4.5;

  return (
    <div className="space-y-2">
      {/* Badges */}
      <div className="flex flex-wrap gap-1.5">
        {isVerified && (
          <span className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/10 text-success',
            textSize
          )}>
            <Shield size={iconSize} />
            Verified
          </span>
        )}
        {isTopSeller && (
          <span className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning/10 text-warning',
            textSize
          )}>
            <Award size={iconSize} />
            Top Seller
          </span>
        )}
        {isHighlyRated && (
          <span className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary',
            textSize
          )}>
            <Star size={iconSize} />
            Highly Rated
          </span>
        )}
      </div>

      {/* Stats */}
      {showStats && (totalOrders > 0 || responseTime) && (
        <div className={cn('flex flex-wrap gap-3 text-muted-foreground', textSize)}>
          {totalOrders > 0 && (
            <span className="flex items-center gap-1">
              <Package size={iconSize} />
              {totalOrders}+ orders
            </span>
          )}
          {responseTime && (
            <span className="flex items-center gap-1">
              <Clock size={iconSize} />
              ~{responseTime} response
            </span>
          )}
        </div>
      )}
    </div>
  );
}
