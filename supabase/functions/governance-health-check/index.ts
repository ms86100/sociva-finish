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

    // Check if user is admin
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

    const report: Record<string, any> = { timestamp: new Date().toISOString(), checks: [] };

    // Check 1: Societies with 0 active admins
    
    // Fallback: manual query
    const { data: allSocieties } = await adminClient
      .from("societies")
      .select("id, name")
      .eq("is_active", true);

    const { data: activeAdmins } = await adminClient
      .from("society_admins")
      .select("society_id")
      .is("deactivated_at", null);

    const adminSocietyIds = new Set((activeAdmins || []).map((a: any) => a.society_id));
    const societiesWithNoAdmin = (allSocieties || []).filter((s: any) => !adminSocietyIds.has(s.id));

    report.checks.push({
      name: "societies_without_admins",
      status: societiesWithNoAdmin.length === 0 ? "pass" : "alert",
      count: societiesWithNoAdmin.length,
      details: societiesWithNoAdmin.map((s: any) => ({ id: s.id, name: s.name })),
    });

    // Check 2: Admin count exceeding limit
    const { data: societies } = await adminClient
      .from("societies")
      .select("id, name, max_society_admins")
      .eq("is_active", true);

    const overLimitSocieties: any[] = [];
    for (const society of societies || []) {
      const { count } = await adminClient
        .from("society_admins")
        .select("id", { count: "exact", head: true })
        .eq("society_id", society.id)
        .is("deactivated_at", null);

      if (count && count > (society.max_society_admins || 5)) {
        overLimitSocieties.push({
          id: society.id,
          name: society.name,
          current: count,
          limit: society.max_society_admins || 5,
        });
      }
    }

    report.checks.push({
      name: "admin_count_exceeding_limit",
      status: overLimitSocieties.length === 0 ? "pass" : "alert",
      count: overLimitSocieties.length,
      details: overLimitSocieties,
    });

    // Check 3: Rapid admin changes (>3 in last hour)
    const { data: rapidChanges } = await adminClient
      .from("audit_log")
      .select("society_id")
      .in("action", ["admin_appointed", "admin_removed"])
      .gte("created_at", new Date(Date.now() - 3600000).toISOString());

    const changeCounts: Record<string, number> = {};
    for (const row of rapidChanges || []) {
      if (row.society_id) {
        changeCounts[row.society_id] = (changeCounts[row.society_id] || 0) + 1;
      }
    }
    const rapidAdminChanges = Object.entries(changeCounts)
      .filter(([, count]) => count > 3)
      .map(([societyId, count]) => ({ society_id: societyId, changes: count }));

    report.checks.push({
      name: "rapid_admin_changes",
      status: rapidAdminChanges.length === 0 ? "pass" : "alert",
      threshold: "> 3 changes/hour",
      count: rapidAdminChanges.length,
      details: rapidAdminChanges,
    });

    // Check 4: Approval spike (>10 in last hour)
    const { data: approvalSpikes } = await adminClient
      .from("audit_log")
      .select("society_id")
      .eq("action", "user_approved")
      .gte("created_at", new Date(Date.now() - 3600000).toISOString());

    const approvalCounts: Record<string, number> = {};
    for (const row of approvalSpikes || []) {
      if (row.society_id) {
        approvalCounts[row.society_id] = (approvalCounts[row.society_id] || 0) + 1;
      }
    }
    const spikes = Object.entries(approvalCounts)
      .filter(([, count]) => count > 10)
      .map(([societyId, count]) => ({ society_id: societyId, approvals: count }));

    report.checks.push({
      name: "approval_spike",
      status: spikes.length === 0 ? "pass" : "alert",
      threshold: "> 10 approvals/hour",
      count: spikes.length,
      details: spikes,
    });

    // GA BLOCKER 6: Security anomaly detection
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const fiveMinAgo = new Date(Date.now() - 300000).toISOString();

    // Check 5: High gate denial rate (>20% in last hour)
    const { data: gateEntries1h } = await adminClient
      .from("gate_entries")
      .select("confirmation_status")
      .gte("entry_time", oneHourAgo);

    const totalEntries1h = (gateEntries1h || []).length;
    const deniedEntries1h = (gateEntries1h || []).filter((e: any) => e.confirmation_status === 'denied').length;
    const denialRate = totalEntries1h > 0 ? deniedEntries1h / totalEntries1h : 0;

    report.checks.push({
      name: "high_gate_denial_rate",
      status: denialRate > 0.2 && totalEntries1h >= 5 ? "alert" : "pass",
      threshold: "> 20% denial rate (min 5 entries)",
      total_entries: totalEntries1h,
      denied: deniedEntries1h,
      denial_rate: Math.round(denialRate * 100) + "%",
    });

    // Check 6: Manual entry spam (>5 by same officer in 5 min)
    const { data: manualEntries5m } = await adminClient
      .from("manual_entry_requests")
      .select("requested_by")
      .gte("created_at", fiveMinAgo);

    const manualCounts: Record<string, number> = {};
    for (const row of manualEntries5m || []) {
      if (row.requested_by) {
        manualCounts[row.requested_by] = (manualCounts[row.requested_by] || 0) + 1;
      }
    }
    const manualSpammers = Object.entries(manualCounts)
      .filter(([, count]) => count > 5)
      .map(([officerId, count]) => ({ officer_id: officerId, count }));

    report.checks.push({
      name: "manual_entry_spam",
      status: manualSpammers.length > 0 ? "alert" : "pass",
      threshold: "> 5 manual entries by same officer in 5 min",
      count: manualSpammers.length,
      details: manualSpammers,
    });

    // Check 7: Replay attempts (>3 in 5 min)
    const { data: replayAttempts } = await adminClient
      .from("audit_log")
      .select("id")
      .eq("action", "gate_token_replay_blocked")
      .gte("created_at", fiveMinAgo);

    const replayCount = (replayAttempts || []).length;

    report.checks.push({
      name: "qr_replay_attempts",
      status: replayCount > 3 ? "alert" : "pass",
      threshold: "> 3 replay attempts in 5 min",
      count: replayCount,
    });

    // Overall status
    report.overall = report.checks.every((c: any) => c.status === "pass") ? "healthy" : "alerts_found";

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
