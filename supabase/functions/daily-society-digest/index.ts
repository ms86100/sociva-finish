import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getCredential } from "../_shared/credentials.ts";

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

    // Get all active societies
    const { data: societies } = await supabase
      .from("societies")
      .select("id, name")
      .eq("is_active", true);

    if (!societies || societies.length === 0) {
      return new Response(
        JSON.stringify({ message: "No active societies" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let totalSent = 0;

    for (const society of societies) {
      // Count today's activity
      const [
        { count: milestoneCount },
        { count: expenseCount },
        { count: docCount },
        { count: qaCount },
        { count: snagCount },
        { count: disputeCount },
        { count: bulletinCount },
        { count: broadcastCount },
      ] = await Promise.all([
        supabase.from("construction_milestones").select("id", { count: "exact", head: true }).eq("society_id", society.id).gte("created_at", since),
        supabase.from("society_expenses").select("id", { count: "exact", head: true }).eq("society_id", society.id).gte("created_at", since),
        supabase.from("project_documents").select("id", { count: "exact", head: true }).eq("society_id", society.id).gte("created_at", since),
        supabase.from("project_questions").select("id", { count: "exact", head: true }).eq("society_id", society.id).gte("created_at", since),
        supabase.from("snag_tickets").select("id", { count: "exact", head: true }).eq("society_id", society.id).gte("created_at", since),
        supabase.from("dispute_tickets").select("id", { count: "exact", head: true }).eq("society_id", society.id).gte("created_at", since),
        supabase.from("bulletin_posts").select("id", { count: "exact", head: true }).eq("society_id", society.id).gte("created_at", since),
        supabase.from("emergency_broadcasts").select("id", { count: "exact", head: true }).eq("society_id", society.id).gte("created_at", since),
      ]);

      const total = (milestoneCount || 0) + (expenseCount || 0) + (docCount || 0) +
        (qaCount || 0) + (snagCount || 0) + (disputeCount || 0) + (bulletinCount || 0) + (broadcastCount || 0);

      // Skip if no activity
      if (total === 0) continue;

      // Build summary
      const parts: string[] = [];
      if (milestoneCount && milestoneCount > 0) parts.push(`🏗 ${milestoneCount} construction update${milestoneCount > 1 ? 's' : ''}`);
      if (docCount && docCount > 0) parts.push(`📄 ${docCount} new document${docCount > 1 ? 's' : ''}`);
      if (bulletinCount && bulletinCount > 0) parts.push(`📋 ${bulletinCount} bulletin post${bulletinCount > 1 ? 's' : ''}`);
      if (expenseCount && expenseCount > 0) parts.push(`💰 ${expenseCount} finance entr${expenseCount > 1 ? 'ies' : 'y'}`);
      if (snagCount && snagCount > 0) parts.push(`🔧 ${snagCount} snag report${snagCount > 1 ? 's' : ''}`);
      if (disputeCount && disputeCount > 0) parts.push(`⚖️ ${disputeCount} dispute${disputeCount > 1 ? 's' : ''}`);
      if (qaCount && qaCount > 0) parts.push(`❓ ${qaCount} Q&A activit${qaCount > 1 ? 'ies' : 'y'}`);

      const body = parts.join(' • ');

      // Get all members of this society
      const { data: members } = await supabase
        .from("profiles")
        .select("id")
        .eq("society_id", society.id)
        .eq("verification_status", "approved");

      if (!members || members.length === 0) continue;

      // Get Firebase service account from DB first, env fallback
      const serviceAccountJson = await getCredential(supabase, "firebase_service_account", "FIREBASE_SERVICE_ACCOUNT");
      if (!serviceAccountJson) continue;

      // Send to each member via the send-push-notification function internally
      for (const member of members) {
        // Get device tokens
        const { data: tokens } = await supabase
          .from("device_tokens")
          .select("token")
          .eq("user_id", member.id);

        if (!tokens || tokens.length === 0) continue;

        // Call the send-push-notification function
        await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            userId: member.id,
            title: `📊 Daily Update — ${society.name}`,
            body,
            data: { type: "digest" },
          }),
        });

        totalSent++;
      }
    }

    return new Response(
      JSON.stringify({ message: `Digest sent to ${totalSent} users`, sent: totalSent }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Digest error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
