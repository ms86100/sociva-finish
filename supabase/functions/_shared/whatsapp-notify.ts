/**
 * Maps notification_queue items → WhatsApp Cloud API sends.
 * Called from process-notification-queue as an additional channel (never replaces push/in-app).
 */
import {
  resolveQueueDisplayCopy,
} from "./notification-display-copy.ts";
import { normalizeWhatsAppPhone } from "./whatsapp.ts";
import {
  claimWhatsAppChannel,
  completeWhatsAppChannel,
  mapUnifiedToChannelStatus,
} from "./whatsapp-channel.ts";
import {
  loadWhatsAppProviderConfig,
  sendViaActiveWhatsAppProvider,
  whatsappDeliveryEvidence,
  type UnifiedWhatsAppResult,
  type WhatsAppProviderId,
} from "./whatsapp-provider.ts";

const WA_ELIGIBLE_TYPES = new Set([
  "order",
  "order_status",
  "order_update",
  "booking_reminder_1_hour",
  "booking_reminder_30_min",
  "booking_reminder_10_min",
  "delivery",
  "delivery_en_route",
  "delivery_stalled",
  "settlement",
  "review_received",
  "seller_approved",
  "seller_rejected",
  "seller_suspended",
  "seller_store_submitted",
  "seller_store_under_review",
  "refund_request",
  "refund_request",
  "license_approved",
  "license_rejected",
  "product_approved",
  "product_rejected",
]);

const SKIP_TYPES = new Set([
  "chat",
  "chat_message",
  "promotion",
  "campaign",
  "visitor",
  "parcel",
  "dispute",
  "snag",
  "milestone",
  "worker_job",
]);

function toWaPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return normalizeWhatsAppPhone(`91${digits}`);
  return normalizeWhatsAppPhone(digits);
}

function shortOrderRef(payload: Record<string, unknown>, title: string): string {
  const id = String(payload.orderId || payload.order_id || "").slice(0, 8);
  if (id) return id.toUpperCase();
  return title.slice(0, 24) || "order";
}

/** Buyer WhatsApp is milestone-only. In-app and push still cover the in-between steps. */
const BUYER_WA_ORDER_STATUSES = new Set([
  "accepted",
  "auto_accepted",
  "confirmed",
  "scheduled",
  "cancelled",
  "rejected",
  "no_show",
  "delivered",
  "completed",
  "refund_requested",
  "refund_approved",
  "refund_completed",
  "refund_failed",
  "refund_rejected",
  "payment_failed",
]);

export function shouldSendWhatsApp(opts: {
  type: string;
  whatsappPref?: boolean | null;
  payload?: Record<string, unknown> | null;
}): boolean {
  if (opts.whatsappPref === false) return false;
  if (opts.payload?.skip_whatsapp === true) return false;
  const role = String(opts.payload?.target_role || "");
  const status = String(opts.payload?.status || opts.payload?.new_status || "").toLowerCase();
  const isOrderType = opts.type === "order" || opts.type === "order_status" || opts.type === "order_update";
  if (role === "buyer" && isOrderType && !BUYER_WA_ORDER_STATUSES.has(status)) return false;
  if (SKIP_TYPES.has(opts.type)) return false;
  if (opts.payload?.wa_template) return true;
  if (WA_ELIGIBLE_TYPES.has(opts.type)) return true;
  if (opts.type.startsWith("booking_") || opts.type.startsWith("delivery_")) return true;
  if (opts.type.startsWith("seller_") || opts.type.startsWith("license_") || opts.type.startsWith("product_")) {
    return true;
  }
  return false;
}

function buildPushParityFallback(title: string, body: string): string {
  const t = title.trim();
  const b = body.trim();
  if (t && b && t !== b) return `${t}\n\n${b}\n\n- Sociva`;
  if (t) return `${t}\n\n- Sociva`;
  return `${b || 'Update from Sociva'}\n\n- Sociva`;
}

function resolveTemplate(opts: {
  type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  userName: string;
}): { templateName: string; bodyParams: string[]; fallbackText: string } {
  const display = resolveQueueDisplayCopy({
    title: opts.title,
    body: opts.body,
    type: opts.type,
    payload: opts.payload,
  });
  const status = String(opts.payload.status || opts.payload.new_status || "").toLowerCase();
  const targetRole = String(opts.payload.target_role || "");
  const name = opts.userName || "there";
  const orderRef = shortOrderRef(opts.payload, display.title);
  const displayTitle = display.title;
  const displayBody = display.body;
  const fallbackText = buildPushParityFallback(displayTitle, displayBody);

  if (opts.payload.wa_template) {
    const tpl = String(opts.payload.wa_template);
    if (tpl === "sociva_booking_confirmed") {
      return {
        templateName: tpl,
        bodyParams: [
          name,
          String(opts.payload.providerName || opts.payload.sellerName || "your provider"),
          orderRef,
          String(opts.payload.serviceDate || opts.payload.date || "-"),
          String(opts.payload.serviceTime || opts.payload.time || "-"),
        ],
        fallbackText,
      };
    }
    if (tpl === "sociva_booking_cancelled") {
      return {
        templateName: tpl,
        bodyParams: [
          name,
          orderRef,
          String(opts.payload.providerName || "your provider"),
          String(opts.payload.reason || opts.body || "Cancelled").slice(0, 200),
        ],
        fallbackText,
      };
    }
    if (tpl === "sociva_booking_reminder") {
      return {
        templateName: tpl,
        bodyParams: [
          name,
          String(opts.payload.providerName || "your provider"),
          String(opts.payload.serviceDate || "-"),
          String(opts.payload.serviceTime || "-"),
          orderRef,
        ],
        fallbackText,
      };
    }
    if (tpl === "sociva_new_order_seller") {
      return {
        templateName: tpl,
        bodyParams: [
          displayTitle.slice(0, 120),
          displayBody.slice(0, 600),
        ],
        fallbackText,
      };
    }
    if (tpl === "sociva_refund_update" || tpl === "sociva_payment_update" || tpl === "sociva_order_update") {
      return {
        templateName: tpl,
        bodyParams: [name, orderRef, (opts.title || status || "Update").slice(0, 120)],
        fallbackText,
      };
    }
  }

  // Seller new order / enquiry
  if (
    targetRole === "seller" &&
    ["placed", "enquired", "requested", "auto_accepted"].includes(status)
  ) {
    return {
      templateName: "sociva_new_order_seller",
      bodyParams: [displayTitle.slice(0, 120), displayBody.slice(0, 600)],
      fallbackText,
    };
  }

  // Booking / order lifecycle for buyers
  if (["accepted", "auto_accepted", "confirmed", "scheduled", "preparing"].includes(status)) {
    return {
      templateName: "sociva_booking_confirmed",
      bodyParams: [
        name,
        String(opts.payload.providerName || opts.payload.sellerName || "your provider"),
        orderRef,
        String(opts.payload.serviceDate || opts.payload.date || "soon"),
        String(opts.payload.serviceTime || opts.payload.time || "-"),
      ],
      fallbackText,
    };
  }

  if (status === "cancelled" || status === "no_show") {
    return {
      templateName: "sociva_booking_cancelled",
      bodyParams: [
        name,
        orderRef,
        String(opts.payload.providerName || "your provider"),
        String(opts.payload.reason || opts.body || status).slice(0, 200),
      ],
      fallbackText,
    };
  }

  if (opts.type.startsWith("booking_reminder")) {
    return {
      templateName: "sociva_booking_reminder",
      bodyParams: [
        name,
        String(opts.payload.providerName || "your provider"),
        String(opts.payload.serviceDate || "today"),
        String(opts.payload.serviceTime || "soon"),
        orderRef,
      ],
      fallbackText,
    };
  }

  if (status.startsWith("refund") || opts.type === "refund_request" || displayTitle.toLowerCase().includes("refund")) {
    return {
      templateName: "sociva_refund_update",
      bodyParams: [name, orderRef, displayBody.slice(0, 600) || displayTitle.slice(0, 120)],
      fallbackText,
    };
  }

  if (
    opts.type.startsWith("seller_store_") ||
    opts.type.startsWith("seller_") ||
    opts.type.startsWith("license_") ||
    opts.type.startsWith("product_")
  ) {
    return {
      templateName: "sociva_order_update",
      bodyParams: [name, orderRef || opts.type, displayBody.slice(0, 600) || displayTitle.slice(0, 120)],
      fallbackText,
    };
  }

  // Default utility order update - mirror push copy
  return {
    templateName: "sociva_order_update",
    bodyParams: [name, orderRef, displayBody.slice(0, 600) || displayTitle.slice(0, 120)],
    fallbackText,
  };
}

export async function deliverWhatsAppForQueueItem(opts: {
  userId: string;
  phone: string | null | undefined;
  userName?: string | null;
  type: string;
  title: string;
  body: string;
  payload?: Record<string, unknown> | null;
  whatsappPref?: boolean | null;
  notificationId?: string;
  /** Stamp at attempt start so admin provider switch cannot silently reroute mid-flight */
  stampedProvider?: WhatsAppProviderId;
  stampedEvolutionMode?: "disabled" | "dry_run" | "live";
  /** Admin WhatsApp-only retry; bypasses success skip once */
  forceWhatsAppRetry?: boolean;
}): Promise<{
  attempted: boolean;
  result?: UnifiedWhatsAppResult;
  skipReason?: string;
  deliveryEvidence?: Record<string, unknown>;
}> {
  if (!shouldSendWhatsApp({
    type: opts.type,
    whatsappPref: opts.whatsappPref,
    payload: opts.payload,
  })) {
    if (opts.notificationId) {
      await completeWhatsAppChannel(opts.notificationId, {
        status: "skipped",
        error: "not_eligible_or_opted_out",
      });
    }
    return { attempted: false, skipReason: "not_eligible_or_opted_out" };
  }

  const phone = toWaPhone(opts.phone);
  if (!phone) {
    if (opts.notificationId) {
      await completeWhatsAppChannel(opts.notificationId, {
        status: "skipped",
        error: "no_phone",
      });
    }
    return { attempted: false, skipReason: "no_phone" };
  }

  const forceFromPayload = opts.payload?.force_whatsapp_retry === true;
  const force = !!(opts.forceWhatsAppRetry || forceFromPayload);

  // F1: DB-backed claim prevents duplicate WA when push retries re-enter PNQ
  if (opts.notificationId) {
    const claim = await claimWhatsAppChannel(opts.notificationId, force);
    if (!claim.ok) {
      if (claim.reason === "already_succeeded" || claim.reason === "already_dry_run") {
        return {
          attempted: false,
          skipReason: `whatsapp_${claim.reason}`,
          deliveryEvidence: {
            whatsapp: {
              skipped: true,
              reason: claim.reason,
              provider: claim.provider || null,
              provider_message_id: claim.messageId || null,
              status: claim.whatsappStatus || null,
              delivery_confirmed: false,
            },
          },
        };
      }
      if (claim.reason === "in_progress") {
        return { attempted: false, skipReason: "whatsapp_in_progress" };
      }
      // claim_error: fail closed (do not send) to avoid duplicates under races
      return { attempted: false, skipReason: claim.reason };
    }
  }

  const mapped = resolveTemplate({
    type: opts.type,
    title: opts.title,
    body: opts.body,
    payload: opts.payload || {},
    userName: opts.userName || "there",
  });

  // Resolve + stamp provider once per attempt (no silent cross-provider fallback)
  const cfg = await loadWhatsAppProviderConfig();
  const stampedFromPayload = opts.payload?.whatsapp_retry_to_provider;
  const stampedProvider =
    opts.stampedProvider ||
    (typeof stampedFromPayload === "string" &&
    (stampedFromPayload === "meta" || stampedFromPayload === "evolution_go")
      ? stampedFromPayload
      : cfg.active_provider);
  const stampedEvolutionMode = opts.stampedEvolutionMode || cfg.evolution_mode;

  const result = await sendViaActiveWhatsAppProvider({
    phoneNumber: phone,
    text: mapped.fallbackText,
    templateName: mapped.templateName,
    bodyParams: mapped.bodyParams,
    fallbackText: mapped.fallbackText,
    stampedProvider,
    stampedEvolutionMode,
    notificationQueueId: opts.notificationId || null,
  });

  if (opts.notificationId) {
    await completeWhatsAppChannel(opts.notificationId, {
      status: mapUnifiedToChannelStatus(result),
      provider: result.provider,
      providerMessageId: result.providerMessageId || result.metaMessageId || null,
      error: result.success ? null : result.error || result.code,
    });
  }

  return {
    attempted: true,
    result,
    deliveryEvidence: whatsappDeliveryEvidence(result),
  };
}
