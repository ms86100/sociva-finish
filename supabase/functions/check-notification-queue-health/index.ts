import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    // Verify caller is admin
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

    const { data: roles } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin");

    if (!roles || roles.length === 0) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pending count
    const { count: pendingCount } = await adminClient
      .from("notification_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");

    // Retrying count
    const { count: retryingCount } = await adminClient
      .from("notification_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "retrying");

    // Failed (dead-letter) count
    const { count: failedCount } = await adminClient
      .from("notification_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed");

    // Oldest unprocessed
    const { data: oldest } = await adminClient
      .from("notification_queue")
      .select("created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    let oldestAgeMinutes: number | null = null;
    if (oldest?.created_at) {
      oldestAgeMinutes = Math.round((Date.now() - new Date(oldest.created_at).getTime()) / 60000);
    }

    const health = {
      timestamp: new Date().toISOString(),
      pending: pendingCount || 0,
      retrying: retryingCount || 0,
      failed: failedCount || 0,
      oldest_pending_age_minutes: oldestAgeMinutes,
      status: (pendingCount || 0) > 100 || (oldestAgeMinutes !== null && oldestAgeMinutes > 30)
        ? "degraded"
        : "healthy",
    };

    return new Response(JSON.stringify(health), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});