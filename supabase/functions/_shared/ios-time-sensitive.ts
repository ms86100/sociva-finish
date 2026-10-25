/**
 * iOS order-alert policy shared by process-notification-queue and
 * send-push-notification.
 *
 * Time Sensitive is not the same as high priority. high_priority still
 * chooses the bell versus the default sound. interruption-level is added
 * only for the two cases below.
 */

export const IOS_APNS_SOUND_FILE = "gate_bell.caf";

const ELIGIBLE_ORDER_STATUSES = ["placed", "enquired", "requested", "confirmed"] as const;

const SELLER_ORDER_EVENT_TYPES = new Set(["order", "order_status", "order_update"]);

const EXCLUDED_EVENT_TYPES = new Set([
  "refund_request",
  "refund",
  "seller_approved",
  "STORE_APPROVED",
  "seller_rejected",
  "seller_suspended",
  "seller_store_submitted",
  "seller_store_under_review",
  "seller_credit_purchased",
  "seller_credit_failed",
]);

const UNACKED_REMINDER_TYPE = "seller_order_status_reminder";
const UNACKED_REMINDER_KIND = "unacked_order";
const SCHEDULED_ACCEPT_REMINDER_KIND = "scheduled_accept";

export interface IosTimeSensitiveInput {
  targetRole?: string | null;
  status?: string | null;
  /** Payload type, when the sender includes one. */
  type?: string | null;
  /** notification_queue.type, when it differs from the payload type. */
  queueType?: string | null;
  reminderType?: string | null;
}

function presentTypes(input: IosTimeSensitiveInput): string[] {
  return [input.type, input.queueType].filter((value): value is string => !!value);
}

/**
 * True only for:
 * - a seller order event whose status is placed, enquired, requested, or confirmed
 * - an unacknowledged-order reminder for an order still in one of those statuses
 *
 * quoted, preparing, buyer alerts, lifecycle notices, refund notices, other
 * reminders, and a bare high_priority flag are not enough.
 */
export function isIosTimeSensitiveSellerAlert(input: IosTimeSensitiveInput): boolean {
  if (input.targetRole !== "seller") return false;

  const status = input.status || "";
  if (!ELIGIBLE_ORDER_STATUSES.includes(status as (typeof ELIGIBLE_ORDER_STATUSES)[number])) {
    return false;
  }

  const types = presentTypes(input);
  if (types.some((type) => EXCLUDED_EVENT_TYPES.has(type))) return false;

  const reminderType = input.reminderType || "";
  if (
    (reminderType === UNACKED_REMINDER_KIND || reminderType === SCHEDULED_ACCEPT_REMINDER_KIND)
    && types.includes(UNACKED_REMINDER_TYPE)
  ) {
    return true;
  }

  // Any other reminder, including a status nudge that still carries an
  // eligible order status, stays a normal alert.
  if (reminderType || types.includes(UNACKED_REMINDER_TYPE)) return false;

  return types.some((type) => SELLER_ORDER_EVENT_TYPES.has(type));
}

/** iOS system sound name. Android keeps the MP3 resource name at the call site. */
export function iosApnsSound(highPriority: boolean): string {
  return highPriority ? IOS_APNS_SOUND_FILE : "default";
}
