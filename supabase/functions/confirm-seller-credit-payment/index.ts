import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getWorkingRazorpayCredentials } from "../_shared/credentials.ts";
import { verifyRazorpayCheckoutSignature } from "../_shared/razorpay-signature.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limiter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const authHeader = req.headers.get("Authorization") || "";
    const isService = authHeader === `Bearer ${supabaseServiceKey}`;

    let userId: string | null = null;
    if (!isService) {
      const { withAuth } = await import("../_shared/auth.ts");
      const authResult = await withAuth(req, corsHeaders);
      if (authResult instanceof Response) return authResult;
      userId = authResult.userId;
      const { allowed } = await checkRateLimit(`seller-credit-confirm:${userId}`, 12, 60);
      if (!allowed) return rateLimitResponse(corsHeaders);
    }

    const body = await req.json();
    const paymentId = String(body.razorpay_payment_id || "").trim();
    const clientOrderId = String(body.razorpay_order_id || "").trim();
    const clientPurchaseId = String(body.purchase_id || "").trim();
    const checkoutSignature = String(body.razorpay_signature || "").trim();
    const source = String(body.source || "").trim();

    if (!paymentId) {
      return json({ error: "razorpay_payment_id required" }, 400);
    }
    if (!isService && !checkoutSignature) {
      return json({ error: "Payment signature required" }, 400);
    }
    if (isService && source !== "webhook") {
      return json({ error: "service confirmation requires webhook source" }, 403);
    }

    const keys = await getWorkingRazorpayCredentials(supabase);
    if (!keys.keyId || !keys.keySecret) {
      return json({ error: "Payment gateway not configured. Please contact admin." }, 503);
    }
    const payRes = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
      headers: { Authorization: "Basic " + btoa(`${keys.keyId}:${keys.keySecret}`) },
    });
    const payment = await payRes.json();
    if (!payRes.ok) {
      return json({ error: "Could not verify payment status." }, 400);
    }
    if (payment.status === "authorized" || payment.status === "created" || payment.status === "pending") {
      return json({
        error: "Payment is still being confirmed. Your Sociva Credits will appear after verification.",
        pending: true,
      }, 202);
    }
    if (payment.status !== "captured") {
      return json({ error: "Payment failed. Your Sociva Credits were not added." }, 400);
    }

    const providerOrderId = String(payment.order_id || "").trim();
    if (!providerOrderId) {
      return json({ error: "Payment is not linked to a Razorpay order." }, 400);
    }
    if (clientOrderId && clientOrderId !== providerOrderId) {
      return json({ error: "Payment order mismatch" }, 400);
    }
    if (String(payment.currency || "INR").toUpperCase() !== "INR") {
      return json({ error: "Payment currency mismatch" }, 400);
    }

    if (!isService) {
      const signed = await verifyRazorpayCheckoutSignature(
        providerOrderId,
        paymentId,
        checkoutSignature,
        keys.keySecret,
      );
      if (!signed) {
        return json({ error: "Payment signature verification failed" }, 401);
      }
    }

    const orderRes = await fetch(`https://api.razorpay.com/v1/orders/${providerOrderId}`, {
      headers: { Authorization: "Basic " + btoa(`${keys.keyId}:${keys.keySecret}`) },
    });
    const rzpOrder = await orderRes.json();
    if (!orderRes.ok || !rzpOrder?.id) {
      return json({ error: "Could not verify payment order." }, 400);
    }

    const notes = {
      ...(rzpOrder.notes || {}),
      ...(payment.notes || {}),
    };
    const notePurchaseId = String(notes.purchase_id || "").trim();
    const notePurpose = String(notes.purpose || "").trim();
    if (notePurpose !== "seller_credit_purchase") {
      return json({ error: "Payment is not a Sociva Credit purchase." }, 400);
    }

    const { data: purchaseByOrder, error: orderLookupError } = await supabase
      .from("seller_credit_purchases")
      .select("id, seller_id, amount, status, provider_order_id, provider_payment_id")
      .eq("provider", "razorpay")
      .eq("provider_order_id", providerOrderId)
      .maybeSingle();
    if (orderLookupError) {
      return json({ error: "Could not load credit purchase." }, 400);
    }
    let purchase = purchaseByOrder;
    if (!purchase?.id) {
      const candidateId = notePurchaseId || clientPurchaseId;
      if (!candidateId) {
        return json({ error: "No credit purchase is bound to this payment order." }, 400);
      }
      const { data: purchaseById, error: idLookupError } = await supabase
        .from("seller_credit_purchases")
        .select("id, seller_id, amount, status, provider_order_id, provider_payment_id")
        .eq("id", candidateId)
        .eq("provider", "razorpay")
        .maybeSingle();
      if (idLookupError) {
        return json({ error: "Could not load credit purchase." }, 400);
      }
      if (
        !purchaseById?.id
        || (purchaseById.provider_order_id && purchaseById.provider_order_id !== providerOrderId)
      ) {
        return json({ error: "No credit purchase is bound to this payment order." }, 400);
      }
      purchase = purchaseById;
    }
    if (clientPurchaseId && clientPurchaseId !== purchase.id) {
      return json({ error: "Payment does not belong to this credit purchase." }, 400);
    }
    if (notePurchaseId && notePurchaseId !== purchase.id) {
      return json({ error: "Payment notes do not match this credit purchase." }, 400);
    }

    if (!isService) {
      const { data: seller } = await supabase
        .from("seller_profiles")
        .select("user_id")
        .eq("id", purchase.seller_id)
        .maybeSingle();
      if (!seller?.user_id || seller.user_id !== userId) {
        return json({ error: "seller scope forbidden" }, 403);
      }
    }

    const paidAmount = Number(payment.amount) / 100;
    const orderAmount = Number(rzpOrder.amount) / 100;
    const purchaseAmount = Number(purchase.amount);
    if (
      !Number.isFinite(paidAmount) ||
      paidAmount !== purchaseAmount ||
      orderAmount !== purchaseAmount
    ) {
      return json({ error: "credit purchase amount mismatch" }, 400);
    }

    const { data, error } = await supabase.rpc("confirm_seller_credit_purchase", {
      p_purchase_id: purchase.id,
      p_provider_payment_id: paymentId,
      p_provider_order_id: providerOrderId,
      p_amount: paidAmount,
    });
    if (error) {
      return json({ error: error.message }, 400);
    }
    return json({ ok: true, ...data });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "confirm_failed" }, 500);
  }
});
