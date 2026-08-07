import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Public health: status only.
 * Detailed telemetry requires service-role bearer (cron/ops).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization") || "";
    const isService =
      !!serviceKey && authHeader === `Bearer ${serviceKey}`;

    // Cheap DB ping for everyone
    const dbStart = Date.now();
    const { error: dbError } = await supabase
      .from("societies")
      .select("id")
      .limit(1);
    const dbOk = !dbError;
    const dbLatency = Date.now() - dbStart;

    if (!isService) {
      return new Response(
        JSON.stringify({
          status: dbOk ? "healthy" : "degraded",
          checked_at: new Date().toISOString(),
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const checks: Record<string, unknown> = {
      db: dbOk ? "ok" : "error",
      db_latency_ms: dbLatency,
    };

    const { count: triggerErrors } = await supabase
      .from("trigger_errors")
      .select("*", { count: "exact", head: true })
      .gte(
        "created_at",
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      );
    checks.trigger_errors_24h = triggerErrors || 0;

    const { data: allSocieties } = await supabase
      .from("societies")
      .select("id")
      .eq("is_active", true);

    const { data: adminedSocieties } = await supabase
      .from("society_admins")
      .select("society_id")
      .is("deactivated_at", null);

    const adminedSet = new Set(
      (adminedSocieties || []).map((a) => a.society_id),
    );
    const orphaned = (allSocieties || []).filter((s) => !adminedSet.has(s.id));
    checks.orphaned_societies = orphaned.length;

    const tables = [
      "profiles",
      "orders",
      "seller_profiles",
      "products",
      "chat_messages",
    ];
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const { count } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true });
      counts[table] = count || 0;
    }
    checks.table_counts = counts;
    checks.auth = "ok";
    checks.status =
      checks.db === "ok" &&
      checks.trigger_errors_24h === 0 &&
      checks.orphaned_societies === 0
        ? "healthy"
        : "degraded";
    checks.checked_at = new Date().toISOString();

    return new Response(JSON.stringify(checks, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
