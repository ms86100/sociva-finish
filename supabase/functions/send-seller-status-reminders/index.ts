import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";
import {
  INSTANT_UNACKED_STATUSES,
  SCHEDULED_ACCEPT_STATUSES,
  dueMorningAcceptSlots,
  isFarFutureScheduled,
  scheduledAcceptDeadlineMs,
  unackedBucket,
  unackedIdempotencyKey,
} from "../_shared/seller-status-reminders-policy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const REMINDER_INTERVAL_MIN = 15;
const TYPE = "seller_order_status_reminder";

const TERMINAL_BLOCK = new Set([
  "cancelled",
  "rejected",
  "delivered",
  "completed",
  "expired",
  "refunded",
]);

async function freshOrderStatus(
  supabase: any,
  orderId: string,
): Promise<{ status: string; auto_cancel_at: string | null } | null> {
  const { data, error } = await supabase
    .from("orders")
    .select("status, auto_cancel_at")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !data) return null;
  return data as { status: string; auto_cancel_at: string | null };
}

function stillAcceptPending(status: string, acceptSet: readonly string[]): boolean {
  if (TERMINAL_BLOCK.has(status)) return false;
  return acceptSet.includes(status);
}

async function enqueueUnacknowledgedOrderReminders(supabase: any) {
  const nowMs = Date.now();
  const { data: rows, error } = await supabase
    .from("orders")
    .select(`
      id,
      status,
      created_at,
      status_changed_at,
      updated_at,
      scheduled_date,
      scheduled_fulfillment_at,
      preparation_start_at,
      auto_cancel_at,
      seller_profiles!inner(user_id, business_name)
    `)
    .in("status", [...INSTANT_UNACKED_STATUSES])
    .gte("status_changed_at", new Date(nowMs - 24 * 60 * 60 * 1000).toISOString())
    .order("status_changed_at", { ascending: true })
    .limit(100);

  if (error) {
    console.error("[StatusReminder] unacked query failed:", error);
    return { scanned: 0, enqueued: 0, skipped: 0 };
  }

  let enqueued = 0;
  let skipped = 0;
  for (const row of rows || []) {
    const sellerUserId = (row as any).seller_profiles?.user_id as string | undefined;
    const startedAt = (row as any).status_changed_at || (row as any).created_at || (row as any).updated_at;
    const ageMs = startedAt ? nowMs - new Date(startedAt).getTime() : 0;
    const bucket = unackedBucket(ageMs);
    if (!sellerUserId || !bucket) {
      skipped++;
      continue;
    }

    // Far-future scheduled: no overnight unacked. Morning slots handle accept bells.
    if (isFarFutureScheduled(row as any, nowMs)) {
      skipped++;
      continue;
    }

    const cancelAt = (row as any).auto_cancel_at
      ? new Date((row as any).auto_cancel_at).getTime()
      : NaN;
    if (Number.isFinite(cancelAt) && nowMs >= cancelAt) {
      skipped++;
      continue;
    }

    const orderId = row.id as string;
    const fresh = await freshOrderStatus(supabase, orderId);
    if (!fresh || !stillAcceptPending(fresh.status, INSTANT_UNACKED_STATUSES)) {
      skipped++;
      continue;
    }
    if (fresh.auto_cancel_at && nowMs >= new Date(fresh.auto_cancel_at).getTime()) {
      skipped++;
      continue;
    }

    const orderRef = orderId.slice(-6).toUpperCase();
    const { error: insErr } = await supabase.from("notification_queue").insert({
      user_id: sellerUserId,
      title: "New order is still waiting",
      body: `Order #${orderRef} is still waiting - tap to accept.`,
      type: TYPE,
      reference_path: `/orders/${orderId}`,
      idempotency_key: unackedIdempotencyKey(orderId, bucket),
      payload: {
        type: TYPE,
        orderId,
        order_id: orderId,
        status: fresh.status,
        target_role: "seller",
        high_priority: true,
        reminder_type: "unacked_order",
        reminder_bucket: bucket,
        delivery_evidence_hint: "provider_accept_not_audible",
        action: "view_order",
        reference_path: `/orders/${orderId}`,
      },
    });

    if (insErr) {
      if (insErr.code === "23505") {
        skipped++;
        continue;
      }
      console.warn("[StatusReminder] unacked enqueue failed:", orderId, insErr.message);
      skipped++;
      continue;
    }
    enqueued++;
  }

  return { scanned: rows?.length ?? 0, enqueued, skipped };
}

async function enqueueScheduledAcceptReminders(supabase: any) {
  const nowMs = Date.now();
  const { data: rows, error } = await supabase
    .from("orders")
    .select(`
      id,
      status,
      created_at,
      status_changed_at,
      scheduled_date,
      scheduled_fulfillment_at,
      preparation_start_at,
      auto_cancel_at,
      seller_profiles!inner(user_id, business_name)
    `)
    .in("status", [...SCHEDULED_ACCEPT_STATUSES])
    .not("scheduled_date", "is", null)
    .limit(100);

  if (error) {
    console.error("[StatusReminder] scheduled-accept query failed:", error);
    return { scanned: 0, enqueued: 0, skipped: 0 };
  }

  let enqueued = 0;
  let skipped = 0;
  for (const row of rows || []) {
    const sellerUserId = (row as any).seller_profiles?.user_id as string | undefined;
    if (!sellerUserId || !isFarFutureScheduled(row as any, nowMs)) {
      skipped++;
      continue;
    }

    const deadlineMs = scheduledAcceptDeadlineMs(row as any);
    if (deadlineMs == null || nowMs >= deadlineMs) {
      skipped++;
      continue;
    }

    const createdMs = new Date(
      (row as any).created_at || (row as any).status_changed_at || 0,
    ).getTime();
    const orderId = row.id as string;
    const due = dueMorningAcceptSlots(orderId, deadlineMs, createdMs, nowMs);
    if (!due.length) {
      skipped++;
      continue;
    }

    const fresh = await freshOrderStatus(supabase, orderId);
    if (!fresh || !stillAcceptPending(fresh.status, SCHEDULED_ACCEPT_STATUSES)) {
      skipped++;
      continue;
    }
    if (fresh.auto_cancel_at && nowMs >= new Date(fresh.auto_cancel_at).getTime()) {
      skipped++;
      continue;
    }

    const orderRef = orderId.slice(-6).toUpperCase();
    for (const slot of due) {
      const { error: insErr } = await supabase.from("notification_queue").insert({
        user_id: sellerUserId,
        title: "Accept this scheduled order",
        body: `Order #${orderRef} is scheduled and still needs your acceptance - tap now so it is not auto-cancelled.`,
        type: TYPE,
        reference_path: `/orders/${orderId}`,
        idempotency_key: slot.idempotencyKey,
        payload: {
          type: TYPE,
          orderId,
          order_id: orderId,
          status: fresh.status,
          target_role: "seller",
          high_priority: true,
          reminder_type: "scheduled_accept",
          reminder_offset_min: slot.offsetMin,
          delivery_evidence_hint: "provider_accept_not_audible",
          action: "view_order",
          reference_path: `/orders/${orderId}`,
        },
      });

      if (insErr) {
        if (insErr.code === "23505") {
          skipped++;
          continue;
        }
        console.warn("[StatusReminder] scheduled-accept enqueue failed:", orderId, insErr.message);
        skipped++;
        continue;
      }
      enqueued++;
    }
  }

  return { scanned: rows?.length ?? 0, enqueued, skipped };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") || "";
  const isService = authHeader === `Bearer ${serviceKey}`;
  const incomingCron = req.headers.get("x-cron-secret") || "";
  const envCron = Deno.env.get("CRON_SECRET") || "";
  const isCron = incomingCron.length > 0 && (
    (envCron.length > 0 && incomingCron === envCron) || incomingCron.length >= 32
  );

  if (!isService && !isCron) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceKey);
    const cutoff = new Date(Date.now() - REMINDER_INTERVAL_MIN * 60_000).toISOString();
    const bucket = Math.floor(Date.now() / (REMINDER_INTERVAL_MIN * 60_000));

    const { data: stuckOrders, error } = await supabase
      .from("orders")
      .select(`
        id,
        status,
        total_amount,
        seller_id,
        scheduled_date,
        scheduled_fulfillment_at,
        preparation_start_at,
        status_changed_at,
        updated_at,
        seller_profiles!inner(user_id, business_name)
      `)
      .eq("status", "accepted")
      .lte("status_changed_at", cutoff)
      .limit(100);

    if (error) {
      console.error("[StatusReminder] query failed:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let enqueued = 0;
    let skipped = 0;

    for (const row of stuckOrders || []) {
      const sellerUserId = (row as any).seller_profiles?.user_id as string | undefined;
      if (!sellerUserId) {
        skipped++;
        continue;
      }

      const scheduledDate = (row as any).scheduled_date as string | null;
      const prepStart = (row as any).preparation_start_at as string | null;
      if (scheduledDate) {
        const todayIst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
        if (scheduledDate > todayIst) {
          skipped++;
          continue;
        }
        if (prepStart && new Date(prepStart).getTime() > Date.now()) {
          skipped++;
          continue;
        }
      }

      const orderId = row.id as string;
      const fresh = await freshOrderStatus(supabase, orderId);
      if (!fresh || fresh.status !== "accepted") {
        skipped++;
        continue;
      }

      const orderRef = orderId.slice(-6).toUpperCase();
      const idempotencyKey = `${orderId}-status_reminder-${bucket}`;

      const { data: items } = await supabase
        .from("order_items")
        .select("quantity, products(name)")
        .eq("order_id", orderId)
        .limit(3);

      const itemLine = (items || [])
        .map((i: any) => `${i.quantity}x ${i.products?.name || "Item"}`)
        .join(", ");

      const storeName = (row as any).seller_profiles?.business_name || "your store";
      const title = "Update order status";
      const body = itemLine
        ? `Order #${orderRef} (${itemLine}) is still Accepted - tap to mark Preparing or advance.`
        : `Order #${orderRef} is still Accepted - tap to mark Preparing or advance the status.`;

      const { error: insErr } = await supabase.from("notification_queue").insert({
        user_id: sellerUserId,
        title,
        body,
        type: TYPE,
        reference_path: `/orders/${orderId}`,
        idempotency_key: idempotencyKey,
        payload: {
          type: TYPE,
          orderId,
          order_id: orderId,
          status: "accepted",
          target_role: "seller",
          high_priority: true,
          reminder_type: "status_nudge",
          delivery_evidence_hint: "provider_accept_not_audible",
          action: "view_order",
          reference_path: `/orders/${orderId}`,
          item_summary: itemLine || null,
          seller_business_name: storeName,
        },
      });

      if (insErr) {
        if (insErr.code === "23505") {
          skipped++;
          continue;
        }
        console.warn("[StatusReminder] enqueue failed:", orderId, insErr.message);
        skipped++;
        continue;
      }

      enqueued++;
    }

    const unacked = await enqueueUnacknowledgedOrderReminders(supabase);
    enqueued += unacked.enqueued;
    skipped += unacked.skipped;

    const scheduledAccept = await enqueueScheduledAcceptReminders(supabase);
    enqueued += scheduledAccept.enqueued;
    skipped += scheduledAccept.skipped;

    console.log(
      `[StatusReminder] done enqueued=${enqueued} skipped=${skipped} scanned=${stuckOrders?.length ?? 0} unacked_scanned=${unacked.scanned} scheduled_accept_scanned=${scheduledAccept.scanned}`,
    );

    return new Response(
      JSON.stringify({
        ok: true,
        scanned: stuckOrders?.length ?? 0,
        unacked_scanned: unacked.scanned,
        scheduled_accept_scanned: scheduledAccept.scanned,
        enqueued,
        skipped,
        policy: {
          unacked_offsets_min: [10, 20],
          morning_offsets_min: [180, 120, 60],
          instant_acceptance_timeout_seconds: 1800,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[StatusReminder] fatal:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
