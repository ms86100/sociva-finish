/** Client/server checkout guard messages — keep in sync with create_multi_vendor_orders errors. */

export const BUYER_SOCIETY_REQUIRED_MSG =
  'Link your account to a society in Profile settings before placing an order.';

export const SELLER_SOCIETY_REQUIRED_MSG =
  'One of the stores in your cart is not linked to a society and cannot accept orders right now.';

export const SELLER_LOCATION_REQUIRED_MSG =
  'One of the stores in your cart has no location set and cannot accept orders right now.';

export const BUYER_DELIVERY_LOCATION_MSG =
  'Your selected address has no location coordinates. Please update it with a precise location.';

export const DELIVERY_ADDRESS_REQUIRED_MSG =
  'Please add a delivery address with a map pin before continuing.';

export function checkoutErrorMessage(error?: string | null, fallbackMessage?: string | null): string {
  switch (error) {
    case 'buyer_society_required':
      return BUYER_SOCIETY_REQUIRED_MSG;
    case 'seller_society_required':
      return fallbackMessage || SELLER_SOCIETY_REQUIRED_MSG;
    case 'seller_location_required':
      return fallbackMessage || SELLER_LOCATION_REQUIRED_MSG;
    case 'buyer_location':
      return fallbackMessage || BUYER_DELIVERY_LOCATION_MSG;
    default:
      return fallbackMessage || error || 'Checkout could not be completed.';
  }
}

export function assertBuyerCanCheckout(opts: {
  profileSocietyId?: string | null;
  fulfillmentType: 'delivery' | 'self_pickup';
  hasDeliveryAddress: boolean;
  hasPreciseDeliveryCoords: boolean;
}): string | null {
  if (!opts.profileSocietyId) {
    return BUYER_SOCIETY_REQUIRED_MSG;
  }
  if (opts.fulfillmentType === 'delivery') {
    if (opts.hasPreciseDeliveryCoords) return null;
    if (!opts.hasDeliveryAddress) {
      return DELIVERY_ADDRESS_REQUIRED_MSG;
    }
    return BUYER_DELIVERY_LOCATION_MSG;
  }
  return null;
}
