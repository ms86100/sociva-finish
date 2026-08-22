/**
 * Scheduled order lifecycle — shared by seller UI, buyer UI, notifications, and board filters.
 * Uses Asia/Kolkata for calendar-day boundaries (matches Sociva ops).
 */

export const SCHEDULED_TZ = 'Asia/Kolkata';
export const DEFAULT_PREP_MINUTES = 60;
export const DEFAULT_CANCEL_CUTOFF_HOURS = 24;

export type ScheduledOrderPhase =
  | 'upcoming'
  | 'due_today'
  | 'preparation_due'
  | 'preparing'
  | 'fulfilling'
  | 'completed'
  | 'cancelled';

export type ScheduledOrderLike = {
  id?: string;
  status?: string | null;
  scheduled_date?: string | null;
  scheduled_time_start?: string | null;
  scheduled_time?: string | null;
  scheduled_time_end?: string | null;
  preparation_start_at?: string | null;
  scheduled_fulfilment_at?: string | null;
  cancellation_cutoff_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export const PRE_FULFILMENT_STATUSES = [
  'placed',
  'pending',
  'payment_pending',
  'accepted',
  'confirmed',
  'scheduled',
  'requested',
  'booked',
  'rescheduled',
] as const;

export const FULFILMENT_STATUSES = [
  'preparing',
  'in_progress',
  'ready',
  'picked_up',
  'on_the_way',
  'at_gate',
  'en_route',
  'assigned',
  'arrived',
  'awaiting_cod_confirmation',
] as const;

export const TERMINAL_STATUSES = [
  'completed',
  'delivered',
  'buyer_received',
  'cancelled',
  'rejected',
  'no_show',
  'returned',
  'failed',
  'expired',
] as const;

export function isScheduledOrder(order: ScheduledOrderLike | null | undefined): boolean {
  return !!order?.scheduled_date;
}

export function istDateString(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHEDULED_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Parse scheduled_date + time as an instant in IST. */
export function getScheduledFulfilmentAt(order: ScheduledOrderLike): Date | null {
  if (!order.scheduled_date) return null;
  if (order.scheduled_fulfilment_at) {
    const parsed = new Date(order.scheduled_fulfilment_at);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const rawTime = order.scheduled_time_start || order.scheduled_time || '12:00';
  const [hh = '12', mm = '00'] = rawTime.slice(0, 5).split(':');
  const iso = `${order.scheduled_date}T${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:00+05:30`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function getPreparationStartAt(
  order: ScheduledOrderLike,
  prepMinutes = DEFAULT_PREP_MINUTES,
): Date | null {
  if (order.preparation_start_at) {
    const parsed = new Date(order.preparation_start_at);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const fulfilment = getScheduledFulfilmentAt(order);
  if (!fulfilment) return null;
  return new Date(fulfilment.getTime() - prepMinutes * 60_000);
}

export function getCancellationCutoffAt(
  order: ScheduledOrderLike,
  cutoffHours = DEFAULT_CANCEL_CUTOFF_HOURS,
): Date | null {
  if (order.cancellation_cutoff_at) {
    const parsed = new Date(order.cancellation_cutoff_at);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const fulfilment = getScheduledFulfilmentAt(order);
  if (!fulfilment) return null;
  return new Date(fulfilment.getTime() - cutoffHours * 60_000);
}

export function daysUntilScheduledDate(scheduledDate: string, now = new Date()): number {
  const today = istDateString(now);
  const a = new Date(`${today}T12:00:00+05:30`).getTime();
  const b = new Date(`${scheduledDate}T12:00:00+05:30`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function isUpcomingScheduled(order: ScheduledOrderLike, now = new Date()): boolean {
  if (!isScheduledOrder(order)) return false;
  const status = order.status || '';
  if (TERMINAL_STATUSES.includes(status as typeof TERMINAL_STATUSES[number])) return false;
  if (FULFILMENT_STATUSES.includes(status as typeof FULFILMENT_STATUSES[number])) return false;
  if (!PRE_FULFILMENT_STATUSES.includes(status as typeof PRE_FULFILMENT_STATUSES[number])) {
    return status === 'scheduled';
  }
  const fulfilment = getScheduledFulfilmentAt(order);
  if (!fulfilment) {
    return daysUntilScheduledDate(order.scheduled_date!, now) > 0;
  }
  const prepStart = getPreparationStartAt(order);
  if (prepStart && now.getTime() >= prepStart.getTime()) return false;
  return fulfilment.getTime() > now.getTime();
}

export function isDueForPreparation(order: ScheduledOrderLike, now = new Date()): boolean {
  if (!isScheduledOrder(order)) return false;
  const status = order.status || '';
  if (TERMINAL_STATUSES.includes(status as typeof TERMINAL_STATUSES[number])) return false;
  if (FULFILMENT_STATUSES.includes(status as typeof FULFILMENT_STATUSES[number])) return false;
  const prepStart = getPreparationStartAt(order);
  if (!prepStart) return false;
  return now.getTime() >= prepStart.getTime();
}

export function resolveScheduledPhase(order: ScheduledOrderLike, now = new Date()): ScheduledOrderPhase {
  const status = order.status || '';
  if (['cancelled', 'rejected', 'expired'].includes(status)) return 'cancelled';
  if (['completed', 'delivered', 'buyer_received'].includes(status)) return 'completed';
  if (FULFILMENT_STATUSES.includes(status as typeof FULFILMENT_STATUSES[number])) {
    return status === 'preparing' || status === 'in_progress' ? 'preparing' : 'fulfilling';
  }
  if (!isScheduledOrder(order)) return 'upcoming';
  if (isDueForPreparation(order, now)) return 'preparation_due';
  if (daysUntilScheduledDate(order.scheduled_date!, now) === 0) return 'due_today';
  if (isUpcomingScheduled(order, now)) return 'upcoming';
  return 'due_today';
}

export function formatScheduledDateTime(order: ScheduledOrderLike): string {
  if (!order.scheduled_date) return '';
  const d = new Date(`${order.scheduled_date}T12:00:00+05:30`);
  const day = d.toLocaleDateString('en-IN', {
    timeZone: SCHEDULED_TZ,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
  const time = order.scheduled_time_start || order.scheduled_time;
  if (!time) return day;
  return `${day} · ${time.slice(0, 5)}`;
}

export function formatPreparationByLine(order: ScheduledOrderLike, prepMinutes = DEFAULT_PREP_MINUTES): string | null {
  const prep = getPreparationStartAt(order, prepMinutes);
  if (!prep) return null;
  return `Start preparing by ${prep.toLocaleTimeString('en-IN', {
    timeZone: SCHEDULED_TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })}`;
}

/** Buyer/seller countdown chip copy. */
export function getScheduledCountdownLabel(order: ScheduledOrderLike, now = new Date()): string {
  const phase = resolveScheduledPhase(order, now);
  const status = order.status || '';

  if (phase === 'completed') return 'Delivered';
  if (phase === 'cancelled') return 'Cancelled';
  if (phase === 'preparing') return 'Preparing your order';
  if (phase === 'fulfilling') {
    if (status === 'ready') return 'Ready for pickup';
    return 'On the way';
  }
  if (phase === 'preparation_due') return 'Preparation due now';

  const fulfilment = getScheduledFulfilmentAt(order);
  if (!fulfilment) {
    const days = daysUntilScheduledDate(order.scheduled_date!, now);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return `${days} days to go`;
  }

  const diffMs = fulfilment.getTime() - now.getTime();
  if (diffMs <= 0) return 'Due now';

  const days = daysUntilScheduledDate(order.scheduled_date!, now);
  if (days > 1) return `${days} days to go`;
  if (days === 1) return 'Tomorrow';

  const hours = Math.floor(diffMs / 3_600_000);
  const mins = Math.floor((diffMs % 3_600_000) / 60_000);
  if (hours >= 2) return 'Today';
  if (hours >= 1) return `Starts in ${hours}h ${mins}m`;
  if (mins >= 1) return `Starts in ${mins} min`;
  return 'Starting soon';
}

export function canBuyerCancelScheduled(order: ScheduledOrderLike, now = new Date()): boolean {
  const cutoff = getCancellationCutoffAt(order);
  if (!cutoff) return true;
  return now.getTime() < cutoff.getTime();
}

export type ScheduledTimelineStep = {
  id: string;
  label: string;
  state: 'done' | 'current' | 'upcoming';
  at?: string | null;
  detail?: string;
};

export function buildScheduledTimeline(
  order: ScheduledOrderLike,
  now = new Date(),
): ScheduledTimelineStep[] {
  const phase = resolveScheduledPhase(order, now);
  const fulfilmentLabel = formatScheduledDateTime(order);
  const prepLine = formatPreparationByLine(order);

  const stepState = (target: ScheduledOrderPhase | ScheduledOrderPhase[]): ScheduledTimelineStep['state'] => {
    const targets = Array.isArray(target) ? target : [target];
    if (targets.includes(phase)) return 'current';
    const orderOf: ScheduledOrderPhase[] = [
      'upcoming', 'due_today', 'preparation_due', 'preparing', 'fulfilling', 'completed',
    ];
    const pi = orderOf.indexOf(phase);
    const ti = Math.min(...targets.map(t => orderOf.indexOf(t)).filter(i => i >= 0));
    if (pi < 0 || ti < 0) return 'upcoming';
    return pi > ti ? 'done' : 'upcoming';
  };

  return [
    {
      id: 'placed',
      label: 'Order placed',
      state: 'done',
      at: order.created_at,
    },
    {
      id: 'confirmed',
      label: 'Seller accepted',
      state: ['accepted', 'confirmed', 'scheduled'].includes(order.status || '') || phase !== 'upcoming'
        ? 'done'
        : stepState(['upcoming']),
      at: order.updated_at,
    },
    {
      id: 'scheduled',
      label: 'Scheduled',
      state: stepState(['upcoming', 'due_today']),
      detail: fulfilmentLabel,
    },
    {
      id: 'preparing',
      label: 'Preparing',
      state: stepState('preparing'),
      detail: prepLine || undefined,
    },
    {
      id: 'ready',
      label: 'Ready / Out for delivery',
      state: stepState('fulfilling'),
    },
    {
      id: 'delivered',
      label: 'Delivered',
      state: phase === 'completed' ? 'done' : 'upcoming',
    },
  ];
}

export function groupUpcomingByDate<T extends ScheduledOrderLike>(
  orders: T[],
  now = new Date(),
): { date: string; label: string; orders: T[] }[] {
  const upcoming = orders
    .filter(o => isScheduledOrder(o) && isUpcomingScheduled(o, now))
    .sort((a, b) => {
      const da = getScheduledFulfilmentAt(a)?.getTime() ?? 0;
      const db = getScheduledFulfilmentAt(b)?.getTime() ?? 0;
      return da - db;
    });

  const map = new Map<string, T[]>();
  for (const o of upcoming) {
    const key = o.scheduled_date!;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(o);
  }

  return [...map.entries()].map(([date, list]) => {
    const days = daysUntilScheduledDate(date, now);
    let label = new Date(`${date}T12:00:00+05:30`).toLocaleDateString('en-IN', {
      timeZone: SCHEDULED_TZ,
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
    if (days === 0) label = `Today · ${label}`;
    else if (days === 1) label = `Tomorrow · ${label}`;
    return { date, label, orders: list };
  });
}
