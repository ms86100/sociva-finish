/**
 * Single-active WhatsApp provider adapter.
 * Default production provider: Meta Cloud API.
 * Evolution Go is optional and never used unless active_provider=evolution_go.
 * Never silently falls through to the inactive provider.
 */
import { createAdminClient } from "./credentials.ts";
import { evolutionGoSendText, type EvolutionGoSendResult } from "./evolution-go.ts";
import {
  normalizeWhatsAppPhone,
  sendWhatsAppTemplateOrText,
  type WhatsAppSendResult,
} from "./whatsapp.ts";

export type WhatsAppProviderId = "meta" | "evolution_go";

export type ProviderConfigRow = {
  active_provider: WhatsAppProviderId;
  evolution_mode: "disabled" | "dry_run" | "live";
  readiness_connected: boolean;
  readiness_health_ok: boolean;
  readiness_session_valid: boolean;
  readiness_test_message_ok: boolean;
  readiness_webhook_ok: boolean;
  readiness_admin_approved: boolean;
};

export type UnifiedWhatsAppResult = {
  success: boolean;
  provider: WhatsAppProviderId;
  code: string;
  httpStatus?: number;
  providerMessageId?: string;
  metaMessageId?: string;
  error?: string;
  elapsedMs: number;
  dryRun: boolean;
  usedTemplate?: boolean;
  meta?: unknown;
  /** True when delivered/read cannot be confirmed by this provider path */
  deliveryStatusSupported: boolean;
};

const DEFAULT_CONFIG: ProviderConfigRow = {
  active_provider: "meta",
  evolution_mode: "disabled",
  readiness_connected: false,
  readiness_health_ok: false,
  readiness_session_valid: false,
  readiness_test_message_ok: false,
  readiness_webhook_ok: false,
  readiness_admin_approved: false,
};

export async function loadWhatsAppProviderConfig(
  admin = createAdminClient(),
): Promise<ProviderConfigRow> {
  const { data, error } = await admin
    .from("whatsapp_provider_config")
    .select(
      "active_provider, evolution_mode, readiness_connected, readiness_health_ok, readiness_session_valid, readiness_test_message_ok, readiness_webhook_ok, readiness_admin_approved",
    )
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) {
    if (error) console.warn("[whatsapp-provider] config load failed, defaulting to meta", error.message);
    return { ...DEFAULT_CONFIG };
  }

  return {
    active_provider: data.active_provider === "evolution_go" ? "evolution_go" : "meta",
    evolution_mode:
      data.evolution_mode === "dry_run" || data.evolution_mode === "live"
        ? data.evolution_mode
        : "disabled",
    readiness_connected: !!data.readiness_connected,
    readiness_health_ok: !!data.readiness_health_ok,
    readiness_session_valid: !!data.readiness_session_valid,
    readiness_test_message_ok: !!data.readiness_test_message_ok,
    readiness_webhook_ok: !!data.readiness_webhook_ok,
    readiness_admin_approved: !!data.readiness_admin_approved,
  };
}

export async function logProviderWhatsAppMessage(row: {
  direction: "outbound" | "inbound";
  phone: string;
  message?: string | null;
  provider: WhatsAppProviderId;
  provider_message_id?: string | null;
  meta_message_id?: string | null;
  status: string;
  error_code?: string | null;
  error_message?: string | null;
  template_name?: string | null;
  meta_payload?: unknown;
  notification_queue_id?: string | null;
  dry_run?: boolean;
  delivery_status_supported?: boolean;
  created_by?: string | null;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("whatsapp_messages").insert({
    direction: row.direction,
    phone: row.phone,
    message: row.message ?? null,
    provider: row.provider,
    provider_message_id: row.provider_message_id ?? null,
    meta_message_id: row.meta_message_id ?? null,
    status: row.status,
    error_code: row.error_code ?? null,
    error_message: row.error_message ?? null,
    template_name: row.template_name ?? null,
    meta_payload: row.meta_payload ?? null,
    notification_queue_id: row.notification_queue_id ?? null,
    dry_run: !!row.dry_run,
    delivery_status_supported: row.delivery_status_supported !== false,
    created_by: row.created_by ?? null,
  });
  // Unique success-once index: concurrent duplicate success logs are expected under race.
  if (error && String(error.code) !== "23505") {
    console.error("[whatsapp-provider] log insert failed", error);
  }
}

function mapMeta(result: WhatsAppSendResult & { usedTemplate?: boolean }): UnifiedWhatsAppResult {
  return {
    success: result.success,
    provider: "meta",
    code: result.code,
    httpStatus: result.httpStatus,
    metaMessageId: result.metaMessageId,
    providerMessageId: result.metaMessageId,
    error: result.error,
    elapsedMs: result.elapsedMs,
    dryRun: false,
    usedTemplate: result.usedTemplate,
    meta: result.meta,
    deliveryStatusSupported: true,
  };
}

function mapEvolution(result: EvolutionGoSendResult, dryRun: boolean): UnifiedWhatsAppResult {
  return {
    success: result.success,
    provider: "evolution_go",
    code: result.code,
    httpStatus: result.httpStatus,
    providerMessageId: result.providerMessageId,
    error: result.error,
    elapsedMs: result.elapsedMs,
    dryRun,
    usedTemplate: false,
    meta: result.raw,
    // Receipt webhooks may later upgrade status; HTTP accept is not delivery proof
    deliveryStatusSupported: true,
  };
}

/**
 * Send via the single active provider only.
 * If evolution_go is active but disconnected/unavailable, fail - do NOT call Meta.
 */
export async function sendViaActiveWhatsAppProvider(opts: {
  phoneNumber: string;
  /** Free-form / Evolution body */
  text: string;
  /** Meta template path */
  templateName?: string;
  bodyParams?: string[];
  fallbackText?: string;
  /** Override config for a stamped attempt (prevents mid-flight switch reroute) */
  stampedProvider?: WhatsAppProviderId;
  stampedEvolutionMode?: ProviderConfigRow["evolution_mode"];
  forceDryRun?: boolean;
  notificationQueueId?: string | null;
  createdBy?: string | null;
}): Promise<UnifiedWhatsAppResult> {
  const phone = normalizeWhatsAppPhone(opts.phoneNumber);
  if (!phone) {
    return {
      success: false,
      provider: opts.stampedProvider || "meta",
      code: "invalid_phone",
      error: "Invalid phone",
      elapsedMs: 0,
      dryRun: false,
      deliveryStatusSupported: false,
    };
  }

  const cfg = await loadWhatsAppProviderConfig();
  const provider = opts.stampedProvider || cfg.active_provider;
  const evolutionMode = opts.stampedEvolutionMode || cfg.evolution_mode;
  const dryRun =
    !!opts.forceDryRun ||
    (provider === "evolution_go" && evolutionMode === "dry_run");

  if (provider === "meta") {
    const text = opts.fallbackText || opts.text;
    let result: WhatsAppSendResult & { usedTemplate?: boolean };
    if (opts.templateName) {
      result = await sendWhatsAppTemplateOrText({
        phoneNumber: phone,
        templateName: opts.templateName,
        bodyParams: opts.bodyParams || [],
        fallbackText: text,
      });
    } else {
      const { sendWhatsAppText } = await import("./whatsapp.ts");
      result = await sendWhatsAppText({ phoneNumber: phone, message: text });
    }
    const unified = mapMeta(result);
    await logProviderWhatsAppMessage({
      direction: "outbound",
      phone,
      message: text.slice(0, 500),
      provider: "meta",
      meta_message_id: unified.metaMessageId || null,
      provider_message_id: unified.providerMessageId || null,
      status: unified.success ? "sent" : "failed",
      error_code: unified.success ? null : unified.code,
      error_message: unified.error || null,
      template_name: unified.usedTemplate ? opts.templateName || null : null,
      meta_payload: {
        ...(typeof unified.meta === "object" && unified.meta ? unified.meta : {}),
        stamped_provider: provider,
      },
      notification_queue_id: opts.notificationQueueId || null,
      dry_run: false,
      delivery_status_supported: true,
      created_by: opts.createdBy || null,
    });
    return unified;
  }

  // Evolution Go path - never fall through to Meta
  if (evolutionMode === "disabled" && !opts.stampedProvider) {
    const failed: UnifiedWhatsAppResult = {
      success: false,
      provider: "evolution_go",
      code: "provider_unavailable",
      error: "evolution_go selected but mode is disabled",
      elapsedMs: 0,
      dryRun: false,
      deliveryStatusSupported: false,
    };
    await logProviderWhatsAppMessage({
      direction: "outbound",
      phone,
      message: opts.text.slice(0, 500),
      provider: "evolution_go",
      status: "failed",
      error_code: failed.code,
      error_message: failed.error || null,
      notification_queue_id: opts.notificationQueueId || null,
      dry_run: false,
      delivery_status_supported: false,
      created_by: opts.createdBy || null,
    });
    return failed;
  }

  // Live requires readiness; dry_run allows operational proof sends via admin test
  if (!dryRun && evolutionMode === "live") {
    if (
      !cfg.readiness_connected ||
      !cfg.readiness_health_ok ||
      !cfg.readiness_session_valid ||
      !cfg.readiness_admin_approved
    ) {
      const failed: UnifiedWhatsAppResult = {
        success: false,
        provider: "evolution_go",
        code: "session_disconnected",
        error: "evolution_go live blocked: readiness incomplete",
        elapsedMs: 0,
        dryRun: false,
        deliveryStatusSupported: false,
      };
      await logProviderWhatsAppMessage({
        direction: "outbound",
        phone,
        message: opts.text.slice(0, 500),
        provider: "evolution_go",
        status: "failed",
        error_code: failed.code,
        error_message: failed.error || null,
        notification_queue_id: opts.notificationQueueId || null,
        dry_run: false,
        delivery_status_supported: false,
        created_by: opts.createdBy || null,
      });
      return failed;
    }
  }

  const evo = await evolutionGoSendText({
    number: phone,
    text: opts.text,
    dryRun,
  });
  const unified = mapEvolution(evo, dryRun);

  await logProviderWhatsAppMessage({
    direction: "outbound",
    phone,
    message: opts.text.slice(0, 500),
    provider: "evolution_go",
    provider_message_id: unified.providerMessageId || null,
    status: dryRun ? "dry_run" : unified.success ? "provider_accepted" : "failed",
    error_code: unified.success ? null : unified.code,
    error_message: unified.error || null,
    meta_payload: {
      ...(typeof unified.meta === "object" && unified.meta ? unified.meta : {}),
      stamped_provider: provider,
      evolution_mode: evolutionMode,
      note: dryRun
        ? "dry_run_no_external_send"
        : "http_accept_is_not_delivery_proof",
    },
    notification_queue_id: opts.notificationQueueId || null,
    dry_run: dryRun,
    delivery_status_supported: !dryRun,
    created_by: opts.createdBy || null,
  });

  return unified;
}

/** Evidence blob to merge into notification_queue.delivery_evidence */
export function whatsappDeliveryEvidence(
  result: UnifiedWhatsAppResult,
): Record<string, unknown> {
  return {
    whatsapp: {
      provider: result.provider,
      success: result.success,
      code: result.code,
      dry_run: result.dryRun,
      provider_message_id: result.providerMessageId || null,
      meta_message_id: result.metaMessageId || null,
      error: result.error || null,
      elapsed_ms: result.elapsedMs,
      delivery_status_supported: result.deliveryStatusSupported,
      // Explicit: HTTP acceptance is not WhatsApp delivery proof
      delivery_confirmed: false,
    },
  };
}
