import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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
    const authHeader = req.headers.get("Authorization") || "";
    const isService = authHeader === `Bearer ${supabaseServiceKey}`;

    if (!isService) {
      const { withAuth } = await import("../_shared/auth.ts");
      const authResult = await withAuth(req, corsHeaders);
      if (authResult instanceof Response) return authResult;
    }

    const body = await req.json();
    const paymentId = String(body.razorpay_payment_id || "");
    const orderId = String(body.razorpay_order_id || "");
    const purchaseId = String(body.purchase_id || "");
    if (!paymentId || !purchaseId) {
      return new Response(JSON.stringify({ error: "purchase_id and razorpay_payment_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const keys = await getRazorpayCredentials(supabase);
    const payRes = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
      headers: { Authorization: "Basic " + btoa(`${keys.keyId}:${keys.keySecret}`) },
    });
    const payment = await payRes.json();
    if (!payRes.ok || payment.status !== "captured") {
      return new Response(JSON.stringify({ error: "Payment failed. Your Sociva Credits were not added." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (orderId && payment.order_id && payment.order_id !== orderId) {
      return new Response(JSON.stringify({ error: "Payment order mismatch" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await supabase.rpc("confirm_seller_credit_purchase", {
      p_purchase_id: purchaseId,
      p_provider_payment_id: paymentId,
      p_provider_order_id: payment.order_id || orderId || null,
      p_amount: Number(payment.amount) / 100,
    });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, ...data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "confirm_failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
