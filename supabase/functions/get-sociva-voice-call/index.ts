import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { withAdmin } from "../_shared/auth.ts";
import { getRetellApiKey, getRetellCall, pickRetellCallForAdmin } from "../_shared/retell.ts";
import { corsHeadersFor, handleCorsPreflight } from "../_shared/cors.ts";

/* cors: use corsHeadersFor(req) */

function makeJson(corsHeaders: Record<string, string>) {
  return (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  const json = makeJson(corsHeaders);
  if (req.method === "OPTIONS") {
    return handleCorsPreflight(req);
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const auth = await withAdmin(req, corsHeaders);
  if (auth instanceof Response) return auth;

  try {
    let payload: any = {};
    try {
      payload = await req.json();
    } catch {
      payload = {};
    }

    let callId = typeof payload?.call_id === "string" ? payload.call_id.trim() : "";
    const leadId = typeof payload?.lead_id === "string" ? payload.lead_id.trim() : "";

    if (!callId && leadId) {
      const { data: lead, error } = await auth.adminClient
        .from("seller_interest_leads")
        .select("id, retell_call_id")
        .eq("id", leadId)
        .maybeSingle();
      if (error) {
        console.error("[get-sociva-voice-call] lead lookup failed", error.message);
        return json(500, { error: "Could not load this lead" });
      }
      if (!lead) return json(404, { error: "Lead not found" });
      callId = String(lead.retell_call_id || "");
    }

    if (!callId) {
      return json(400, { error: "This lead does not have a voice call yet" });
    }

    const apiKey = await getRetellApiKey(auth.adminClient);
    if (!apiKey) {
      return json(503, { error: "Retell is not configured" });
    }

    const call = await getRetellCall({ apiKey, callId });
    return json(200, { call: pickRetellCallForAdmin(call) });
  } catch (err) {
    console.error("[get-sociva-voice-call] failed", (err as Error)?.message || err);
    return json(502, { error: "Could not load the conversation from Retell" });
  }
});
