/**
 * Evolution Go HTTP client for Sociva Edge Functions.
 * Secrets: EVOLUTION_GO_BASE_URL, EVOLUTION_GO_API_KEY, EVOLUTION_GO_INSTANCE_NAME.
 * Paths follow Evolution Go OpenAPI docs; verify against live Swagger after deploy.
 * Never expose GLOBAL_API_KEY / apikey to the frontend.
 */
import { createAdminClient } from "./credentials.ts";

export type EvolutionGoSendResult = {
  success: boolean;
  code:
    | "ok"
    | "missing_credentials"
    | "invalid_phone"
    | "unauthorized"
    | "provider_unavailable"
    | "session_disconnected"
    | "rate_limited"
    | "dry_run"
    | "evolution_error"
    | "unexpected";
  httpStatus?: number;
  providerMessageId?: string;
  raw?: unknown;
  error?: string;
  elapsedMs: number;
};

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function blockedDestination(rawNumber: string): string | null {
  if (/@g\.us|@broadcast|@newsletter/i.test(rawNumber)) {
    return "Group and broadcast destinations are blocked";
  }
  return null;
}

/** Evolution session dropped / not paired (includes "store doesn't contain a device JID"). */
export function isEvolutionSessionDisconnect(message: string): boolean {
  return /disconnect|not connected|session|closed|device jid|doesn'?t contain a device|no device/i
    .test(String(message || ""));
}

export function loadEvolutionGoEnv() {
  const baseUrl = trimSlash(Deno.env.get("EVOLUTION_GO_BASE_URL") || "");
  const apiKey = Deno.env.get("EVOLUTION_GO_API_KEY") || "";
  const instanceName = Deno.env.get("EVOLUTION_GO_INSTANCE_NAME") || "sociva-primary";
  const webhookSecret = Deno.env.get("EVOLUTION_GO_WEBHOOK_SECRET") || "";
  return { baseUrl, apiKey, instanceName, webhookSecret };
}

export function assertEvolutionGoBaseUrlSafe(baseUrl: string): string | null {
  if (!baseUrl) return "EVOLUTION_GO_BASE_URL missing";
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return "EVOLUTION_GO_BASE_URL invalid";
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    return "EVOLUTION_GO_BASE_URL must be https in production";
  }
  return null;
}

async function evoFetch(
  path: string,
  opts: { method?: string; body?: unknown; instanceId?: string | null } = {},
): Promise<{ ok: boolean; status: number; json: any; elapsedMs: number }> {
  const started = Date.now();
  const { baseUrl, apiKey } = loadEvolutionGoEnv();
  const urlErr = assertEvolutionGoBaseUrlSafe(baseUrl);
  if (urlErr || !apiKey) {
    return {
      ok: false,
      status: 0,
      json: { error: urlErr || "EVOLUTION_GO_API_KEY missing" },
      elapsedMs: Date.now() - started,
    };
  }

  const headers: Record<string, string> = {
    apikey: apiKey,
    "Content-Type": "application/json",
  };
  if (opts.instanceId) headers.instanceId = opts.instanceId;

  try {
    const res = await fetch(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`, {
      method: opts.method || "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json, elapsedMs: Date.now() - started };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      json: { error: String(e) },
      elapsedMs: Date.now() - started,
    };
  }
}

export async function evolutionGoHealth(): Promise<{
  ok: boolean;
  status: number;
  error?: string;
  elapsedMs: number;
}> {
  const started = Date.now();
  const { baseUrl, apiKey } = loadEvolutionGoEnv();
  const urlErr = assertEvolutionGoBaseUrlSafe(baseUrl);
  if (urlErr || !apiKey) {
    return { ok: false, status: 0, error: urlErr || "missing credentials", elapsedMs: Date.now() - started };
  }
  try {
    // Root `/` is often 404 on Evolution Go; `/instance/all` proves API + DB are up.
    const res = await fetch(`${baseUrl}/instance/all`, {
      headers: { apikey: apiKey },
    });
    return {
      ok: res.ok || res.status === 503,
      status: res.status,
      error: res.ok ? undefined : `HTTP ${res.status}`,
      elapsedMs: Date.now() - started,
    };
  } catch (e) {
    return { ok: false, status: 0, error: String(e), elapsedMs: Date.now() - started };
  }
}

export async function evolutionGoCreateInstance(name: string) {
  // Evolution Go requires an instance `token` in the body (often same as GLOBAL_API_KEY).
  // Create without it returns 400 "token is required".
  const { apiKey } = loadEvolutionGoEnv();
  return evoFetch("/instance/create", {
    method: "POST",
    body: { name, token: apiKey },
  });
}

export async function evolutionGoConnect(opts: {
  instanceId: string;
  webhookUrl: string;
  subscribe?: string[];
  immediate?: boolean;
}) {
  return evoFetch("/instance/connect", {
    method: "POST",
    instanceId: opts.instanceId,
    body: {
      webhookUrl: opts.webhookUrl,
      subscribe: opts.subscribe || ["ALL"],
      immediate: opts.immediate !== false,
    },
  });
}

export async function evolutionGoQr(instanceId?: string | null) {
  return evoFetch("/instance/qr", {
    method: "GET",
    instanceId: instanceId || undefined,
  });
}

/** Instance list often carries `qrcode` (data URL + optional wa.me link) when GET /instance/qr is still 400. */
export async function evolutionGoListInstances() {
  return evoFetch("/instance/all", { method: "GET" });
}

export async function evolutionGoStatus(instanceId?: string | null) {
  const primary = await evoFetch("/instance/status", {
    method: "GET",
    instanceId: instanceId || undefined,
  });
  if (primary.status !== 404) return primary;
  const { instanceName } = loadEvolutionGoEnv();
  return evoFetch(`/instance/${encodeURIComponent(instanceName)}/status`, {
    method: "GET",
  });
}

export async function evolutionGoDisconnect(instanceId?: string | null) {
  return evoFetch("/instance/disconnect", {
    method: "POST",
    instanceId: instanceId || undefined,
  });
}

export async function evolutionGoLogout(instanceId?: string | null) {
  // Evolution Go OpenAPI: DELETE /instance/logout (POST returns 404).
  return evoFetch("/instance/logout", {
    method: "DELETE",
    instanceId: instanceId || undefined,
  });
}

export async function evolutionGoForceReconnect(instanceId: string) {
  return evoFetch(`/instance/forcereconnect/${encodeURIComponent(instanceId)}`, {
    method: "POST",
    instanceId,
  });
}

export async function evolutionGoDeleteInstance(instanceId: string) {
  return evoFetch(`/instance/delete/${encodeURIComponent(instanceId)}`, {
    method: "DELETE",
    instanceId,
  });
}

export async function evolutionGoSendText(opts: {
  number: string;
  text: string;
  instanceId?: string | null;
  /** When false, `number` is sent as-is (e.g. LID / full JID). Default true for phone digits. */
  formatJid?: boolean;
  dryRun?: boolean;
}): Promise<EvolutionGoSendResult> {
  const started = Date.now();
  const rawNumber = String(opts.number || "").trim();
  const blocked = blockedDestination(rawNumber);
  if (blocked) {
    return {
      success: false,
      code: "invalid_phone",
      error: blocked,
      elapsedMs: Date.now() - started,
    };
  }
  const isJid = /@/.test(rawNumber);
  const digits = rawNumber.replace(/\D/g, "");
  const formatJid = opts.formatJid ?? !isJid;
  const number = isJid ? rawNumber : digits;

  if (!isJid && (digits.length < 10 || digits.length > 15)) {
    return {
      success: false,
      code: "invalid_phone",
      error: "Invalid phone",
      elapsedMs: Date.now() - started,
    };
  }
  if (!number) {
    return {
      success: false,
      code: "invalid_phone",
      error: "Invalid destination",
      elapsedMs: Date.now() - started,
    };
  }

  if (opts.dryRun) {
    return {
      success: true,
      code: "dry_run",
      providerMessageId: `dryrun_${crypto.randomUUID()}`,
      elapsedMs: Date.now() - started,
      raw: { dry_run: true, number, text_len: opts.text.length },
    };
  }

  const res = await evoFetch("/send/text", {
    method: "POST",
    instanceId: opts.instanceId,
    body: { number, text: opts.text, formatJid },
  });

  if (res.status === 0) {
    return {
      success: false,
      code: "provider_unavailable",
      error: String(res.json?.error || "Evolution Go unreachable"),
      elapsedMs: res.elapsedMs,
      raw: res.json,
    };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      success: false,
      code: "unauthorized",
      httpStatus: res.status,
      error: "Evolution Go unauthorized",
      elapsedMs: res.elapsedMs,
      raw: res.json,
    };
  }
  if (res.status === 429) {
    return {
      success: false,
      code: "rate_limited",
      httpStatus: res.status,
      error: "Evolution Go rate limited",
      elapsedMs: res.elapsedMs,
      raw: res.json,
    };
  }
  if (res.status === 503) {
    return {
      success: false,
      code: "provider_unavailable",
      httpStatus: res.status,
      error: "Evolution Go unavailable (license or process)",
      elapsedMs: res.elapsedMs,
      raw: res.json,
    };
  }
  if (!res.ok) {
    const msg = String(res.json?.error?.message || res.json?.message || res.json?.error || `HTTP ${res.status}`);
    return {
      success: false,
      code: isEvolutionSessionDisconnect(msg) ? "session_disconnected" : "evolution_error",
      httpStatus: res.status,
      error: msg,
      elapsedMs: res.elapsedMs,
      raw: res.json,
    };
  }

  const providerMessageId =
    res.json?.messageId ||
    res.json?.data?.Info?.ID ||
    res.json?.data?.key?.id ||
    res.json?.key?.id ||
    undefined;

  return {
    success: true,
    code: "ok",
    httpStatus: res.status,
    providerMessageId: providerMessageId ? String(providerMessageId) : undefined,
    raw: res.json,
    elapsedMs: res.elapsedMs,
  };
}

export type EvolutionGoReplyButton = {
  id: string;
  displayText: string;
};

/** Interactive reply buttons (max 3). Evolution POST /send/button. */
export async function evolutionGoSendButtons(opts: {
  number: string;
  title: string;
  description: string;
  footer: string;
  buttons: EvolutionGoReplyButton[];
  instanceId?: string | null;
  formatJid?: boolean;
}): Promise<EvolutionGoSendResult> {
  const started = Date.now();
  const rawNumber = String(opts.number || "").trim();
  const blocked = blockedDestination(rawNumber);
  if (blocked) {
    return {
      success: false,
      code: "invalid_phone",
      error: blocked,
      elapsedMs: Date.now() - started,
    };
  }
  const isJid = /@/.test(rawNumber);
  const digits = rawNumber.replace(/\D/g, "");
  const formatJid = opts.formatJid ?? !isJid;
  const number = isJid ? rawNumber : digits;

  if (!isJid && (digits.length < 10 || digits.length > 15)) {
    return {
      success: false,
      code: "invalid_phone",
      error: "Invalid phone",
      elapsedMs: Date.now() - started,
    };
  }
  if (!opts.buttons?.length || opts.buttons.length > 3) {
    return {
      success: false,
      code: "evolution_error",
      error: "Need 1-3 reply buttons",
      elapsedMs: Date.now() - started,
    };
  }

  const res = await evoFetch("/send/button", {
    method: "POST",
    instanceId: opts.instanceId,
    body: {
      number,
      formatJid,
      title: opts.title,
      description: opts.description,
      footer: opts.footer,
      buttons: opts.buttons.map((b) => ({
        type: "reply",
        id: b.id,
        displayText: b.displayText,
      })),
    },
  });

  if (!res.ok) {
    const msg = String(
      res.json?.error?.message || res.json?.error || res.json?.message || `HTTP ${res.status}`,
    );
    return {
      success: false,
      code: res.status === 0
        ? "provider_unavailable"
        : isEvolutionSessionDisconnect(msg)
        ? "session_disconnected"
        : "evolution_error",
      httpStatus: res.status || undefined,
      error: msg,
      elapsedMs: res.elapsedMs,
      raw: res.json,
    };
  }

  const providerMessageId =
    res.json?.messageId ||
    res.json?.data?.Info?.ID ||
    res.json?.data?.key?.id ||
    undefined;

  return {
    success: true,
    code: "ok",
    httpStatus: res.status,
    providerMessageId: providerMessageId ? String(providerMessageId) : undefined,
    raw: res.json,
    elapsedMs: res.elapsedMs,
  };
}

export async function upsertCommunicationInstance(row: {
  instance_name: string;
  provider_instance_id?: string | null;
  connection_status?: string;
  last_error?: string | null;
  last_connected_at?: string | null;
  last_health_at?: string | null;
  last_health_ok?: boolean | null;
  last_qr_at?: string | null;
  webhook_configured_at?: string | null;
  connected_phone_masked?: string | null;
  webhook_trusted?: boolean;
  metadata?: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("communication_instances")
    .select("id")
    .eq("channel", "whatsapp_evolution_go")
    .eq("instance_name", row.instance_name)
    .maybeSingle();

  const payload: Record<string, unknown> = {
    channel: "whatsapp_evolution_go",
    instance_name: row.instance_name,
    updated_at: new Date().toISOString(),
  };
  if (row.provider_instance_id !== undefined) payload.provider_instance_id = row.provider_instance_id;
  if (row.connection_status !== undefined) payload.connection_status = row.connection_status;
  if (row.last_error !== undefined) payload.last_error = row.last_error;
  if (row.last_connected_at !== undefined) payload.last_connected_at = row.last_connected_at;
  if (row.last_health_at !== undefined) payload.last_health_at = row.last_health_at;
  if (row.last_health_ok !== undefined) payload.last_health_ok = row.last_health_ok;
  if (row.last_qr_at !== undefined) payload.last_qr_at = row.last_qr_at;
  if (row.webhook_configured_at !== undefined) payload.webhook_configured_at = row.webhook_configured_at;
  if (row.connected_phone_masked !== undefined) payload.connected_phone_masked = row.connected_phone_masked;
  if (row.webhook_trusted !== undefined) payload.webhook_trusted = row.webhook_trusted;
  if (row.metadata !== undefined) payload.metadata = row.metadata;

  if (existing?.id) {
    await admin.from("communication_instances").update(payload).eq("id", existing.id);
    return existing.id as string;
  }
  const { data, error } = await admin.from("communication_instances").insert(payload).select("id").single();
  if (error) console.error("[evolution-go] instance upsert failed", error);
  return data?.id as string | undefined;
}
