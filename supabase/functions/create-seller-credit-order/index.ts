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
    if (!sellerId || !packageId) {
      return new Response(JSON.stringify({ error: "seller_id and package_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: created, error: createError } = await authResult.userClient.rpc(
      "create_seller_credit_purchase",
      { p_seller_id: sellerId, p_package_id: packageId },
    );
    if (createError || !created?.ok) {
      return new Response(JSON.stringify({ error: createError?.message || "Could not start credit purchase" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const keys = await getRazorpayCredentials(supabase);
    if (!keys.keyId || !keys.keySecret) {
      return new Response(JSON.stringify({ error: "Payment gateway not configured. Please contact admin." }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const amountPaise = Math.round(Number(created.amount) * 100);
    const receipt = `scred_${String(created.purchase_id).replace(/-/g, "").slice(0, 32)}`;
    const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${keys.keyId}:${keys.keySecret}`),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt,
        notes: {
          purpose: "seller_credit_purchase",
          seller_id: sellerId,
          purchase_id: created.purchase_id,
        },
      }),
    });
    const rzp = await rzpRes.json();
    if (!rzpRes.ok || !rzp.id) {
      await supabase.rpc("fail_seller_credit_purchase", { p_purchase_id: created.purchase_id });
      return new Response(JSON.stringify({ error: "Could not create credit payment." }), {
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
