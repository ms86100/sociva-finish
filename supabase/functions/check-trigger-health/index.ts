import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller is platform admin
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Check admin role
    const { data: roles } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin");

    if (!roles || roles.length === 0) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse optional time window (default: last 24 hours)
    const url = new URL(req.url);
    const hours = parseInt(url.searchParams.get("hours") || "24", 10);
    const since = new Date(Date.now() - hours * 3600000).toISOString();

    // Fetch recent trigger errors
    const { data: errors, error } = await adminClient
      .from("trigger_errors")
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      throw new Error(`Failed to query trigger_errors: ${error.message}`);
    }

    // Group by trigger name
    const grouped: Record<string, { count: number; latest: string; errors: any[] }> = {};
    for (const err of errors || []) {
      if (!grouped[err.trigger_name]) {
        grouped[err.trigger_name] = { count: 0, latest: err.created_at, errors: [] };
      }
      grouped[err.trigger_name].count++;
      if (grouped[err.trigger_name].errors.length < 3) {
        grouped[err.trigger_name].errors.push({
          message: err.error_message,
          detail: err.error_detail,
          at: err.created_at,
        });
      }
    }

    const report = {
      timestamp: new Date().toISOString(),
      window_hours: hours,
      total_errors: (errors || []).length,
      status: (errors || []).length === 0 ? "healthy" : "errors_found",
      triggers: grouped,
    };

    return new Response(JSON.stringify(report, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
