// @ts-nocheck
import { Package, Truck } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';

type FulfillmentMode = 'self_pickup' | 'seller_delivery' | 'platform_delivery' | 'pickup_and_seller_delivery' | 'pickup_and_platform_delivery';

interface FulfillmentSelectorProps {
  value: 'self_pickup' | 'delivery';
  onChange: (value: 'self_pickup' | 'delivery') => void;
  deliveryFee: number;
  freeDeliveryThreshold: number;
  orderValue?: number;
  sellerFulfillmentMode?: FulfillmentMode | null;
}

/**
 * Determines buyer-facing fulfillment options based on seller's mode:
 * - self_pickup: no choice, pickup forced
 * - seller_delivery / platform_delivery: no choice, delivery forced
 * - pickup_and_*: buyer chooses pickup or delivery
 */
export function FulfillmentSelector({ value, onChange, deliveryFee, freeDeliveryThreshold, orderValue = 0, sellerFulfillmentMode }: FulfillmentSelectorProps) {
  const { formatPrice } = useCurrency();
  const isFreeDelivery = deliveryFee === 0 || orderValue >= freeDeliveryThreshold;

  // Determine what options to show based on seller's fulfillment mode
  const mode = sellerFulfillmentMode || 'self_pickup';
  const showPickup = mode === 'self_pickup' || mode.startsWith('pickup_and_');
  const showDelivery = mode !== 'self_pickup';
  const hasBuyerChoice = mode.startsWith('pickup_and_');

  // If no buyer choice, don't render the selector at all — just show info
  if (!hasBuyerChoice) {
    if (mode === 'self_pickup') {
      return (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fulfillment</h3>
          <div className="flex items-center gap-2 p-3 rounded-xl border-2 border-primary bg-primary/5">
            <Package size={20} className="text-primary" />
            <div>
              <span className="text-sm font-medium text-primary">Self Pickup</span>
              <span className="text-[11px] text-primary font-medium ml-2">FREE</span>
            </div>
          </div>
        </div>
      );
    }
    // seller_delivery or platform_delivery — delivery is forced
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fulfillment</h3>
        <div className="flex items-center gap-2 p-3 rounded-xl border-2 border-primary bg-primary/5">
          <Truck size={20} className="text-primary" />
          <div>
            <span className="text-sm font-medium text-primary">
              {mode === 'platform_delivery' ? 'Delivery Partner' : 'Delivery'}
            </span>
            <span className={`text-[11px] font-medium ml-2 ${isFreeDelivery ? 'text-primary' : 'text-muted-foreground'}`}>
              {isFreeDelivery ? 'FREE' : formatPrice(deliveryFee)}
            </span>
          </div>
        </div>
        {!isFreeDelivery && freeDeliveryThreshold > 0 && (
          <p className="text-[11px] text-muted-foreground text-center">
            Free delivery on orders above {formatPrice(freeDeliveryThreshold)}
          </p>
        )}
      </div>
    );
  }

  // Buyer has a choice: pickup or delivery
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fulfillment</h3>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onChange('self_pickup')}
          className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-colors ${
            value === 'self_pickup'
              ? 'border-primary bg-primary/5'
              : 'border-border bg-card hover:border-muted-foreground/30'
          }`}
        >
          <Package size={20} className={value === 'self_pickup' ? 'text-primary' : 'text-muted-foreground'} />
          <span className={`text-sm font-medium ${value === 'self_pickup' ? 'text-primary' : 'text-foreground'}`}>
            Self Pickup
          </span>
          <span className="text-[11px] text-primary font-medium">FREE</span>
        </button>
        <button
          onClick={() => onChange('delivery')}
          className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-colors ${
            value === 'delivery'
              ? 'border-primary bg-primary/5'
              : 'border-border bg-card hover:border-muted-foreground/30'
          }`}
        >
          <Truck size={20} className={value === 'delivery' ? 'text-primary' : 'text-muted-foreground'} />
          <span className={`text-sm font-medium ${value === 'delivery' ? 'text-primary' : 'text-foreground'}`}>
            {mode === 'pickup_and_platform_delivery' ? 'Delivery Partner' : 'Delivery'}
          </span>
          <span className={`text-[11px] font-medium ${isFreeDelivery ? 'text-primary' : 'text-muted-foreground'}`}>
            {isFreeDelivery ? 'FREE' : formatPrice(deliveryFee)}
          </span>
          <span className="text-[10px] text-primary/70 font-medium">Recommended</span>
        </button>
      </div>
      {value === 'delivery' && !isFreeDelivery && freeDeliveryThreshold > 0 && (
        <p className="text-[11px] text-muted-foreground text-center">
          Free delivery on orders above {formatPrice(freeDeliveryThreshold)}
        </p>
      )}
    </div>
  );
}
