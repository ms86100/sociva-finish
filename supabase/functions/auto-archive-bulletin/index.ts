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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Archive posts older than 30 days that aren't pinned
    const { data, error } = await supabase
      .from('bulletin_posts')
      .update({ is_archived: true })
      .eq('is_archived', false)
      .eq('is_pinned', false)
      .lt('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .select('id');

    // Also expire open help requests past their expiry
    const { data: expiredHelp } = await supabase
      .from('help_requests')
      .update({ status: 'expired' })
      .eq('status', 'open')
      .lt('expires_at', new Date().toISOString())
      .select('id');

    return new Response(
      JSON.stringify({
        archived_posts: data?.length || 0,
        expired_help_requests: expiredHelp?.length || 0,
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
