/**
 * Admin-only Evolution Go control plane.
 * Frontend never receives GLOBAL_API_KEY. All Evolution calls are server-side.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient } from "../_shared/credentials.ts";
import {
  evolutionGoConnect,
  evolutionGoCreateInstance,
  evolutionGoDeleteInstance,
  evolutionGoDisconnect,
  evolutionGoHealth,
  evolutionGoListInstances,
  evolutionGoLogout,
  evolutionGoQr,
  evolutionGoSendText,
  evolutionGoStatus,
  loadEvolutionGoEnv,
  upsertCommunicationInstance,
} from "../_shared/evolution-go.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Action =
  | "get_config"
  | "health"
  | "status"
  | "connect"
  | "qr"
  | "disconnect"
  | "reconnect"
  | "test_message"
  | "set_provider"
  | "kill_switch_meta"
  | "update_readiness"
  | "approve_live"
  | "stats"
  | "audit"
  | "messages"
  | "retry_failed_with_active_provider";

async function requireAdmin(req: Request): Promise<{ userId: string; admin: ReturnType<typeof createAdminClient> } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ success: false, code: "unauthorized", error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const admin = createAdminClient();
  const token = authHeader.replace("Bearer ", "");
  const { data: userData, error } = await admin.auth.getUser(token);
  if (error || !userData?.user) {
    return new Response(JSON.stringify({ success: false, code: "unauthorized", error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: isAdmin } = await admin.rpc("is_admin", { _user_id: userData.user.id });
  if (!isAdmin) {
    return new Response(JSON.stringify({ success: false, code: "unauthorized", error: "Admin only" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return { userId: userData.user.id, admin };
}

function supabaseFunctionsBase(): string {
  const url = Deno.env.get("SUPABASE_URL") || "";
  return `${url.replace(/\/+$/, "")}/functions/v1`;
}

function maskPhone(raw: string | null | undefined): string | null {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length < 4) return null;
  return `${"*".repeat(Math.max(0, d.length - 4))}${d.slice(-4)}`;
}

/** Normalize Evolution QR payloads: `data:image/...;base64,xxx|https://wa.me/...` or raw base64. */
function normalizeQrPayload(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  // Instance list returns image data URL, optionally pipe-separated with a deep link.
  if (s.includes("|")) s = s.split("|")[0].trim();
  if (s.startsWith("data:image")) {
    const marker = "base64,";
    const idx = s.indexOf(marker);
    if (idx >= 0) {
      const b64 = s.slice(idx + marker.length).trim();
      return b64.length > 20 ? b64 : null;
    }
    return s.length > 40 ? s : null;
  }
  return s.length > 20 ? s : null;
}

function extractQrBase64(json: any): string | null {
  const list = Array.isArray(json?.data) ? json.data : null;
  const fromList = list
    ?.map((row: any) => row?.qrcode || row?.Qrcode || row?.QRCode || row?.base64)
    .find((v: unknown) => typeof v === "string" && v.length > 20);
  const candidates = [
    fromList,
    json?.data?.Qrcode,
    json?.data?.qrcode,
    json?.data?.QRCode,
    json?.data?.base64,
    json?.data?.qr,
    json?.data?.code,
    json?.qrCode,
    json?.qrcode,
    json?.base64,
  ];
  for (const c of candidates) {
    const normalized = normalizeQrPayload(c);
    if (normalized) return normalized;
  }
  return null;
}

function interpretConnected(json: any): boolean {
  const data = json?.data || json || {};
  if (data.Connected === true || data.connected === true || data.LoggedIn === true || data.loggedIn === true) {
    return true;
  }
  if (data.Connected === false || data.connected === false || data.LoggedIn === false || data.loggedIn === false) {
    return false;
  }
  if (json?.data?.instance?.state === "open") return true;
  const state = String(data.state || data.Status || data.status || "").toLowerCase();
  return state === "open" || state === "connected" || state === "online";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollQrBase64(instanceId: string | null | undefined, attempts = 6): Promise<{
  qrBase64: string | null;
  lastStatus: number;
  lastError: string | null;
}> {
  let lastStatus = 0;
  let lastError: string | null = null;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(2000);
    // Prefer /instance/all first - QR often lands there while /instance/qr still 400s.
    // Also avoids hammering /qr which starts new whatsmeow clients and can exhaust Postgres.
    const listed = await evolutionGoListInstances();
    if (listed.ok) {
      const rows = Array.isArray(listed.json?.data) ? listed.json.data : [];
      const match = instanceId
        ? rows.find((r: any) => String(r?.id || "") === String(instanceId))
        : rows[0];
      const fromList = extractQrBase64({ data: match ? [match] : rows });
      if (fromList) return { qrBase64: fromList, lastStatus: listed.status, lastError: null };
    }
    const qr = await evolutionGoQr(instanceId);
    lastStatus = qr.status;
    const qrBase64 = extractQrBase64(qr.json);
    if (qrBase64) return { qrBase64, lastStatus, lastError: null };
    lastError = String(
      qr.json?.error?.message || qr.json?.error || qr.json?.message || listed.json?.error ||
        `HTTP ${qr.status}`,
    );
  }
  return { qrBase64: null, lastStatus, lastError };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  const { userId, admin } = auth;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: Action;
      provider?: string;
      mode?: string;
      reason?: string;
      phoneNumber?: string;
      message?: string;
      notificationQueueId?: string;
      readiness?: Record<string, boolean>;
    };
    const action = (body.action || "get_config") as Action;
    const { instanceName, webhookSecret, baseUrl } = loadEvolutionGoEnv();

    if (action === "get_config") {
      const { data: cfg } = await admin.from("whatsapp_provider_config").select("*").eq("id", 1).maybeSingle();
      const { data: instance } = await admin
        .from("communication_instances")
        .select("*")
        .eq("channel", "whatsapp_evolution_go")
        .eq("instance_name", instanceName)
        .maybeSingle();
      return json({
        success: true,
        config: cfg,
        instance,
        evolutionConfigured: !!(baseUrl && Deno.env.get("EVOLUTION_GO_API_KEY")),
        // Never return API keys
      });
    }

    if (action === "health") {
      const health = await evolutionGoHealth();
      await upsertCommunicationInstance({
        instance_name: instanceName,
        last_health_at: new Date().toISOString(),
        last_health_ok: health.ok && health.status < 500,
        last_error: health.ok ? null : health.error || `HTTP ${health.status}`,
      });
      if (health.ok && health.status < 500) {
        await admin.rpc("admin_update_whatsapp_evolution_readiness", {
          p_health_ok: true,
          p_metadata: { source: "health", status: health.status },
        });
      }
      return json({ success: true, health });
    }

    if (action === "status") {
      const { data: instance } = await admin
        .from("communication_instances")
        .select("*")
        .eq("instance_name", instanceName)
        .maybeSingle();
      const status = await evolutionGoStatus(instance?.provider_instance_id);
      const connected = interpretConnected(status.json);
      await upsertCommunicationInstance({
        instance_name: instanceName,
        provider_instance_id: instance?.provider_instance_id,
        connection_status: connected ? "connected" : "disconnected",
        last_connected_at: connected ? new Date().toISOString() : undefined,
        last_health_at: new Date().toISOString(),
        last_health_ok: status.ok,
        last_error: status.ok ? null : String(status.json?.error || status.json?.message || `HTTP ${status.status}`),
      });
      if (connected) {
        await admin.rpc("admin_update_whatsapp_evolution_readiness", {
          p_connected: true,
          p_session_valid: true,
          p_health_ok: true,
          p_metadata: { source: "status" },
        });
      }
      return json({ success: true, connected, status: status.json, httpStatus: status.status });
    }

    if (action === "connect" || action === "reconnect") {
      // Ensure instance exists
      let { data: instance } = await admin
        .from("communication_instances")
        .select("*")
        .eq("instance_name", instanceName)
        .maybeSingle();

      if (!instance?.provider_instance_id) {
        const created = await evolutionGoCreateInstance(instanceName);
        const id =
          created.json?.data?.id ||
          created.json?.instance?.id ||
          created.json?.id ||
          null;
        if (!created.ok && !id) {
          return json({
            success: false,
            code: "evolution_error",
            error: String(created.json?.error?.message || created.json?.error || "create instance failed"),
            raw: created.json,
          }, 502);
        }
        await upsertCommunicationInstance({
          instance_name: instanceName,
          provider_instance_id: id ? String(id) : null,
          connection_status: "connecting",
        });
        const refreshed = await admin
          .from("communication_instances")
          .select("*")
          .eq("instance_name", instanceName)
          .maybeSingle();
        instance = refreshed.data;
      }

      if (!webhookSecret) {
        return json({
          success: false,
          code: "missing_credentials",
          error: "EVOLUTION_GO_WEBHOOK_SECRET not configured",
        }, 400);
      }

      // F6: never put the webhook secret in the query string.
      // Prefer EVOLUTION_GO_WEBHOOK_URL (private Docker relay that injects
      // x-sociva-webhook-secret). Fall back to direct Edge URL only if unset
      // (requires an external header-injecting relay in front of Supabase).
      const webhookOverride = (Deno.env.get("EVOLUTION_GO_WEBHOOK_URL") || "").replace(/\/+$/, "");
      const webhookUrl = webhookOverride ||
        `${supabaseFunctionsBase()}/receive-evolution-go-webhook`;
      if (webhookUrl.includes("?") && /[?&](secret|token)=/i.test(webhookUrl)) {
        return json({
          success: false,
          code: "invalid_webhook_url",
          error: "Webhook URL must not contain secret/token query parameters",
        }, 400);
      }

      let instanceId = String(instance?.provider_instance_id || "");

      // Soft path first: connect once, then read QR from /instance/all.
      // Aggressive logout/delete + QR hammering exhausted Postgres (too many clients).
      let connect = await evolutionGoConnect({
        instanceId,
        webhookUrl,
        subscribe: ["ALL"],
        immediate: true,
      });
      let polled = await pollQrBase64(instanceId, 6);

      if (!polled.qrBase64 && instanceId) {
        await evolutionGoLogout(instanceId).catch(() => null);
        connect = await evolutionGoConnect({
          instanceId,
          webhookUrl,
          subscribe: ["ALL"],
          immediate: true,
        });
        polled = await pollQrBase64(instanceId, 5);
      }

      // Last resort: delete + recreate so whatsmeow drops the stale device store.
      if (!polled.qrBase64 && instanceId) {
        await evolutionGoDeleteInstance(instanceId).catch(() => null);
        const created = await evolutionGoCreateInstance(instanceName);
        const newId =
          created.json?.data?.id ||
          created.json?.instance?.id ||
          created.json?.id ||
          null;
        if (newId) {
          instanceId = String(newId);
          await upsertCommunicationInstance({
            instance_name: instanceName,
            provider_instance_id: instanceId,
            connection_status: "connecting",
            last_error: null,
          });
          connect = await evolutionGoConnect({
            instanceId,
            webhookUrl,
            subscribe: ["ALL"],
            immediate: true,
          });
          polled = await pollQrBase64(instanceId, 6);
          instance = {
            ...instance,
            provider_instance_id: instanceId,
          };
        }
      }

      const qrBase64 = polled.qrBase64;
      await upsertCommunicationInstance({
        instance_name: instanceName,
        provider_instance_id: instance?.provider_instance_id,
        connection_status: qrBase64 ? "qr" : "disconnected",
        webhook_configured_at: new Date().toISOString(),
        last_qr_at: qrBase64 ? new Date().toISOString() : undefined,
        // F7: admin-initiated connect marks this instance trusted for webhooks
        metadata: { webhook_auth: "header_only", trusted_via: "admin_connect" },
        last_error: qrBase64
          ? null
          : (polled.lastError || String(connect.json?.error || connect.json?.message || "QR unavailable")),
      });
      await admin.from("communication_instances").update({
        webhook_trusted: true,
        updated_at: new Date().toISOString(),
      }).eq("instance_name", instanceName).eq("channel", "whatsapp_evolution_go");

      await admin.from("whatsapp_provider_audit").insert({
        action: action === "reconnect" ? "reconnect" : "connect",
        actor_id: userId,
        reason: body.reason || action,
        metadata: {
          instance_name: instanceName,
          http: connect.status,
          qr: !!qrBase64,
          qr_status: polled.lastStatus,
        },
      });

      if (!qrBase64) {
        return json({
          success: false,
          code: "qr_unavailable",
          connect: connect.json,
          qrBase64: null,
          webhookConfigured: true,
          error: polled.lastError ||
            "Evolution did not issue a QR. The WhatsApp session may be stuck - try Connect again in 30 seconds.",
        }, 502);
      }

      return json({
        success: true,
        connect: connect.json,
        qrBase64,
        webhookConfigured: true,
        note: "Scan QR in WhatsApp Linked Devices. Status Connected only after verification.",
      });
    }

    if (action === "qr") {
      const { data: instance } = await admin
        .from("communication_instances")
        .select("*")
        .eq("instance_name", instanceName)
        .maybeSingle();
      let instanceId = instance?.provider_instance_id
        ? String(instance.provider_instance_id)
        : null;

      const webhookOverride = (Deno.env.get("EVOLUTION_GO_WEBHOOK_URL") || "").replace(/\/+$/, "");
      const webhookUrl = webhookOverride ||
        `${supabaseFunctionsBase()}/receive-evolution-go-webhook`;

      // Soft refresh: read existing QR from /instance/all, then one connect if needed.
      let polled = await pollQrBase64(instanceId, 4);
      if (!polled.qrBase64 && instanceId) {
        await evolutionGoConnect({
          instanceId,
          webhookUrl,
          subscribe: ["ALL"],
          immediate: true,
        }).catch(() => null);
        polled = await pollQrBase64(instanceId, 5);
      }

      const qrBase64 = polled.qrBase64;
      if (qrBase64) {
        await upsertCommunicationInstance({
          instance_name: instanceName,
          provider_instance_id: instanceId,
          last_qr_at: new Date().toISOString(),
          connection_status: "qr",
          last_error: null,
        });
      } else {
        await upsertCommunicationInstance({
          instance_name: instanceName,
          provider_instance_id: instanceId,
          connection_status: "disconnected",
          last_error: polled.lastError || "QR unavailable",
        });
      }
      return json({
        success: !!qrBase64,
        qrBase64,
        rawStatus: polled.lastStatus,
        error: qrBase64
          ? null
          : (polled.lastError ||
            "Evolution did not issue a QR. Tap Connect WhatsApp to reset the session, then Refresh QR."),
      }, qrBase64 ? 200 : 502);
    }

    if (action === "disconnect") {
      const { data: instance } = await admin
        .from("communication_instances")
        .select("provider_instance_id")
        .eq("instance_name", instanceName)
        .maybeSingle();
      const disc = await evolutionGoDisconnect(instance?.provider_instance_id);
      await evolutionGoLogout(instance?.provider_instance_id).catch(() => null);
      await upsertCommunicationInstance({
        instance_name: instanceName,
        connection_status: "disconnected",
        last_error: null,
      });
      await admin.rpc("admin_update_whatsapp_evolution_readiness", {
        p_connected: false,
        p_session_valid: false,
        p_metadata: { source: "disconnect" },
      });
      // Clear live approval on disconnect
      await admin.from("whatsapp_provider_config").update({
        readiness_admin_approved: false,
        readiness_admin_approved_at: null,
        updated_at: new Date().toISOString(),
      }).eq("id", 1);
      await admin.from("whatsapp_provider_audit").insert({
        action: "disconnect",
        actor_id: userId,
        reason: body.reason || "disconnect",
        metadata: { http: disc.status },
      });
      return json({ success: true, disconnected: true });
    }

    if (action === "test_message") {
      const phone = body.phoneNumber || "";
      const message = body.message || "Sociva Evolution Go test message";
      // Operational readiness requires a real Evolution send (not Meta, not silent).
      // forceDry=true only simulates payload for UI wiring checks and does NOT satisfy readiness_test_message_ok.
      const forceDry = body.mode === "dry_run";
      const result = await evolutionGoSendText({
        number: phone,
        text: message,
        dryRun: !!forceDry,
      });

      const { logProviderWhatsAppMessage } = await import("../_shared/whatsapp-provider.ts");
      await logProviderWhatsAppMessage({
        direction: "outbound",
        phone: phone.replace(/\D/g, ""),
        message: message.slice(0, 500),
        provider: "evolution_go",
        provider_message_id: result.providerMessageId || null,
        status: forceDry ? "dry_run" : result.success ? "provider_accepted" : "failed",
        error_code: result.success ? null : result.code,
        error_message: result.error || null,
        meta_payload: {
          source: "admin_test_message",
          dry_run: !!forceDry,
          note: "http_accept_is_not_delivery_proof",
        },
        dry_run: !!forceDry,
        delivery_status_supported: !forceDry,
        created_by: userId,
      });

      if (result.success && !forceDry) {
        await admin.rpc("admin_update_whatsapp_evolution_readiness", {
          p_test_message_ok: true,
          p_metadata: { source: "test_message", provider_message_id: result.providerMessageId },
        });
      }

      await admin.from("whatsapp_provider_audit").insert({
        action: "test_message",
        actor_id: userId,
        reason: body.reason || "test_message",
        metadata: {
          success: result.success,
          code: result.code,
          dry_run: !!forceDry,
          phone_masked: maskPhone(phone),
        },
      });

      return json({
        success: result.success,
        code: result.code,
        error: result.error,
        providerMessageId: result.providerMessageId,
        elapsedMs: result.elapsedMs,
        dryRun: !!forceDry,
        note: result.success && !forceDry
          ? "HTTP accept is not delivery proof - confirm on the handset before marking device test passed."
          : forceDry
          ? "Dry-run does not satisfy live readiness test_message gate."
          : undefined,
      }, result.success ? 200 : 502);
    }

    if (action === "set_provider") {
      const { data, error } = await admin.rpc("admin_set_whatsapp_provider", {
        p_provider: body.provider,
        p_mode: body.mode ?? null,
        p_reason: body.reason ?? null,
      });
      if (error) {
        return json({ success: false, code: "rpc_error", error: error.message }, 400);
      }
      return json({ success: true, config: data });
    }

    if (action === "kill_switch_meta") {
      const { data, error } = await admin.rpc("admin_rollback_whatsapp_provider_to_meta", {
        p_reason: body.reason || "kill_switch",
      });
      if (error) return json({ success: false, code: "rpc_error", error: error.message }, 400);
      return json({ success: true, config: data, killed: true });
    }

    if (action === "update_readiness") {
      const r = body.readiness || {};
      const { data, error } = await admin.rpc("admin_update_whatsapp_evolution_readiness", {
        p_connected: r.connected ?? null,
        p_health_ok: r.health_ok ?? null,
        p_session_valid: r.session_valid ?? null,
        p_test_message_ok: r.test_message_ok ?? null,
        p_webhook_ok: r.webhook_ok ?? null,
        p_metadata: { source: "admin_manual" },
      });
      if (error) return json({ success: false, code: "rpc_error", error: error.message }, 400);
      return json({ success: true, config: data });
    }

    if (action === "approve_live") {
      const { data, error } = await admin.rpc("admin_approve_whatsapp_evolution_live", {
        p_reason: body.reason || "admin_approve_live",
      });
      if (error) return json({ success: false, code: "rpc_error", error: error.message }, 400);
      return json({ success: true, config: data });
    }

    if (action === "stats") {
      // Service-role client has auth.uid()=null, so the admin-only RPC fails.
      // Aggregate directly after requireAdmin already verified the caller.
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await admin
        .from("whatsapp_messages")
        .select("provider, status, dry_run")
        .gte("created_at", since);
      if (error) return json({ success: false, code: "rpc_error", error: error.message }, 400);
      const counts = new Map<string, { provider: string; status: string; dry_run: boolean; cnt: number }>();
      for (const row of data || []) {
        const provider = String(row.provider || "unknown");
        const status = String(row.status || "unknown");
        const dry_run = row.dry_run === true;
        const key = `${provider}|${status}|${dry_run ? 1 : 0}`;
        const prev = counts.get(key);
        if (prev) prev.cnt += 1;
        else counts.set(key, { provider, status, dry_run, cnt: 1 });
      }
      return json({
        success: true,
        stats: [...counts.values()].sort((a, b) =>
          a.provider.localeCompare(b.provider) || a.status.localeCompare(b.status)
        ),
        legend: {
          provider_accepted: "Provider HTTP accepted - not proof of WhatsApp delivery",
          dry_run: "No external send",
          unsupported: "Status not supported by provider path",
          delivered_read: "Only when webhook receipts confirm; otherwise do not invent",
        },
      });
    }

    if (action === "audit") {
      const { data } = await admin
        .from("whatsapp_provider_audit")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      return json({ success: true, audit: data || [] });
    }

    if (action === "messages") {
      const { data } = await admin
        .from("whatsapp_messages")
        .select("id, direction, phone, message, provider, status, dry_run, error_code, error_message, provider_message_id, meta_message_id, created_at, delivery_status_supported")
        .order("created_at", { ascending: false })
        .limit(100);
      return json({ success: true, messages: data || [] });
    }

    if (action === "retry_failed_with_active_provider") {
      // F2: WhatsApp-only retry. Never reset push / queue status to re-fire FCM/APNs.
      const queueId = body.notificationQueueId;
      if (!queueId) {
        return json({ success: false, code: "invalid", error: "notificationQueueId required" }, 400);
      }

      const { data: cfg } = await admin.from("whatsapp_provider_config").select("active_provider").eq("id", 1).maybeSingle();
      const { data: queueRow, error: qErr } = await admin
        .from("notification_queue")
        .select("id, user_id, type, title, body, payload, whatsapp_status, whatsapp_provider, status")
        .eq("id", queueId)
        .maybeSingle();
      if (qErr || !queueRow) {
        return json({ success: false, code: "not_found", error: "notification queue item not found" }, 404);
      }

      const { data: retryReq, error: retryErr } = await admin.rpc("admin_request_whatsapp_only_retry", {
        p_notification_queue_id: queueId,
        p_reason: body.reason || "admin_whatsapp_only_retry",
        p_to_provider: cfg?.active_provider || "meta",
        p_idempotency_key: body.idempotencyKey || null,
      });
      if (retryErr) return json({ success: false, code: "rpc_error", error: retryErr.message }, 400);
      if (retryReq && retryReq.ok === false) {
        return json({
          success: false,
          code: String(retryReq.reason || "duplicate_retry"),
          error: "Duplicate WhatsApp retry suppressed",
          retry: retryReq,
        }, 409);
      }

      // Deliver WhatsApp immediately via adapter (does not touch push)
      const { data: profile } = await admin
        .from("profiles")
        .select("phone, name")
        .eq("id", queueRow.user_id)
        .maybeSingle();
      const { deliverWhatsAppForQueueItem } = await import("../_shared/whatsapp-notify.ts");
      const wa = await deliverWhatsAppForQueueItem({
        userId: queueRow.user_id,
        phone: profile?.phone,
        userName: profile?.name,
        type: queueRow.type,
        title: queueRow.title,
        body: queueRow.body,
        payload: {
          ...(queueRow.payload || {}),
          force_whatsapp_retry: true,
          whatsapp_retry_to_provider: cfg?.active_provider || "meta",
        },
        whatsappPref: true,
        notificationId: queueId,
        forceWhatsAppRetry: true,
        stampedProvider: (cfg?.active_provider === "evolution_go" ? "evolution_go" : "meta"),
      });

      return json({
        success: true,
        retried: true,
        whatsappOnly: true,
        pushUntouched: true,
        queueStatusUnchanged: queueRow.status,
        activeProvider: cfg?.active_provider,
        whatsappAttempted: wa.attempted,
        whatsappSuccess: wa.result?.success ?? null,
        whatsappCode: wa.result?.code || wa.skipReason || null,
        audit: retryReq,
        note: "WhatsApp-only retry completed. Push was not re-triggered.",
      });
    }

    return json({ success: false, code: "unknown_action", error: `Unknown action ${action}` }, 400);
  } catch (e) {
    console.error("[evolution-go-admin]", e);
    return json({ success: false, code: "unexpected", error: String(e) }, 500);
  }
});

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
