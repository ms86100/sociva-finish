import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor, handleCorsPreflight } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* cors: use corsHeadersFor(req) */

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS" || req.method === 'OPTIONS') {
    return handleCorsPreflight(req);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // TTL: soft-expire posts whose expires_at has passed (status=expired, archived)
    const { data: ttlExpired, error: ttlError } = await supabase.rpc('expire_bulletin_posts_by_ttl');
    if (ttlError) {
      console.warn('[auto-archive-bulletin] expire_bulletin_posts_by_ttl failed', ttlError);
    }

    // Archive posts older than 30 days that aren't pinned (legacy age-based archive)
    const { data, error } = await supabase
      .from('bulletin_posts')
      .update({ is_archived: true })
      .eq('is_archived', false)
      .eq('is_pinned', false)
      .lt('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .select('id');

    // Soft-close community snags left in resolved for 7+ days
    const { data: softClosed, error: softCloseError } = await supabase.rpc(
      'soft_close_resolved_community_snags',
    );
    if (softCloseError) {
      console.warn('[auto-archive-bulletin] soft_close_resolved_community_snags failed', softCloseError);
    }

    // Also expire open help requests past their expiry
    const { data: expiredHelp } = await supabase
      .from('help_requests')
      .update({ status: 'expired' })
      .eq('status', 'open')
      .lt('expires_at', new Date().toISOString())
      .select('id');

    return new Response(
      JSON.stringify({
        ttl_expired_posts: typeof ttlExpired === 'number' ? ttlExpired : 0,
        soft_closed_snags: typeof softClosed === 'number' ? softClosed : 0,
        archived_posts: data?.length || 0,
        expired_help_requests: expiredHelp?.length || 0,
        archive_error: error?.message || null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
