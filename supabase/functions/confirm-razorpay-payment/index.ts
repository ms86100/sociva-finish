import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getRazorpayCredentials } from "../_shared/credentials.ts";
import {
  checkFinancialRuntime,
  financialRuntimeUnavailableResponse,
} from "../_shared/financial-runtime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function parseNotesOrderIds(notes: any): string[] {
  if (!notes) return [];
  if (notes.order_ids) {
    try {
      const parsed = typeof notes.order_ids === "string" ? JSON.parse(notes.order_ids) : notes.order_ids;
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch { /* fall through */ }
  }
  if (notes.order_id) return [String(notes.order_id)];
  return [];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const runtime = await checkFinancialRuntime(
      supabase,
      "payment_ready",
      "payment_confirm_enabled",
    );
    if (!runtime.ready) {
      return financialRuntimeUnavailableResponse(runtime, corsHeaders);
    }

    // Auth: JWT buyer OR service-role (webhook/cron)
    const authHeader = req.headers.get("Authorization") || "";
    const isService = authHeader === `Bearer ${supabaseServiceKey}`;
    let callerUserId: string | null = null;

    if (!isService) {
      const { withAuth } = await import("../_shared/auth.ts");
      const authResult = await withAuth(req, corsHeaders);
      if (authResult instanceof Response) return authResult;
      callerUserId = authResult.userId;

      // Block new client confirms when Razorpay checkout rail is off.
      // Webhook/cron (service) may still settle in-flight Razorpay payments.
      const { getPaymentGatewayMode, paymentModeBlockedResponse } = await import(
        "../_shared/payment-gateway-mode.ts"
      );
      const gatewayMode = await getPaymentGatewayMode(supabase);
      if (gatewayMode !== "razorpay") {
        return paymentModeBlockedResponse(gatewayMode, "razorpay", corsHeaders);
      }
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { razorpay_payment_id, razorpay_order_id } = body;
    let order_ids: string[] = Array.isArray(body.order_ids) ? body.order_ids.map(String) : [];
    const source = body.source || (isService ? "service" : "client_confirm");

    if (
      (!razorpay_payment_id && !razorpay_order_id) ||
      !order_ids ||
      order_ids.length === 0
    ) {
      return new Response(
        JSON.stringify({ error: "Missing razorpay_payment_id/razorpay_order_id or order_ids" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const creds = await getRazorpayCredentials(supabase);
    if (!creds.keyId || !creds.keySecret) {
      return new Response(JSON.stringify({ error: "Payment gateway not configured" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authBasic = "Basic " + btoa(`${creds.keyId}:${creds.keySecret}`);

    // Load seed orders, then expand ALL siblings via checkout_group_id BEFORE amount check
    const { data: seedOrders, error: seedErr } = await supabase
      .from("orders")
      .select("id, buyer_id, seller_id, total_amount, society_id, status, payment_status, razorpay_order_id, net_amount, loyalty_reservation_id, loyalty_discount_amount, loyalty_points_redeemed, checkout_group_id")
      .in("id", order_ids);

    if (seedErr || !seedOrders || seedOrders.length === 0) {
      return new Response(JSON.stringify({ error: "One or more orders not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const groupIds = Array.from(
      new Set(
        seedOrders
          .map((o: any) => o.checkout_group_id)
          .filter((id: string | null | undefined) => !!id),
      ),
    ) as string[];

    let orders = seedOrders as any[];
    if (groupIds.length > 0) {
      const { data: siblings, error: sibErr } = await supabase
        .from("orders")
        .select("id, buyer_id, seller_id, total_amount, society_id, status, payment_status, razorpay_order_id, net_amount, loyalty_reservation_id, loyalty_discount_amount, loyalty_points_redeemed, checkout_group_id")
        .in("checkout_group_id", groupIds);

      if (sibErr || !siblings?.length) {
        return new Response(JSON.stringify({ error: "Failed to resolve checkout group siblings" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      orders = siblings;
      order_ids = siblings.map((o: any) => o.id);
      console.log(`[confirm] expanded checkout_group siblings → ${order_ids.length} orders`, groupIds);
    } else if (seedOrders.length !== order_ids.length) {
      return new Response(JSON.stringify({ error: "One or more orders not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    orders = [...orders].sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));
    order_ids = orders.map((o: any) => o.id);

    if (callerUserId) {
      const unauthorized = orders.some((o: any) => o.buyer_id !== callerUserId);
      if (unauthorized) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const expectedPaise = Math.round(
      orders.reduce((sum: number, o: any) => sum + Number(o.total_amount || 0), 0) * 100
    );
    const expectedRzpOrderId = orders[0]?.razorpay_order_id || razorpay_order_id;

    let verifiedPaymentId = razorpay_payment_id;
    let paymentEntity: any = null;

    if (razorpay_payment_id && razorpay_payment_id !== "reconciled") {
      const rzpResponse = await fetch(
        `https://api.razorpay.com/v1/payments/${razorpay_payment_id}`,
        { headers: { Authorization: authBasic } }
      );
      if (!rzpResponse.ok) {
        return new Response(JSON.stringify({ error: "Payment verification failed" }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      paymentEntity = await rzpResponse.json();
      if (paymentEntity.status !== "captured") {
        return new Response(
          JSON.stringify({
            error: "Payment is not captured",
            status: paymentEntity.status,
            reconciliation_required: paymentEntity.status === "authorized",
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else if (expectedRzpOrderId) {
      const rzpResponse = await fetch(
        `https://api.razorpay.com/v1/orders/${expectedRzpOrderId}/payments`,
        { headers: { Authorization: authBasic } }
      );
      if (!rzpResponse.ok) {
        return new Response(JSON.stringify({ error: "Payment verification failed" }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const data = await rzpResponse.json();
      const items = data.items || data;
      paymentEntity = Array.isArray(items)
        ? items.find((p: any) => p.status === "captured")
        : null;
      if (!paymentEntity) {
        return new Response(
          JSON.stringify({ error: "No captured payment found for this order" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      verifiedPaymentId = paymentEntity.id;
    } else {
      return new Response(JSON.stringify({ error: "Cannot verify payment without ID" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Amount binding against FULL sibling set (allow 1 paise rounding)
    const paidPaise = Number(paymentEntity.amount || 0);
    if (Math.abs(paidPaise - expectedPaise) > 1) {
      console.error(`[confirm] amount mismatch paid=${paidPaise} expected=${expectedPaise} orders=${order_ids.length}`);
      return new Response(
        JSON.stringify({ error: "Payment amount does not match order total" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Bind Razorpay order id when present on payment
    if (paymentEntity.order_id && expectedRzpOrderId && paymentEntity.order_id !== expectedRzpOrderId) {
      console.error(`[confirm] razorpay_order_id mismatch`);
      return new Response(
        JSON.stringify({ error: "Payment does not belong to these orders" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Bind notes order_ids when present
    const noteIds = parseNotesOrderIds(paymentEntity.notes);
    if (noteIds.length > 0) {
      const missingFromNotes = order_ids.filter((id: string) => !noteIds.includes(id));
      if (missingFromNotes.length > 0) {
        return new Response(
          JSON.stringify({
            error: "Payment notes do not include all checkout group orders",
            missing: missingFromNotes,
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ONE DB transaction: provider capture + allocations + payment records +
    // order/group stamps + loyalty/wallet commit.
    const { data: commitData, error: commitErr } = await supabase.rpc(
      "confirm_captured_payment_group",
      {
        p_order_ids: order_ids,
        p_provider_payment_id: verifiedPaymentId,
        p_provider_order_id: paymentEntity.order_id ||
          expectedRzpOrderId ||
          razorpay_order_id ||
          null,
        p_amount_minor: paidPaise,
        p_currency: paymentEntity.currency || "INR",
        p_captured_at: paymentEntity.captured_at
          ? new Date(Number(paymentEntity.captured_at) * 1000).toISOString()
          : new Date().toISOString(),
        p_source: source,
      },
    );

    if (commitErr) {
      console.error("[confirm] atomic commit failed", commitErr);
      if (commitErr.message?.includes("duplicate_capture")) {
        await supabase.from("financial_reconciliation_records").upsert(
          {
            provider: "razorpay",
            reconciliation_date: new Date().toISOString().slice(0, 10),
            reference_type: "payment_capture",
            reference_id: verifiedPaymentId,
            provider_amount_minor: paidPaise,
            status: "open",
            reason: commitErr.message,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "provider,reconciliation_date,reference_type,reference_id" },
        );
      }
      return new Response(
        JSON.stringify({
          success: false,
          error: commitErr.message || "atomic_confirm_failed",
          source,
          order_ids,
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const allOk = commitData?.success === true;
    const successCount = Number(commitData?.confirmed || 0);

    if (allOk) {
      if (successCount > 0) setTimeout(() => {
        fetch(`${supabaseUrl}/functions/v1/process-notification-queue`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseServiceKey}`,
            "Content-Type": "application/json",
          },
          body: "{}",
        }).catch(() => {});
      }, 2000);
    }

    return new Response(
      JSON.stringify({
        success: allOk,
        confirmed: successCount,
        results: commitData?.results || [],
        loyalty: commitData?.loyalty,
        wallet: commitData?.wallet,
        commit_failed: !allOk,
        atomic: true,
        source,
        order_ids: commitData?.order_ids || order_ids,
      }),
      { status: allOk ? 200 : 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("confirm-razorpay-payment error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
