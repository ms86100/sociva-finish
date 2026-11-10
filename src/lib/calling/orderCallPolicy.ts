/** Active commerce / booking / contact statuses that may place an in-app call. */
export const ORDER_CALLABLE_STATUSES = [
  'placed',
  'accepted',
  'preparing',
  'ready',
  'picked_up',
  'on_the_way',
  'at_gate',
  'arrived',
  'assigned',
  'en_route',
  'in_progress',
  'payment_pending',
  'awaiting_cod_confirmation',
  'enquired',
  'quoted',
  'requested',
  'scheduled',
  'confirmed',
  'rescheduled',
] as const;

export const ORDER_NON_CALLABLE_STATUSES = [
  'cancelled',
  'completed',
  'delivered',
  'refunded',
  'rejected',
  'expired',
  'failed',
  'returned',
  'no_show',
] as const;

export type OrderCallableStatus = (typeof ORDER_CALLABLE_STATUSES)[number];

export function isOrderStatusCallable(status: string | null | undefined): boolean {
  if (!status) return false;
  return (ORDER_CALLABLE_STATUSES as readonly string[]).includes(status);
}

/** UI gate: order must be active and LiveKit VoIP must be ready. */
export function canPlaceOrderCall(
  orderStatus: string | null | undefined,
  voipCaps: { can_place_calls?: boolean } | null | undefined,
): boolean {
  return isOrderStatusCallable(orderStatus) && voipCaps?.can_place_calls === true;
}

export const ORDER_CALL_HONESTY = 'In-app call - numbers stay private';

/** Soft caps mirrored in voip_start_call / voip_heartbeat. */
export const ORDER_CALL_MAX_DURATION_SECONDS = 10 * 60;
export const ORDER_CALL_MAX_PER_HOUR = 3;
