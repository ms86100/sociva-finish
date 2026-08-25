/**
 * Single source of truth for when a seller must provide a UPI ID.
 * Matches checkout: Deep UPI collection needs a VPA; Razorpay does not.
 */

export type PaymentGatewayMode = 'off' | 'upi_deep_link' | 'razorpay';

export type SellerSettingsSaveScope = 'hours' | 'payments' | 'general';

export interface SellerPaymentConfig {
  accepts_cod?: boolean;
  accepts_online?: boolean;
}

export interface SellerPaymentSnapshot {
  upi_id?: string | null;
  accepts_upi?: boolean | null;
  pickup_payment_config?: SellerPaymentConfig | null;
  delivery_payment_config?: SellerPaymentConfig | null;
}

export const UPI_REQUIRED_TITLE = 'UPI ID needed for online payments';

export const UPI_REQUIRED_FOR_ONLINE_MESSAGE =
  'Add your UPI ID to accept online payments, or turn off Online Payment and use cash.';

export const UPI_REQUIRED_FOR_GO_LIVE_MESSAGE =
  'Add your UPI ID before going live with online payments, or turn off Online Payment and use cash.';

export function wantsOnlinePayments(seller: SellerPaymentSnapshot | null | undefined): boolean {
  if (!seller) return false;
  return !!(
    seller.pickup_payment_config?.accepts_online ||
    seller.delivery_payment_config?.accepts_online ||
    seller.accepts_upi
  );
}

export function hasSellerUpiId(seller: { upi_id?: string | null } | null | undefined): boolean {
  return !!seller?.upi_id?.trim();
}

/** UPI is only required when Deep UPI is live and the seller wants online collection. */
export function requiresSellerUpi(
  gatewayMode: PaymentGatewayMode,
  sellerWantsOnline: boolean,
): boolean {
  return gatewayMode === 'upi_deep_link' && sellerWantsOnline;
}

export function isUpiRequiredAndMissing(
  gatewayMode: PaymentGatewayMode,
  seller: SellerPaymentSnapshot | null | undefined,
): boolean {
  return requiresSellerUpi(gatewayMode, wantsOnlinePayments(seller)) && !hasSellerUpiId(seller);
}

export function shouldShowSellerUpiField(
  gatewayMode: PaymentGatewayMode,
  seller: SellerPaymentSnapshot | null | undefined,
): boolean {
  return requiresSellerUpi(gatewayMode, wantsOnlinePayments(seller));
}

/** Hours / store-info / delivery saves must never block on UPI. Payments tab may. */
export function shouldValidateUpiOnSettingsSave(scope: SellerSettingsSaveScope): boolean {
  return scope === 'payments';
}

export function isSettingsSaveBlockedForMissingUpi(
  scope: SellerSettingsSaveScope,
  gatewayMode: PaymentGatewayMode,
  seller: SellerPaymentSnapshot | null | undefined,
): boolean {
  return shouldValidateUpiOnSettingsSave(scope) && isUpiRequiredAndMissing(gatewayMode, seller);
}

export function canGoLiveWithPayments(
  gatewayMode: PaymentGatewayMode,
  seller: SellerPaymentSnapshot | null | undefined,
): boolean {
  return !isUpiRequiredAndMissing(gatewayMode, seller);
}
