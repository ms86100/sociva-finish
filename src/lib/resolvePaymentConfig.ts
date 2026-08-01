// @ts-nocheck
/**
 * Canonical resolver for seller payment configuration per fulfillment type.
 * Used by cart, checkout, settings, and admin — single source of truth.
 */

export interface PaymentConfig {
  accepts_cod: boolean;
  accepts_online: boolean;
}

interface SellerPaymentInfo {
  pickup_payment_config?: PaymentConfig | null;
  delivery_payment_config?: PaymentConfig | null;
  // Legacy fallbacks
  accepts_cod?: boolean;
  accepts_upi?: boolean;
  upi_id?: string | null;
}

interface PaymentModeInfo {
  isRazorpay: boolean;
}

/**
 * Resolves available payment methods for a seller given a fulfillment type.
 * Falls back to legacy `accepts_cod`/`accepts_upi` if JSONB config is null.
 * For online payments: Razorpay is always available when enabled; UPI deep link
 * requires the seller to have `accepts_upi && upi_id`.
 */
export function resolvePaymentConfig(
  seller: SellerPaymentInfo | null | undefined,
  fulfillmentType: 'self_pickup' | 'delivery',
  paymentMode: PaymentModeInfo
): { acceptsCod: boolean; acceptsOnline: boolean } {
  if (!seller) return { acceptsCod: false, acceptsOnline: false };

  const config: PaymentConfig | null | undefined =
    fulfillmentType === 'self_pickup'
      ? seller.pickup_payment_config
      : seller.delivery_payment_config;

  // Determine COD
  const acceptsCod = config
    ? (config.accepts_cod ?? false)
    : (seller.accepts_cod ?? false);

  // Determine online payment
  let acceptsOnline: boolean;
  if (config) {
    const configOnline = config.accepts_online ?? false;
    if (paymentMode.isRazorpay) {
      // Razorpay is infra-level — if config says online, it's available
      acceptsOnline = configOnline;
    } else {
      // UPI deep link mode — requires seller to have UPI ID configured
      acceptsOnline = configOnline && !!(seller.accepts_upi) && !!(seller.upi_id);
    }
  } else {
    // Legacy fallback
    if (paymentMode.isRazorpay) {
      acceptsOnline = true;
    } else {
      acceptsOnline = !!(seller.accepts_upi) && !!(seller.upi_id);
    }
  }

  return { acceptsCod, acceptsOnline };
}
