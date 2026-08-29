import type { ProductActionType } from '@/types/Database';

export type ListingGlanceKind = 'product' | 'booking' | 'enquiry' | 'contact';

const FULFILLMENT_LABEL: Record<string, string> = {
  self_pickup: 'Pickup',
  delivery: 'Delivery',
  both: 'Pickup or delivery',
  home_visit: 'Home visit',
  at_store: 'At store',
  online: 'Online',
  seller_delivery: 'Delivery',
};

export function listingGlanceKind(action: ProductActionType | string | null | undefined): ListingGlanceKind {
  if (action === 'contact_seller') return 'contact';
  if (action === 'request_service' || action === 'request_quote' || action === 'make_offer') return 'enquiry';
  if (action === 'book' || action === 'schedule_visit') return 'booking';
  return 'product';
}

export function fulfillmentGlanceLabel(mode: string | null | undefined): string | null {
  if (!mode) return null;
  return FULFILLMENT_LABEL[mode] || mode.replace(/_/g, ' ');
}

/** One discount number. Never pair a badge with a second "% off" next to the price. */
export function listingDiscountPercent(
  price: number,
  mrp?: number | null,
  storedPercent?: number | null,
): number {
  if (storedPercent && storedPercent > 0 && mrp && mrp > price) return Math.round(storedPercent);
  if (mrp && mrp > price) return Math.round(((mrp - price) / mrp) * 100);
  return 0;
}

export function shouldShowStockLeft(stock: number | null | undefined, lowStockThreshold = 8): boolean {
  if (stock == null || stock <= 0) return false;
  return stock <= lowStockThreshold;
}

/**
 * At most two short facts a buyer can use in a glance.
 * Skip facts already covered by overlays (closed / out of stock).
 */
export function listingGlanceFacts(product: {
  serving_size?: string | null;
  unit_type?: string | null;
  price_per_unit?: string | null;
  stock_quantity?: number | null;
  prep_time_minutes?: number | null;
  delivery_time_text?: string | null;
  service_duration_minutes?: number | null;
  fulfillment_mode?: string | null;
  service_scope?: string | null;
  description?: string | null;
  avg_response_minutes?: number | null;
  visit_charge?: number | null;
  seller_is_available?: boolean | null;
}, kind: ListingGlanceKind): string[] {
  const facts: string[] = [];

  if (kind === 'product') {
    const serving = product.serving_size?.trim();
    if (serving) facts.push(serving.toLowerCase().startsWith('serves') ? serving : `Serves ${serving}`);
    else if (product.price_per_unit) facts.push(product.price_per_unit);
    else if (product.unit_type) facts.push(product.unit_type);
    if (shouldShowStockLeft(product.stock_quantity)) facts.push(`${product.stock_quantity} left`);
    const eta = product.delivery_time_text || (product.prep_time_minutes ? `${product.prep_time_minutes} min` : null);
    if (eta && facts.length < 2) facts.push(eta);
    const fulfill = fulfillmentGlanceLabel(product.fulfillment_mode);
    if (fulfill && facts.length < 2) facts.push(fulfill);
  }

  if (kind === 'booking') {
    if (product.seller_is_available === true) facts.push('Available today');
    if (product.service_duration_minutes) facts.push(`${product.service_duration_minutes} min`);
    const fulfill = fulfillmentGlanceLabel(product.fulfillment_mode);
    if (fulfill && facts.length < 2) facts.push(fulfill);
    if (facts.length < 2 && product.visit_charge) facts.push('Home visit extra');
  }

  if (kind === 'enquiry' || kind === 'contact') {
    const mins = Number(product.avg_response_minutes);
    if (mins > 0) facts.push(mins <= 15 ? `Replies in ~${mins}m` : 'Usually replies');
    const fulfill = fulfillmentGlanceLabel(product.fulfillment_mode);
    if (fulfill) facts.push(fulfill);
    const scope = (product.service_scope || '').replace(/\s+/g, ' ').trim();
    if (scope && facts.length < 2) facts.push(scope.length > 36 ? `${scope.slice(0, 34)}…` : scope);
  }

  return facts.slice(0, 2);
}
