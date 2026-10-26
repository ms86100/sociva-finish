/**
 * Pure seller reminder / acceptance-window policy.
 * Used by send-seller-status-reminders and Vitest (no Deno APIs).
 *
 * Instant orders: unacked reminders at ~10m and ~20m; cancel at authoritative
 * auto_cancel_at (system_settings.order_acceptance_timeout_seconds = 1800).
 * Scheduled far-future: no overnight unacked; morning accept slots before deadline.
 */

export const INSTANT_ACCEPTANCE_TIMEOUT_SECONDS = 1800;
export const UNACKED_REMINDER_OFFSETS_MIN = [10, 20] as const;
/** Minutes before auto_cancel_at / prep for scheduled morning accept bells. */
export const SCHEDULED_MORNING_OFFSETS_MIN = [180, 120, 60] as const;
export const CLOSED_STORE_CANCEL_GAP_MS = 45 * 60_000;
export const SELLER_TZ_DEFAULT = "Asia/Kolkata";

export const INSTANT_UNACKED_STATUSES = [
  "placed",
  "enquired",
  "requested",
  "quoted",
] as const;

export const SCHEDULED_ACCEPT_STATUSES = [
  "placed",
  "pending",
  "requested",
] as const;

export type DeliveryEvidenceLevel =
  | "event_created"
  | "job_persisted"
  | "worker_executed"
  | "provider_accepted"
  | "provider_failed"
  | "no_tokens"
  | "device_delivery_unknown"
  | "seller_resolved"
  | "reminder_suppressed_resolved";

export type AudibleEvidence = "unknown" | "not_applicable";

/**
 * Map queue push counters to honest evidence.
 * Provider accept is never treated as device delivery or audible success.
 */
export function classifyPushDeliveryEvidence(input: {
  pushAttempted?: boolean | null;
  pushSuccessCount?: number | null;
  pushFailCount?: number | null;
  pushSkipReason?: string | null;
  orderTerminal?: boolean | null;
  reminderSuppressed?: boolean | null;
}): {
  level: DeliveryEvidenceLevel;
  deviceDelivery: "unknown" | "not_observed";
  audible: AudibleEvidence;
  label: string;
} {
  if (input.reminderSuppressed) {
    return {
      level: "reminder_suppressed_resolved",
      deviceDelivery: "not_observed",
      audible: "not_applicable",
      label: "Reminder suppressed after order resolved",
    };
  }
  if (input.orderTerminal) {
    return {
      level: "seller_resolved",
      deviceDelivery: "not_observed",
      audible: "not_applicable",
      label: "Order resolved (accept / reject / cancel)",
    };
  }
  const skip = (input.pushSkipReason || "").toLowerCase();
  if (skip.includes("no_token")) {
    return {
      level: "no_tokens",
      deviceDelivery: "not_observed",
      audible: "not_applicable",
      label: "No device tokens",
    };
  }
  if (input.pushAttempted && (input.pushFailCount || 0) > 0 && (input.pushSuccessCount || 0) === 0) {
    return {
      level: "provider_failed",
      deviceDelivery: "not_observed",
      audible: "unknown",
      label: "Provider rejected or failed all tokens",
    };
  }
  if (input.pushAttempted && (input.pushSuccessCount || 0) > 0) {
    return {
      level: "provider_accepted",
      deviceDelivery: "unknown",
      audible: "unknown",
      label: "Provider accepted push (device delivery and audible bell unknown)",
    };
  }
  if (input.pushAttempted) {
    return {
      level: "worker_executed",
      deviceDelivery: "unknown",
      audible: "unknown",
      label: "Worker ran; no provider success recorded",
    };
  }
  return {
    level: "job_persisted",
    deviceDelivery: "not_observed",
    audible: "unknown",
    label: "Notification job persisted; push not yet evidenced",
  };
}

/** Instant unacked bucket: 1 at >=10m, 2 at >=20m. Zero before 10m. */
export function unackedBucket(ageMs: number, nowMs: number = ageMs): number {
  void nowMs;
  if (ageMs >= UNACKED_REMINDER_OFFSETS_MIN[1] * 60_000) return 2;
  if (ageMs >= UNACKED_REMINDER_OFFSETS_MIN[0] * 60_000) return 1;
  return 0;
}

export function unackedIdempotencyKey(orderId: string, bucket: number): string {
  const minutes = bucket === 2 ? 20 : 10;
  return `${orderId}-unacked-${minutes}m`;
}

export function isFarFutureScheduled(
  row: {
    scheduled_date?: string | null;
    auto_cancel_at?: string | null;
    created_at?: string | null;
    status_changed_at?: string | null;
    preparation_start_at?: string | null;
  },
  nowMs: number = Date.now(),
): boolean {
  if (!row.scheduled_date) return false;
  const cancel = row.auto_cancel_at ? new Date(row.auto_cancel_at).getTime() : NaN;
  const created = new Date(row.created_at || row.status_changed_at || 0).getTime();
  if (Number.isFinite(cancel) && Number.isFinite(created) && cancel - created > CLOSED_STORE_CANCEL_GAP_MS) {
    return true;
  }
  const prep = row.preparation_start_at ? new Date(row.preparation_start_at).getTime() : NaN;
  return Number.isFinite(prep) && prep - nowMs > 20 * 60_000;
}

export function scheduledAcceptDeadlineMs(row: {
  auto_cancel_at?: string | null;
  preparation_start_at?: string | null;
  scheduled_fulfillment_at?: string | null;
}): number | null {
  for (const raw of [row.auto_cancel_at, row.preparation_start_at, row.scheduled_fulfillment_at]) {
    if (!raw) continue;
    const t = new Date(raw).getTime();
    if (Number.isFinite(t)) return t;
  }
  return null;
}

export type MorningAcceptSlot = {
  offsetMin: number;
  atMs: number;
  idempotencyKey: string;
};

/**
 * Morning (pre-deadline) accept reminder slots.
 * Uses fixed offsets before the authoritative deadline. Drops slots that are
 * not useful: already past, after deadline, or before order creation + 2m.
 * Near-deadline orders keep only remaining meaningful slots (never burst three at once via one key).
 */
export function computeMorningAcceptSlots(
  orderId: string,
  deadlineMs: number,
  createdMs: number,
  nowMs: number = Date.now(),
): MorningAcceptSlot[] {
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(createdMs)) return [];
  const minUsefulGapMs = 2 * 60_000;
  const slots: MorningAcceptSlot[] = [];
  for (const offsetMin of SCHEDULED_MORNING_OFFSETS_MIN) {
    const atMs = deadlineMs - offsetMin * 60_000;
    if (atMs >= deadlineMs) continue;
    if (atMs < createdMs + minUsefulGapMs) continue;
    // Only due slots are returned for enqueue; future slots stay for planning tests.
    slots.push({
      offsetMin,
      atMs,
      idempotencyKey: `${orderId}-scheduled_accept-m${offsetMin}`,
    });
  }
  return slots;
}

/** Slots that should fire at nowMs (due and before deadline). */
export function dueMorningAcceptSlots(
  orderId: string,
  deadlineMs: number,
  createdMs: number,
  nowMs: number,
): MorningAcceptSlot[] {
  return computeMorningAcceptSlots(orderId, deadlineMs, createdMs, nowMs).filter(
    (s) => nowMs >= s.atMs && nowMs < deadlineMs,
  );
}

/**
 * Would overnight unacked fire for a next-day scheduled order under this policy?
 * Used for historical incident verification (#bcce1b63).
 */
export function wouldEnqueueOvernightUnacked(row: {
  scheduled_date?: string | null;
  auto_cancel_at?: string | null;
  created_at?: string | null;
  status_changed_at?: string | null;
  preparation_start_at?: string | null;
  status?: string | null;
}, ageMs: number, nowMs: number): boolean {
  const status = row.status || "placed";
  if (!(INSTANT_UNACKED_STATUSES as readonly string[]).includes(status)) return false;
  if (isFarFutureScheduled(row, nowMs)) return false;
  return unackedBucket(ageMs) > 0;
}
