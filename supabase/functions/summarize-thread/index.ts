import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { post_id } = await req.json();
    if (!post_id) throw new Error('post_id required');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableKey = Deno.env.get('LOVABLE_API_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get post + comments
    const { data: post } = await supabase
      .from('bulletin_posts')
      .select('title, body')
      .eq('id', post_id)
      .single();

    const { data: comments } = await supabase
      .from('bulletin_comments')
      .select('body, author:profiles!bulletin_comments_author_id_fkey(name)')
      .eq('post_id', post_id)
      .order('created_at', { ascending: true })
      .limit(50);

    if (!post || !comments || comments.length < 5) {
      return new Response(
        JSON.stringify({ summary: null, reason: 'Not enough comments for summary' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const commentThread = comments
      .map((c: any) => `${c.author?.name || 'Member'}: ${c.body}`)
      .join('\n');

    const prompt = `Summarize this community discussion in 2-3 concise sentences. Focus on key points, decisions, and consensus.

Post: ${post.title}
${post.body || ''}

Comments:
${commentThread}`;

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${lovableKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: 'You are a helpful community discussion summarizer. Keep summaries brief, neutral, and factual.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 200,
      }),
    });

    const aiData = await aiResponse.json();
    const summary = aiData.choices?.[0]?.message?.content || 'Unable to generate summary.';

    // Cache summary
    await supabase
      .from('bulletin_posts')
      .update({ ai_summary: summary })
      .eq('id', post_id);

    return new Response(
      JSON.stringify({ summary }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
