import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";
import { getRazorpayCredentials } from "../_shared/credentials.ts";
import {
  checkFinancialRuntime,
  financialRuntimeUnavailableResponse,
} from "../_shared/financial-runtime.ts";

const jsonHeaders = { "Content-Type": "application/json" };

async function razorpayRequest(
  path: string,
  keyId: string,
  keySecret: string,
): Promise<{ ok: boolean; status: number; body: any }> {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    headers: { Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}` },
  });
  return {
    ok: response.ok,
    status: response.status,
    body: await response.json().catch(() => ({})),
  };
}

Deno.serve(async (req) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceKey,
  );
  const runtime = await checkFinancialRuntime(
    supabase,
    "recovery_ready",
    "recovery_mutations_enabled",
  );
  if (!runtime.ready) {
    return financialRuntimeUnavailableResponse(runtime, jsonHeaders);
  }

  const serviceAuthorized =
    req.headers.get("Authorization") === `Bearer ${serviceKey}`;
  const cronSecret = req.headers.get("x-cron-secret");
  const cronAuthorized =
    !!cronSecret && cronSecret === Deno.env.get("CRON_SECRET");
  if (!serviceAuthorized && !cronAuthorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  try {
    const credentials = await getRazorpayCredentials(supabase);
    if (!credentials.keyId || !credentials.keySecret) {
      throw new Error("razorpay_credentials_missing");
    }

    const results = {
      refunds_recovered: 0,
      payouts_recovered: 0,
      still_unknown: 0,
      errors: [] as string[],
    };

    const { data: refunds, error: refundsError } = await supabase
      .from("refund_attempts")
      .select("id, refund_id, provider_payment_id, provider_refund_id, amount_minor")
      .eq("provider", "razorpay")
      .in("status", ["unknown", "reconciliation_required"])
      .limit(50);
    if (refundsError) throw refundsError;

    for (const attempt of refunds || []) {
      try {
        let providerRefund: any = null;
        if (attempt.provider_refund_id) {
          const exact = await razorpayRequest(
            `/refunds/${encodeURIComponent(attempt.provider_refund_id)}`,
            credentials.keyId,
            credentials.keySecret,
          );
          if (exact.ok) providerRefund = exact.body;
        } else {
          const list = await razorpayRequest(
            `/payments/${encodeURIComponent(attempt.provider_payment_id)}/refunds?count=100`,
            credentials.keyId,
            credentials.keySecret,
          );
          if (list.ok) {
            providerRefund = (list.body?.items || []).find((item: any) =>
              String(item?.notes?.refund_request_id || "") === attempt.refund_id &&
              Number(item?.amount) === Number(attempt.amount_minor) &&
              String(item?.payment_id || "") === attempt.provider_payment_id
            ) || null;
          }
        }
        if (!providerRefund?.id) {
          results.still_unknown++;
          continue;
        }
        if (
          Number(providerRefund.amount) !== Number(attempt.amount_minor) ||
          String(providerRefund.payment_id) !== attempt.provider_payment_id
        ) {
          throw new Error(`refund_identity_mismatch:${attempt.id}`);
        }
        const terminal = String(providerRefund.status).toLowerCase();
        const { error: bindError } = await supabase
          .from("refund_attempts")
          .update({
            provider_refund_id: providerRefund.id,
            provider_status: terminal,
            status: terminal === "processed" ? "succeeded" : "processing",
            error_message: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", attempt.id)
          .in("status", ["unknown", "reconciliation_required"]);
        if (bindError) throw bindError;
        if (terminal === "processed") {
          const { data: completed, error: completeError } = await supabase.rpc(
            "complete_refund_by_gateway_id",
            {
              p_gateway_refund_id: providerRefund.id,
              p_gateway_status: terminal,
              p_razorpay_payment_id: attempt.provider_payment_id,
            },
          );
          if (completeError || completed?.ok !== true) {
            throw new Error(
              `refund_completion_failed:${completeError?.message || "not_completed"}`,
            );
          }
          results.refunds_recovered++;
        }
      } catch (error) {
        results.errors.push(String(error));
      }
    }

    const { data: payouts, error: payoutsError } = await supabase
      .from("payout_attempts")
      .select(
        "id, settlement_id, provider_transfer_id, amount_minor, destination:seller_payout_destinations(provider_reference)",
      )
      .eq("provider", "razorpay_route")
      .in("status", ["unknown", "reconciliation_required"])
      .limit(50);
    if (payoutsError) throw payoutsError;

    for (const attempt of payouts || []) {
      try {
        let transfer: any = null;
        if (attempt.provider_transfer_id) {
          const exact = await razorpayRequest(
            `/transfers/${encodeURIComponent(attempt.provider_transfer_id)}`,
            credentials.keyId,
            credentials.keySecret,
          );
          if (exact.ok) transfer = exact.body;
        } else {
          const list = await razorpayRequest(
            "/transfers?count=100",
            credentials.keyId,
            credentials.keySecret,
          );
          if (list.ok) {
            transfer = (list.body?.items || []).find((item: any) =>
              String(item?.notes?.settlement_id || "") === attempt.settlement_id &&
              Number(item?.amount) === Number(attempt.amount_minor)
            ) || null;
          }
        }
        if (!transfer?.id) {
          results.still_unknown++;
          continue;
        }
        const destination = Array.isArray(attempt.destination)
          ? attempt.destination[0]?.provider_reference
          : attempt.destination?.provider_reference;
        if (
          Number(transfer.amount) !== Number(attempt.amount_minor) ||
          String(transfer.currency || "").toUpperCase() !== "INR" ||
          String(transfer.recipient || transfer.account || "") !== destination ||
          String(transfer.notes?.settlement_id || "") !== attempt.settlement_id
        ) {
          throw new Error(`transfer_identity_mismatch:${attempt.id}`);
        }
        const status = String(transfer.status).toLowerCase();
        if (status === "processed") {
          const { data: finalized, error: finalizeError } = await supabase.rpc(
            "finalize_seller_payout",
            {
              p_attempt_id: attempt.id,
              p_provider_transfer_id: transfer.id,
            },
          );
          if (finalizeError || finalized?.finalized !== true) {
            throw new Error(
              `payout_finalize_failed:${finalizeError?.message || "not_finalized"}`,
            );
          }
          results.payouts_recovered++;
        } else if (status === "failed" || status === "reversed") {
          const { error: holdError } = await supabase.rpc(
            "hold_failed_seller_payout",
            {
              p_attempt_id: attempt.id,
              p_unknown: false,
              p_error: `provider_terminal_${status}`,
              p_provider_transfer_id: transfer.id,
            },
          );
          if (holdError) throw holdError;
        } else {
          results.still_unknown++;
        }
      } catch (error) {
        results.errors.push(String(error));
      }
    }

    return new Response(JSON.stringify({ ok: results.errors.length === 0, ...results }), {
      status: results.errors.length === 0 ? 200 : 409,
      headers: jsonHeaders,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
