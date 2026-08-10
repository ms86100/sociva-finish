// @ts-nocheck
import { Link } from 'react-router-dom';
import { useCategoryBehavior } from '@/hooks/useCategoryBehavior';
import { ServiceCategory, ItemCondition, RentalPeriodType } from '@/types/categories';
import { useMarketplaceConfig } from '@/hooks/useMarketplaceConfig';
import { ProductActionType } from '@/types/Database';
import { ACTION_CONFIG } from '@/lib/marketplace-constants';
import { VegBadge } from '@/components/ui/veg-badge';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Plus, Minus, Clock, Star, Zap, MapPin } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';

export interface Listing {
  id: string;
  seller_id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  category: ServiceCategory;
  is_veg?: boolean;
  is_available: boolean;
  is_bestseller?: boolean;
  is_recommended?: boolean;
  is_urgent?: boolean;
  listing_type?: string;
  service_duration_minutes?: number;
  deposit_amount?: number;
  rental_period_type?: RentalPeriodType;
  condition?: ItemCondition;
  accepts_preorders?: boolean;
  lead_time_hours?: number;
  is_negotiable?: boolean;
  action_type?: string;
  seller?: {
    business_name: string;
    rating?: number;
    profile_image_url?: string;
    latitude?: number;
    longitude?: number;
  };
}

interface ListingCardProps {
  listing: Listing;
  quantity?: number;
  onAdd?: () => void;
  onIncrement?: () => void;
  onDecrement?: () => void;
  onEnquire?: () => void;
  onBook?: () => void;
  onRent?: () => void;
  compact?: boolean;
}

export function ListingCard({
  listing,
  quantity = 0,
  onAdd,
  onIncrement,
  onDecrement,
  onEnquire,
  onBook,
  onRent,
  compact = false,
}: ListingCardProps) {
  const { behavior, listingType, supportsCart, requiresTimeSlot, hasDateRange, enquiryOnly, isNegotiable, hasDuration } = 
    useCategoryBehavior(listing.category);
  const marketplaceConfig = useMarketplaceConfig();
  const { formatPrice } = useCurrency();

  // Use action_type from the listing (set by DB trigger), fallback to deriving from behavior
  const actionType: ProductActionType = (listing.action_type as ProductActionType) || 'add_to_cart';
  const actionConfig = ACTION_CONFIG[actionType] || ACTION_CONFIG.add_to_cart;
  const ActionIcon = actionConfig.icon;

  const renderActionButton = () => {
    if (!actionConfig.isCart) {
      // Non-cart: show action label, trigger appropriate callback
      const handler = actionType === 'book' ? onBook : actionType === 'request_service' || actionType === 'request_quote' ? onEnquire : onEnquire;
      return (
        <Button
          size="sm"
          className="rounded-full"
          onClick={(e) => {
            e.preventDefault();
            handler?.();
          }}
        >
          <ActionIcon size={14} className="mr-1" />
          {actionConfig.shortLabel}
        </Button>
      );
    }

    if (quantity > 0) {
      return (
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 rounded-full"
            onClick={(e) => {
              e.preventDefault();
              onDecrement?.();
            }}
          >
            <Minus size={14} />
          </Button>
          <span className="w-6 text-center font-semibold tabular-nums">{quantity}</span>
          <Button
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={(e) => {
              e.preventDefault();
              onIncrement?.();
            }}
          >
            <Plus size={14} />
          </Button>
        </div>
      );
    }
    return (
      <Button
        size="sm"
        className="rounded-full"
        onClick={(e) => {
          e.preventDefault();
          onAdd?.();
        }}
      >
        <Plus size={14} className="mr-1" />
        ADD
      </Button>
    );
  };

  const renderPriceInfo = () => {
    // Rental pricing
    if (listing.rental_period_type) {
      return (
        <div>
          <span className="font-bold text-lg tabular-nums">{formatPrice(listing.price)}</span>
          <span className="text-xs text-muted-foreground ml-1">
            {marketplaceConfig.rentalPeriodLabels[listing.rental_period_type] || listing.rental_period_type}
          </span>
          {listing.deposit_amount && listing.deposit_amount > 0 && (
            <p className="text-xs text-muted-foreground">
              + {formatPrice(listing.deposit_amount)} deposit
            </p>
          )}
        </div>
      );
    }

    // Service duration pricing
    if (listing.service_duration_minutes) {
      return (
        <div>
          <span className="font-bold text-lg tabular-nums">{formatPrice(listing.price)}</span>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock size={10} />
            {listing.service_duration_minutes} min
          </p>
        </div>
      );
    }

    // Standard pricing
    return (
      <div>
        <span className="font-bold text-lg tabular-nums">{formatPrice(listing.price)}</span>
        {isNegotiable && (
          <Badge variant="outline" className="ml-2 text-[10px]">
            Negotiable
          </Badge>
        )}
      </div>
    );
  };

  const renderBadges = () => {
    const badges = [];

    if (listing.is_bestseller) {
      badges.push(
        <Badge key="bestseller" variant="secondary" className="bg-warning/20 text-warning-foreground text-[10px]">
          <Star size={10} className="mr-0.5 fill-current" />
          Bestseller
        </Badge>
      );
    }

    if (listing.is_urgent) {
      badges.push(
        <Badge key="urgent" variant="destructive" className="text-[10px]">
          <Zap size={10} className="mr-0.5" />
          Urgent
        </Badge>
      );
    }

    if (listing.condition) {
      const conditionInfo = marketplaceConfig.itemConditionLabels[listing.condition] || { label: listing.condition, color: '' };
      badges.push(
        <Badge key="condition" variant="outline" className={cn('text-[10px]', conditionInfo.color)}>
          {conditionInfo.label}
        </Badge>
      );
    }

    return badges.length > 0 ? (
      <div className="flex flex-wrap gap-1 mb-1">{badges}</div>
    ) : null;
  };

  if (compact) {
    return (
      <div className="flex items-center gap-3 p-3 bg-card rounded-2xl border border-border/60 shadow-card">
        {listing.image_url && (
          <img
            src={optimizedImageUrl(listing.image_url, { width: 128, quality: 78 })}
            alt={listing.name}
            className="w-16 h-16 rounded-xl object-cover product-image-bg shrink-0"
            loading="lazy"
            decoding="async"
            onError={handleImageError}
          />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate text-sm">{listing.name}</p>
          <p className="text-sm font-extrabold text-foreground tabular-nums mt-0.5">{formatPrice(listing.price)}</p>
        </div>
        {renderActionButton()}
      </div>
    );
  }

  return (
    <div className="flex gap-3 p-3.5 border-b border-border/70 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          {listing.is_veg !== undefined && <VegBadge isVeg={listing.is_veg} size="sm" />}
          <div className="flex-1 min-w-0">
            {renderBadges()}
            <h4 className="font-semibold leading-snug line-clamp-2 text-[14px]">{listing.name}</h4>
            {listing.description && (
              <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
                {listing.description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-end justify-between mt-2 gap-2">
          {renderPriceInfo()}
          {renderActionButton()}
        </div>
      </div>

      <div className="relative w-[96px] h-[96px] rounded-xl overflow-hidden shrink-0 product-image-bg shadow-sm">
        {listing.image_url && (
          <img
            src={optimizedImageUrl(listing.image_url, { width: 200, quality: 78 })}
            alt={listing.name}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
            onError={handleImageError}
          />
        )}
        {listing.accepts_preorders && (
          <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-card/90 backdrop-blur-sm border border-border/50 shadow-sm">
            <span className="text-[9px] font-semibold text-foreground flex items-center gap-0.5">
              <Clock size={8} className="text-primary" /> Pre-order
            </span>
          </div>
        )}
        {listing.seller?.latitude && listing.seller?.longitude && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(
                `https://www.google.com/maps/search/?api=1&query=${listing.seller!.latitude},${listing.seller!.longitude}`,
                '_blank'
              );
            }}
            className="absolute bottom-1.5 right-1.5 p-1.5 rounded-full bg-card/90 backdrop-blur-sm shadow-sm border border-border/40 hover:bg-card transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center touch-manipulation"
            title="View seller location"
            aria-label="View seller location"
          >
            <MapPin size={14} className="text-primary" />
          </button>
        )}
      </div>
    </div>
  );
}
