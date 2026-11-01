import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limiter.ts";
import { getWorkingRazorpayCredentials } from "../_shared/credentials.ts";

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
    const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { withAuth } = await import("../_shared/auth.ts");
    const authResult = await withAuth(req, corsHeaders);
    if (authResult instanceof Response) return authResult;

    const { allowed } = await checkRateLimit(`cc-fuel-settle:${authResult.userId}`, 6, 60);
    if (!allowed) return rateLimitResponse(corsHeaders);

    const body = await req.json();
    const paymentId = String(body.payment_id || "");
    if (!paymentId) return json({ error: "payment_id is required" }, 400);

    const { data: payment, error: paymentError } = await service
      .from("ride_fuel_payments")
      .select("id, payee_id, amount_paise, status, payout_status, transfer_id, razorpay_payment_id")
      .eq("id", paymentId)
      .maybeSingle();
    if (paymentError || !payment) return json({ error: "Fuel payment not found" }, 404);
    if (payment.payee_id !== authResult.userId) {
      return json({ error: "Only the host can send this fuel share to their route account" }, 403);
    }
    if (payment.status !== "paid" || payment.payout_status === "transferred") {
      return json({
        error: payment.payout_status === "transferred"
          ? "This fuel share was already transferred."
          : "The guest payment is not captured yet.",
        payout_status: payment.payout_status,
      }, 400);
    }
    if (payment.transfer_id) {
      return json({
        error: "A transfer was already started and is not finished. Do not send it again.",
        payout_status: "payable",
        transfer_id: payment.transfer_id,
      }, 409);
    }

    const { data: profile } = await service
      .from("commute_profiles")
      .select("razorpay_route_account_id")
      .eq("user_id", authResult.userId)
      .is("deleted_at", null)
      .maybeSingle();
    const accountId = String(profile?.razorpay_route_account_id || "");
    if (!accountId) {
      return json({
        error: "Link a Razorpay route account before a bank transfer. The fuel stays payable until then.",
        payout_status: "payable",
      }, 400);
    }

    const keys = await getWorkingRazorpayCredentials(service);
    const keyId = String(keys.keyId || "").trim();
    const keySecret = String(keys.keySecret || "").trim();
    if (!keyId || !keySecret) {
      return json({ error: "Payment gateway not configured. Please contact admin." }, 503);
    }

    const res = await fetch("https://api.razorpay.com/v1/transfers", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account: accountId,
        amount: Number(payment.amount_paise),
        currency: "INR",
        notes: {
          payment_id: paymentId,
          razorpay_payment_id: payment.razorpay_payment_id || "",
          source: "cleaner_city_fuel",
        },
      }),
    });
    const transfer = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = transfer?.error?.description || transfer?.error?.reason || `razorpay_transfer_http_${res.status}`;
      await service.rpc("cleaner_city_note_fuel_transfer", {
        p_payment_id: paymentId,
        p_transfer_id: null,
        p_error: String(message),
      });
      return json({
        error: "Razorpay did not create the transfer. The fuel stays payable.",
        detail: String(message),
        payout_status: "payable",
      }, 502);
    }

    const transferId = String(transfer?.id || "");
    const transferStatus = String(transfer?.status || "").toLowerCase();
    if (transferStatus !== "processed" || !transferId) {
      await service.rpc("cleaner_city_note_fuel_transfer", {
        p_payment_id: paymentId,
        p_transfer_id: transferId || null,
        p_error: `transfer_${transferStatus || "pending"}`,
      });
      return json({
        error: "Razorpay accepted a transfer that is not finished. It was not marked paid to the bank.",
        payout_status: "payable",
        transfer_id: transferId || null,
      }, 202);
    }

    const { error: markError } = await service.rpc("cleaner_city_mark_fuel_transferred", {
      p_payment_id: paymentId,
      p_transfer_id: transferId,
    });
    if (markError) return json({ error: markError.message }, 400);
    return json({ payout_status: "transferred", transfer_id: transferId });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Fuel transfer failed" }, 500);
  }
});
