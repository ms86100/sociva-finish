import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor, handleCorsPreflight } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";
import { isAuthorizedWorker } from "../_shared/worker-auth.ts";

/* cors: use corsHeadersFor(req) */

const PENDING_AGE_ALERT_MS = 15 * 60 * 1000;
const PENDING_COUNT_ALERT = 100;

function parseSentryDsn(dsn: string): { host: string; projectId: string; key: string } | null {
  const trimmed = dsn.trim();
  const m = trimmed.match(/^https:\/\/([^@]+)@([^/]+)\/(\d+)\/?$/);
  if (!m) return null;
  return { key: m[1], host: m[2], projectId: m[3] };
}

async function postSentryWarning(
  dsn: string,
  message: string,
  extra: Record<string, unknown>,
): Promise<void> {
  const parsed = parseSentryDsn(dsn);
  if (!parsed) return;

  const eventId = crypto.randomUUID().replace(/-/g, "");
  const payload = {
    event_id: eventId,
    timestamp: new Date().toISOString(),
    platform: "javascript",
    level: "warning",
    logger: "ops-alert-check",
    message,
    extra,
  };

  const url = `https://${parsed.host}/api/${parsed.projectId}/store/`;
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sentry-Auth":
        `Sentry sentry_version=7, sentry_client=ops-alert-check/1.0, sentry_key=${parsed.key}`,
    },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return handleCorsPreflight(req);
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!isAuthorizedWorker(req, serviceKey)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { count: pendingCount, error: countErr } = await supabase
      .from("notification_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");

    if (countErr) {
      return new Response(
        JSON.stringify({ ok: false, error: countErr.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const pending = pendingCount ?? 0;

    const { data: oldestPending, error: oldestErr } = await supabase
      .from("notification_queue")
      .select("created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (oldestErr) {
      return new Response(
        JSON.stringify({ ok: false, error: oldestErr.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const oldestAgeMs = oldestPending?.created_at
      ? Math.max(0, Date.now() - new Date(oldestPending.created_at).getTime())
      : 0;

    const alerted =
      pending > PENDING_COUNT_ALERT || oldestAgeMs > PENDING_AGE_ALERT_MS;

    const body = {
      ok: true,
      alerted,
      pending_count: pending,
      oldest_pending_age_sec: Math.floor(oldestAgeMs / 1000),
      thresholds: {
        pending_count: PENDING_COUNT_ALERT,
        oldest_age_sec: Math.floor(PENDING_AGE_ALERT_MS / 1000),
      },
      checked_at: new Date().toISOString(),
    };

    const sentryDsn = Deno.env.get("SENTRY_DSN")?.trim();
    if (alerted && sentryDsn) {
      await postSentryWarning(sentryDsn, "notification_queue backlog alert", {
        pending_count: pending,
        oldest_pending_age_sec: body.oldest_pending_age_sec,
      });
    }

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});