import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";
import { withAuth } from "../_shared/auth.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limiter.ts";
import { getCredential, createAdminClient } from "../_shared/credentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Strict VPA regex: handle 2-256 chars, no leading/trailing dots/specials,
// provider must start with letter, 2-64 chars
const VPA_REGEX =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,254}[a-zA-Z0-9])?@[a-zA-Z][a-zA-Z0-9]{1,63}$/;

type ValidationStatus = "valid" | "invalid" | "unavailable" | "error";

interface ValidationResult {
  status: ValidationStatus;
  customer_name?: string;
  vpa: string;
  provider?: string;
  reason?: string;
}

async function logValidation(
  admin: any,
  userId: string,
  vpa: string,
  result: ValidationResult,
  sellerId?: string
) {
  try {
    await admin.from("upi_validation_logs").insert({
      user_id: userId,
      seller_id: sellerId ?? null,
      vpa,
      status: result.status,
      customer_name: result.customer_name ?? null,
      provider: result.provider ?? null,
      reason: result.reason ?? null,
    });
  } catch (e) {
    console.warn("Failed to write upi_validation_logs:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await withAuth(req, corsHeaders);
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  // Rate limit: 5 / 60s per user
  const rl = await checkRateLimit(`upi-validate:${userId}`, 5, 60);
  if (!rl.allowed) return rateLimitResponse(corsHeaders);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const vpa: string = String(body?.vpa ?? "").trim();
  const sellerId: string | undefined = body?.seller_id;

  const admin = createAdminClient();

  // Format pre-check
  if (!vpa || !VPA_REGEX.test(vpa)) {
    const result: ValidationResult = {
      status: "invalid",
      vpa,
      reason: "Invalid UPI ID format",
    };
    await logValidation(admin, userId, vpa, result, sellerId);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const provider = vpa.split("@")[1]?.toLowerCase();

  // RELAXED MODE: Razorpay FAV bypassed for now.
  // Any format-valid VPA is accepted as `valid` so sellers can save without friction.
  // Holder name is not fetched; payouts can still proceed and verification can be
  // re-enabled later by switching back to the FAV flow.
  const result: ValidationResult = {
    status: "valid",
    vpa,
    provider,
    reason: "UPI ID format accepted. Holder name verification is currently disabled.",
  };
  await logValidation(admin, userId, vpa, result, sellerId);

  if (sellerId) {
    try {
      await admin
        .from("seller_profiles")
        .update({
          upi_id: vpa,
          upi_provider: provider ?? null,
          upi_verified_at: new Date().toISOString(),
          upi_verification_status: "valid",
        })
        .eq("id", sellerId);
    } catch (e) {
      console.warn("Failed to persist UPI (relaxed mode):", e);
    }
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
