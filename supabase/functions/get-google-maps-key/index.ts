import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Public endpoint: the Google Maps key is loaded into the browser and must be
  // restricted by HTTP referrer in Google Cloud Console (that is the real security boundary).
  // Requiring a JWT here just breaks unauthenticated pages and pre-auth bootstrap.

  // 1. Try admin_settings first (admin override)
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data } = await admin
      .from("admin_settings")
      .select("value, is_active")
      .eq("key", "google_maps_api_key")
      .maybeSingle();
    if (data?.value && data.is_active !== false) {
      return new Response(JSON.stringify({ apiKey: data.value }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (_) {
    // fall through to env secret
  }

  // 2. Fall back to runtime secret
  const envKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (envKey) {
    return new Response(JSON.stringify({ apiKey: envKey }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ error: "Google Maps API key not configured" }),
    {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
