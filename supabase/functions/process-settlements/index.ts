import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";
import { getRazorpayCredentials, getCredential } from "../_shared/credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Create a Razorpay Route transfer to a linked account.
 * Returns transfer id on success.
 */
async function createRouteTransfer(opts: {
  keyId: string;
  keySecret: string;
  accountId: string;
  amountPaise: number;
  settlementId: string;
  orderId: string;
}): Promise<{ ok: true; transferId: string } | { ok: false; error: string }> {
  const authBasic = "Basic " + btoa(`${opts.keyId}:${opts.keySecret}`);
  const res = await fetch("https://api.razorpay.com/v1/transfers", {
    method: "POST",
    headers: {
      Authorization: authBasic,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      account: opts.accountId,
      amount: opts.amountPaise,
      currency: "INR",
      notes: {
        settlement_id: opts.settlementId,
        order_id: opts.orderId,
        source: "sociva_process_settlements",
      },
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      body?.error?.description ||
      body?.error?.reason ||
      `razorpay_transfer_http_${res.status}`;
    return { ok: false, error: String(msg) };
  }

  const transferId = body?.id;
  if (!transferId) {
    return { ok: false, error: "razorpay_transfer_missing_id" };
  }
  return { ok: true, transferId: String(transferId) };
}

/**
 * Settlement eligibility + optional Razorpay Route payout cron.
 *
 * HONESTY CONTRACT:
 * - pending → eligible after cooldown/delivery/payment checks (always).
 * - eligible → settled ONLY when route is enabled AND a real transfer id
 *   is returned from Razorpay (seller must have razorpay_account_id).
 * - Never marks settled without razorpay_transfer_id.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    const { data: autoSetting } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "auto_settle_enabled")
      .single();

    const autoEnabled = autoSetting?.value === "true";

    let force = false;
    try {
      const body = await req.json();
      force = body?.force === true;
    } catch {
      // No body is fine
    }

    if (!autoEnabled && !force) {
      return new Response(
        JSON.stringify({
          processed: 0,
          message: "Auto-settle is disabled. Pass force=true to override.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const routeVal = await getCredential(
      supabase,
      "razorpay_route_enabled",
      "RAZORPAY_ROUTE_ENABLED",
    );
    const routeEnabled = String(routeVal || "").toLowerCase() === "true";

    const creds = routeEnabled
      ? await getRazorpayCredentials(supabase)
      : { keyId: "", keySecret: "" };

    // 1) Promote pending → eligible
    const { data: pendingSettlements, error: fetchErr } = await supabase
      .from("seller_settlements")
      .select("id, order_id, seller_id, net_amount, settlement_status")
      .eq("settlement_status", "pending")
      .lte("eligible_at", new Date().toISOString());

    if (fetchErr) throw fetchErr;

    let processed = 0;
    const errors: { id: string; error: string }[] = [];
    let transferred = 0;

    const { data: allTerminalRows } = await supabase
      .from("category_status_flows")
      .select("status_key, transaction_type")
      .eq("is_terminal", true)
      .eq("is_success", true);

    const terminalByWorkflow = new Map<string, Set<string>>();
    const allTerminalStatuses = new Set<string>();
    for (const r of allTerminalRows || []) {
      allTerminalStatuses.add(r.status_key);
      if (!terminalByWorkflow.has(r.transaction_type)) {
        terminalByWorkflow.set(r.transaction_type, new Set());
      }
      terminalByWorkflow.get(r.transaction_type)!.add(r.status_key);
    }

    for (const settlement of pendingSettlements || []) {
      const { data: orderData } = await supabase
        .from("orders")
        .select(
          "status, fulfillment_type, delivery_handled_by, order_type, transaction_type, payment_status",
        )
        .eq("id", settlement.order_id)
        .single();

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

      const orderWorkflow =
        orderData?.transaction_type ||
        orderData?.order_type ||
        "self_fulfillment";
      const relevantTerminals =
        terminalByWorkflow.get(orderWorkflow) || allTerminalStatuses;

      const isNonPlatformDelivery =
        orderData?.fulfillment_type === "self_pickup" ||
        orderData?.delivery_handled_by !== "platform";

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
          route_enabled: routeEnabled,
          transfer_attempted: false,
        },
      });

      processed++;
    }

    // 2) When Route enabled: transfer eligible settlements with linked accounts
    if (routeEnabled) {
      if (!creds.keyId || !creds.keySecret) {
        return new Response(
          JSON.stringify({
            processed,
            transferred: 0,
            errors: [
              ...errors,
              {
                id: "route",
                error: "razorpay_route_enabled but credentials missing",
              },
            ],
            route_enabled: true,
            message:
              "Eligible marked where possible; Route transfers skipped — Razorpay credentials missing.",
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const { data: eligibleRows, error: eligErr } = await supabase
        .from("seller_settlements")
        .select("id, order_id, seller_id, net_amount, settlement_status, razorpay_transfer_id")
        .eq("settlement_status", "eligible")
        .is("razorpay_transfer_id", null)
        .limit(50);

      if (eligErr) throw eligErr;

      for (const row of eligibleRows || []) {
        const amountPaise = Math.round(Number(row.net_amount || 0) * 100);
        if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
          errors.push({ id: row.id, error: "invalid_net_amount" });
          continue;
        }

        const { data: seller } = await supabase
          .from("seller_profiles")
          .select("id, razorpay_account_id, razorpay_onboarding_status")
          .eq("id", row.seller_id)
          .maybeSingle();

        const accountId = seller?.razorpay_account_id;
        if (!accountId) {
          errors.push({
            id: row.id,
            error: "seller_missing_razorpay_account_id",
          });
          continue;
        }

        // Mark processing before transfer to reduce double-pay races
        const { data: locked, error: lockErr } = await supabase
          .from("seller_settlements")
          .update({
            settlement_status: "processing",
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id)
          .eq("settlement_status", "eligible")
          .is("razorpay_transfer_id", null)
          .select("id");

        if (lockErr || !locked?.length) {
          errors.push({
            id: row.id,
            error: lockErr?.message || "could_not_lock_for_transfer",
          });
          continue;
        }

        const transfer = await createRouteTransfer({
          keyId: creds.keyId,
          keySecret: creds.keySecret,
          accountId,
          amountPaise,
          settlementId: row.id,
          orderId: row.order_id,
        });

        if (!transfer.ok) {
          await supabase
            .from("seller_settlements")
            .update({
              settlement_status: "eligible",
              hold_reason: `Route transfer failed: ${transfer.error}`,
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id)
            .eq("settlement_status", "processing");

          errors.push({ id: row.id, error: transfer.error });
          continue;
        }

        const { error: settleErr } = await supabase
          .from("seller_settlements")
          .update({
            settlement_status: "settled",
            razorpay_transfer_id: transfer.transferId,
            hold_reason: null,
            settled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id)
          .eq("settlement_status", "processing");

        if (settleErr) {
          errors.push({
            id: row.id,
            error: `transfer_ok_but_db_update_failed:${settleErr.message}:transfer=${transfer.transferId}`,
          });
          continue;
        }

        await supabase.from("audit_log").insert({
          actor_id: null,
          action: "settlement_route_transferred",
          target_type: "seller_settlements",
          target_id: row.id,
          society_id: null,
          metadata: {
            order_id: row.order_id,
            seller_id: row.seller_id,
            net_amount: row.net_amount,
            razorpay_transfer_id: transfer.transferId,
            account_id: accountId,
          },
        });

        transferred++;
      }
    }

    return new Response(
      JSON.stringify({
        processed,
        transferred,
        errors,
        total_pending: (pendingSettlements || []).length,
        route_enabled: routeEnabled,
        message: routeEnabled
          ? `Marked ${processed} eligible; transferred ${transferred} via Razorpay Route.`
          : "Settlements marked eligible only. Enable razorpay_route_enabled + seller linked accounts for payouts.",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
