// Recomputes seller_performance_metrics from the last 30 days of orders.
// Runs on a 15 min cron. Idempotent.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let updated = 0;
  const errors: string[] = [];

  try {
    // Pull orders from last 30 days that have a seller and have moved past 'placed'
    const { data: orders, error } = await supabase
      .from("orders")
      .select("id, seller_id, status, created_at, updated_at, status_changed_at")
      .gte("created_at", since)
      .not("seller_id", "is", null)
      .limit(10000);
    if (error) throw error;

    // Group by seller
    const bySeller = new Map<
      string,
      { responseSecs: number[]; missed: number; total: number; lastActive: string }
    >();

    for (const o of orders || []) {
      const sid = (o as any).seller_id as string;
      if (!sid) continue;
      const bucket = bySeller.get(sid) || {
        responseSecs: [],
        missed: 0,
        total: 0,
        lastActive: (o as any).created_at,
      };
      bucket.total += 1;

      const status = (o as any).status as string;
      const created = new Date((o as any).created_at).getTime();
      const changed = new Date(
        (o as any).status_changed_at || (o as any).updated_at || (o as any).created_at,
      ).getTime();

      if (status === "cancelled") {
        bucket.missed += 1;
      } else if (status !== "placed") {
        // Time from order creation to first non-placed status = response time
        const secs = Math.max(0, Math.round((changed - created) / 1000));
        if (secs > 0 && secs < 60 * 60 * 24) bucket.responseSecs.push(secs);
      }

      const lastActiveTs = Math.max(
        new Date(bucket.lastActive).getTime(),
        changed,
      );
      bucket.lastActive = new Date(lastActiveTs).toISOString();
      bySeller.set(sid, bucket);
    }

    // Pull existing escalation_hits to preserve cumulative count
    const sellerIds = Array.from(bySeller.keys());
    let existingMap = new Map<string, number>();
    if (sellerIds.length > 0) {
      const { data: existing } = await supabase
        .from("seller_performance_metrics")
        .select("seller_id, escalation_hits")
        .in("seller_id", sellerIds);
      for (const row of existing || []) {
        existingMap.set((row as any).seller_id, (row as any).escalation_hits || 0);
      }
    }

    for (const [sellerId, bucket] of bySeller.entries()) {
      const avg =
        bucket.responseSecs.length > 0
          ? Math.round(
              bucket.responseSecs.reduce((a, b) => a + b, 0) /
                bucket.responseSecs.length,
            )
          : 0;

      const { error: upErr } = await supabase.rpc("fn_upsert_seller_metrics", {
        _seller_id: sellerId,
        _avg_response_seconds: avg,
        _missed_orders_count: bucket.missed,
        _total_orders_30d: bucket.total,
        _last_active_at: bucket.lastActive,
      });
      if (upErr) {
        errors.push(`${sellerId}: ${upErr.message}`);
      } else {
        updated += 1;
      }
    }

    return new Response(
      JSON.stringify({ success: true, sellers_updated: updated, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[seller-perf] fatal", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
