import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function getRazorpayCredentials(supabase: any) {
  // Prefer Deno secrets; fall back to admin_settings for edge service_role reads
  const envKeyId = Deno.env.get("RAZORPAY_KEY_ID") || "";
  const envKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET") || "";
  if (envKeyId && envKeySecret) {
    return { keyId: envKeyId, keySecret: envKeySecret };
  }

  const { data: rows } = await supabase
    .from("admin_settings")
    .select("key, value, is_active")
    .in("key", ["razorpay_key_id", "razorpay_key_secret"]);

  const map: Record<string, string> = {};
  for (const r of rows || []) {
    if (r.value && r.is_active) map[r.key] = r.value;
  }

  return {
    keyId: map.razorpay_key_id || envKeyId,
    keySecret: map.razorpay_key_secret || envKeySecret,
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
      .select("id, buyer_id, seller_id, total_amount, society_id, status, payment_status, razorpay_order_id, platform_fee, net_amount, loyalty_reservation_id, loyalty_discount_amount, loyalty_points_redeemed, checkout_group_id")
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
        .select("id, buyer_id, seller_id, total_amount, society_id, status, payment_status, razorpay_order_id, platform_fee, net_amount, loyalty_reservation_id, loyalty_discount_amount, loyalty_points_redeemed, checkout_group_id")
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

    // Bind notes order_ids when present — every DB sibling must appear in notes (or notes subset of siblings)
    const noteIds = parseNotesOrderIds(paymentEntity.notes);
    if (noteIds.length > 0) {
      const missingFromNotes = order_ids.filter((id: string) => !noteIds.includes(id));
      const extraInNotes = noteIds.filter((id: string) => !order_ids.includes(id));
      if (missingFromNotes.length > 0 || extraInNotes.length > 0) {
        // Allow notes to be a subset only if we expanded from a partial client list;
        // after expansion, notes and siblings should match.
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
    }

    const results: { id: string; success: boolean; skipped?: boolean; resurrected?: boolean; error?: string }[] = [];
    const now = new Date().toISOString();
    let hardFailure = false;

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
        results.push({ id: orderId, success: false, error: payRecErr.message });
        hardFailure = true;
        continue;
      }

      // Leave auto_cancel_at alone — DB trigger stamps the 5-minute
      // seller-acceptance deadline when status becomes `placed`.
      const { data: updated, error: updateErr } = await supabase
        .from("orders")
        .update({
          status: "placed",
          payment_status: "paid",
          razorpay_payment_id: verifiedPaymentId,
          updated_at: now,
        })
        .eq("id", orderId)
        .in("status", ["payment_pending", "placed"])
        .in("payment_status", ["pending"])
        .select("id");

      if (updateErr) {
        results.push({ id: orderId, success: false, error: updateErr.message });
        hardFailure = true;
        continue;
      }

      if (!updated || updated.length === 0) {
        // Paid-after-cancel resurrection: only if still pending pay + cancelled.
        // MUST re-hold stock atomically via RPC — never paid with free stock.
        const { data: cancelledOrder } = await supabase
          .from("orders")
          .select("id")
          .eq("id", orderId)
          .eq("status", "cancelled")
          .eq("payment_status", "pending")
          .maybeSingle();

        if (cancelledOrder) {
          const { data: resurrectData, error: resurrectErr } = await supabase.rpc(
            "resurrect_cancelled_order_after_payment",
            {
              p_order_id: orderId,
              p_razorpay_payment_id: verifiedPaymentId,
            },
          );

          if (resurrectErr || resurrectData?.success === false) {
            console.error("[confirm] resurrection failed — leave for refund path", orderId, resurrectErr || resurrectData);
            results.push({
              id: orderId,
              success: false,
              error: resurrectErr?.message || resurrectData?.error || "resurrect_failed",
            });
            hardFailure = true;
            continue;
          }

          results.push({ id: orderId, success: true, resurrected: true });
          continue;
        }

        results.push({ id: orderId, success: true, skipped: true });
        continue;
      }

      results.push({ id: orderId, success: true });
    }

    // After any child failure post-capture: do NOT return silent success
    const successCount = results.filter((r) => r.success && !r.skipped).length;
    let allOk = results.every((r) => r.success) && !hardFailure;

    // Stamp checkout_group payment header when children share a group
    if (groupIds.length > 0 && (allOk || successCount > 0)) {
      for (const groupId of groupIds) {
        const { error: stampErr } = await supabase.rpc("stamp_checkout_group_capture", {
          _group_id: groupId,
          _razorpay_payment_id: verifiedPaymentId,
          _razorpay_order_id: expectedRzpOrderId || razorpay_order_id || null,
        });
        if (stampErr) {
          console.error("[confirm] stamp_checkout_group_capture failed", groupId, stampErr);
          const { error: groupErr } = await supabase
            .from("checkout_groups")
            .update({
              payment_status: "paid",
              razorpay_order_id: expectedRzpOrderId || razorpay_order_id || null,
              razorpay_payment_id: verifiedPaymentId,
              updated_at: now,
            })
            .eq("id", groupId);
          if (groupErr) {
            console.error("[confirm] checkout_groups stamp failed", groupId, groupErr);
          } else {
            try {
              await supabase.rpc("refresh_checkout_group_totals", { _group_id: groupId });
            } catch (refreshErr) {
              console.warn("[confirm] refresh_checkout_group_totals failed", refreshErr);
            }
          }
        }
      }
    }

    // Fail-closed: never success:true if wallet/loyalty commit fails
    let loyaltyCommit: unknown = null;
    let walletCommit: unknown = null;
    let commitFailed = false;

    if (allOk || successCount > 0) {
      try {
        const { data: commitData, error: commitErr } = await supabase.rpc(
          "commit_loyalty_for_orders",
          { _order_ids: order_ids },
        );
        if (commitErr) {
          console.error("[confirm] loyalty commit failed", commitErr);
          commitFailed = true;
        } else {
          loyaltyCommit = commitData;
        }
      } catch (loyaltyErr) {
        console.error("[confirm] loyalty commit exception", loyaltyErr);
        commitFailed = true;
      }

      try {
        const { data: walletData, error: walletErr } = await supabase.rpc(
          "commit_wallet_for_orders",
          { _order_ids: order_ids },
        );
        if (walletErr) {
          console.error("[confirm] wallet commit failed", walletErr);
          commitFailed = true;
        } else {
          walletCommit = walletData;
        }
      } catch (walletEx) {
        console.error("[confirm] wallet commit exception", walletEx);
        commitFailed = true;
      }
    }

    if (commitFailed) {
      allOk = false;
    }

    if (allOk && successCount > 0) {
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
      JSON.stringify({
        success: allOk,
        confirmed: successCount,
        results,
        loyalty: loyaltyCommit,
        wallet: walletCommit,
        commit_failed: commitFailed,
        source,
        order_ids,
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
