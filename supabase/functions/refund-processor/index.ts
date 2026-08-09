// Refund Processor Edge Function
// Executes real Razorpay refunds — never simulates success.
// P4: partial refunds against shared checkout-group captures.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";
import { getRazorpayCredentials } from "../_shared/credentials.ts";
import {
  checkFinancialRuntime,
  financialRuntimeUnavailableResponse,
} from "../_shared/financial-runtime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ProcessRequest {
  refund_id: string;
}

async function getRazorpayKeys(supabase: any): Promise<{ keyId: string; keySecret: string } | null> {
  const keys = await getRazorpayCredentials(supabase);
  if (!keys.keyId || !keys.keySecret) return null;
  return keys;
}

async function fetchPaymentRefundable(
  keys: { keyId: string; keySecret: string },
  paymentId: string,
): Promise<{ amountPaise: number; amountRefundedPaise: number; status: string } | null> {
  const auth = "Basic " + btoa(`${keys.keyId}:${keys.keySecret}`);
  const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
    headers: { Authorization: auth },
  });
  const raw = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("[refund-processor] payment fetch failed", paymentId, raw);
    return null;
  }
  return {
    amountPaise: Number(raw.amount || 0),
    amountRefundedPaise: Number(raw.amount_refunded || 0),
    status: String(raw.status || ""),
  };
}

async function callRazorpayRefund(
  keys: { keyId: string; keySecret: string },
  paymentId: string,
  amountRupees: number,
  refundId: string,
  opts?: { reverseAll?: boolean },
): Promise<{
  ok: boolean;
  reference: string;
  status: string;
  raw: any;
  failureState?: "failed" | "unknown";
  error?: string;
}> {
  const amountPaise = Math.round(Number(amountRupees) * 100);
  const auth = "Basic " + btoa(`${keys.keyId}:${keys.keySecret}`);

  const body: Record<string, unknown> = {
    amount: amountPaise,
    notes: { refund_request_id: refundId, sociva_partial: true },
  };
  // Route: reverse linked transfers when this refund covers the full remaining capture
  if (opts?.reverseAll) {
    body.reverse_all = 1;
  }

  let res: Response;
  try {
    res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
        "X-Razorpay-Idempotency-Key": `refund-${refundId}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return {
      ok: false,
      reference: "",
      status: "unknown",
      raw: {},
      failureState: "unknown",
      error: `refund_request_timeout:${String(error)}`,
    };
  }

  const raw = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      reference: "",
      status: "failed",
      raw,
      failureState: res.status >= 500 || res.status === 429 ? "unknown" : "failed",
      error: raw?.error?.description || raw?.error?.reason || `HTTP ${res.status}`,
    };
  }

  if (!raw.id) {
    return {
      ok: false,
      reference: "",
      status: String(raw.status || "unknown"),
      raw,
      failureState: "unknown",
      error: "razorpay_refund_missing_provider_id",
    };
  }

  return {
    ok: true,
    reference: raw.id,
    status: raw.status || "processed",
    raw,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const runtime = await checkFinancialRuntime(
      supabase,
      "refund_ready",
      "refund_processing_enabled",
    );
    if (!runtime.ready) {
      return financialRuntimeUnavailableResponse(runtime, corsHeaders);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const isService = authHeader === `Bearer ${serviceKey}`;
    const isCron = req.headers.get("x-cron-secret") === Deno.env.get("CRON_SECRET");
    let callerUserId: string | null = null;

    if (!isService && !isCron) {
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      callerUserId = user.id;
    }

    const body = (await req.json().catch(() => ({}))) as ProcessRequest;
    if (!body.refund_id) {
      return new Response(JSON.stringify({ error: "refund_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: refund, error: fetchErr } = await supabase
      .from("refund_requests")
      .select("id, refund_state, amount, order_id, buyer_id, refund_destination, wallet_credit_amount")
      .eq("id", body.refund_id)
      .single();

    if (fetchErr || !refund) {
      return new Response(JSON.stringify({ error: "Refund not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ownership: seller of order, admin, or service/cron
    if (callerUserId) {
      const { data: order } = await supabase
        .from("orders")
        .select("seller_id")
        .eq("id", refund.order_id)
        .single();

      const { data: sellerProfile } = order?.seller_id
        ? await supabase
            .from("seller_profiles")
            .select("user_id")
            .eq("id", order.seller_id)
            .maybeSingle()
        : { data: null };

      const { data: isAdmin } = await supabase.rpc("is_admin", { _user_id: callerUserId });
      const isSellerOwner = sellerProfile?.user_id === callerUserId;

      if (!isSellerOwner && !isAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (refund.refund_state === "refund_completed" || refund.refund_state === "settled") {
      return new Response(
        JSON.stringify({
          ok: true,
          skipped: true,
          state: refund.refund_state,
          message: `Refund already completed`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (refund.refund_state !== "approved") {
      return new Response(
        JSON.stringify({
          ok: true,
          skipped: true,
          state: refund.refund_state,
          message: `Refund already in state ${refund.refund_state}`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Sociva Credit path: skip Razorpay, credit wallet + complete
    const destination = (refund as { refund_destination?: string }).refund_destination || "original_payment";
    if (destination === "wallet") {
      const { data: walletFlag } = await supabase
        .from("financial_feature_flags")
        .select("enabled")
        .eq("key", "wallet_refund_credit_enabled")
        .maybeSingle();
      if (walletFlag?.enabled !== true) {
        await supabase
          .from("refund_requests")
          .update({
            refund_state: "needs_manual_review",
            notes: "needs_manual_review: wallet refund credit is disabled",
            updated_at: new Date().toISOString(),
          })
          .eq("id", refund.id)
          .eq("refund_state", "approved");
        return new Response(
          JSON.stringify({
            ok: false,
            state: "needs_manual_review",
            error: "wallet_refund_credit_disabled",
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      // Claim mutex: prevents concurrent cron ticks from double-crediting the wallet.
      // Uses the same claim_refund_attempt RPC as the Razorpay path, with a sentinel
      // provider_payment_id so the attempt row is identifiable in audits.
      const { data: walletClaim, error: walletClaimErr } = await supabase.rpc(
        "claim_refund_attempt",
        {
          p_refund_id: refund.id,
          p_provider_payment_id: `wallet:${refund.id}`,
          p_request_key: `wallet-refund-${refund.id}`,
          p_amount_minor: Math.round(Number(refund.amount) * 100),
        },
      );
      if (walletClaimErr) {
        return new Response(JSON.stringify({ ok: false, error: walletClaimErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (walletClaim?.claimed !== true || !walletClaim?.attempt_id) {
        return new Response(
          JSON.stringify({
            ok: true,
            deduplicated: walletClaim?.deduplicated === true,
            state: walletClaim?.status || walletClaim?.reason || "not_claimed",
            destination: "wallet",
          }),
          {
            status: walletClaim?.status === "succeeded" ? 200 : 202,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const { data: walletDone, error: walletErr } = await supabase.rpc("complete_wallet_refund", {
        p_refund_id: refund.id,
      });
      if (walletErr) {
        console.error("[refund-processor] wallet refund failed", walletErr);
        await supabase.rpc("fail_refund", {
          p_refund_id: refund.id,
          p_reason: walletErr.message || "Wallet credit failed",
        });
        return new Response(
          JSON.stringify({ ok: false, state: "refund_failed", error: walletErr.message, destination: "wallet" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      console.log(`[refund-processor] completed wallet refund ${refund.id}`);
      return new Response(
        JSON.stringify({
          ok: true,
          state: "refund_completed",
          destination: "wallet",
          gateway_ref: walletDone?.gateway_refund_id || null,
          simulated: false,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const keys = await getRazorpayKeys(supabase);
    if (!keys) {
      return new Response(
        JSON.stringify({
          error: "Refund gateway not configured. Set Razorpay keys before processing refunds.",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // P4: resolve payment from order OR checkout_group; amount = child share
    const { data: gwCtx, error: ctxErr } = await supabase.rpc("resolve_refund_gateway_context", {
      p_refund_id: refund.id,
    });
    if (ctxErr) {
      console.error("[refund-processor] resolve context failed", ctxErr);
    }
    const ctx = (gwCtx || {}) as {
      ok?: boolean;
      razorpay_payment_id?: string;
      amount?: number;
      is_partial?: boolean;
      checkout_group_id?: string;
    };

    let paymentId = ctx.razorpay_payment_id || null;
    if (!paymentId) {
      const { data: orderPay } = await supabase
        .from("orders")
        .select("razorpay_payment_id, checkout_group_id")
        .eq("id", refund.order_id)
        .single();
      paymentId = orderPay?.razorpay_payment_id || null;
      if (!paymentId && orderPay?.checkout_group_id) {
        const { data: group } = await supabase
          .from("checkout_groups")
          .select("razorpay_payment_id")
          .eq("id", orderPay.checkout_group_id)
          .maybeSingle();
        paymentId = group?.razorpay_payment_id || null;
      }
    }

    if (!paymentId) {
      // Never silently change the buyer's chosen refund destination. Missing
      // payment identity requires an operator to establish the original rail.
      console.warn(`[refund-processor] no razorpay_payment_id for ${refund.id} — manual review`);
      await supabase
        .from("refund_requests")
        .update({
          refund_state: "needs_manual_review",
          notes: "needs_manual_review: original payment reference is missing",
          updated_at: new Date().toISOString(),
        })
        .eq("id", refund.id)
        .eq("refund_state", "approved");
      return new Response(
        JSON.stringify({
          ok: false,
          state: "needs_manual_review",
          error: "missing_original_payment_reference",
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // P0: ignore client-stored refund.amount — recompute from order server-side only
    let gatewayRefundAmount = Number(ctx.amount);
    if (!Number.isFinite(gatewayRefundAmount) || gatewayRefundAmount <= 0) {
      const { data: recomputed } = await supabase.rpc("compute_child_gateway_refund_amount", {
        _order_id: refund.order_id,
      });
      gatewayRefundAmount = Number(recomputed);
    }
    if (!Number.isFinite(gatewayRefundAmount) || gatewayRefundAmount <= 0) {
      await supabase.rpc("fail_refund", {
        p_refund_id: refund.id,
        p_reason: "Server could not compute refund amount from order",
      });
      return new Response(
        JSON.stringify({ ok: false, state: "refund_failed", error: "uncomputable_refund_amount" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Cap against live Razorpay remaining (partial refunds must not overshoot)
    const live = await fetchPaymentRefundable(keys, paymentId);
    if (!live) {
      await supabase
        .from("refund_requests")
        .update({
          refund_state: "needs_manual_review",
          notes: "needs_manual_review: Razorpay refundable amount could not be verified",
          updated_at: new Date().toISOString(),
        })
        .eq("id", refund.id)
        .eq("refund_state", "approved");
      return new Response(
        JSON.stringify({ ok: false, state: "needs_manual_review", error: "provider_state_unknown" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const remainingRupees = Math.max(0, (live.amountPaise - live.amountRefundedPaise) / 100);
    if (remainingRupees <= 0) {
      // An aggregate refunded amount cannot identify which partial child refund
      // succeeded. Exact provider refund identity is required.
      await supabase
        .from("refund_requests")
        .update({
          refund_state: "needs_manual_review",
          notes: "needs_manual_review: payment is fully refunded but exact refund entity is unbound",
          updated_at: new Date().toISOString(),
        })
        .eq("id", refund.id)
        .eq("refund_state", "approved");
      return new Response(
        JSON.stringify({ ok: false, state: "needs_manual_review", error: "exact_refund_reference_required" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (remainingRupees + 0.001 < gatewayRefundAmount) {
      await supabase
        .from("refund_requests")
        .update({
          refund_state: "needs_manual_review",
          notes: `needs_manual_review: requested gateway refund ${gatewayRefundAmount} exceeds provider remaining ${remainingRupees}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", refund.id)
        .eq("refund_state", "approved");
      return new Response(
        JSON.stringify({ ok: false, state: "needs_manual_review", error: "insufficient_provider_refundable_amount" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Round to paise-safe 2dp
    gatewayRefundAmount = Math.round(gatewayRefundAmount * 100) / 100;
    if (gatewayRefundAmount < 0.01) {
      await supabase.rpc("fail_refund", {
        p_refund_id: refund.id,
        p_reason: "Computed gateway refund amount is zero",
      });
      return new Response(
        JSON.stringify({ ok: false, state: "refund_failed", error: "zero_refund_amount" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const remainingAfter =
      (live.amountPaise - live.amountRefundedPaise) / 100 - gatewayRefundAmount;
    const reverseAll = remainingAfter < 0.01;

    const requestKey = `refund-${refund.id}`;
    const { data: refundAttempt, error: attemptErr } = await supabase.rpc(
      "claim_refund_attempt",
      {
        p_refund_id: refund.id,
        p_provider_payment_id: paymentId,
        p_request_key: requestKey,
        p_amount_minor: Math.round(gatewayRefundAmount * 100),
      },
    );
    if (attemptErr) {
      return new Response(
        JSON.stringify({ ok: false, error: attemptErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (refundAttempt?.claimed !== true || !refundAttempt?.attempt_id) {
      return new Response(
        JSON.stringify({
          ok: true,
          deduplicated: refundAttempt?.deduplicated === true,
          state: refundAttempt?.status || refundAttempt?.reason || "not_claimed",
          gateway_ref: refundAttempt?.provider_refund_id || null,
          provider_status: refundAttempt?.provider_status || null,
        }),
        {
          status: refundAttempt?.status === "succeeded" ? 200 : 202,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const refundAttemptId = String(refundAttempt.attempt_id);

    const gw = await callRazorpayRefund(keys, paymentId, gatewayRefundAmount, refund.id, {
      reverseAll,
    });

    if (gw.ok) {
      if (String(gw.status).toLowerCase() !== "processed") {
        await supabase
          .from("refund_attempts")
          .update({
            status: "processing",
            provider_refund_id: gw.reference,
            provider_status: gw.status,
            updated_at: new Date().toISOString(),
          })
          .eq("id", refundAttemptId);
        return new Response(
          JSON.stringify({
            ok: true,
            state: "refund_processing",
            gateway_ref: gw.reference,
            provider_status: gw.status,
          }),
          { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      await supabase
        .from("refund_attempts")
        .update({
          status: "succeeded",
          provider_refund_id: gw.reference,
          provider_status: gw.status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", refundAttemptId);
      const { error: doneErr } = await supabase.rpc("complete_refund", {
        p_refund_id: refund.id,
        p_gateway_ref: gw.reference,
        p_gateway_status: gw.status,
      });
      if (doneErr) {
        console.error("[refund-processor] complete failed", doneErr);
        return new Response(JSON.stringify({ error: doneErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.log(
        `[refund-processor] completed refund ${refund.id} ref=${gw.reference} amount=${gatewayRefundAmount} partial=${ctx.is_partial} reverse_all=${reverseAll}`,
      );
      return new Response(
        JSON.stringify({
          ok: true,
          state: "refund_completed",
          gateway_ref: gw.reference,
          amount: gatewayRefundAmount,
          partial: !!ctx.is_partial,
          reverse_all: reverseAll,
          simulated: false,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const unknownOutcome = gw.failureState === "unknown";
    await supabase
      .from("refund_attempts")
      .update({
        status: unknownOutcome ? "reconciliation_required" : "failed",
        provider_status: gw.status,
        error_message: gw.error || "Gateway error",
        updated_at: new Date().toISOString(),
      })
      .eq("id", refundAttemptId);
    if (unknownOutcome) {
      await supabase
        .from("refund_requests")
        .update({
          refund_state: "needs_manual_review",
          notes: `needs_manual_review: provider outcome unknown: ${gw.error || "unknown"}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", refund.id)
        .eq("refund_state", "refund_initiated");
    } else {
      await supabase.rpc("fail_refund", {
        p_refund_id: refund.id,
        p_reason: gw.error || "Gateway error",
      });
    }
    return new Response(
      JSON.stringify({
        ok: false,
        state: unknownOutcome ? "needs_manual_review" : "refund_failed",
        error: gw.error,
        simulated: false,
      }),
      { status: unknownOutcome ? 409 : 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[refund-processor] error", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
