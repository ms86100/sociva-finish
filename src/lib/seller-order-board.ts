/**
 * Seller ops board taxonomy — single source of truth for KPI cards,
 * OrderFilters chips, and infinite-list filter predicates.
 *
 * Every `order_status` enum value maps to exactly one board bucket
 * (or HIDDEN with an explicit reason). Refunded is an orthogonal overlay
 * filter based on payment_status / refund_requests, not a status bucket.
 *
 * Settled GMV (revenue):
 *   sum(orders.total_amount) where status ∈ completed|delivered|buyer_received
 *   AND payment_status IS DISTINCT FROM 'refunded'
 * Used by dashboard EarningsSummary, SellerEarningsPage overview, and analytics.
 */

export type SellerBoardBucket =
  | 'action_needed'
  | 'enquiries'
  | 'preparing'
  | 'ready'
  | 'in_transit'
  | 'cod_confirm'
  | 'done'
  | 'cancelled'
  | 'no_show'
  | 'terminal_fail'
  | 'hidden';

/** Filter chip values — includes time/overlay filters beyond status buckets. */
export type SellerOrderFilter =
  | 'all'
  | 'today'
  | 'enquiries'
  | 'pending' // action needed
  | 'preparing'
  | 'ready'
  | 'in_transit'
  | 'cod_confirm'
  | 'completed'
  | 'cancelled'
  | 'refunded'
  | 'no_show'
  | 'terminal_fail';

export const SETTLED_STATUSES = ['completed', 'delivered', 'buyer_received'] as const;
export const ACTION_NEEDED_STATUSES = [
  'placed',
  'pending',
  'accepted',
  'confirmed',
  'requested',
  'scheduled',
  'rescheduled',
] as const;
export const ENQUIRY_STATUSES = ['enquired', 'quoted'] as const;
export const PREPARING_STATUSES = ['preparing', 'in_progress'] as const;
export const IN_TRANSIT_STATUSES = [
  'picked_up',
  'on_the_way',
  'at_gate',
  'en_route',
  'assigned',
  'arrived',
] as const;
export const CANCELLED_STATUSES = ['cancelled', 'rejected'] as const;
export const TERMINAL_FAIL_STATUSES = ['returned', 'failed'] as const;

/** Explicit map for documentation / golden tests. */
export const STATUS_TO_BUCKET: Record<string, SellerBoardBucket> = {
  placed: 'action_needed',
  pending: 'action_needed',
  accepted: 'action_needed',
  booked: 'action_needed',
  requested: 'action_needed',
  scheduled: 'action_needed',
  rescheduled: 'action_needed',

  enquired: 'enquiries',
  quoted: 'enquiries',

  preparing: 'preparing',
  in_progress: 'preparing',

  ready: 'ready',

  picked_up: 'in_transit',
  on_the_way: 'in_transit',
  at_gate: 'in_transit',
  en_route: 'in_transit',
  assigned: 'in_transit',
  arrived: 'in_transit',

  awaiting_cod_confirmation: 'cod_confirm',

  completed: 'done',
  delivered: 'done',
  buyer_received: 'done',

  cancelled: 'cancelled',
  rejected: 'cancelled',

  no_show: 'no_show',

  returned: 'terminal_fail',
  failed: 'terminal_fail',

  // Unpaid checkout phantoms — hidden unless buyer_confirmed (handled in resolveBoardBucket)
  payment_pending: 'hidden',
};

export const FILTER_LABELS: Record<SellerOrderFilter, string> = {
  all: 'All',
  today: 'Today',
  enquiries: 'Enquiries',
  pending: 'Action needed',
  preparing: 'Preparing',
  ready: 'Ready for Pickup',
  in_transit: 'In transit',
  cod_confirm: 'COD confirm',
  completed: 'Done',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  no_show: 'No-show',
  terminal_fail: 'Failed',
};

export function resolveBoardBucket(
  status: string,
  paymentStatus?: string | null,
): SellerBoardBucket {
  if (status === 'payment_pending') {
    return paymentStatus === 'buyer_confirmed' ? 'action_needed' : 'hidden';
  }
  return STATUS_TO_BUCKET[status] ?? 'action_needed';
}

export function isSettledRevenueOrder(
  status: string,
  paymentStatus?: string | null,
): boolean {
  return (
    (SETTLED_STATUSES as readonly string[]).includes(status) &&
    paymentStatus !== 'refunded'
  );
}

/**
 * Fulfill latency end timestamp preference:
 * delivered_at > status_changed_at > updated_at
 * (updated_at alone drifts on non-status edits).
 */
export function resolveFulfillEndAt(row: {
  delivered_at?: string | null;
  status_changed_at?: string | null;
  updated_at?: string | null;
}): string | null {
  return row.delivered_at || row.status_changed_at || row.updated_at || null;
}

export function computeFulfillMinutes(
  createdAt: string,
  endAt: string | null | undefined,
): number | null {
  if (!createdAt || !endAt) return null;
  const mins =
    (new Date(endAt).getTime() - new Date(createdAt).getTime()) / 60000;
  if (mins < 0 || mins >= 7 * 24 * 60) return null;
  return mins;
}

export function sellerDisplayStatusLabel(
  status: string,
  rejectionReason?: string | null,
): string | null {
  if ((status === 'cancelled' || status === 'rejected') && rejectionReason) {
    return 'Cancelled (Rejected)';
  }
  if (status === 'rejected') return 'Cancelled (Rejected)';
  if (status === 'ready') return 'Ready for Pickup';
  if (status === 'awaiting_cod_confirmation') return 'Confirm cash';
  return null;
}

/** IST calendar day / week / month start as UTC ISO strings (matches existing dashboard). */
export function getIstPeriodBounds(now = new Date()) {
  const nowIST = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const y = nowIST.getFullYear();
  const m = String(nowIST.getMonth() + 1).padStart(2, '0');
  const d = String(nowIST.getDate()).padStart(2, '0');
  const todayISO = new Date(`${y}-${m}-${d}T00:00:00+05:30`).toISOString();

  const weekStartIST = new Date(nowIST);
  weekStartIST.setDate(weekStartIST.getDate() - weekStartIST.getDay());
  const wy = weekStartIST.getFullYear();
  const wm = String(weekStartIST.getMonth() + 1).padStart(2, '0');
  const wd = String(weekStartIST.getDate()).padStart(2, '0');
  const weekISO = new Date(`${wy}-${wm}-${wd}T00:00:00+05:30`).toISOString();

  const monthISO = new Date(`${y}-${m}-01T00:00:00+05:30`).toISOString();

  return { todayISO, weekISO, monthISO };
}

export interface SellerBoardCounts {
  all: number;
  today: number;
  enquiries: number;
  pending: number;
  preparing: number;
  ready: number;
  in_transit: number;
  cod_confirm: number;
  completed: number;
  cancelled: number;
  refunded: number;
  no_show: number;
  terminal_fail: number;
}

export interface SellerDashboardKpis {
  totalOrders: number;
  pendingOrders: number;
  preparingOrders: number;
  readyOrders: number;
  inTransitOrders: number;
  codConfirmOrders: number;
  completedOrders: number;
  doneToday: number;
  cancelledOrders: number;
  noShowOrders: number;
  terminalFailOrders: number;
  enquiryOrders: number;
  todayOrders: number;
  pendingRefunds: number;
  totalEarnings: number;
  todayEarnings: number;
  weekEarnings: number;
  monthEarnings: number;
  avgFulfillMinutes: number | null;
  cancelRate30d: number;
  refundRate30d: number;
}

export function emptyBoardCounts(): SellerBoardCounts {
  return {
    all: 0,
    today: 0,
    enquiries: 0,
    pending: 0,
    preparing: 0,
    ready: 0,
    in_transit: 0,
    cod_confirm: 0,
    completed: 0,
    cancelled: 0,
    refunded: 0,
    no_show: 0,
    terminal_fail: 0,
  };
}

export function emptyDashboardKpis(): SellerDashboardKpis {
  return {
    totalOrders: 0,
    pendingOrders: 0,
    preparingOrders: 0,
    readyOrders: 0,
    inTransitOrders: 0,
    codConfirmOrders: 0,
    completedOrders: 0,
    doneToday: 0,
    cancelledOrders: 0,
    noShowOrders: 0,
    terminalFailOrders: 0,
    enquiryOrders: 0,
    todayOrders: 0,
    pendingRefunds: 0,
    totalEarnings: 0,
    todayEarnings: 0,
    weekEarnings: 0,
    monthEarnings: 0,
    avgFulfillMinutes: null,
    cancelRate30d: 0,
    refundRate30d: 0,
  };
}

type AggregateRow = {
  status: string;
  payment_status?: string | null;
  total_amount?: number | null;
  created_at: string;
  updated_at?: string | null;
  delivered_at?: string | null;
  status_changed_at?: string | null;
  is_refunded?: boolean;
};

/**
 * Client-side aggregate mirroring RPC semantics (fallback when RPC unavailable).
 */
export function aggregateSellerBoardFromOrders(
  rows: AggregateRow[],
  opts?: { pendingRefunds?: number; now?: Date },
): { kpis: SellerDashboardKpis; counts: SellerBoardCounts } {
  const { todayISO, weekISO, monthISO } = getIstPeriodBounds(opts?.now);
  const thirtyDaysAgo = new Date((opts?.now ?? new Date()).getTime() - 30 * 86400000).toISOString();

  const counts = emptyBoardCounts();
  const kpis = emptyDashboardKpis();
  kpis.pendingRefunds = opts?.pendingRefunds ?? 0;

  let cancel30 = 0;
  let refund30 = 0;
  let considered30 = 0;
  let fulfillSum = 0;
  let fulfillN = 0;

  for (const row of rows) {
    const bucket = resolveBoardBucket(row.status, row.payment_status);
    if (bucket === 'hidden') continue;

    const amt = Number(row.total_amount) || 0;
    const isToday = row.created_at >= todayISO;
    const isWeek = row.created_at >= weekISO;
    const isMonth = row.created_at >= monthISO;
    const isRefunded = row.is_refunded || row.payment_status === 'refunded';

    counts.all++;
    kpis.totalOrders++;
    if (isToday) {
      counts.today++;
      kpis.todayOrders++;
    }
    if (isRefunded) counts.refunded++;

    switch (bucket) {
      case 'action_needed':
        counts.pending++;
        kpis.pendingOrders++;
        break;
      case 'enquiries':
        counts.enquiries++;
        kpis.enquiryOrders++;
        break;
      case 'preparing':
        counts.preparing++;
        kpis.preparingOrders++;
        break;
      case 'ready':
        counts.ready++;
        kpis.readyOrders++;
        break;
      case 'in_transit':
        counts.in_transit++;
        kpis.inTransitOrders++;
        break;
      case 'cod_confirm':
        counts.cod_confirm++;
        kpis.codConfirmOrders++;
        break;
      case 'done':
        counts.completed++;
        kpis.completedOrders++;
        if (isToday) kpis.doneToday++;
        break;
      case 'cancelled':
        counts.cancelled++;
        kpis.cancelledOrders++;
        break;
      case 'no_show':
        counts.no_show++;
        kpis.noShowOrders++;
        break;
      case 'terminal_fail':
        counts.terminal_fail++;
        kpis.terminalFailOrders++;
        break;
      default:
        break;
    }

    if (isSettledRevenueOrder(row.status, row.payment_status)) {
      kpis.totalEarnings += amt;
      if (isToday) kpis.todayEarnings += amt;
      if (isWeek) kpis.weekEarnings += amt;
      if (isMonth) kpis.monthEarnings += amt;

      const mins = computeFulfillMinutes(
        row.created_at,
        resolveFulfillEndAt(row),
      );
      if (mins != null) {
        fulfillSum += mins;
        fulfillN++;
      }
    }

    if (row.created_at >= thirtyDaysAgo) {
      considered30++;
      if (bucket === 'cancelled' || bucket === 'terminal_fail' || bucket === 'no_show') cancel30++;
      if (isRefunded) refund30++;
    }
  }

  kpis.avgFulfillMinutes = fulfillN > 0 ? Math.round(fulfillSum / fulfillN) : null;
  kpis.cancelRate30d = considered30 > 0 ? Math.round((cancel30 / considered30) * 100) : 0;
  kpis.refundRate30d = considered30 > 0 ? Math.round((refund30 / considered30) * 100) : 0;

  return { kpis, counts };
}

/** Status list for PostgREST `.in('status', …)` for a given filter (non-overlay). */
export function statusesForFilter(filter: SellerOrderFilter): string[] | null {
  switch (filter) {
    case 'enquiries':
      return [...ENQUIRY_STATUSES];
    case 'pending':
      return [...ACTION_NEEDED_STATUSES];
    case 'preparing':
      return [...PREPARING_STATUSES];
    case 'ready':
      return ['ready'];
    case 'in_transit':
      return [...IN_TRANSIT_STATUSES];
    case 'cod_confirm':
      return ['awaiting_cod_confirmation'];
    case 'completed':
      return [...SETTLED_STATUSES];
    case 'cancelled':
      return [...CANCELLED_STATUSES];
    case 'no_show':
      return ['no_show'];
    case 'terminal_fail':
      return [...TERMINAL_FAIL_STATUSES];
    default:
      return null;
  }
}

/** Map KPI card id → order filter for click-through. */
export const KPI_TO_FILTER: Record<string, SellerOrderFilter> = {
  action_needed: 'pending',
  preparing: 'preparing',
  in_transit: 'in_transit',
  done_today: 'completed',
  terminal_fail: 'terminal_fail',
  ready: 'ready',
  cod_confirm: 'cod_confirm',
  cancelled: 'cancelled',
};

/**
 * Sentinel for multi-store portfolio mode (SellerSwitcher “All stores”).
 * Never pass this to PostgREST `.eq('seller_id', …)` — resolve real UUIDs first.
 */
export const ALL_STORES_ID = '__all_stores__';

export function isPortfolioSellerId(sellerId: string | null | undefined): boolean {
  return sellerId === ALL_STORES_ID;
}

/** Real store UUID for ops pages, or null when portfolio / unset. */
export function resolveOperationalSellerId(
  currentSellerId: string | null | undefined,
  sellerProfiles: { id: string }[],
): string | null {
  if (isPortfolioSellerId(currentSellerId)) return null;
  if (currentSellerId) return currentSellerId;
  return sellerProfiles[0]?.id ?? null;
}

export function sumDashboardKpis(parts: SellerDashboardKpis[]): SellerDashboardKpis {
  const out = emptyDashboardKpis();
  if (parts.length === 0) return out;

  let fulfillWeighted = 0;
  let fulfillWeight = 0;
  let cancelWeighted = 0;
  let refundWeighted = 0;
  let rateWeight = 0;

  for (const p of parts) {
    out.totalOrders += p.totalOrders;
    out.pendingOrders += p.pendingOrders;
    out.preparingOrders += p.preparingOrders;
    out.readyOrders += p.readyOrders;
    out.inTransitOrders += p.inTransitOrders;
    out.codConfirmOrders += p.codConfirmOrders;
    out.completedOrders += p.completedOrders;
    out.doneToday += p.doneToday;
    out.cancelledOrders += p.cancelledOrders;
    out.noShowOrders += p.noShowOrders;
    out.terminalFailOrders += p.terminalFailOrders;
    out.enquiryOrders += p.enquiryOrders;
    out.todayOrders += p.todayOrders;
    out.pendingRefunds += p.pendingRefunds;
    out.totalEarnings += p.totalEarnings;
    out.todayEarnings += p.todayEarnings;
    out.weekEarnings += p.weekEarnings;
    out.monthEarnings += p.monthEarnings;

    if (p.avgFulfillMinutes != null && p.completedOrders > 0) {
      fulfillWeighted += p.avgFulfillMinutes * p.completedOrders;
      fulfillWeight += p.completedOrders;
    }
    // Weight rates by totalOrders as proxy for 30d considered volume
    if (p.totalOrders > 0) {
      cancelWeighted += p.cancelRate30d * p.totalOrders;
      refundWeighted += p.refundRate30d * p.totalOrders;
      rateWeight += p.totalOrders;
    }
  }

  out.avgFulfillMinutes =
    fulfillWeight > 0 ? Math.round(fulfillWeighted / fulfillWeight) : null;
  out.cancelRate30d = rateWeight > 0 ? Math.round(cancelWeighted / rateWeight) : 0;
  out.refundRate30d = rateWeight > 0 ? Math.round(refundWeighted / rateWeight) : 0;
  return out;
}

export function sumBoardCounts(parts: SellerBoardCounts[]): SellerBoardCounts {
  const out = emptyBoardCounts();
  for (const p of parts) {
    out.all += p.all;
    out.today += p.today;
    out.enquiries += p.enquiries;
    out.pending += p.pending;
    out.preparing += p.preparing;
    out.ready += p.ready;
    out.in_transit += p.in_transit;
    out.cod_confirm += p.cod_confirm;
    out.completed += p.completed;
    out.cancelled += p.cancelled;
    out.refunded += p.refunded;
    out.no_show += p.no_show;
    out.terminal_fail += p.terminal_fail;
  }
  return out;
}
