import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function getRazorpayCredentials(supabase: any) {
  const { data: rows } = await supabase
    .from("admin_settings")
    .select("key, value, is_active")
    .in("key", ["razorpay_key_id", "razorpay_key_secret"]);

  const map: Record<string, string> = {};
  for (const r of rows || []) {
    if (r.value && r.is_active) map[r.key] = r.value;
  }

  return {
    keyId: map.razorpay_key_id || Deno.env.get("RAZORPAY_KEY_ID") || "",
    keySecret: map.razorpay_key_secret || Deno.env.get("RAZORPAY_KEY_SECRET") || "",
  };
}

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

    // Auth: JWT buyer OR service-role (webhook/cron)
    const authHeader = req.headers.get("Authorization") || "";
    const isService = authHeader === `Bearer ${supabaseServiceKey}`;
    let callerUserId: string | null = null;

    if (!isService) {
      const { withAuth } = await import("../_shared/auth.ts");
      const authResult = await withAuth(req, corsHeaders);
      if (authResult instanceof Response) return authResult;
      callerUserId = authResult.userId;
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { razorpay_payment_id, razorpay_order_id, order_ids } = body;
    const source = body.source || (isService ? "service" : "client_confirm");

    if (
      (!razorpay_payment_id && !razorpay_order_id) ||
      !order_ids ||
      !Array.isArray(order_ids) ||
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

    // Load orders from DB — amount and ownership come from DB only
    const { data: orders, error: ordersErr } = await supabase
      .from("orders")
      .select("id, buyer_id, seller_id, total_amount, society_id, status, payment_status, razorpay_order_id, platform_fee, net_amount")
      .in("id", order_ids);

    if (ordersErr || !orders || orders.length !== order_ids.length) {
      return new Response(JSON.stringify({ error: "One or more orders not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
      if (paymentEntity.status !== "captured" && paymentEntity.status !== "authorized") {
        return new Response(
          JSON.stringify({ error: "Payment not confirmed", status: paymentEntity.status }),
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
        ? items.find((p: any) => p.status === "captured" || p.status === "authorized")
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

    // Amount binding (allow 1 paise rounding)
    const paidPaise = Number(paymentEntity.amount || 0);
    if (Math.abs(paidPaise - expectedPaise) > 1) {
      console.error(`[confirm] amount mismatch paid=${paidPaise} expected=${expectedPaise}`);
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
      const missing = order_ids.filter((id: string) => !noteIds.includes(id));
      if (missing.length > 0) {
        return new Response(
          JSON.stringify({ error: "Payment notes do not include these orders" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const results: { id: string; success: boolean; skipped?: boolean }[] = [];
    const now = new Date().toISOString();

    for (const orderData of orders) {
      const orderId = orderData.id;

      if (orderData.payment_status === "paid") {
        results.push({ id: orderId, success: true, skipped: true });
        continue;
      }

      const { error: payRecErr } = await supabase.from("payment_records").upsert(
        {
          order_id: orderId,
          buyer_id: orderData.buyer_id,
          // Per-order seller_id — critical for multi-store platform-collect so each
          // settlement row (created on delivery) attributes the right seller.
          seller_id: orderData.seller_id,
          amount: orderData.total_amount,
          platform_fee: Number(orderData.platform_fee || 0),
          net_amount: Number(
            orderData.net_amount != null
              ? orderData.net_amount
              : Number(orderData.total_amount || 0) - Number(orderData.platform_fee || 0),
          ),
          razorpay_payment_id: verifiedPaymentId,
          payment_status: "paid",
          payment_method: "online",
          transaction_reference: verifiedPaymentId,
          payment_collection: "direct",
          payment_mode: "online",
          society_id: orderData.society_id,
        },
        { onConflict: "order_id", ignoreDuplicates: false }
      );
      if (payRecErr) {
        console.error("payment_records upsert failed for order", orderId, payRecErr);
        results.push({ id: orderId, success: false });
        continue;
      }

      const { data: updated, error: updateErr } = await supabase
        .from("orders")
        .update({
          status: "placed",
          payment_status: "paid",
          razorpay_payment_id: verifiedPaymentId,
          auto_cancel_at: null,
          updated_at: now,
        })
        .eq("id", orderId)
        .in("status", ["payment_pending", "placed"])
        .in("payment_status", ["pending"])
        .select("id");

      if (updateErr) {
        results.push({ id: orderId, success: false });
        continue;
      }

      if (!updated || updated.length === 0) {
        const { data: cancelledOrder } = await supabase
          .from("orders")
          .select("id")
          .eq("id", orderId)
          .eq("status", "cancelled")
          .eq("payment_status", "pending")
          .maybeSingle();

        if (cancelledOrder) {
          const { error: resurrectErr } = await supabase
            .from("orders")
            .update({
              status: "placed",
              payment_status: "paid",
              razorpay_payment_id: verifiedPaymentId,
              rejection_reason: null,
              auto_cancel_at: null,
              updated_at: now,
            })
            .eq("id", orderId)
            .eq("status", "cancelled");

          results.push({ id: orderId, success: !resurrectErr });
          continue;
        }

        results.push({ id: orderId, success: true, skipped: true });
        continue;
      }

      results.push({ id: orderId, success: true });
    }

    const successCount = results.filter((r) => r.success && !r.skipped).length;
    const allOk = results.every((r) => r.success);

    if (successCount > 0) {
      setTimeout(() => {
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
      JSON.stringify({ success: allOk, confirmed: successCount, results }),
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
