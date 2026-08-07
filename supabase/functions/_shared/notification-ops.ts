/**
 * Shared notification helpers for edge functions (quiet hours, rate limits, DLQ).
 */

export function isWithinQuietHours(opts: {
  enabled?: boolean | null;
  startHour?: number | null;
  endHour?: number | null;
  timezone?: string | null;
  now?: Date;
}): boolean {
  if (!opts.enabled) return false;
  const start = Number.isFinite(opts.startHour as number) ? Number(opts.startHour) : 22;
  const end = Number.isFinite(opts.endHour as number) ? Number(opts.endHour) : 7;
  const tz = opts.timezone || "Asia/Kolkata";
  const now = opts.now || new Date();

  let hour: number;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).formatToParts(now);
    hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
    if (hour === 24) hour = 0;
  } catch {
    hour = now.getUTCHours();
  }

  if (start === end) return true; // full-day quiet if misconfigured equal
  if (start < end) return hour >= start && hour < end;
  // wraps midnight e.g. 22–7
  return hour >= start || hour < end;
}

export function pnqLog(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ts: new Date().toISOString(), ...fields }));
}

export async function moveToDeadLetter(
  supabase: { from: (t: string) => any },
  item: {
    id: string;
    user_id?: string;
    type?: string;
    title?: string;
    body?: string;
    reference_path?: string | null;
    payload?: Record<string, unknown> | null;
    retry_count?: number;
    last_error?: string | null;
    push_skip_reason?: string | null;
  },
): Promise<void> {
  try {
    await supabase.from("notification_dead_letter").insert({
      queue_item_id: item.id,
      user_id: item.user_id ?? null,
      type: item.type ?? null,
      title: item.title ?? null,
      body: item.body ?? null,
      reference_path: item.reference_path ?? null,
      payload: item.payload ?? {},
      retry_count: item.retry_count ?? null,
      last_error: item.last_error ?? null,
      push_skip_reason: item.push_skip_reason ?? null,
    });
    pnqLog("dlq_insert", { queue_item_id: item.id, type: item.type, last_error: item.last_error });
  } catch (e) {
    console.warn("[PNQ] DLQ insert failed:", e);
  }
}

export async function updateTokenHealth(
  supabase: { from: (t: string) => any },
  tokenRecord: {
    id: string;
    health_score?: number | null;
    consecutive_failures?: number | null;
    invalid_count?: number | null;
  },
  result: { success: boolean; error?: string },
): Promise<void> {
  try {
    if (result.success) {
      await supabase.from("device_tokens").update({
        health_score: 100,
        consecutive_failures: 0,
        last_success_at: new Date().toISOString(),
        last_error_code: null,
        invalid: false,
      }).eq("id", tokenRecord.id);
      return;
    }

    const failures = (tokenRecord.consecutive_failures || 0) + 1;
    const health = Math.max(0, 100 - failures * 20);
    const isInvalid = result.error === "INVALID_TOKEN";
    const shouldPrune = isInvalid || failures >= 5 || health <= 10;

    await supabase.from("device_tokens").update({
      health_score: health,
      consecutive_failures: failures,
      last_error_code: result.error || "unknown",
      invalid: shouldPrune,
      invalid_count: (tokenRecord.invalid_count || 0) + (isInvalid || shouldPrune ? 1 : 0),
    }).eq("id", tokenRecord.id);

    pnqLog("token_health_update", {
      token_id: tokenRecord.id,
      health_score: health,
      consecutive_failures: failures,
      invalid: shouldPrune,
      error: result.error || null,
    });
  } catch (e) {
    console.warn("[PNQ] token health update failed:", e);
  }
}
