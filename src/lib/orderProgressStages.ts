/**
 * Shared order progress presentation — same 4 visible stages for buyer and seller.
 * Internal order_status / workflow transitions are unchanged; this is display-only.
 */

export type OrderFulfillmentKind = 'delivery' | 'pickup';

export type ProgressStageId = 1 | 2 | 3 | 4;

export type ProgressEndState =
  | 'cancelled'
  | 'rejected'
  | 'failed'
  | 'returned'
  | 'no_show'
  | 'expired';

export interface OrderProgressStageDef {
  id: ProgressStageId;
  key: string;
  label: string;
  shortLabel: string;
}

export interface OrderProgressResolution {
  kind: 'stages' | 'end_state';
  fulfillment: OrderFulfillmentKind;
  /** 1–4 when kind === 'stages' */
  stageId: ProgressStageId | null;
  /** 0-based index into `stages` */
  stageIndex: number;
  stages: OrderProgressStageDef[];
  /** Label for the active stage (or end state) */
  label: string;
  /** Optional clarifying copy (not a 5th rail node), e.g. rider assigned */
  subtext: string | null;
  endState: ProgressEndState | null;
  showCodBanner: boolean;
  /** Presentation progress 0–100 */
  progressPercent: number;
  /** Delivery stage 3 only — map / live tracking eligible */
  isTransitStage: boolean;
}

export const DELIVERY_PROGRESS_STAGES: OrderProgressStageDef[] = [
  { id: 1, key: 'confirmed', label: 'Confirmed', shortLabel: 'Confirmed' },
  { id: 2, key: 'preparing', label: 'Preparing', shortLabel: 'Preparing' },
  { id: 3, key: 'on_the_way', label: 'On the way', shortLabel: 'On the way' },
  { id: 4, key: 'delivered', label: 'Delivered', shortLabel: 'Delivered' },
];

export const PICKUP_PROGRESS_STAGES: OrderProgressStageDef[] = [
  { id: 1, key: 'confirmed', label: 'Confirmed', shortLabel: 'Confirmed' },
  { id: 2, key: 'preparing', label: 'Preparing', shortLabel: 'Preparing' },
  { id: 3, key: 'ready', label: 'Ready for pickup', shortLabel: 'Ready' },
  // Align with self_fulfillment terminal (buyer_received), not delivery's picked_up
  { id: 4, key: 'buyer_received', label: 'Picked up', shortLabel: 'Picked up' },
];

const END_STATES = new Set<string>([
  'cancelled',
  'rejected',
  'failed',
  'returned',
  'no_show',
  'expired',
]);

/** Statuses that mean the order is physically in transit (delivery stage 3). */
export const TRUE_TRANSIT_STATUSES = new Set([
  'picked_up',
  'on_the_way',
  'en_route',
  'arrived',
  'at_gate',
  'in_transit',
]);

/** Platform / pre-pickup statuses that stay in Preparing for delivery (not map). */
const DELIVERY_PRE_TRANSIT_READY = new Set([
  'ready',
  'assigned',
  'ready_for_delivery',
]);

const STAGE1 = new Set([
  'payment_pending',
  'placed',
  'pending',
  'enquired',
  'quoted',
  'requested',
  'scheduled',
  'rescheduled',
]);

const STAGE2_CORE = new Set([
  'accepted',
  'confirmed',
  'preparing',
  'in_progress',
  'processing',
]);

const STAGE4 = new Set([
  'delivered',
  'buyer_received',
  'completed',
  'awaiting_cod_confirmation',
]);

export function resolveFulfillmentKind(
  fulfillmentType?: string | null,
): OrderFulfillmentKind {
  if (
    fulfillmentType === 'self_pickup' ||
    fulfillmentType === 'pickup'
  ) {
    return 'pickup';
  }
  return 'delivery';
}

export function getOrderProgressStages(
  fulfillment: OrderFulfillmentKind,
): OrderProgressStageDef[] {
  return fulfillment === 'pickup'
    ? PICKUP_PROGRESS_STAGES
    : DELIVERY_PROGRESS_STAGES;
}

/**
 * Map gating for Google Maps / live tracking.
 * Delivery only, and only when truly in transit — never for ready/assigned.
 * Honors flow `is_transit` for custom workflow keys, with ready/assigned excluded.
 */
export function isDeliveryMapEligible(
  status: string,
  flowIsTransit?: boolean,
): boolean {
  if (DELIVERY_PRE_TRANSIT_READY.has(status)) return false;
  if (TRUE_TRANSIT_STATUSES.has(status)) return true;
  return flowIsTransit === true;
}

function stagePercent(stageId: ProgressStageId): number {
  switch (stageId) {
    case 1: return 12;
    case 2: return 38;
    case 3: return 72;
    case 4: return 100;
  }
}

function resolveStageId(
  status: string,
  fulfillment: OrderFulfillmentKind,
  flowIsTransit?: boolean,
): ProgressStageId {
  if (STAGE4.has(status)) return 4;
  if (STAGE1.has(status)) return 1;
  if (STAGE2_CORE.has(status)) return 2;

  if (fulfillment === 'pickup') {
    if (
      status === 'ready' ||
      status === 'assigned' ||
      status === 'ready_for_pickup' ||
      status === 'ready_for_delivery'
    ) {
      return 3;
    }
    // Collected / completed (self_fulfillment uses buyer_received, not picked_up)
    if (
      status === 'buyer_received' ||
      status === 'picked_up' ||
      STAGE4.has(status) ||
      TRUE_TRANSIT_STATUSES.has(status)
    ) {
      return 4;
    }
    return 2;
  }

  // Delivery
  if (DELIVERY_PRE_TRANSIT_READY.has(status)) return 2;
  if (TRUE_TRANSIT_STATUSES.has(status) || flowIsTransit) return 3;
  return 2;
}

function deliverySubtext(status: string): string | null {
  if (status === 'assigned') return 'Delivery partner assigned';
  if (status === 'ready' || status === 'ready_for_delivery') {
    return 'Waiting for pickup';
  }
  return null;
}

/**
 * Resolve the shared 4-stage progress presentation for an order status.
 */
export function resolveOrderProgress(options: {
  status: string;
  fulfillmentType?: string | null;
  /** From category_status_flows.is_transit for the current step */
  flowIsTransit?: boolean;
}): OrderProgressResolution {
  const fulfillment = resolveFulfillmentKind(options.fulfillmentType);
  const stages = getOrderProgressStages(fulfillment);
  const status = options.status;

  if (END_STATES.has(status)) {
    const endState = status as ProgressEndState;
    return {
      kind: 'end_state',
      fulfillment,
      stageId: null,
      stageIndex: -1,
      stages,
      label: status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      subtext: null,
      endState,
      showCodBanner: false,
      progressPercent: 0,
      isTransitStage: false,
    };
  }

  const stageId = resolveStageId(status, fulfillment, options.flowIsTransit);
  const stageIndex = stageId - 1;
  const stageDef = stages[stageIndex];
  const showCodBanner = status === 'awaiting_cod_confirmation';
  const isTransitStage =
    fulfillment === 'delivery' &&
    stageId === 3 &&
    isDeliveryMapEligible(status, options.flowIsTransit);

  let subtext: string | null = null;
  if (fulfillment === 'delivery' && stageId === 2) {
    subtext = deliverySubtext(status);
  }
  if (status === 'payment_pending') {
    subtext = 'Complete payment';
  }

  return {
    kind: 'stages',
    fulfillment,
    stageId,
    stageIndex,
    stages,
    label: stageDef.label,
    subtext,
    endState: null,
    showCodBanner,
    progressPercent: stagePercent(stageId),
    isTransitStage,
  };
}

/** Map stage → deriveDisplayStatus-compatible phase */
export function progressStageToPhase(
  resolution: OrderProgressResolution,
): 'placed' | 'preparing' | 'ready' | 'transit' | 'delivered' | 'cancelled' {
  if (resolution.kind === 'end_state') return 'cancelled';
  switch (resolution.stageId) {
    case 1: return 'placed';
    case 2: return 'preparing';
    case 3:
      return resolution.fulfillment === 'pickup' ? 'ready' : 'transit';
    case 4: return 'delivered';
    default: return 'preparing';
  }
}
