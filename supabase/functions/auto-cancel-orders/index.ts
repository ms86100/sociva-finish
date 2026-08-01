import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const app = new Hono();

// Handle CORS preflight
app.options("*", (c) => {
  return c.json({}, 200, corsHeaders);
});

// Auto-cancel expired urgent orders
app.post("/", async (c) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Security: Only allow invocation via service role key or cron
    const authHeader = c.req.header("Authorization") || "";
    const isServiceRole = authHeader === `Bearer ${supabaseServiceKey}`;
    const isCron = c.req.header("x-cron-secret") === Deno.env.get("CRON_SECRET");
    if (!isServiceRole && !isCron) {
      return c.json({ error: "Unauthorized" }, 401, corsHeaders);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // --- DB-driven: resolve cancellable statuses from category_status_transitions ---
    // Any status that has a transition TO 'cancelled' (by any actor) is auto-cancellable.
    const { data: cancelTransitions } = await supabase
      .from("category_status_transitions")
      .select("from_status")
      .eq("to_status", "cancelled");

    const dbCancellableStatuses = cancelTransitions
      ? [...new Set(cancelTransitions.map((t: any) => t.from_status))]
      : [];

    // Fallback only if DB returns nothing (e.g. empty transitions table)
    const cancellableStatuses = dbCancellableStatuses.length > 0
      ? dbCancellableStatuses
      : ["placed", "payment_pending"];

    // --- DB-driven: resolve auto-completable statuses from category_status_flows ---
    // Any status flagged as non-terminal that transitions to a terminal+success state
    const { data: completableTransitions } = await supabase
      .from("category_status_transitions")
      .select("from_status")
      .eq("to_status", "completed");

    const dbCompletableStatuses = completableTransitions
      ? [...new Set(completableTransitions.map((t: any) => t.from_status))]
      : [];

    // Load admin overrides from system_settings (optional narrowing)
    const { data: settingsRows } = await supabase
      .from("system_settings")
      .select("key, value")
      .in("key", ["cancellable_statuses_override", "auto_completable_statuses_override"]);

    const settings: Record<string, string> = {};
    for (const row of settingsRows || []) {
      if (row.key && row.value) settings[row.key] = row.value;
    }

    // Admin overrides narrow the DB-derived set (intersection), not replace it
    if (settings["cancellable_statuses_override"]) {
      try {
        const override: string[] = JSON.parse(settings["cancellable_statuses_override"]);
        const overrideSet = new Set(override);
        // Only keep statuses that exist in BOTH the DB transitions and the admin override
        const narrowed = cancellableStatuses.filter(s => overrideSet.has(s));
        if (narrowed.length > 0) cancellableStatuses.splice(0, cancellableStatuses.length, ...narrowed);
      } catch { /* ignore malformed override */ }
    }

    let autoCompletableStatuses = dbCompletableStatuses.length > 0
      ? dbCompletableStatuses
      : ["delivered"];

    // DB-driven grace periods
    const { data: graceRows } = await supabase
      .from("system_settings")
      .select("key, value")
      .in("key", ["auto_cancel_grace_online_seconds", "auto_cancel_grace_urgent_seconds"]);
    const graceMap: Record<string, string> = {};
    for (const r of graceRows || []) if (r.key && r.value) graceMap[r.key] = r.value;
    const onlineGraceSec = parseInt(graceMap["auto_cancel_grace_online_seconds"] || "1800", 10);

    const now = new Date().toISOString();
    const onlineCutoff = new Date(Date.now() - onlineGraceSec * 1000).toISOString();

    // Query 1: Urgent orders past auto_cancel_at (skip if buyer already confirmed/paid)
    const { data: urgentExpired, error: urgentErr } = await supabase
      .from("orders")
      .select("id, buyer_id, seller_id, total_amount, razorpay_order_id")
      .in("status", cancellableStatuses)
      .not("auto_cancel_at", "is", null)
      .lt("auto_cancel_at", now)
      .not("payment_status", "in", "(buyer_confirmed,paid)");

    // Query 2: Orphaned online orders — payment_status=pending, non-COD, past DB-driven grace
    const { data: orphanedUpi, error: orphanErr } = await supabase
      .from("orders")
      .select("id, buyer_id, seller_id, total_amount, razorpay_order_id")
      .in("status", cancellableStatuses)
      .eq("payment_status", "pending")
      .neq("payment_type", "cod")
      .lt("created_at", onlineCutoff);

    // Gate: ensure L4 final-warning notification has fired for each candidate.
    // This binds hard cancel to nudge completion — no silent cancellations.
    const { data: l4Rule } = await supabase
      .from("notification_rules")
      .select("id, delay_seconds")
      .eq("key", "order_placed_seller_l4")
      .eq("active", true)
      .maybeSingle();

    // Require the L4 final-warning to have fired AND have aged at least 60s,
    // so we never cancel before the buyer/seller see the final notification.
    const gateCancellation = async (candidateIds: string[]): Promise<Set<string>> => {
      if (!l4Rule || candidateIds.length === 0) return new Set(candidateIds);
      const ageCutoff = new Date(Date.now() - 60 * 1000).toISOString();
      const { data: tracked } = await supabase
        .from("notification_state_tracker")
        .select("entity_id, last_triggered_at")
        .eq("rule_id", (l4Rule as any).id)
        .in("entity_id", candidateIds)
        .lte("last_triggered_at", ageCutoff);
      const okIds = new Set<string>();
      for (const t of tracked || []) {
        okIds.add((t as any).entity_id);
      }
      return okIds;
    };

    const fetchError = urgentErr || orphanErr;

    // Tag each order with its cancel reason so we write the correct rejection_reason
    const urgentIds = new Set((urgentExpired || []).map(o => o.id));
    const orphanIds = new Set((orphanedUpi || []).map(o => o.id));

    const candidateOrders = [
      ...(urgentExpired || []),
      ...(orphanedUpi || []),
    ].filter((order, idx, arr) => arr.findIndex(o => o.id === order.id) === idx);

    if (fetchError) {
      console.error("Error fetching expired orders:", fetchError);
      return c.json({ error: fetchError.message }, 500, corsHeaders);
    }

    // Apply L4 nudge gate — orders without a recorded final-warning are deferred.
    const okToCancel = await gateCancellation(candidateOrders.map(o => o.id));
    const expiredOrders = candidateOrders.filter(o => okToCancel.has(o.id));
    const deferredCount = candidateOrders.length - expiredOrders.length;

    if (deferredCount > 0) {
      console.log(`[auto-cancel][gate] deferring ${deferredCount} orders — L4 final warning not yet fired`);
    }
    if (expiredOrders.length === 0) {
      console.log("No expired orders to cancel");
    } else {
      console.log(`Found ${expiredOrders.length} expired orders to cancel (after gate)`);
    }

    // --- Auto-complete delivered orders past auto_complete_at ---
    const { data: deliveredExpired, error: deliveredErr } = await supabase
      .from("orders")
      .select("id, buyer_id, seller_id")
      .in("status", autoCompletableStatuses)
      .not("auto_complete_at", "is", null)
      .lt("auto_complete_at", now);

    if (deliveredErr) {
      console.error("Error fetching delivered orders for auto-complete:", deliveredErr);
    }

    // --- P0: Buyer Protection SLA — auto-approve refunds after 48h seller inaction ---
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: slaRefunds, error: slaErr } = await supabase
      .from("refund_requests")
      .select("id, order_id, buyer_id, seller_id, amount")
      .eq("status", "requested")
      .lt("created_at", fortyEightHoursAgo);

    if (slaErr) {
      console.error("Error fetching SLA refunds:", slaErr);
    }

    let slaApprovedCount = 0;
    for (const refund of slaRefunds || []) {
      const { error: approveErr } = await supabase
        .from("refund_requests")
        .update({
          status: "approved",
          auto_approved: true,
          approved_at: now,
          notes: "Auto-approved: seller did not respond within 48 hours (Buyer Protection SLA)",
          updated_at: now,
        })
        .eq("id", refund.id)
        .eq("status", "requested"); // guard against race

      if (!approveErr) {
        slaApprovedCount++;
        console.log(`[SLA] Auto-approved refund ${refund.id} for order ${refund.order_id}`);

        // Notify buyer about auto-approval
        await supabase.from("notification_queue").insert({
          user_id: refund.buyer_id,
          title: "Refund Approved",
          body: "Your refund has been automatically approved under our Buyer Protection policy.",
          type: "order",
          reference_path: `/orders/${refund.order_id}`,
          payload: { orderId: refund.order_id, status: "refund_approved", target_role: "buyer" },
        });
      }
    }
    if (slaApprovedCount > 0) {
      console.log(`[SLA] Auto-approved ${slaApprovedCount} refunds under Buyer Protection`);
    }

    // --- P0: Auto-process approved refunds (state machine: approved -> refund_completed) ---
    // Picks up refunds the seller approved (or that were SLA-auto-approved above) and
    // drives them through initiate -> complete via the refund-processor function.
    const { data: approvedRefunds } = await supabase
      .from("refund_requests")
      .select("id")
      .eq("refund_state", "approved")
      .limit(50);

    let processedRefundCount = 0;
    for (const ref of approvedRefunds || []) {
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/refund-processor`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({ refund_id: ref.id }),
        });
        if (resp.ok) processedRefundCount++;
        else console.error(`[refund-cron] failed for ${ref.id}: ${resp.status}`);
      } catch (e) {
        console.error(`[refund-cron] error for ${ref.id}`, e);
      }
    }
    if (processedRefundCount > 0) {
      console.log(`[refund-cron] auto-processed ${processedRefundCount} approved refunds`);
    }

    // --- Manual fallback: any refund stuck in initiated/processing >72h auto-completes ---
    const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const { data: stuckRefunds } = await supabase
      .from("refund_requests")
      .select("id")
      .in("refund_state", ["refund_initiated", "refund_processing"])
      .lt("processed_at", seventyTwoHoursAgo)
      .limit(50);

    for (const ref of stuckRefunds || []) {
      const { error: completeErr } = await supabase.rpc("complete_refund", {
        p_refund_id: ref.id,
        p_gateway_ref: `manual-fallback-${ref.id.slice(0, 8)}`,
        p_gateway_status: "manual_fallback",
      });
      if (completeErr) console.error(`[refund-cron] fallback complete failed`, completeErr);
      else console.log(`[refund-cron] fallback completed refund ${ref.id}`);
    }

    const thirtyMinDelivered = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: reviewableOrders, error: reviewErr } = await supabase
      .from("orders")
      .select("id, buyer_id, seller_id, updated_at, seller_profiles!orders_seller_id_fkey(business_name)")
      .eq("status", "delivered")
      .lt("updated_at", thirtyMinDelivered)
      .gt("updated_at", twoHoursAgo); // only process recent deliveries, not ancient ones

    if (reviewErr) {
      console.error("Error fetching reviewable orders:", reviewErr);
    }

    let reviewPromptsCreated = 0;
    for (const order of reviewableOrders || []) {
      // Check if prompt already exists
      const { data: existing } = await supabase
        .from("review_prompts")
        .select("id")
        .eq("order_id", order.id)
        .limit(1);
      if (existing && existing.length > 0) continue;

      const sellerName = (order as any).seller_profiles?.business_name || "the seller";
      const { error: promptErr } = await supabase.from("review_prompts").insert({
        order_id: order.id,
        buyer_id: order.buyer_id,
        seller_id: order.seller_id,
        seller_name: sellerName,
        prompt_at: now,
        status: "pending",
      });
      if (!promptErr) {
        reviewPromptsCreated++;
        // Send notification to buyer
        await supabase.from("notification_queue").insert({
          user_id: order.buyer_id,
          title: `How was your order from ${sellerName}?`,
          body: "Tap to leave a quick review and help your community.",
          type: "order",
          reference_path: `/orders/${order.id}`,
          payload: { orderId: order.id, action: "review_prompt", target_role: "buyer" },
        });
      }
    }
    if (reviewPromptsCreated > 0) {
      console.log(`[ReviewPrompt] Created ${reviewPromptsCreated} review prompts`);
    }

    const autoCompleteResults = await Promise.allSettled(
      (deliveredExpired || []).map(async (order) => {
        const { error: completeError } = await supabase
          .from("orders")
          .update({
            status: "completed",
            auto_complete_at: null,
            updated_at: now,
          })
          .eq("id", order.id)
          .eq("status", "delivered");

        if (completeError) {
          console.error(`Error auto-completing order ${order.id}:`, completeError);
          throw { id: order.id, error: completeError.message };
        }
        console.log(`Order ${order.id} auto-completed`);
        return { id: order.id, success: true };
      })
    );

    // --- Razorpay verification helper: check if payment was actually captured ---
    async function isRazorpayPaid(razorpayOrderId: string): Promise<boolean> {
      try {
        const { data: credRows } = await supabase
          .from("admin_settings")
          .select("key, value, is_active")
          .in("key", ["razorpay_key_id", "razorpay_key_secret"]);
        const credMap: Record<string, string> = {};
        for (const r of credRows || []) {
          if (r.value && r.is_active) credMap[r.key] = r.value;
        }
        const keyId = credMap.razorpay_key_id || Deno.env.get("RAZORPAY_KEY_ID") || "";
        const keySecret = credMap.razorpay_key_secret || Deno.env.get("RAZORPAY_KEY_SECRET") || "";
        if (!keyId || !keySecret) return false;

        // Fetch payments for this Razorpay order
        const res = await fetch(`https://api.razorpay.com/v1/orders/${razorpayOrderId}/payments`, {
          headers: { Authorization: "Basic " + btoa(`${keyId}:${keySecret}`) },
        });
        if (!res.ok) return false;
        const data = await res.json();
        const items = data.items || data;
        return Array.isArray(items) && items.some((p: any) => p.status === "captured" || p.status === "authorized");
      } catch (e) {
        console.warn("Razorpay verification failed, proceeding with cancel:", e);
        return false;
      }
    }

    // --- Cancel expired orders ---
    // Bug 1 fix: Add status guard to prevent cancelling orders that were accepted between SELECT and UPDATE
    const cancelResults = await Promise.allSettled(
      (expiredOrders || []).map(async (order) => {
        // GUARD: For online orders with a razorpay_order_id, verify with Razorpay before cancelling
        if ((order as any).razorpay_order_id) {
          const actuallyPaid = await isRazorpayPaid((order as any).razorpay_order_id);
          if (actuallyPaid) {
            console.log(`[auto-cancel][reconcile] order=${order.id} razorpay_order_id=${(order as any).razorpay_order_id} result=actually_paid — triggering confirmation`);
            // Trigger the confirm function to fix the state
            try {
              const fnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/confirm-razorpay-payment`;
              await fetch(fnUrl, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  razorpay_payment_id: "reconciled",
                  razorpay_order_id: (order as any).razorpay_order_id,
                  order_ids: [order.id],
                }),
              });
            } catch (e) {
              console.warn("Reconciliation trigger failed:", e);
            }
            return { id: order.id, success: false, skipped: true, reason: "razorpay_paid" };
          }
        }

        // Dynamic rejection reason based on WHY the order is being cancelled
        const reason = orphanIds.has(order.id) && !urgentIds.has(order.id)
          ? "Order was cancelled as payment was not completed in time"
          : "We couldn't confirm your order as the seller didn't respond in time";

        const { error: updateError, data: updated } = await supabase
          .from("orders")
          .update({
            status: "cancelled",
            rejection_reason: reason,
            auto_cancel_at: null,
            updated_at: now,
          })
          .eq("id", order.id)
          .in("status", cancellableStatuses)
          .select("id");

        if (updateError) {
          console.error(`Error cancelling order ${order.id}:`, updateError);
          throw { id: order.id, error: updateError.message };
        }
        if (!updated || updated.length === 0) {
          console.log(`Order ${order.id} already transitioned — skipping cancel`);
          return { id: order.id, success: false, skipped: true };
        }
        console.log(`[auto-cancel] order=${order.id} result=cancelled reason="${reason}"`);

        // Trigger recovery suggestions for the cancelled buyer
        try {
          const fnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-order-suggestions`;
          await fetch(fnUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ buyer_id: order.buyer_id, cancelled_order_id: order.id }),
          });
          console.log(`[auto-cancel] triggered recovery suggestions for buyer=${order.buyer_id}`);
        } catch (e) {
          console.warn("Failed to trigger order suggestions:", e);
        }

        return { id: order.id, success: true };
      })
    );

    const mapResult = (r: PromiseSettledResult<any>) =>
      r.status === 'fulfilled' ? r.value : { id: (r.reason as any)?.id, success: false, error: (r.reason as any)?.error };

    const cancelledCount = cancelResults.filter(r => r.status === 'fulfilled').length;
    const completedCount = autoCompleteResults.filter(r => r.status === 'fulfilled').length;

    // Trigger push notifications for affected orders
    if (cancelledCount > 0 || completedCount > 0) {
      try {
        const fnUrl = `${supabaseUrl}/functions/v1/process-notification-queue`;
        await fetch(fnUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseServiceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        });
        console.log("Triggered process-notification-queue");
      } catch (e) {
        console.warn("Failed to trigger notification queue:", e);
      }
    }

    return c.json(
      {
        message: `Cancelled ${cancelledCount}, auto-completed ${completedCount}, SLA refunds ${slaApprovedCount}, review prompts ${reviewPromptsCreated}`,
        cancelled: cancelledCount,
        auto_completed: completedCount,
        sla_refunds_approved: slaApprovedCount,
        review_prompts_created: reviewPromptsCreated,
        cancel_results: cancelResults.map(mapResult),
        complete_results: autoCompleteResults.map(mapResult),
      },
      200,
      corsHeaders
    );
  } catch (error) {
    console.error("Error in auto-cancel function:", error);
    return c.json({ error: String(error) }, 500, corsHeaders);
  }
});

Deno.serve(app.fetch);
