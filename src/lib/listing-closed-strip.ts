import { computeStoreStatus, formatStoreClosedMessage } from '@/lib/store-availability';
import { canScheduleWhileClosed, scheduleHoursFromProduct } from '@/lib/store-schedule';
import { listingStoreChip } from '@/lib/listing-trust';

export type ClosedStripProduct = {
  seller_id?: string | null;
  seller_name?: string | null;
  seller_availability_start?: string | null;
  seller_availability_end?: string | null;
  seller_operating_days?: string[] | null;
  seller_is_available?: boolean | null;
  seller_vacation_mode?: boolean | null;
  vacation_mode?: boolean | null;
  prep_time_minutes?: number | null;
};

export type ListingClosedStripModel = {
  message: string;
  hint: string;
};

/**
 * Page-level closed banner when enough scheduleable closed listings are in view.
 * Avoids repeating a truncated "Closed today..." chip on every tiny card.
 */
export function buildListingClosedStrip(
  products: ClosedStripProduct[],
): ListingClosedStripModel | null {
  if (!products.length) return null;

  const closed: { message: string; sellerId: string; sellerName: string }[] = [];
  for (const product of products) {
    const availability = computeStoreStatus(
      product.seller_availability_start,
      product.seller_availability_end,
      product.seller_operating_days,
      product.seller_is_available ?? true,
    );
    if (availability.status === 'open' || availability.status === 'paused') continue;
    const hours = scheduleHoursFromProduct(product as any);
    if (hours.vacationMode) continue;
    if (!canScheduleWhileClosed(availability.status, hours.vacationMode)) continue;
    const message = formatStoreClosedMessage(availability);
    if (!message) continue;
    closed.push({
      message,
      sellerId: String(product.seller_id || ''),
      sellerName: listingStoreChip(product.seller_name) || 'this kitchen',
    });
  }

  if (closed.length === 0) return null;
  const share = closed.length / products.length;
  if (closed.length < 2 && share < 0.35) return null;

  const messageCounts = new Map<string, number>();
  for (const row of closed) {
    messageCounts.set(row.message, (messageCounts.get(row.message) || 0) + 1);
  }
  let message = closed[0].message;
  let best = 0;
  for (const [msg, count] of messageCounts) {
    if (count > best) {
      best = count;
      message = msg;
    }
  }

  const sellerIds = new Set(closed.map((row) => row.sellerId).filter(Boolean));
  const hint = sellerIds.size === 1
    ? `Schedule for later from ${closed[0].sellerName}`
    : 'Schedule ahead - kitchens still take orders';

  return { message, hint };
}
