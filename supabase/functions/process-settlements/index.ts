import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    // 2. Fetch eligible settlements where cooldown has passed
    const { data: eligibleSettlements, error: fetchErr } = await supabase
      .from("seller_settlements")
      .select("id, order_id, seller_id, net_amount, settlement_status")
      .eq("settlement_status", "pending")
      .lte("eligible_at", new Date().toISOString());

    if (fetchErr) throw fetchErr;

    if (!eligibleSettlements || eligibleSettlements.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, message: "No eligible settlements" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let processed = 0;
    const errors: { id: string; error: string }[] = [];

    // Bug 6 fix: Pre-fetch terminal statuses ONCE, filtered by workflow type per order
    // Cache all terminal success flows grouped by transaction_type
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

    for (const settlement of eligibleSettlements) {
      const { data: orderData } = await supabase
        .from("orders")
        .select("status, fulfillment_type, delivery_handled_by, order_type")
        .eq("id", settlement.order_id)
        .single();

      // Determine the correct terminal statuses for this order's workflow
      const orderWorkflow = orderData?.order_type || 'standard';
      const relevantTerminals = terminalByWorkflow.get(orderWorkflow) || allTerminalStatuses;

      const isNonPlatformDelivery = orderData?.fulfillment_type === 'self_pickup' ||
        (orderData?.delivery_handled_by !== 'platform');

      if (isNonPlatformDelivery) {
        if (!orderData || !relevantTerminals.has(orderData.status)) {
          errors.push({ id: settlement.id, error: "Order not completed" });
          continue;
        }
      } else {
        // For platform delivery: check delivery_assignments
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

      // 4. Verify payment is confirmed
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

      // Mark eligible only — do NOT mark settled without a real Razorpay Route transfer
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
          note: "Awaiting real payout transfer — not auto-settled",
        },
      });

      processed++;
    }

    return new Response(
      JSON.stringify({
        processed,
        errors,
        total_eligible: eligibleSettlements.length,
        message: "Settlements marked eligible only. Automatic Route payout is not enabled.",
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
