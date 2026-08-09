/**
 * Maps notification_queue items → WhatsApp Cloud API sends.
 * Called from process-notification-queue as an additional channel (never replaces push/in-app).
 *
 * Until sociva_* templates are APPROVED, free-form fallback only delivers inside Meta's
 * ~24h customer service window (after the user messages the business). In-app opt-in CTA
 * (wa.me Hi) is user-initiated and does not require a "register me" template.
 */
import {
  logWhatsAppMessage,
  normalizeWhatsAppPhone,
  sendWhatsAppTemplateOrText,
  type WhatsAppSendResult,
} from "./whatsapp.ts";

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
  "review",
  "review_received",
  "review_nudge",
  "low_rating_alert",
  "seller_daily_summary",
  "seller_approved",
  "seller_rejected",
  "seller_suspended",
  "license_approved",
  "license_rejected",
  "product_approved",
  "product_rejected",
]);

/** Society/chat noise — never WhatsApp. Marketing is gated separately. */
const SKIP_TYPES = new Set([
  "chat",
  "chat_message",
  "visitor",
  "parcel",
  "dispute",
  "snag",
  "milestone",
  "worker_job",
  "moderation",
]);

const MARKETING_TYPES = new Set(["promotion", "campaign"]);

/** Normalize mixed enqueue payload shapes (orderId vs order_id, status vs new_status). */
export function normalizeWaPayload(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const p = { ...(payload || {}) };
  if (!p.status && p.new_status) p.status = p.new_status;
  if (!p.orderId && p.order_id) p.orderId = p.order_id;
  if (!p.order_id && p.orderId) p.order_id = p.orderId;
  if (!p.sellerName && p.seller_name) p.sellerName = p.seller_name;
  if (!p.providerName && (p.sellerName || p.provider_name)) {
    p.providerName = p.sellerName || p.provider_name;
  }
  return p;
}

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

function statusHeadline(status: string): string {
  const map: Record<string, string> = {
    assigned: "Provider assigned",
    provider_changed: "Provider updated",
    on_the_way: "On the way",
    arrived: "Provider arrived",
    at_gate: "At your gate",
    in_progress: "Service started",
    picked_up: "Order picked up",
    ready: "Order ready",
    delivered: "Delivered",
    completed: "Completed",
    confirmed: "Booking confirmed",
    scheduled: "Booking scheduled",
    rescheduled: "Rescheduled",
    cancelled: "Cancelled",
    no_show: "No-show",
    quoted: "Quote received",
    accepted: "Accepted",
    preparing: "Preparing",
    settlement_eligible: "Settlement eligible",
    settlement_paid: "Settlement paid",
    released: "Payment released",
  };
  return map[status] || status.replace(/_/g, " ") || "Update";
}

export function shouldSendWhatsApp(opts: {
  type: string;
  whatsappPref?: boolean | null;
  whatsappOptedInAt?: string | null;
  promotionsPref?: boolean | null;
  payload?: Record<string, unknown> | null;
}): boolean {
  // Hard Meta opt-in: require explicit whatsapp_opted_in_at (grandfathered in migration).
  if (!opts.whatsappOptedInAt) return false;
  if (opts.whatsappPref === false) return false;
  if (opts.payload?.skip_whatsapp === true) return false;
  if (SKIP_TYPES.has(opts.type)) return false;

  // Marketing: require promotions + whatsapp prefs AND explicit enqueue flag
  if (MARKETING_TYPES.has(opts.type) || opts.payload?.allow_whatsapp_marketing === true) {
    return (
      opts.promotionsPref === true &&
      opts.whatsappPref !== false &&
      !!opts.whatsappOptedInAt &&
      opts.payload?.allow_whatsapp_marketing === true
    );
  }

  if (opts.payload?.wa_template) return true;
  if (WA_ELIGIBLE_TYPES.has(opts.type)) return true;
  if (opts.type.startsWith("booking_") || opts.type.startsWith("delivery_")) return true;
  if (opts.type.startsWith("seller_") || opts.type.startsWith("license_") || opts.type.startsWith("product_")) {
    return true;
  }
  if (opts.type.startsWith("review") || opts.type.startsWith("settlement")) return true;
  return false;
}

function resolveTemplate(opts: {
  type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  userName: string;
}): { templateName: string; bodyParams: string[]; fallbackText: string } {
  const payload = normalizeWaPayload(opts.payload);
  const status = String(payload.status || "").toLowerCase();
  const targetRole = String(payload.target_role || "");
  const name = opts.userName || "there";
  const orderRef = shortOrderRef(payload, opts.title);
  const fallbackText = `${opts.title}\n${opts.body}\n— Sociva`;

  if (payload.wa_template) {
    const tpl = String(payload.wa_template);
    if (tpl === "sociva_booking_confirmed") {
      return {
        templateName: tpl,
        bodyParams: [
          name,
          String(payload.providerName || payload.sellerName || "your provider"),
          orderRef,
          String(payload.serviceDate || payload.date || "—"),
          String(payload.serviceTime || payload.time || "—"),
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
          String(payload.providerName || "your provider"),
          String(payload.reason || opts.body || "Cancelled").slice(0, 200),
        ],
        fallbackText,
      };
    }
    if (tpl === "sociva_booking_reminder") {
      return {
        templateName: tpl,
        bodyParams: [
          name,
          String(payload.providerName || "your provider"),
          String(payload.serviceDate || "—"),
          String(payload.serviceTime || "—"),
          orderRef,
        ],
        fallbackText,
      };
    }
    if (tpl === "sociva_new_order_seller") {
      return {
        templateName: tpl,
        bodyParams: [
          String(payload.status || "order"),
          `${orderRef} — ${opts.body}`.slice(0, 200),
        ],
        fallbackText,
      };
    }
    if (
      tpl === "sociva_refund_update" ||
      tpl === "sociva_payment_update" ||
      tpl === "sociva_order_update" ||
      tpl === "sociva_store_status"
    ) {
      return {
        templateName: tpl,
        bodyParams: [name, orderRef || opts.type, (opts.title || statusHeadline(status) || "Update").slice(0, 120)],
        fallbackText,
      };
    }
  }

  // Marketing (opt-in already gated in shouldSendWhatsApp)
  if (MARKETING_TYPES.has(opts.type) || payload.allow_whatsapp_marketing === true) {
    return {
      templateName: "sociva_order_update",
      bodyParams: [name, "offer", (opts.title || "Sociva offer").slice(0, 120)],
      fallbackText,
    };
  }

  // Seller new order / enquiry
  if (
    targetRole === "seller" &&
    ["placed", "enquired", "requested", "auto_accepted"].includes(status)
  ) {
    return {
      templateName: "sociva_new_order_seller",
      bodyParams: [status || "order", `${orderRef} — ${opts.body}`.slice(0, 200)],
      fallbackText,
    };
  }

  // Booking / order lifecycle for buyers
  if (["accepted", "auto_accepted", "confirmed", "scheduled", "preparing"].includes(status)) {
    return {
      templateName: "sociva_booking_confirmed",
      bodyParams: [
        name,
        String(payload.providerName || payload.sellerName || "your provider"),
        orderRef,
        String(payload.serviceDate || payload.date || "soon"),
        String(payload.serviceTime || payload.time || "—"),
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
        String(payload.providerName || "your provider"),
        String(payload.reason || opts.body || status).slice(0, 200),
      ],
      fallbackText,
    };
  }

  if (opts.type.startsWith("booking_reminder")) {
    return {
      templateName: "sociva_booking_reminder",
      bodyParams: [
        name,
        String(payload.providerName || "your provider"),
        String(payload.serviceDate || "today"),
        String(payload.serviceTime || "soon"),
        orderRef,
      ],
      fallbackText,
    };
  }

  // Provider / fulfillment lifecycle → utility order update
  if (
    [
      "assigned",
      "provider_changed",
      "on_the_way",
      "arrived",
      "at_gate",
      "in_progress",
      "picked_up",
      "ready",
      "delivered",
      "completed",
      "rescheduled",
      "quoted",
    ].includes(status)
  ) {
    return {
      templateName: "sociva_order_update",
      bodyParams: [name, orderRef, statusHeadline(status).slice(0, 120)],
      fallbackText,
    };
  }

  if (
    status.startsWith("refund") ||
    opts.title.toLowerCase().includes("refund") ||
    opts.type.includes("refund")
  ) {
    return {
      templateName: "sociva_refund_update",
      bodyParams: [name, orderRef, (opts.title || "Refund update").slice(0, 120)],
      fallbackText,
    };
  }

  // Settlements / earnings digest
  if (
    opts.type === "settlement" ||
    opts.type === "seller_daily_summary" ||
    status.startsWith("settlement") ||
    status === "released" ||
    status === "eligible" ||
    status === "settled"
  ) {
    return {
      templateName: "sociva_payment_update",
      bodyParams: [name, orderRef || "payout", (opts.title || statusHeadline(status) || "Earnings update").slice(0, 120)],
      fallbackText,
    };
  }

  // Reviews
  if (
    opts.type === "review_nudge" ||
    opts.type === "review" ||
    opts.type === "review_received" ||
    opts.type === "low_rating_alert"
  ) {
    return {
      templateName: "sociva_order_update",
      bodyParams: [name, orderRef || "review", (opts.title || "Review update").slice(0, 120)],
      fallbackText,
    };
  }

  if (
    opts.type.startsWith("seller_") ||
    opts.type.startsWith("license_") ||
    opts.type.startsWith("product_")
  ) {
    return {
      templateName: "sociva_store_status",
      bodyParams: [name, orderRef || opts.type, (opts.title || "Account update").slice(0, 120)],
      fallbackText,
    };
  }

  // Default utility order update
  return {
    templateName: "sociva_order_update",
    bodyParams: [name, orderRef, (opts.title || statusHeadline(status) || "Update").slice(0, 120)],
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
  whatsappOptedInAt?: string | null;
  promotionsPref?: boolean | null;
  notificationId?: string;
}): Promise<{ attempted: boolean; result?: WhatsAppSendResult & { usedTemplate?: boolean }; skipReason?: string }> {
  const payload = normalizeWaPayload(opts.payload);

  if (!shouldSendWhatsApp({
    type: opts.type,
    whatsappPref: opts.whatsappPref,
    whatsappOptedInAt: opts.whatsappOptedInAt,
    promotionsPref: opts.promotionsPref,
    payload,
  })) {
    return { attempted: false, skipReason: "not_eligible_or_opted_out" };
  }

  const phone = toWaPhone(opts.phone);
  if (!phone) {
    return { attempted: false, skipReason: "no_phone" };
  }

  const mapped = resolveTemplate({
    type: opts.type,
    title: opts.title,
    body: opts.body,
    payload,
    userName: opts.userName || "there",
  });

  const result = await sendWhatsAppTemplateOrText({
    phoneNumber: phone,
    templateName: mapped.templateName,
    bodyParams: mapped.bodyParams,
    fallbackText: mapped.fallbackText,
  });

  await logWhatsAppMessage({
    direction: "outbound",
    phone,
    message: mapped.fallbackText.slice(0, 500),
    meta_message_id: result.metaMessageId || null,
    status: result.success ? "sent" : "failed",
    error_code: result.success ? null : result.code,
    error_message: result.error || null,
    template_name: result.usedTemplate ? mapped.templateName : null,
    meta_payload: {
      ...(typeof result.meta === "object" && result.meta ? result.meta : {}),
      queue_notification_id: opts.notificationId || null,
      used_template: !!result.usedTemplate,
      user_id: opts.userId,
      mapped_template: mapped.templateName,
    },
  });

  return { attempted: true, result };
}
