import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCorsPreflight } from "../_shared/cors.ts";

/**
 * Public health: status only.
 * Detailed telemetry requires service-role bearer (cron/ops).
 */
Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return handleCorsPreflight(req);
  }

  const cors = corsHeadersFor(req);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const detailSecret = (Deno.env.get("HEALTH_DETAIL_SECRET") || "").trim();
    const isService =
      (!!serviceKey &&
        (authHeader === `Bearer ${serviceKey}` || bearer === serviceKey)) ||
      (!!detailSecret &&
        (authHeader === `Bearer ${detailSecret}` || bearer === detailSecret));

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
          headers: { ...cors, "Content-Type": "application/json" },
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

    const { count: nqPending } = await supabase
      .from("notification_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");
    checks.notification_queue_pending = nqPending || 0;

    const { data: oldestPending } = await supabase
      .from("notification_queue")
      .select("created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (oldestPending?.created_at) {
      const ageMs = Date.now() - new Date(oldestPending.created_at).getTime();
      checks.notification_queue_oldest_pending_age_sec = Math.max(
        0,
        Math.floor(ageMs / 1000),
      );
    } else {
      checks.notification_queue_oldest_pending_age_sec = 0;
    }

    // Redis via vault/admin_settings (Upstash REST). Self-contained so health
    // can deploy without bundling every shared module.
    try {
      const { data: url } = await supabase.rpc("get_edge_credential", {
        p_key: "upstash_redis_rest_url",
      });
      const { data: token } = await supabase.rpc("get_edge_credential", {
        p_key: "upstash_redis_rest_token",
      });
      const redisUrl =
        typeof url === "string" ? url.trim().replace(/\/$/, "") : "";
      const redisToken = typeof token === "string" ? token.trim() : "";
      checks.redis_configured = !!(redisUrl && redisToken);
      if (!checks.redis_configured) {
        checks.redis = "not_configured";
      } else {
        const pingRes = await fetch(`${redisUrl}/ping`, {
          method: "POST",
          headers: { Authorization: `Bearer ${redisToken}` },
        });
        const pingBody = await pingRes.json().catch(() => ({}));
        checks.redis =
          String((pingBody as { result?: unknown }).result || "").toUpperCase() ===
          "PONG"
            ? "ok"
            : "error";
      }
    } catch (redisErr) {
      checks.redis_configured = false;
      checks.redis = "error";
      checks.redis_error = (redisErr as Error).message;
    }

    checks.status =
      checks.db === "ok" &&
      checks.trigger_errors_24h === 0 &&
      checks.orphaned_societies === 0
        ? "healthy"
        : "degraded";
    checks.checked_at = new Date().toISOString();

    return new Response(JSON.stringify(checks, null, 2), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ status: "error", error: (err as Error).message }),
      {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      },
    );
  }
});
