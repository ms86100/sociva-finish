import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limiter.ts";
import { corsHeadersFor, handleCorsPreflight } from "../_shared/cors.ts";

/* cors: use corsHeadersFor(req) */

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return handleCorsPreflight(req);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
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

    const cronRl = await checkRateLimit(`admin-cron:${user.id}`, 30, 60);
    if (!cronRl.allowed) {
      return rateLimitResponse(corsHeaders, cronRl.retryAfterSeconds);
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action || "list";

    if (action === "list") {
      const { data, error } = await adminClient.rpc("get_cron_jobs" as any);
      // Fallback: direct SQL via a simple function
      if (error) {
        // Try raw query approach
        const result = await fetch(`${supabaseUrl}/rest/v1/rpc/get_cron_jobs`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
            "apikey": serviceKey,
          },
        });
        if (!result.ok) {
          return new Response(JSON.stringify({ error: "Failed to list cron jobs", detail: error.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const jobs = await result.json();
        return new Response(JSON.stringify({ jobs }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ jobs: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "toggle") {
      const { jobid, active } = body;
      if (!jobid) {
        return new Response(JSON.stringify({ error: "jobid required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (active) {
        await adminClient.rpc("enable_cron_job" as any, { p_jobid: jobid });
      } else {
        await adminClient.rpc("disable_cron_job" as any, { p_jobid: jobid });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update_schedule") {
      const { jobid, schedule } = body;
      if (!jobid || !schedule) {
        return new Response(JSON.stringify({ error: "jobid and schedule required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await adminClient.rpc("update_cron_schedule" as any, { p_jobid: jobid, p_schedule: schedule });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "recent_runs") {
      const { jobid } = body;
      const result = await adminClient.rpc("get_cron_job_runs" as any, { p_jobid: jobid || 0, p_limit: 20 });
      return new Response(JSON.stringify({ runs: result.data || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
