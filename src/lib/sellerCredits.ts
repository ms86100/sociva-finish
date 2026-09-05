/**
 * Sociva Credits — prepaid seller→platform usage.
 * Never mix with seller payable (/seller/wallet) or customer payments.
 * Billing amounts come from Admin → Monetization. Do not hard-code rates here.
 */

export const SELLER_CREDITS_ROUTE = '/seller/credits';
export const SELLER_EARNINGS_WALLET_ROUTE = '/seller/wallet';

export const CUSTOMER_UNAVAILABLE_ORDERS =
  'This seller isn’t accepting new orders right now. Try another store nearby, or check back later.';

export const CUSTOMER_UNAVAILABLE_REQUESTS =
  'This seller isn’t accepting new requests right now. Try another store nearby, or check back later.';

export const CUSTOMER_UNAVAILABLE_TITLE = 'Seller unavailable';

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

export type SellerBillingRate = {
  eventType: BillingEventType;
  amount: number;
  enabled: boolean;
};

/** Store commerce surfaces that map to Admin Monetization billing events. */
export type SellerCommerceMode = 'cart' | 'booking' | 'enquiry' | 'contact';

const COMMERCE_MODE_EVENT: Record<SellerCommerceMode, BillingEventType> = {
  cart: 'ORDER_COMPLETED',
  booking: 'SERVICE_BOOKING',
  enquiry: 'ENQUIRY_CREATED',
  contact: 'CONTACT_REQUEST',
};

const COMMERCE_MODE_LABEL: Record<SellerCommerceMode, string> = {
  cart: 'Add to cart / orders',
  booking: 'Bookings',
  enquiry: 'Enquiries',
  contact: 'Contact requests',
};

export function commerceModesFromProductHints(
  rows: Array<{ action_type?: string | null; listing_type?: string | null } | null | undefined>,
): SellerCommerceMode[] {
  const modes = new Set<SellerCommerceMode>();
  for (const row of rows || []) {
    const raw = `${row?.action_type || ''} ${row?.listing_type || ''}`.toLowerCase();
    if (!raw.trim()) continue;
    if (/(add_to_cart|buy_now|cart|purchase|product)/.test(raw)) modes.add('cart');
    if (/(book|booking|service_booking|schedule)/.test(raw)) modes.add('booking');
    if (/(enquir|request_service|quote)/.test(raw) && !/contact/.test(raw)) modes.add('enquiry');
    if (/(contact|call|message|whatsapp)/.test(raw)) modes.add('contact');
  }
  return Array.from(modes);
}

export function buildSellerCreditUsageExplainer(opts: {
  formatPrice: (amount: number) => string;
  rates: SellerBillingRate[];
  modes?: SellerCommerceMode[];
}): { headline: string; lines: string[] } {
  const rateByEvent = new Map(
    (opts.rates || [])
      .filter((r) => r.enabled && Number(r.amount) > 0)
      .map((r) => [r.eventType, r] as const),
  );

  const preferredModes = (opts.modes && opts.modes.length > 0)
    ? opts.modes
    : (['cart', 'booking', 'enquiry', 'contact'] as SellerCommerceMode[]);

  const lines: string[] = [];
  for (const mode of preferredModes) {
    const event = COMMERCE_MODE_EVENT[mode];
    const rate = rateByEvent.get(event);
    if (!rate) continue;
    const price = opts.formatPrice(rate.amount);
    switch (mode) {
      case 'cart':
        lines.push(
          `${COMMERCE_MODE_LABEL.cart}: ${price} is reserved when a buyer places an order, then used when that order completes successfully.`,
        );
        break;
      case 'booking':
        lines.push(
          `${COMMERCE_MODE_LABEL.booking}: ${price} is reserved when a booking is confirmed and used when the booking completes.`,
        );
        break;
      case 'enquiry':
        lines.push(
          `${COMMERCE_MODE_LABEL.enquiry}: ${price} is used when a buyer sends a new enquiry.`,
        );
        break;
      case 'contact':
        lines.push(
          `${COMMERCE_MODE_LABEL.contact}: ${price} is used on the first call or message from a buyer (repeats inside the admin window are free).`,
        );
        break;
    }
  }

  if (lines.length === 0) {
    return {
      headline: 'Sociva Credits keep your store visible to nearby buyers.',
      lines: [
        'Recharge anytime. Admin Monetization rates will appear here once they are configured.',
      ],
    };
  }

  return {
    headline: 'How Sociva Credits are used for your store',
    lines,
  };
}

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
  if (/unavailable for new requests|isn['’]t accepting new requests/i.test(message || '')) {
    return CUSTOMER_UNAVAILABLE_REQUESTS;
  }
  if (
    isSellerCreditInsufficientError(message)
    || /temporarily unavailable for new/i.test(message || '')
    || /unavailable for new orders/i.test(message || '')
    || /isn['’]t accepting new orders/i.test(message || '')
  ) {
    return CUSTOMER_UNAVAILABLE_ORDERS;
  }
  return message || CUSTOMER_UNAVAILABLE_ORDERS;
}

/** Title + body for ActionBlockedDialog when buyer hits a credit/activation gate. */
export function sellerCreditCustomerNotifyOptions(
  message?: string | null,
  eventType?: string | null,
): { title: string; message: string; id: string } {
  return {
    title: CUSTOMER_UNAVAILABLE_TITLE,
    message: sellerCreditCustomerMessage(message, eventType),
    id: eventType === 'ORDER_COMPLETED' || !eventType
      ? 'seller-credit-orders-blocked'
      : 'seller-credit-requests-blocked',
  };
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
  billingRates: SellerBillingRate[];
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
    billingRates: [],
  };
}

function optionalNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapBillingRates(raw: unknown): SellerBillingRate[] {
  if (!Array.isArray(raw)) return [];
  const out: SellerBillingRate[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const eventType = String((row as any).event_type || (row as any).eventType || '');
    if (!BILLING_EVENT_TYPES.includes(eventType as BillingEventType)) continue;
    const amount = Number((row as any).amount ?? 0);
    out.push({
      eventType: eventType as BillingEventType,
      amount: Number.isFinite(amount) ? amount : 0,
      enabled: Boolean((row as any).enabled),
    });
  }
  return out;
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
    billingRates: mapBillingRates(row?.billing_rates),
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
