/**
 * Independent WhatsApp channel helpers for notification_queue.
 * Push retries must not resend a successful WhatsApp delivery (adversarial F1).
 */
import { createAdminClient } from "./credentials.ts";
import type { UnifiedWhatsAppResult, WhatsAppProviderId } from "./whatsapp-provider.ts";

export type WhatsAppClaimResult =
  | { ok: true; force: boolean; attemptCount: number }
  | { ok: false; reason: string; whatsappStatus?: string; provider?: string; messageId?: string };

export async function claimWhatsAppChannel(
  queueId: string,
  force = false,
  admin = createAdminClient(),
): Promise<WhatsAppClaimResult> {
  const { data, error } = await admin.rpc("claim_whatsapp_channel_delivery", {
    p_queue_id: queueId,
    p_force: force,
  });
  if (error) {
    console.warn("[whatsapp-channel] claim failed", error.message);
    // Fail closed for send (avoid duplicates) when claim RPC unavailable after migration
    return { ok: false, reason: `claim_error:${error.message}` };
  }
  const row = data as Record<string, unknown>;
  if (!row?.ok) {
    return {
      ok: false,
      reason: String(row?.reason || "not_claimed"),
      whatsappStatus: row?.whatsapp_status ? String(row.whatsapp_status) : undefined,
      provider: row?.whatsapp_provider ? String(row.whatsapp_provider) : undefined,
      messageId: row?.whatsapp_provider_message_id
        ? String(row.whatsapp_provider_message_id)
        : undefined,
    };
  }
  return {
    ok: true,
    force: !!row.force,
    attemptCount: Number(row.attempt_count || 1),
  };
}

export async function completeWhatsAppChannel(
  queueId: string,
  result: {
    status: string;
    provider?: WhatsAppProviderId | null;
    providerMessageId?: string | null;
    error?: string | null;
  },
  admin = createAdminClient(),
): Promise<void> {
  const { error } = await admin.rpc("complete_whatsapp_channel_delivery", {
    p_queue_id: queueId,
    p_status: result.status,
    p_provider: result.provider ?? null,
    p_provider_message_id: result.providerMessageId ?? null,
    p_error: result.error ?? null,
  });
  if (error) console.warn("[whatsapp-channel] complete failed", error.message);
}

export function mapUnifiedToChannelStatus(result: UnifiedWhatsAppResult): string {
  if (result.dryRun) return "dry_run";
  if (!result.success) return "failed";
  if (result.provider === "evolution_go") return "provider_accepted";
  return "sent";
}

/** Merge push evidence without wiping whatsapp evidence (F4). */
export function mergeDeliveryEvidence(
  existing: Record<string, unknown> | null | undefined,
  pushEvidence: Record<string, unknown>,
  whatsappEvidence?: Record<string, unknown> | null,
): Record<string, unknown> {
  const base = existing && typeof existing === "object" ? { ...existing } : {};
  const prevWa =
    whatsappEvidence?.whatsapp ||
    (base.whatsapp && typeof base.whatsapp === "object" ? base.whatsapp : undefined);
  return {
    ...base,
    ...pushEvidence,
    ...(prevWa ? { whatsapp: prevWa } : {}),
    ...(whatsappEvidence?.whatsapp ? { whatsapp: whatsappEvidence.whatsapp } : {}),
  };
}
