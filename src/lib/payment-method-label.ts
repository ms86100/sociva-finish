const PAID_STATUSES = new Set(['paid', 'captured', 'settled', 'success']);
const WAITING_STATUSES = new Set(['pending', 'created', 'authorized', 'processing', 'payment_pending']);

export function paymentMethodName(paymentType?: string | null): string | null {
  if (!paymentType) return null;
  if (paymentType === 'cod') return 'Cash';
  if (paymentType === 'card') return 'Online';
  if (paymentType === 'upi') return 'UPI';
  return 'Online';
}

/** Method first. Checkmark language only when money is actually captured. */
export function orderPaymentChipLabel(
  paymentType?: string | null,
  paymentStatus?: string | null,
): string | null {
  const method = paymentMethodName(paymentType);
  if (!method) return null;
  const status = (paymentStatus || '').toLowerCase();
  if (PAID_STATUSES.has(status)) return `${method} · Paid`;
  if (status === 'refunded' || status === 'partially_refunded') return `${method} · Refunded`;
  if (WAITING_STATUSES.has(status) || !status) return `${method} · Waiting`;
  return method;
}
