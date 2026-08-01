import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const client = createClient(supabaseUrl, serviceKey);

    // Find approved sellers with no discoverable coordinates
    const { data: invalidSellers, error } = await client
      .from("seller_profiles")
      .select("id, business_name, society_id, latitude, longitude, verification_status")
      .eq("verification_status", "approved")
      .is("latitude", null)
      .is("longitude", null);

    if (error) throw error;

    // Filter further: check if society also has no coords
    const results: Array<{ id: string; business_name: string; reason: string }> = [];

    for (const seller of invalidSellers || []) {
      if (!seller.society_id) {
        results.push({ id: seller.id, business_name: seller.business_name, reason: "No coordinates and no society" });
        continue;
      }

      const { data: society } = await client
        .from("societies")
        .select("latitude, longitude")
        .eq("id", seller.society_id)
        .single();

      if (!society?.latitude || !society?.longitude) {
        results.push({ id: seller.id, business_name: seller.business_name, reason: "No coordinates and society has no coordinates" });
      }
    }

    if (results.length > 0) {
      console.error(`⚠️ LOCATION INTEGRITY VIOLATION: ${results.length} approved seller(s) with no discoverable coordinates`);
      for (const r of results) {
        console.error(`  - seller_id=${r.id}, name="${r.business_name}", reason="${r.reason}"`);
      }
    } else {
      console.log("✅ Location integrity check passed — all approved sellers have discoverable coordinates.");
    }

    return new Response(JSON.stringify({ violations: results.length, details: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Location integrity check failed:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
