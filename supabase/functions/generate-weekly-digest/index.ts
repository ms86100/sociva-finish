import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: societies } = await supabase
      .from("societies")
      .select("id, name, trust_score")
      .eq("is_active", true);

    if (!societies || societies.length === 0) {
      return new Response(
        JSON.stringify({ message: "No active societies" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    let totalQueued = 0;

    for (const society of societies) {
      const [
        { count: expenseCount },
        { count: disputesResolved },
        { count: snagsFixed },
        { count: milestoneCount },
        { count: snagsClosed },
      ] = await Promise.all([
        supabase.from("society_expenses").select("id", { count: "exact", head: true }).eq("society_id", society.id).gte("created_at", weekAgo),
        supabase.from("dispute_tickets").select("id", { count: "exact", head: true }).eq("society_id", society.id).in("status", ["resolved", "closed"]).gte("created_at", weekAgo),
        supabase.from("snag_tickets").select("id", { count: "exact", head: true }).eq("society_id", society.id).in("status", ["fixed", "verified", "closed"]).gte("created_at", weekAgo),
        supabase.from("construction_milestones").select("id", { count: "exact", head: true }).eq("society_id", society.id).gte("created_at", weekAgo),
        supabase.from("snag_tickets").select("id", { count: "exact", head: true }).eq("society_id", society.id).in("status", ["fixed", "verified", "closed"]).gte("created_at", weekAgo),
      ]);

      const total = (expenseCount || 0) + (disputesResolved || 0) + (snagsFixed || 0) + (milestoneCount || 0);
      if (total === 0) continue;

      // Build digest body
      const parts: string[] = [];
      if (expenseCount && expenseCount > 0) parts.push(`💰 ${expenseCount} expense${expenseCount > 1 ? "s" : ""} documented`);
      if (disputesResolved && disputesResolved > 0) parts.push(`⚖️ ${disputesResolved} dispute${disputesResolved > 1 ? "s" : ""} resolved`);
      if (snagsFixed && snagsFixed > 0) parts.push(`🔧 ${snagsFixed} snag${snagsFixed > 1 ? "s" : ""} fixed`);
      if (milestoneCount && milestoneCount > 0) parts.push(`🏗 ${milestoneCount} construction update${milestoneCount > 1 ? "s" : ""}`);

      const trustScore = Number(society.trust_score || 0);
      parts.push(`📊 Trust Score: ${trustScore.toFixed(1)}/10`);

      const body = parts.join("\n");

      // Get all approved members
      const { data: members } = await supabase
        .from("profiles")
        .select("id")
        .eq("society_id", society.id)
        .eq("verification_status", "approved");

      if (!members || members.length === 0) continue;

      // Insert into notification queue for each member
      const notifications = members.map((m) => ({
        user_id: m.id,
        title: `📋 Weekly Digest — ${society.name}`,
        body,
        type: "weekly_digest",
        reference_path: "/society/reports",
      }));

      // Batch insert (max 100 at a time)
      for (let i = 0; i < notifications.length; i += 100) {
        const batch = notifications.slice(i, i + 100);
        await supabase.from("notification_queue").insert(batch);
      }

      totalQueued += members.length;
    }

    return new Response(
      JSON.stringify({ message: `Weekly digest queued for ${totalQueued} users`, queued: totalQueued }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Weekly digest error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
