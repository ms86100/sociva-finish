import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCorsPreflight } from "../_shared/cors.ts";

/* cors: use corsHeadersFor(req) */

const MIN_COMMENTS = 5;
const AI_TIMEOUT_MS = 20000;
/** Stable model already used across Sociva edge functions via Lovable gateway */
const PRIMARY_MODEL = "google/gemini-2.5-flash";
const FALLBACK_MODEL = "google/gemini-2.5-flash-lite";

function extractiveFallback(
  title: string,
  body: string | null,
  comments: Array<{ body: string; author?: { name?: string } | null }>,
): string {
  const top = comments.slice(0, 3).map((c) => {
    const who = c.author?.name || "A neighbour";
    const text = (c.body || "").replace(/\s+/g, " ").trim().slice(0, 120);
    return `${who}: ${text}`;
  });
  const lead = body
    ? `${title} - ${(body || "").replace(/\s+/g, " ").trim().slice(0, 140)}`
    : title;
  return `${lead} Neighbours discussed: ${top.join(" · ")}`;
}

async function callLovable(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const aiResponse = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "You summarise residential society discussions for neighbours in India. Be brief (2-3 sentences), neutral, factual. No emojis. Prefer plain ASCII hyphen (-) not dashes. Name decisions, open questions, and who offered help when clear.",
            },
            { role: "user", content: prompt },
          ],
          max_tokens: 220,
          temperature: 0.2,
        }),
      },
    );

    if (!aiResponse.ok) {
      const text = await aiResponse.text();
      console.error("summarize-thread AI error", model, aiResponse.status, text);
      return null;
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) return null;
    return content.trim().replace(/[\u2013\u2014]/g, "-");
  } catch (err) {
    console.error("summarize-thread AI call failed", model, err);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return handleCorsPreflight(req);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const post_id = body?.post_id;
    const force = !!body?.force;
    if (!post_id) throw new Error("post_id required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: post, error: postErr } = await supabase
      .from("bulletin_posts")
      .select("id, title, body, ai_summary, comment_count, structured")
      .eq("id", post_id)
      .single();

    if (postErr || !post) throw new Error("Post not found");

    const { data: comments, error: commentsErr } = await supabase
      .from("bulletin_comments")
      .select(
        "body, created_at, parent_id, author:profiles!bulletin_comments_author_id_fkey(name)",
      )
      .eq("post_id", post_id)
      .order("created_at", { ascending: true })
      .limit(60);

    if (commentsErr) throw commentsErr;

    const rows = comments || [];
    if (rows.length < MIN_COMMENTS) {
      return new Response(
        JSON.stringify({
          summary: null,
          reason: `Need at least ${MIN_COMMENTS} comments (have ${rows.length})`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const summarisedAtCount =
      typeof post.structured?.summary_comment_count === "number"
        ? post.structured.summary_comment_count
        : 0;

    // Skip re-call if cached and thread has not grown meaningfully (unless force)
    if (
      !force &&
      post.ai_summary &&
      rows.length < summarisedAtCount + 3 &&
      rows.length <= summarisedAtCount
    ) {
      return new Response(
        JSON.stringify({
          summary: post.ai_summary,
          cached: true,
          model: "cache",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (
      !force &&
      post.ai_summary &&
      summarisedAtCount > 0 &&
      rows.length < summarisedAtCount + 3
    ) {
      return new Response(
        JSON.stringify({
          summary: post.ai_summary,
          cached: true,
          model: "cache",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const commentThread = rows
      .map((c: any) => {
        const nest = c.parent_id ? "  (reply) " : "";
        return `${nest}${c.author?.name || "Member"}: ${c.body}`;
      })
      .join("\n");

    const prompt = `Summarise this society community thread for busy residents.

Post title: ${post.title}
Post body: ${post.body || "(none)"}

Comments (${rows.length}):
${commentThread}

Write 2-3 sentences covering: what was asked, main neighbour responses, and any clear next step or open question.`;

    let summary: string | null = null;
    let modelUsed = "extractive";

    if (lovableKey) {
      summary = await callLovable(lovableKey, PRIMARY_MODEL, prompt);
      if (summary) modelUsed = PRIMARY_MODEL;
      if (!summary) {
        summary = await callLovable(lovableKey, FALLBACK_MODEL, prompt);
        if (summary) modelUsed = FALLBACK_MODEL;
      }
    } else {
      console.warn("summarize-thread: LOVABLE_API_KEY missing, using extractive fallback");
    }

    if (!summary) {
      summary = extractiveFallback(post.title, post.body, rows as any);
      modelUsed = "extractive";
    }

    const nextStructured = {
      ...(typeof post.structured === "object" && post.structured
        ? post.structured
        : {}),
      summary_comment_count: rows.length,
      summary_model: modelUsed,
      summary_updated_at: new Date().toISOString(),
    };

    await supabase
      .from("bulletin_posts")
      .update({
        ai_summary: summary,
        structured: nextStructured,
      })
      .eq("id", post_id);

    return new Response(
      JSON.stringify({
        summary,
        cached: false,
        model: modelUsed,
        comment_count: rows.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("summarize-thread error", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
        summary: null,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
