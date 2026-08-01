import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * Detects GPS-stalled deliveries and writes stall_level (1 = soft, 2 = hard).
 * The notification-engine picks up the stall_level via notification_rules
 * and emits the configured seller + buyer messages. No notifications fired here.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: settingsRows } = await supabase
      .from('system_settings')
      .select('key, value')
      .in('key', [
        'stalled_soft_threshold_minutes',
        'stalled_hard_threshold_minutes',
        'transit_statuses',
      ]);
    const settings: Record<string, string> = {};
    for (const row of settingsRows || []) {
      if (row.key && row.value) settings[row.key] = row.value;
    }

    const softMin = parseFloat(settings['stalled_soft_threshold_minutes'] || '1.5');
    const hardMin = parseFloat(settings['stalled_hard_threshold_minutes'] || '3');

    // Accept either JSON array (["a","b"]) or CSV ("a,b") for transit_statuses
    let transitStatuses: string[] = [];
    const raw = (settings['transit_statuses'] || '').trim();
    if (raw) {
      if (raw.startsWith('[')) {
        try { transitStatuses = JSON.parse(raw); } catch { /* fall through */ }
      }
      if (transitStatuses.length === 0) {
        transitStatuses = raw.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    if (transitStatuses.length === 0) {
      return new Response(JSON.stringify({ skipped: 'no_transit_statuses' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const softCutoff = new Date(Date.now() - softMin * 60_000).toISOString();
    const hardCutoff = new Date(Date.now() - hardMin * 60_000).toISOString();
    const nowIso = new Date().toISOString();

    const { data: assignments, error } = await supabase
      .from('delivery_assignments')
      .select('id, last_location_at, stall_level, status')
      .in('status', transitStatuses)
      .not('last_location_at', 'is', null);

    if (error) throw error;

    let updated = 0;
    let cleared = 0;

    for (const a of assignments || []) {
      const ts = new Date(a.last_location_at as string).toISOString();
      let desired: 0 | 1 | 2 = 0;
      if (ts < hardCutoff) desired = 2;
      else if (ts < softCutoff) desired = 1;

      if ((a as any).stall_level !== desired) {
        const { error: upErr } = await supabase
          .from('delivery_assignments')
          .update({ stall_level: desired, stall_changed_at: nowIso, updated_at: nowIso })
          .eq('id', a.id);
        if (!upErr) {
          if (desired === 0) cleared += 1;
          else updated += 1;
        }
      }
    }

    return new Response(JSON.stringify({ success: true, updated, cleared }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('monitor-stalled-deliveries failed:', e);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
