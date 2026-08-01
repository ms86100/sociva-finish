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

    const THRESHOLD = 5;

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

    let totalEscalations = 0;

    for (const society of societies) {
      // Get open snags grouped by category (and optionally tower)
      const { data: openSnags } = await supabase
        .from("snag_tickets")
        .select("id, category, tower_id, photo_urls, reported_by")
        .eq("society_id", society.id)
        .not("status", "in", '("fixed","verified","closed")');

      if (!openSnags || openSnags.length < THRESHOLD) continue;

      // Group by category + tower_id
      const groups: Record<string, typeof openSnags> = {};
      for (const snag of openSnags) {
        const key = `${snag.category}|${snag.tower_id || "all"}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(snag);
      }

      for (const [key, snags] of Object.entries(groups)) {
        if (snags.length < THRESHOLD) continue;

        const [category, towerId] = key.split("|");
        const uniqueReporters = new Set(snags.map((s) => s.reported_by));

        // Check if an active escalation already exists for this group
        let existingQuery = supabase
          .from("collective_escalations")
          .select("id")
          .eq("society_id", society.id)
          .eq("category", category)
          .eq("status", "active");

        if (towerId !== "all") {
          existingQuery = existingQuery.eq("tower_id", towerId);
        } else {
          existingQuery = existingQuery.is("tower_id", null);
        }

        const { data: existing } = await existingQuery;
        if (existing && existing.length > 0) {
          // Update existing escalation counts
          await supabase
            .from("collective_escalations")
            .update({
              snag_count: snags.length,
              resident_count: uniqueReporters.size,
              sample_photos: snags
                .flatMap((s) => s.photo_urls || [])
                .slice(0, 6),
            })
            .eq("id", existing[0].id);
          continue;
        }

        // Create new escalation
        const samplePhotos = snags
          .flatMap((s) => s.photo_urls || [])
          .slice(0, 6);

        await supabase.from("collective_escalations").insert({
          society_id: society.id,
          category,
          tower_id: towerId !== "all" ? towerId : null,
          snag_count: snags.length,
          resident_count: uniqueReporters.size,
          sample_photos: samplePhotos,
          status: "active",
        });

        // Notify society admins
        const { data: admins } = await supabase
          .from("society_admins")
          .select("user_id")
          .eq("society_id", society.id);

        if (admins && admins.length > 0) {
          const notifications = admins.map((a) => ({
            user_id: a.user_id,
            title: `🚨 Collective Issue: ${category}`,
            body: `${uniqueReporters.size} residents reported ${snags.length} ${category} snags. This requires immediate attention.`,
            type: "collective_escalation",
            reference_path: "/society/snags",
          }));

          await supabase.from("notification_queue").insert(notifications);
        }

        totalEscalations++;
      }
    }

    return new Response(
      JSON.stringify({ message: `Created ${totalEscalations} new escalations`, created: totalEscalations }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Collective issues error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
