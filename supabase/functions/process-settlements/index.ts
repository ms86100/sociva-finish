import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Settlement eligibility cron.
 *
 * HONESTY CONTRACT:
 * - Without Razorpay Route linked accounts + razorpay_route_enabled=true,
 *   this function ONLY moves pending → eligible after cooldown/delivery/payment checks.
 * - It never marks settlement_status=settled and never calls Route transfer APIs
 *   unless route is explicitly enabled AND transfer credentials/accounts exist.
 * - "Eligible" means: amount is owed / ready for payout — NOT paid out.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // SEC-01 FIX: Require service-role authorization (cron or internal call only)
    const authHeader = req.headers.get("Authorization");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!authHeader || authHeader !== `Bearer ${serviceRoleKey}`) {
      return new Response(
        JSON.stringify({ error: "Unauthorized — service role required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey,
    );

    // 1. Check if auto-settle is enabled
    const { data: autoSetting } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "auto_settle_enabled")
      .single();

    const autoEnabled = autoSetting?.value === "true";

    // Allow manual invocation even when auto is off (admin can pass force=true)
    let force = false;
    try {
      const body = await req.json();
      force = body?.force === true;
    } catch {
      // No body is fine
    }

    if (!autoEnabled && !force) {
      return new Response(
        JSON.stringify({ processed: 0, message: "Auto-settle is disabled. Pass force=true to override." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Route payout gate — default OFF. Do not invent transfers.
    const { data: routeSetting } = await supabase
      .from("admin_settings")
      .select("value, is_active")
      .eq("key", "razorpay_route_enabled")
      .maybeSingle();

    const routeEnabled =
      routeSetting?.is_active === true &&
      String(routeSetting?.value || "").toLowerCase() === "true";

    // 2. Fetch pending settlements where cooldown has passed
    const { data: pendingSettlements, error: fetchErr } = await supabase
      .from("seller_settlements")
      .select("id, order_id, seller_id, net_amount, settlement_status")
      .eq("settlement_status", "pending")
      .lte("eligible_at", new Date().toISOString());

    if (fetchErr) throw fetchErr;

    if (!pendingSettlements || pendingSettlements.length === 0) {
      return new Response(
        JSON.stringify({
          processed: 0,
          route_enabled: routeEnabled,
          message: "No pending settlements past cooldown",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let processed = 0;
    const errors: { id: string; error: string }[] = [];

    // Bug 6 fix: Pre-fetch terminal statuses ONCE, filtered by workflow type per order
    const { data: allTerminalRows } = await supabase
      .from("category_status_flows")
      .select("status_key, transaction_type")
      .eq("is_terminal", true)
      .eq("is_success", true);

    const terminalByWorkflow = new Map<string, Set<string>>();
    const allTerminalStatuses = new Set<string>();
    for (const r of (allTerminalRows || [])) {
      allTerminalStatuses.add(r.status_key);
      if (!terminalByWorkflow.has(r.transaction_type)) terminalByWorkflow.set(r.transaction_type, new Set());
      terminalByWorkflow.get(r.transaction_type)!.add(r.status_key);
    }

    for (const settlement of pendingSettlements) {
      const { data: orderData } = await supabase
        .from("orders")
        .select("status, fulfillment_type, delivery_handled_by, order_type, payment_status")
        .eq("id", settlement.order_id)
        .single();

      // Block payout eligibility for refunded / in-refund orders
      const orderPay = String(orderData?.payment_status || "");
      if (["refunded", "refund_initiated", "refund_processing"].includes(orderPay)) {
        await supabase
          .from("seller_settlements")
          .update({
            settlement_status: "on_hold",
            hold_reason: `Blocked: order payment_status=${orderPay}`,
            eligible_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", settlement.id)
          .in("settlement_status", ["pending", "eligible", "processing"]);
        errors.push({ id: settlement.id, error: `Order ${orderPay} — settlement held` });
        continue;
      }

      const orderWorkflow = orderData?.order_type || "standard";
      const relevantTerminals = terminalByWorkflow.get(orderWorkflow) || allTerminalStatuses;

      const isNonPlatformDelivery = orderData?.fulfillment_type === "self_pickup" ||
        (orderData?.delivery_handled_by !== "platform");

      if (isNonPlatformDelivery) {
        if (!orderData || !relevantTerminals.has(orderData.status)) {
          errors.push({ id: settlement.id, error: "Order not completed" });
          continue;
        }
      } else {
        const { data: delivery } = await supabase
          .from("delivery_assignments")
          .select("status")
          .eq("order_id", settlement.order_id)
          .single();

        if (delivery?.status !== "delivered") {
          errors.push({ id: settlement.id, error: "Delivery not confirmed" });
          continue;
        }
      }

      const { data: payment } = await supabase
        .from("payment_records")
        .select("payment_status")
        .eq("order_id", settlement.order_id)
        .limit(1)
        .single();

      if (payment?.payment_status !== "paid") {
        errors.push({ id: settlement.id, error: "Payment not confirmed" });
        continue;
      }

      // Skip Route transfer — APIs/linked accounts are not wired.
      // Mark eligible only — never settled without a real razorpay_transfer_id.
      const { error: eligibleErr } = await supabase
        .from("seller_settlements")
        .update({ settlement_status: "eligible" })
        .eq("id", settlement.id);

      if (eligibleErr) {
        errors.push({ id: settlement.id, error: eligibleErr.message });
        continue;
      }

      await supabase.from("audit_log").insert({
        actor_id: null,
        action: "settlement_marked_eligible",
        target_type: "seller_settlements",
        target_id: settlement.id,
        society_id: null,
        metadata: {
          order_id: settlement.order_id,
          seller_id: settlement.seller_id,
          net_amount: settlement.net_amount,
          note: routeEnabled
            ? "Eligible only — razorpay_route_enabled is true but Route transfer APIs are not implemented; no money transferred."
            : "Eligible — payout pending platform Route setup. Not transferred.",
          route_enabled: routeEnabled,
          transfer_attempted: false,
        },
      });

      // Seller notify is also fired by trg_seller_settlement_notification on settlement_status update.
      // Extra enqueue here is intentionally skipped to avoid duplicates.

      processed++;
    }

    return new Response(
      JSON.stringify({
        processed,
        errors,
        total_pending: pendingSettlements.length,
        route_enabled: routeEnabled,
        message:
          "Settlements marked eligible only. No money transferred — Razorpay Route payouts are not active.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
