import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limiter.ts";
import { getWorkingRazorpayCredentials } from "../_shared/credentials.ts";
import { RAZORPAY_GATEWAY_AUTH_FAILED, razorpayKeyMode } from "../_shared/razorpay-key-pair.ts";

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
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { withAuth } = await import("../_shared/auth.ts");
    const authResult = await withAuth(req, corsHeaders);
    if (authResult instanceof Response) return authResult;

    const { allowed } = await checkRateLimit(`cc-fuel:${authResult.userId}`, 8, 60);
    if (!allowed) return rateLimitResponse(corsHeaders);

    const body = await req.json();
    const rideId = String(body.ride_id || "");
    if (!rideId) return json({ error: "ride_id is required" }, 400);

    const keys = await getWorkingRazorpayCredentials(supabase);
    const keyId = String(keys.keyId || "").trim();
    const keySecret = String(keys.keySecret || "").trim();
    if (!keyId || !keySecret) {
      if (keys.source === "rejected") return json({ error: RAZORPAY_GATEWAY_AUTH_FAILED }, 502);
      return json({ error: "Payment gateway not configured. Please contact admin." }, 503);
    }

    const { data: started, error: startError } = await authResult.userClient.rpc(
      "cleaner_city_start_fuel_payment",
      { p_ride_id: rideId },
    );
    if (startError || !started?.id) {
      return json({ error: startError?.message || "Could not start the fuel payment" }, 400);
    }

    const amountPaise = Number(started.amount_paise);
    const receipt = `ccfuel_${String(started.id).replace(/-/g, "").slice(0, 32)}`;
    const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt,
        payment_capture: 1,
        notes: {
          purpose: "cleaner_city_fuel",
          ride_id: rideId,
          payment_id: String(started.id),
        },
      }),
    });
    const rzp = await rzpRes.json().catch(() => ({}));
    if (!rzpRes.ok || !rzp.id) {
      await authResult.userClient.rpc("cleaner_city_fail_fuel_payment", { p_payment_id: started.id });
      const razorpayMessage = rzp?.error?.description || rzp?.error?.reason || rzp?.error?.code;
      const authFailed = rzpRes.status === 401 || rzpRes.status === 403
        || /authentication failed/i.test(String(razorpayMessage || ""));
      console.error("[cleaner-city-fuel-order] Razorpay order failed", {
        status: rzpRes.status,
        payment_id: started.id,
        mode: razorpayKeyMode(keyId),
        razorpay: razorpayMessage || rzp,
      });
      if (authFailed) return json({ error: RAZORPAY_GATEWAY_AUTH_FAILED }, 502);
      return json({
        error: razorpayMessage
          ? `We couldn't start the fuel payment: ${razorpayMessage}`
          : "We couldn't start the fuel payment. Please try again.",
      }, 502);
    }

    const { error: attachError } = await authResult.userClient.rpc("cleaner_city_attach_fuel_order", {
      p_payment_id: started.id,
      p_razorpay_order_id: rzp.id,
    });
    if (attachError) {
      return json({
        error: "We created a payment order but could not bind it to this ride. Please try again.",
      }, 500);
    }

    return json({
      ok: true,
      payment_id: started.id,
      razorpay_order_id: rzp.id,
      key_id: keyId,
      amount_paise: amountPaise,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "fuel_order_failed" }, 500);
  }
});
