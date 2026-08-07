import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Per-order acceptance expiry worker.
 * Invoked once when an order becomes `placed`. Reads fire_at from
 * order_acceptance_expiry (ignores client clock), waits until due, then
 * cancels that order by id via expire_unaccepted_order (O(1)).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const allowed =
      token === serviceKey ||
      (anonKey && token === anonKey) ||
      req.headers.get("x-cron-secret") === Deno.env.get("CRON_SECRET");

    if (!allowed) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const orderId = body?.order_id as string | undefined;
    if (!orderId) {
      return new Response(JSON.stringify({ error: "order_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: timer, error: timerErr } = await supabase
      .from("order_acceptance_expiry")
      .select("order_id, fire_at")
      .eq("order_id", orderId)
      .maybeSingle();

    if (timerErr) {
      console.error("[expire-unaccepted-order] timer lookup failed", timerErr);
      return new Response(JSON.stringify({ error: timerErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!timer) {
      // Already accepted/cancelled/cleared — nothing to do
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "no_timer" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const fireAtMs = new Date(timer.fire_at).getTime();
    const delayMs = Math.max(0, fireAtMs - Date.now());
    // Cap slightly above 5m so a slow schedule still waits out the SLA
    const cappedDelay = Math.min(delayMs, 6 * 60 * 1000);

    const runExpire = async () => {
      // Re-check timer still present (seller may have accepted while waiting)
      const { data: still } = await supabase
        .from("order_acceptance_expiry")
        .select("order_id, fire_at")
        .eq("order_id", orderId)
        .maybeSingle();

      if (!still) {
        return { cancelled: false, reason: "timer_cleared" };
      }

      const due = new Date(still.fire_at).getTime() <= Date.now() + 250;
      if (!due) {
        return { cancelled: false, reason: "not_yet_due" };
      }

      const { data, error } = await supabase.rpc("expire_unaccepted_order", {
        _order_id: orderId,
      });

      if (error) {
        console.error("[expire-unaccepted-order] rpc failed", orderId, error);
        return { cancelled: false, reason: error.message };
      }
      return data;
    };

    if (cappedDelay === 0) {
      const result = await runExpire();
      return new Response(JSON.stringify({ ok: true, result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const task = new Promise<void>((resolve) => {
      setTimeout(async () => {
        try {
          const result = await runExpire();
          console.log("[expire-unaccepted-order] fired", orderId, result);
        } catch (e) {
          console.error("[expire-unaccepted-order] wait task failed", orderId, e);
        } finally {
          resolve();
        }
      }, cappedDelay);
    });

    const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (runtime?.waitUntil) {
      runtime.waitUntil(task);
    } else {
      // Local / no waitUntil: still await so the cancel happens
      await task;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        scheduled: true,
        order_id: orderId,
        delay_ms: cappedDelay,
        fire_at: timer.fire_at,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[expire-unaccepted-order] fatal", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
