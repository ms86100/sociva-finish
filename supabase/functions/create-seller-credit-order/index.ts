import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limiter.ts";
import { getRazorpayCredentials } from "../_shared/credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { withAuth } = await import("../_shared/auth.ts");
    const authResult = await withAuth(req, corsHeaders);
    if (authResult instanceof Response) return authResult;

    const { allowed } = await checkRateLimit(`seller-credit:${authResult.userId}`, 8, 60);
    if (!allowed) return rateLimitResponse(corsHeaders);

    const body = await req.json();
    const sellerId = String(body.seller_id || "");
    const packageId = String(body.package_id || "");
    const customAmount = Number(body.amount);
    const hasPackage = Boolean(packageId);
    const hasAmount = Number.isFinite(customAmount) && customAmount > 0;
    if (!sellerId || (!hasPackage && !hasAmount)) {
      return new Response(JSON.stringify({ error: "seller_id and package_id or amount required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!hasPackage && customAmount < 100) {
      return new Response(JSON.stringify({ error: "Minimum recharge amount is ₹100" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: created, error: createError } = hasPackage
      ? await authResult.userClient.rpc("create_seller_credit_purchase", {
          p_seller_id: sellerId,
          p_package_id: packageId,
        })
      : await authResult.userClient.rpc("create_seller_credit_purchase_amount", {
          p_seller_id: sellerId,
          p_amount: Math.round(customAmount * 100) / 100,
        });
    if (createError || !created?.ok) {
      return new Response(JSON.stringify({ error: createError?.message || "Could not start credit purchase" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const keys = await getRazorpayCredentials(supabase);
    const keyId = String(keys.keyId || "").trim();
    const keySecret = String(keys.keySecret || "").trim();
    if (!keyId || !keySecret) {
      return new Response(JSON.stringify({ error: "Payment gateway not configured. Please contact admin." }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const amountPaise = Math.round(Number(created.amount) * 100);
    if (!Number.isFinite(amountPaise) || amountPaise < 10000) {
      await supabase.rpc("fail_seller_credit_purchase", { p_purchase_id: created.purchase_id });
      return new Response(JSON.stringify({ error: "Minimum recharge amount is ₹100" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const receipt = `scred_${String(created.purchase_id).replace(/-/g, "").slice(0, 32)}`;
    const razorpayAuth = btoa(`${keyId}:${keySecret}`);
    const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${razorpayAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt,
        payment_capture: 1,
        notes: {
          purpose: "seller_credit_purchase",
          seller_id: String(sellerId),
          purchase_id: String(created.purchase_id),
        },
      }),
    });
    const rzp = await rzpRes.json().catch(() => ({}));
    if (!rzpRes.ok || !rzp.id) {
      const razorpayMessage = rzp?.error?.description || rzp?.error?.reason || rzp?.error?.code;
      console.error("[create-seller-credit-order] Razorpay order failed", {
        status: rzpRes.status,
        purchase_id: created.purchase_id,
        amount_paise: amountPaise,
        razorpay: razorpayMessage || rzp,
      });
      await supabase.rpc("fail_seller_credit_purchase", { p_purchase_id: created.purchase_id });
      return new Response(JSON.stringify({
        error: razorpayMessage
          ? `We couldn't start the recharge: ${razorpayMessage}`
          : "We couldn't complete your recharge. Please try again.",
      }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.rpc("attach_seller_credit_provider_order", {
      p_purchase_id: created.purchase_id,
      p_provider_order_id: rzp.id,
    });

    return new Response(JSON.stringify({
      ok: true,
      purchase_id: created.purchase_id,
      razorpay_order_id: rzp.id,
      key_id: keys.keyId,
      amount_paise: amountPaise,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "credit_order_failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
