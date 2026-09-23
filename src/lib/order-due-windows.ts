import { IN_TRANSIT_STATUSES, SETTLED_STATUSES, CANCELLED_STATUSES, TERMINAL_FAIL_STATUSES } from '@/lib/seller-order-board';

export const TRANSIT_OVERDUE_MS = 90 * 60 * 1000;
export const TRANSIT_STUCK_MS = 6 * 60 * 60 * 1000;

const TRANSIT = new Set<string>(IN_TRANSIT_STATUSES);
const DONE = new Set<string>(SETTLED_STATUSES);
const CANCELLED = new Set<string>([...CANCELLED_STATUSES, ...TERMINAL_FAIL_STATUSES, 'no_show']);

export type SellerReceivedFilter =
  | 'all'
  | 'pending'
  | 'preparing'
  | 'in_transit'
  | 'completed'
  | 'cancelled'
  | 'due_1h'
  | 'due_2h'
  | 'overdue';

export const SELLER_RECEIVED_FILTER_LABELS: Record<SellerReceivedFilter, string> = {
  all: 'All',
  pending: 'Needs action',
  preparing: 'Preparing',
  in_transit: 'In transit',
  completed: 'Delivered',
  cancelled: 'Cancelled',
  due_1h: 'Due < 1h',
  due_2h: 'Due < 2h',
  overdue: 'Overdue',
};

export interface DueWindowOrder {
  status?: string | null;
  created_at?: string | null;
  status_changed_at?: string | null;
  preparation_start_at?: string | null;
  scheduled_fulfillment_at?: string | null;
  estimated_delivery_at?: string | null;
  updated_at?: string | null;
}

function parseTs(raw?: string | null): number | null {
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Soonest actionable deadline for prep / delivery. */
export function resolveOrderDueAt(order: DueWindowOrder, now = Date.now()): number | null {
  const candidates = [
    parseTs(order.preparation_start_at),
    parseTs(order.scheduled_fulfillment_at),
    parseTs(order.estimated_delivery_at),
  ].filter((t): t is number => t != null);
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

export function isOrderTerminalish(status: string): boolean {
  const s = (status || '').toLowerCase();
  return DONE.has(s) || CANCELLED.has(s);
}

export function isInTransitStatus(status: string): boolean {
  return TRANSIT.has((status || '').toLowerCase());
}

export function transitAgeMs(order: DueWindowOrder, now = Date.now()): number | null {
  if (!isInTransitStatus(String(order.status || ''))) return null;
  const start =
    parseTs(order.status_changed_at) ||
    parseTs(order.updated_at) ||
    parseTs(order.created_at);
  if (start == null) return null;
  return Math.max(0, now - start);
}

export function isTransitOverdue(order: DueWindowOrder, now = Date.now()): boolean {
  const age = transitAgeMs(order, now);
  if (age != null && age >= TRANSIT_OVERDUE_MS) return true;
  const dueAt = resolveOrderDueAt(order, now);
  if (dueAt != null && dueAt < now && !isOrderTerminalish(String(order.status || ''))) {
    return true;
  }
  return false;
}

export function matchesDueWindow(
  order: DueWindowOrder,
  window: 'due_1h' | 'due_2h' | 'overdue',
  now = Date.now(),
): boolean {
  if (isOrderTerminalish(String(order.status || ''))) return false;
  if (window === 'overdue') return isTransitOverdue(order, now);

  const dueAt = resolveOrderDueAt(order, now);
  if (dueAt == null) {
    // No explicit due - treat prep-due transit age as soft due
    const age = transitAgeMs(order, now);
    if (age == null) return false;
    if (window === 'due_1h') return age < 60 * 60 * 1000;
    return age < 2 * 60 * 60 * 1000;
  }
  const delta = dueAt - now;
  if (delta < 0) return false;
  if (window === 'due_1h') return delta <= 60 * 60 * 1000;
  return delta <= 2 * 60 * 60 * 1000;
}

export function formatTransitAgeChip(order: DueWindowOrder, now = Date.now()): {
  label: string;
  tone: 'ok' | 'warn' | 'danger';
} | null {
  const age = transitAgeMs(order, now);
  if (age == null) return null;
  const mins = Math.floor(age / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  let label: string;
  if (days >= 1) label = `Stuck ${days}d`;
  else if (hours >= 1) label = `In transit ${hours}h`;
  else label = `In transit ${Math.max(1, mins)}m`;

  if (age >= TRANSIT_STUCK_MS) return { label, tone: 'danger' };
  if (age >= TRANSIT_OVERDUE_MS) return { label: hours >= 1 ? `Overdue ${hours}h` : `Overdue ${mins}m`, tone: 'warn' };
  return { label, tone: 'ok' };
}

export function matchesSellerReceivedFilter(
  order: DueWindowOrder & { status?: string | null },
  filter: SellerReceivedFilter,
  now = Date.now(),
): boolean {
  const status = String(order.status || '').toLowerCase();
  switch (filter) {
    case 'all':
      return true;
    case 'pending':
      return ['placed', 'pending', 'accepted', 'confirmed', 'scheduled', 'requested', 'rescheduled', 'booked'].includes(status);
    case 'preparing':
      return ['preparing', 'in_progress', 'ready'].includes(status);
    case 'in_transit':
      return isInTransitStatus(status);
    case 'completed':
      return DONE.has(status);
    case 'cancelled':
      return CANCELLED.has(status);
    case 'due_1h':
      return matchesDueWindow(order, 'due_1h', now);
    case 'due_2h':
      return matchesDueWindow(order, 'due_2h', now);
    case 'overdue':
      return matchesDueWindow(order, 'overdue', now);
    default:
      return true;
  }
}

export function countSellerReceivedFilters(
  orders: DueWindowOrder[],
  now = Date.now(),
): Record<SellerReceivedFilter, number> {
  const keys: SellerReceivedFilter[] = [
    'all', 'pending', 'preparing', 'in_transit', 'completed', 'cancelled', 'due_1h', 'due_2h', 'overdue',
  ];
  const counts = Object.fromEntries(keys.map((k) => [k, 0])) as Record<SellerReceivedFilter, number>;
  for (const order of orders) {
    for (const key of keys) {
      if (matchesSellerReceivedFilter(order, key, now)) counts[key] += 1;
    }
  }
  return counts;
}
