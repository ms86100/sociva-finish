import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";
import { corsHeadersFor, handleCorsPreflight } from "../_shared/cors.ts";
import { withAuth } from "../_shared/auth.ts";

/* cors: use corsHeadersFor(req) */

/**
 * Mark a seller's UPI as stale after a payment failure.
 * Called by payment failure handlers (server-side).
 * Requires authenticated caller; only the seller themselves OR service role can flip.
 */
Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return handleCorsPreflight(req);
  }

  const auth = await withAuth(req, corsHeaders);
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sellerId: string = body?.seller_id;
  const reason: string = body?.reason ?? "payment_failed";
  if (!sellerId) {
    return new Response(JSON.stringify({ error: "seller_id required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Authorization: caller must own the seller, or be admin
  const { data: seller } = await admin
    .from("seller_profiles")
    .select("id, user_id, upi_id, upi_verification_status")
    .eq("id", sellerId)
    .maybeSingle();

  if (!seller) {
    return new Response(JSON.stringify({ error: "Seller not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: isAdmin } = await admin.rpc("is_admin", { _user_id: userId });
  if (seller.user_id !== userId && !isAdmin) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (seller.upi_verification_status === "valid") {
    const { error: staleErr } = await admin
      .from("seller_profiles")
      .update({ upi_verification_status: "stale" })
      .eq("id", sellerId);
    if (staleErr) {
      console.error("Failed to mark UPI stale:", staleErr);
      return new Response(JSON.stringify({ error: "Failed to mark UPI stale", details: staleErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  console.log(`UPI marked stale for seller ${sellerId}, reason: ${reason}`);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
