import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeadersFor, handleCorsPreflight } from "../_shared/cors.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  isCronSecretRequest,
  isServiceRoleRequest,
} from "../_shared/worker-auth.ts";

/* cors: use corsHeadersFor(req) */

const THANK_YOU_TEXT =
  "Thank you for placing your trust in Sociva. Your society app is ready: connect with neighbors and local businesses, explore food and verified services, or list something of your own if you like. Open Sociva and look around. https://sociva.in";

const HARD_BLOCK_LAST10 = new Set(["9632084449"]);
const DEFAULT_DELAY_MS = 4500;
const DEFAULT_BATCH_CAP = 50;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeWhatsAppPhone(raw: string): string | null {
  let digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10 && /^[6-9]/.test(digits)) digits = `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0") && /^[6-9]/.test(digits.slice(1))) {
    digits = `91${digits.slice(1)}`;
  }
  if (digits.length < 11 || digits.length > 15) return null;
  return digits;
}

function last10(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

async function evolutionGoSendText(opts: {
  number: string;
  text: string;
}): Promise<{
  success: boolean;
  code: string;
  providerMessageId?: string;
  error?: string;
}> {
  const digits = String(opts.number || "").replace(/\D/g, "");
  const l10 = last10(digits);
  if (HARD_BLOCK_LAST10.has(l10)) {
    return { success: false, code: "blocked", error: "Phone is on WhatsApp send blocklist" };
  }
  if (/@g\.us|@broadcast|@newsletter/i.test(opts.number)) {
    return { success: false, code: "invalid_phone", error: "Group destinations blocked" };
  }

  const baseUrl = trimSlash(Deno.env.get("EVOLUTION_GO_BASE_URL") || "");
  const apiKey = Deno.env.get("EVOLUTION_GO_API_KEY") || "";
  const instanceName = Deno.env.get("EVOLUTION_GO_INSTANCE_NAME") || "sociva-primary";
  if (!baseUrl || !apiKey) {
    return { success: false, code: "missing_credentials", error: "Evolution Go env missing" };
  }

  try {
    const res = await fetch(`${baseUrl}/send/text`, {
      method: "POST",
      headers: {
        apikey: apiKey,
        "Content-Type": "application/json",
        instanceId: instanceName,
      },
      body: JSON.stringify({
        number: digits,
        text: opts.text,
        formatJid: true,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 429) {
      return { success: false, code: "rate_limited", error: "Evolution Go rate limited" };
    }
    if (!res.ok) {
      const msg = String(body?.error?.message || body?.message || body?.error || `HTTP ${res.status}`);
      const code = /disconnect|not connected|session|device jid/i.test(msg)
        ? "session_disconnected"
        : "evolution_error";
      return { success: false, code, error: msg };
    }
    const providerMessageId = String(
      body?.messageId || body?.data?.Info?.ID || body?.data?.key?.id || body?.key?.id || "",
    ) || undefined;
    return { success: true, code: "ok", providerMessageId };
  } catch (e) {
    return { success: false, code: "provider_unavailable", error: String(e) };
  }
}

Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return handleCorsPreflight(req);
  }
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

  const authHeader = req.headers.get("Authorization") || "";
  const isService = isServiceRoleRequest(req, serviceKey);
  const isCron = isCronSecretRequest(req);

  const admin = createClient(supabaseUrl, serviceKey);
  let isAdmin = false;
  if (!isService && !isCron && authHeader.startsWith("Bearer ") && anonKey) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (user) {
      const { data: roles } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin");
      isAdmin = !!roles && roles.length > 0;
    }
  }

  if (!isService && !isCron && !isAdmin) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as {
    wave?: number;
    dry_run?: boolean;
    test_phone?: string;
    delay_ms?: number;
    batch_cap?: number;
    message?: string;
  };

  const dryRun = body.dry_run === true;
  const delayMs = Math.max(2000, Number(body.delay_ms || DEFAULT_DELAY_MS));
  const batchCap = Math.min(50, Math.max(1, Number(body.batch_cap || DEFAULT_BATCH_CAP)));
  const message = String(body.message || THANK_YOU_TEXT).slice(0, 4000);

  if (body.test_phone) {
    const phone = normalizeWhatsAppPhone(body.test_phone);
    if (!phone) return json({ error: "invalid_test_phone" }, 400);
    if (HARD_BLOCK_LAST10.has(last10(phone))) {
      return json({ error: "test_phone_blocked", phone }, 400);
    }
    if (dryRun) {
      return json({ ok: true, dry_run: true, test_phone: phone, message_len: message.length });
    }
    const result = await evolutionGoSendText({ number: phone, text: `[Sociva test] ${message}` });
    return json({
      ok: result.success,
      test_phone: phone,
      code: result.code,
      providerMessageId: result.providerMessageId || null,
      error: result.error || null,
    }, result.success ? 200 : 502);
  }

  const wave = Number(body.wave || 0);
  if (![1, 2, 3].includes(wave)) {
    return json({ error: "wave must be 1, 2, or 3" }, 400);
  }

  const { data: blockRows } = await admin
    .from("whatsapp_send_blocklist")
    .select("phone_last10");
  const blockSet = new Set<string>([
    ...HARD_BLOCK_LAST10,
    ...((blockRows || []).map((r: { phone_last10: string }) => r.phone_last10)),
  ]);

  const { data: audience, error: audErr } = await admin
    .from("buyer_awareness_campaign_20261116")
    .select("user_id, wa_wave, wa_status")
    .eq("wa_wave", wave)
    .in("wa_status", ["queued", "failed"])
    .order("user_id", { ascending: true })
    .limit(batchCap);

  if (audErr) return json({ error: audErr.message }, 500);

  const userIds = (audience || []).map((r: { user_id: string }) => r.user_id);
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, phone, name")
    .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);

  const profileById = new Map(
    (profiles || []).map((p: { id: string; phone: string | null; name: string | null }) => [p.id, p]),
  );

  const { data: runRow, error: runErr } = await admin
    .from("buyer_awareness_wa_runs")
    .insert({
      wave,
      status: "running",
      dry_run: dryRun,
      requested_count: userIds.length,
      meta: { delay_ms: delayMs, batch_cap: batchCap },
    })
    .select("id")
    .single();

  if (runErr || !runRow) return json({ error: runErr?.message || "run_insert_failed" }, 500);
  const runId = runRow.id as string;

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let stopReason: string | null = null;
  const results: Array<Record<string, unknown>> = [];

  for (let i = 0; i < userIds.length; i++) {
    const userId = userIds[i];
    const profile = profileById.get(userId);
    const phone = normalizeWhatsAppPhone(profile?.phone || "");
    const l10 = phone ? last10(phone) : "";

    if (!phone || !l10) {
      skipped++;
      await admin.from("buyer_awareness_wa_send_log").insert({
        run_id: runId,
        user_id: userId,
        phone: profile?.phone || null,
        wave,
        status: "skipped_no_phone",
      });
      await admin.from("buyer_awareness_campaign_20261116")
        .update({ wa_status: "skipped_no_phone", wa_error: "no_phone" })
        .eq("user_id", userId);
      continue;
    }

    if (blockSet.has(l10)) {
      skipped++;
      await admin.from("buyer_awareness_wa_send_log").insert({
        run_id: runId,
        user_id: userId,
        phone,
        wave,
        status: "skipped_blocklist",
        error: "blocked",
      });
      await admin.from("buyer_awareness_campaign_20261116")
        .update({ wa_status: "skipped_blocklist", wa_error: "blocked" })
        .eq("user_id", userId);
      continue;
    }

    if (dryRun) {
      sent++;
      await admin.from("buyer_awareness_wa_send_log").insert({
        run_id: runId,
        user_id: userId,
        phone,
        wave,
        status: "dry_run",
      });
      results.push({ user_id: userId, phone, status: "dry_run" });
    } else {
      const result = await evolutionGoSendText({ number: phone, text: message });
      if (result.success) {
        sent++;
        await admin.from("buyer_awareness_wa_send_log").insert({
          run_id: runId,
          user_id: userId,
          phone,
          wave,
          status: "sent",
          provider_message_id: result.providerMessageId || null,
        });
        await admin.from("buyer_awareness_campaign_20261116")
          .update({
            wa_status: "sent",
            wa_sent_at: new Date().toISOString(),
            wa_provider_message_id: result.providerMessageId || null,
            wa_error: null,
          })
          .eq("user_id", userId);
        results.push({
          user_id: userId,
          phone,
          status: "sent",
          providerMessageId: result.providerMessageId,
        });
      } else {
        failed++;
        await admin.from("buyer_awareness_wa_send_log").insert({
          run_id: runId,
          user_id: userId,
          phone,
          wave,
          status: "failed",
          error: result.error || result.code,
        });
        await admin.from("buyer_awareness_campaign_20261116")
          .update({
            wa_status: "failed",
            wa_error: result.error || result.code,
          })
          .eq("user_id", userId);
        results.push({
          user_id: userId,
          phone,
          status: "failed",
          error: result.error || result.code,
        });

        if (result.code === "rate_limited" || result.code === "session_disconnected") {
          stopReason = result.code;
          break;
        }
      }
    }

    if (i < userIds.length - 1) await sleep(delayMs);
  }

  const finalStatus = stopReason ? "stopped" : failed > 0 && sent === 0 ? "failed" : "completed";
  await admin.from("buyer_awareness_wa_runs").update({
    status: finalStatus,
    sent_count: sent,
    skipped_count: skipped,
    failed_count: failed,
    stop_reason: stopReason,
    finished_at: new Date().toISOString(),
  }).eq("id", runId);

  return json({
    ok: !stopReason,
    run_id: runId,
    wave,
    dry_run: dryRun,
    requested: userIds.length,
    sent,
    skipped,
    failed,
    stop_reason: stopReason,
    results_preview: results.slice(0, 10),
  });
});
