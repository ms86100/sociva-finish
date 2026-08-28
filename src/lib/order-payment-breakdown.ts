export type OrderPaymentMethod = 'cod' | 'online' | 'wallet' | 'mixed' | 'unknown';

export interface OrderPaymentBreakdown {
  orderValue: number;
  socivaBalance: number;
  socivaBalanceCash: number;
  socivaBalancePromo: number;
  loyaltyDiscount: number;
  couponDiscount: number;
  onlinePayment: number;
  cashToCollect: number;
  paymentMethod: OrderPaymentMethod;
  paymentTypeLabel: string;
  isCod: boolean;
  isOnline: boolean;
}

function round2(n: number) {
  return Math.round(Math.max(n, 0) * 100) / 100;
}

function normalizePaymentType(raw?: string | null): string {
  return String(raw || '').trim().toLowerCase();
}

export function resolveOrderPaymentMethod(paymentType?: string | null): OrderPaymentMethod {
  const pt = normalizePaymentType(paymentType);
  if (!pt || pt === 'cod' || pt === 'cash' || pt === 'cash_on_delivery') return 'cod';
  if (pt === 'wallet') return 'wallet';
  if (['online', 'upi', 'razorpay', 'card', 'upi_deep_link', 'prepaid'].includes(pt)) return 'online';
  return 'unknown';
}

export function paymentTypeLabel(paymentType?: string | null): string {
  const method = resolveOrderPaymentMethod(paymentType);
  if (method === 'cod') return 'Cash on Delivery';
  if (method === 'wallet') return 'Sociva Balance';
  if (method === 'online') return 'Online payment';
  return 'Payment';
}

/** Mirrors settlement gross = residual total + wallet + loyalty (coupon already in total). */
export function computeOrderPaymentBreakdown(order: {
  total_amount?: number | null;
  frozen_total?: number | null;
  wallet_cash_amount?: number | null;
  wallet_promo_amount?: number | null;
  loyalty_discount_amount?: number | null;
  coupon_discount?: number | null;
  payment_type?: string | null;
  payment_method?: string | null;
}): OrderPaymentBreakdown {
  const residual = round2(
    Number(order.frozen_total) > 0
      ? Number(order.frozen_total)
      : Number(order.total_amount || 0),
  );
  const walletCash = round2(Number(order.wallet_cash_amount || 0));
  const walletPromo = round2(Number(order.wallet_promo_amount || 0));
  const socivaBalance = round2(walletCash + walletPromo);
  const loyaltyDiscount = round2(Number(order.loyalty_discount_amount || 0));
  const couponDiscount = round2(Number(order.coupon_discount || 0));
  const paymentType = order.payment_type || order.payment_method;
  const method = resolveOrderPaymentMethod(paymentType);
  const isCod = method === 'cod';
  const isOnline = method === 'online' || method === 'wallet' || (method === 'unknown' && socivaBalance > 0);

  const orderValue = round2(residual + socivaBalance + loyaltyDiscount);

  let onlinePayment = 0;
  let cashToCollect = 0;
  if (isCod) {
    cashToCollect = residual;
  } else if (method === 'wallet' && residual <= 0) {
    onlinePayment = 0;
  } else {
    onlinePayment = residual;
  }

  return {
    orderValue,
    socivaBalance,
    socivaBalanceCash: walletCash,
    socivaBalancePromo: walletPromo,
    loyaltyDiscount,
    couponDiscount,
    onlinePayment,
    cashToCollect,
    paymentMethod: socivaBalance > 0 && isCod ? 'mixed' : method,
    paymentTypeLabel: paymentTypeLabel(paymentType),
    isCod,
    isOnline,
  };
}

export function orderGrossForRefund(order: {
  total_amount?: number | null;
  frozen_total?: number | null;
  wallet_cash_amount?: number | null;
  wallet_promo_amount?: number | null;
}): number {
  return computeOrderPaymentBreakdown(order).orderValue;
}
