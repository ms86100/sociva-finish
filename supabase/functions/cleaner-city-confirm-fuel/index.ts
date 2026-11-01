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

    const { withAuth } = await import("../_shared/auth.ts");
    const authResult = await withAuth(req, corsHeaders);
    if (authResult instanceof Response) return authResult;
    const { allowed } = await checkRateLimit(`cc-fuel-confirm:${authResult.userId}`, 12, 60);
    if (!allowed) return rateLimitResponse(corsHeaders);

    const body = await req.json();
    const paymentId = String(body.payment_id || "").trim();
    const razorpayPaymentId = String(body.razorpay_payment_id || "").trim();
    const razorpayOrderId = String(body.razorpay_order_id || "").trim();
    const signature = String(body.razorpay_signature || "").trim();
    if (!paymentId || !razorpayPaymentId || !razorpayOrderId || !signature) {
      return json({ error: "Payment confirmation is incomplete" }, 400);
    }

    const keys = await getWorkingRazorpayCredentials(supabase);
    if (!keys.keyId || !keys.keySecret) {
      return json({ error: "Payment gateway not configured. Please contact admin." }, 503);
    }
    const valid = await verifyRazorpayCheckoutSignature(
      razorpayOrderId,
      razorpayPaymentId,
      signature,
      keys.keySecret,
    );
    if (!valid) return json({ error: "Payment signature did not match" }, 400);

    const payRes = await fetch(`https://api.razorpay.com/v1/payments/${razorpayPaymentId}`, {
      headers: { Authorization: "Basic " + btoa(`${keys.keyId}:${keys.keySecret}`) },
    });
    const payment = await payRes.json();
    if (!payRes.ok) return json({ error: "Could not verify payment status." }, 400);
    if (payment.status !== "captured") {
      return json({ error: "Payment is not captured yet.", pending: payment.status !== "failed" }, 202);
    }
    if (String(payment.order_id || "") !== razorpayOrderId) {
      return json({ error: "Payment is not linked to this fuel order." }, 400);
    }

    const { data, error } = await supabase.rpc("cleaner_city_confirm_fuel_payment", {
      p_payment_id: paymentId,
      p_razorpay_order_id: razorpayOrderId,
      p_razorpay_payment_id: razorpayPaymentId,
    });
    if (error) return json({ error: error.message }, 400);
    return json({
      ok: true,
      status: data?.status || "paid",
      payout_status: data?.payout_status || "payable",
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "fuel_confirm_failed" }, 500);
  }
});
