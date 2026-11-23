import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor, handleCorsPreflight } from "../_shared/cors.ts";
import { withAuth } from "../_shared/auth.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limiter.ts";

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return handleCorsPreflight(req);
  }

  const auth = await withAuth(req, corsHeaders);
  if (auth instanceof Response) return auth;
  const { userId, userClient } = auth;

  const rl = await checkRateLimit(`notify-help-request:${userId}`, 8, 3600);
  if (!rl.allowed) return rateLimitResponse(corsHeaders, rl.retryAfterSeconds);

  let body: { helpRequestId?: string; societyId?: string; authorId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const helpRequestId = String(body?.helpRequestId || "").trim();
  if (!helpRequestId) {
    return new Response(JSON.stringify({ error: "helpRequestId required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Ignore client societyId / authorId. RPC pins JWT membership.
  const { data, error } = await userClient.rpc("notify_help_request", {
    _help_request_id: helpRequestId,
  });

  if (error) {
    const msg = error.message || "Notify failed";
    const denied = /not authenticated|not authorized|membership/i.test(msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: denied ? 403 : 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(data ?? { ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
