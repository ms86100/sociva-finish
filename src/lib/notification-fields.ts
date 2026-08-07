/**
 * Dual-column helpers for notification payload/data and reference_path/action_url.
 * Writers should emit both; readers should accept either.
 */

export type NotificationFieldBag = {
  data?: Record<string, unknown> | null;
  payload?: Record<string, unknown> | null;
  action_url?: string | null;
  reference_path?: string | null;
};

/** Prefer `data`, fall back to `payload`. */
export function pickNotificationData(
  row: NotificationFieldBag | null | undefined,
): Record<string, unknown> {
  if (!row) return {};
  const d = row.data ?? row.payload;
  if (d && typeof d === 'object' && !Array.isArray(d)) return d as Record<string, unknown>;
  return {};
}

/** Prefer `action_url`, fall back to `reference_path`. */
export function pickNotificationRoute(
  row: NotificationFieldBag | null | undefined,
): string | null {
  if (!row) return null;
  return row.action_url || row.reference_path || null;
}

/** Extract order id from dual payload fields or route path. */
export function pickNotificationOrderId(
  row: NotificationFieldBag | null | undefined,
): string | null {
  const d = pickNotificationData(row);
  const fromData = (d.orderId || d.order_id || d.entity_id) as string | undefined;
  if (fromData) return String(fromData);
  const route = pickNotificationRoute(row);
  const match = route?.match(/\/orders\/([0-9a-f-]{36}|[\w-]+)/i);
  return match?.[1] ?? null;
}

/** Build dual columns for queue / inbox inserts. */
export function dualNotificationColumns(opts: {
  path?: string | null;
  data?: Record<string, unknown> | null;
}): {
  reference_path: string | null;
  action_url: string | null;
  payload: Record<string, unknown>;
  data: Record<string, unknown>;
} {
  const path = opts.path ?? null;
  const body = opts.data && typeof opts.data === 'object' ? { ...opts.data } : {};
  return {
    reference_path: path,
    action_url: path,
    payload: body,
    data: body,
  };
}
