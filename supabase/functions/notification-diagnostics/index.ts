import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const [unreadRes, tokensRes, queuedRes, deliveredRes, prefsRes, rolesRes] = await Promise.all([
      admin.from("user_notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id).eq("is_read", false),
      admin.from("device_tokens")
        .select("platform, created_at, last_used_at")
        .eq("user_id", user.id),
      admin.from("notification_queue")
        .select("id, type, status, retry_count, last_error, created_at, processed_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(5),
      admin.from("user_notifications")
        .select("id, type, title, is_read, action_url, data, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(5),
      admin.from("notification_preferences")
        .select("orders, chat, promotions")
        .eq("user_id", user.id).maybeSingle(),
      admin.from("user_roles").select("role").eq("user_id", user.id),
    ]);

    const result = {
      user_id: user.id,
      timestamp: new Date().toISOString(),
      unread_count: unreadRes.count || 0,
      device_tokens: {
        count: (tokensRes.data || []).length,
        platforms: (tokensRes.data || []).map((t: any) => t.platform),
      },
      roles: (rolesRes.data || []).map((r: any) => r.role),
      preferences: prefsRes.data || null,
      last_5_queued: queuedRes.data || [],
      last_5_delivered: (deliveredRes.data || []).map((n: any) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        is_read: n.is_read,
        has_action_url: !!n.action_url,
        has_data: n.data && Object.keys(n.data).length > 0,
        created_at: n.created_at,
      })),
    };

    return new Response(JSON.stringify(result, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || String(error) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
