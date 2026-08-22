/**
 * Sociva Credits — prepaid seller→platform usage.
 * Never mix with seller payable (/seller/wallet) or customer payments.
 * Billing amounts come from Admin → Monetization. Do not hard-code rates here.
 */

export const SELLER_CREDITS_ROUTE = '/seller/credits';
export const SELLER_EARNINGS_WALLET_ROUTE = '/seller/wallet';

export const CUSTOMER_UNAVAILABLE_ORDERS =
  'This seller is currently unavailable for new orders.';

export const CUSTOMER_UNAVAILABLE_REQUESTS =
  'This seller is currently unavailable for new requests.';

/** @deprecated Use CUSTOMER_UNAVAILABLE_ORDERS or sellerCreditCustomerMessage */
export const CUSTOMER_STORE_UNAVAILABLE = CUSTOMER_UNAVAILABLE_ORDERS;

export const SELLER_CREDITS_EXHAUSTED =
  'Your Sociva Credits are exhausted. Recharge to start accepting new orders again.';

export const SELLER_CREDITS_LOW =
  'Your Sociva Credits are running low. Recharge now to keep receiving new orders and requests.';

export const BILLING_EVENT_TYPES = [
  'ORDER_COMPLETED',
  'ENQUIRY_CREATED',
  'SERVICE_BOOKING',
  'CONTACT_REQUEST',
] as const;

export type BillingEventType = (typeof BILLING_EVENT_TYPES)[number];

export const BILLING_EVENT_LABELS: Record<BillingEventType, string> = {
  ORDER_COMPLETED: 'Successful Order',
  ENQUIRY_CREATED: 'Enquiry',
  SERVICE_BOOKING: 'Service Booking',
  CONTACT_REQUEST: 'Contact Request',
};

export type CreditHealth = 'healthy' | 'low' | 'critical' | 'exhausted';

export type CreditThresholds = {
  healthyMin?: number | null;
  lowMin?: number | null;
  criticalMin?: number | null;
};

/** Default contact debounce. Live billing reads seller_credit_settings.contact_debounce_hours. */
export const CONTACT_DEBOUNCE_HOURS_INVARIANT = 24;

export function creditEventForOrder(orderType?: string | null, transactionType?: string | null): BillingEventType | null {
  if (orderType === 'enquiry') return 'ENQUIRY_CREATED';
  if (orderType === 'booking' || transactionType === 'service_booking') return 'SERVICE_BOOKING';
  if (!orderType) return 'ORDER_COMPLETED';
  return 'ORDER_COMPLETED';
}

export function shouldChargeOrderCompleted(orderType?: string | null, transactionType?: string | null): boolean {
  return creditEventForOrder(orderType, transactionType) === 'ORDER_COMPLETED';
}

export function creditHealth(
  available: number,
  thresholds: CreditThresholds = {},
): CreditHealth {
  if (available <= 0) return 'exhausted';
  if (thresholds.criticalMin != null && available <= thresholds.criticalMin) return 'critical';
  if (thresholds.lowMin != null && available < thresholds.lowMin) return 'critical';
  if (thresholds.healthyMin != null && available < thresholds.healthyMin) return 'low';
  return 'healthy';
}

export function creditLedgerLabel(type?: string | null, eventType?: string | null): string {
  if (type === 'purchase') return 'Credit purchase';
  if (type === 'admin_adjustment') return 'Admin adjustment';
  if (type === 'reservation') return 'Reserved';
  if (type === 'reservation_release') return 'Booking reservation released';
  if (type === 'reversal') return 'Reversal';
  if (type === 'refund') return 'Purchase refund';
  switch (eventType) {
    case 'ORDER_COMPLETED':
      return 'Successful order';
    case 'ENQUIRY_CREATED':
      return 'New enquiry';
    case 'SERVICE_BOOKING':
      return type === 'event_charge' ? 'Service booking completed' : 'Service booking';
    case 'CONTACT_REQUEST':
      return 'Contact request';
    default:
      return type || 'Credit activity';
  }
}

export function creditActivityDetails(row: {
  type?: string | null;
  event_type?: string | null;
  reference_short?: string | null;
  reference_id?: string | null;
  product_name?: string | null;
  booking_date?: string | null;
  start_time?: string | null;
  order_status?: string | null;
  description?: string | null;
}): string[] {
  const lines: string[] = [];
  const short = row.reference_short || (row.reference_id ? String(row.reference_id).replace(/-/g, '').slice(0, 8).toUpperCase() : '');
  if (row.event_type === 'ORDER_COMPLETED' && short) lines.push(`Order #${short}`);
  if (row.event_type === 'ENQUIRY_CREATED' && short) lines.push(`Enquiry #${short}`);
  if (row.event_type === 'SERVICE_BOOKING' && short) lines.push(`Booking #${short}`);
  if (row.event_type === 'CONTACT_REQUEST' && short) lines.push(`Contact #${short}`);
  if (row.product_name) lines.push(`Product: ${row.product_name}`);
  if (row.booking_date) {
    const time = row.start_time ? String(row.start_time).slice(0, 5) : '';
    lines.push(`Appointment: ${row.booking_date}${time ? `, ${time}` : ''}`);
  }
  if (row.order_status && row.event_type === 'ORDER_COMPLETED') {
    lines.push(row.order_status === 'completed' || row.order_status === 'delivered' || row.order_status === 'buyer_received'
      ? 'Completed'
      : row.order_status);
  }
  if (row.description && !lines.some((line) => row.description && line.includes(row.description))) {
    lines.push(row.description);
  }
  return lines;
}

export function isSellerCreditInsufficientError(message?: string | null): boolean {
  return Boolean(message && /SELLER_CREDIT_INSUFFICIENT/i.test(message));
}

export function sellerCreditCustomerMessage(
  message?: string | null,
  eventType?: string | null,
): string {
  if (eventType === 'ORDER_COMPLETED') return CUSTOMER_UNAVAILABLE_ORDERS;
  if (eventType && eventType !== 'ORDER_COMPLETED') return CUSTOMER_UNAVAILABLE_REQUESTS;
  if (/unavailable for new requests/i.test(message || '')) return CUSTOMER_UNAVAILABLE_REQUESTS;
  if (
    isSellerCreditInsufficientError(message)
    || /temporarily unavailable for new/i.test(message || '')
    || /unavailable for new orders/i.test(message || '')
  ) {
    return CUSTOMER_UNAVAILABLE_ORDERS;
  }
  return message || CUSTOMER_UNAVAILABLE_ORDERS;
}

export type SellerCreditSummary = {
  available: number;
  reserved: number;
  lifetimePurchased: number;
  lifetimeConsumed: number;
  lifetimeAdjusted: number;
  usedThisMonth: number;
  ordersThisMonth: number;
  enquiriesThisMonth: number;
  bookingsThisMonth: number;
  contactsThisMonth: number;
  health: CreditHealth;
  spendEnabled: boolean;
  purchaseEnabled: boolean;
  healthyMin: number | null;
  lowMin: number | null;
  criticalMin: number | null;
};

export function emptySellerCreditSummary(): SellerCreditSummary {
  return {
    available: 0,
    reserved: 0,
    lifetimePurchased: 0,
    lifetimeConsumed: 0,
    lifetimeAdjusted: 0,
    usedThisMonth: 0,
    ordersThisMonth: 0,
    enquiriesThisMonth: 0,
    bookingsThisMonth: 0,
    contactsThisMonth: 0,
    health: 'exhausted',
    spendEnabled: false,
    purchaseEnabled: false,
    healthyMin: null,
    lowMin: null,
    criticalMin: null,
  };
}

function optionalNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function mapSellerCreditSummary(row: Record<string, unknown> | null | undefined): SellerCreditSummary {
  const available = Number(row?.available ?? 0);
  const healthyMin = optionalNumber(row?.healthy_min);
  const lowMin = optionalNumber(row?.low_min);
  const criticalMin = optionalNumber(row?.critical_min);
  return {
    available,
    reserved: Number(row?.reserved ?? 0),
    lifetimePurchased: Number(row?.lifetime_purchased ?? 0),
    lifetimeConsumed: Number(row?.lifetime_consumed ?? 0),
    lifetimeAdjusted: Number(row?.lifetime_adjusted ?? 0),
    usedThisMonth: Number(row?.used_this_month ?? 0),
    ordersThisMonth: Number(row?.orders_this_month ?? 0),
    enquiriesThisMonth: Number(row?.enquiries_this_month ?? 0),
    bookingsThisMonth: Number(row?.bookings_this_month ?? 0),
    contactsThisMonth: Number(row?.contacts_this_month ?? 0),
    health: creditHealth(available, { healthyMin, lowMin, criticalMin }),
    spendEnabled: Boolean(row?.spend_enabled),
    purchaseEnabled: Boolean(row?.purchase_enabled),
    healthyMin,
    lowMin,
    criticalMin,
  };
}

export function creditsReconcile(input: {
  lifetimePurchased: number;
  lifetimeAdjusted: number;
  lifetimeConsumed: number;
  reserved: number;
}): number {
  return Number((input.lifetimePurchased + input.lifetimeAdjusted - input.lifetimeConsumed - input.reserved).toFixed(2));
}
