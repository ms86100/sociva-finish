import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { job, language, society_name } = await req.json();
    if (!job) throw new Error("No job data provided");

    const langCode = language;
    if (!langCode) {
      return new Response(JSON.stringify({ error: "Language code is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const jobId = job.id;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // Check cache first if job has an ID
    if (jobId) {
      const { data: cached } = await sb
        .from("job_tts_cache")
        .select("summary_text")
        .eq("job_id", jobId)
        .eq("language_code", langCode)
        .maybeSingle();

      if (cached?.summary_text) {
        return new Response(JSON.stringify({ summary: cached.summary_text, cached: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Fetch language ai_name dynamically from DB — no hardcoded map, fail-closed
    const { data: langRow } = await sb
      .from("supported_languages")
      .select("ai_name")
      .eq("code", langCode)
      .eq("is_active", true)
      .maybeSingle();
    if (!langRow?.ai_name) {
      return new Response(JSON.stringify({ error: "Language not configured in database", language: langCode }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const langName = langRow.ai_name;

    const societyContext = society_name ? `\n- From society: ${society_name}` : "";

    const prompt = `Generate a simple, friendly voice summary for a worker who may not read well. Keep it under 4 sentences in ${langName}. Use simple words.

Include these details:
- Job type: ${job.job_type}
- Location: ${job.location_details || "Not specified"}
- Duration: ${job.duration_hours || 1} hours
- Payment: ₹${job.price || "To be decided"}
- Start time: ${job.start_time || "Flexible"}
- Urgency: ${job.urgency || "Normal"}${societyContext}

Output ONLY the voice summary text in ${langName}, nothing else.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("AI error:", response.status, t);
      // Fetch a localized fallback from the language name instead of English-only
      return new Response(JSON.stringify({ error: "AI generation failed", language: langCode }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content;
    if (!summary) {
      return new Response(JSON.stringify({ error: "No summary generated", language: langCode }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cache the result if we have a job ID
    if (jobId) {
      try {
        await sb.from("job_tts_cache").upsert({
          job_id: jobId,
          language_code: langCode,
          summary_text: summary,
        }, { onConflict: "job_id,language_code" });
      } catch (cacheErr) {
        console.error("Cache write failed (non-fatal):", cacheErr);
      }
    }

    return new Response(JSON.stringify({ summary, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
