import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // C4: Block in production unless explicitly allowed
  if (!Deno.env.get("ALLOW_TEST_FUNCTIONS")) {
    return new Response(
      JSON.stringify({ error: "Test functions are disabled in this environment" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { results } = await req.json();

    if (!Array.isArray(results) || results.length === 0) {
      return new Response(
        JSON.stringify({ error: "No results provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert in batches of 500
    const batchSize = 500;
    let inserted = 0;

    for (let i = 0; i < results.length; i += batchSize) {
      const batch = results.slice(i, i + batchSize).map((r: any) => ({
        run_id: r.run_id,
        module_name: r.module_name,
        test_name: r.test_name,
        page_or_api_url: r.page_or_api_url || null,
        input_data: r.input_data || null,
        outcome: r.outcome || "passed",
        duration_ms: r.duration_ms || null,
        response_payload: r.response_payload || null,
        error_message: r.error_message || null,
        error_code: r.error_code || null,
        http_status_code: r.http_status_code || null,
        file_path: r.file_path || null,
        executed_at: r.executed_at || new Date().toISOString(),
      }));

      const { error } = await supabase.from("test_results").insert(batch);
      if (error) {
        console.error("Insert error:", error);
        return new Response(
          JSON.stringify({ error: error.message, inserted }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      inserted += batch.length;
    }

    return new Response(
      JSON.stringify({ success: true, inserted }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
