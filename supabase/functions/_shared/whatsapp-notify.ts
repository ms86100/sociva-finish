/**
 * Maps notification_queue items → WhatsApp Cloud API sends.
 * Called from process-notification-queue as an additional channel (never replaces push/in-app).
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
  "review_received",
  "seller_approved",
  "seller_rejected",
  "seller_suspended",
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

export function shouldSendWhatsApp(opts: {
  type: string;
  whatsappPref?: boolean | null;
  payload?: Record<string, unknown> | null;
}): boolean {
  if (opts.whatsappPref === false) return false;
  if (opts.payload?.skip_whatsapp === true) return false;
  if (SKIP_TYPES.has(opts.type)) return false;
  if (opts.payload?.wa_template) return true;
  if (WA_ELIGIBLE_TYPES.has(opts.type)) return true;
  if (opts.type.startsWith("booking_") || opts.type.startsWith("delivery_")) return true;
  if (opts.type.startsWith("seller_") || opts.type.startsWith("license_") || opts.type.startsWith("product_")) {
    return true;
  }
  return false;
}

function resolveTemplate(opts: {
  type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  userName: string;
}): { templateName: string; bodyParams: string[]; fallbackText: string } {
  const status = String(opts.payload.status || opts.payload.new_status || "").toLowerCase();
  const targetRole = String(opts.payload.target_role || "");
  const name = opts.userName || "there";
  const orderRef = shortOrderRef(opts.payload, opts.title);
  const displayTitle = (opts.title || "").trim()
    || (status === "accepted" ? "Order Accepted" : status === "placed" ? "New Order" : "Order Update");
  const displayBody = (opts.body || "").trim()
    || String(opts.payload.item_summary || opts.payload.sellerName || opts.payload.providerName || displayTitle);
  const fallbackText = `${displayTitle}\n${displayBody}\n— Sociva`;

  if (opts.payload.wa_template) {
    const tpl = String(opts.payload.wa_template);
    if (tpl === "sociva_booking_confirmed") {
      return {
        templateName: tpl,
        bodyParams: [
          name,
          String(opts.payload.providerName || opts.payload.sellerName || "your provider"),
          orderRef,
          String(opts.payload.serviceDate || opts.payload.date || "—"),
          String(opts.payload.serviceTime || opts.payload.time || "—"),
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
          String(opts.payload.serviceDate || "—"),
          String(opts.payload.serviceTime || "—"),
          orderRef,
        ],
        fallbackText,
      };
    }
    if (tpl === "sociva_new_order_seller") {
      return {
        templateName: tpl,
        bodyParams: [
          String(opts.payload.status || "order"),
          `${orderRef} — ${opts.body}`.slice(0, 200),
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
        String(opts.payload.providerName || opts.payload.sellerName || "your provider"),
        orderRef,
        String(opts.payload.serviceDate || opts.payload.date || "soon"),
        String(opts.payload.serviceTime || opts.payload.time || "—"),
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

  if (status.startsWith("refund") || opts.title.toLowerCase().includes("refund")) {
    return {
      templateName: "sociva_refund_update",
      bodyParams: [name, orderRef, (opts.title || "Refund update").slice(0, 120)],
      fallbackText,
    };
  }

  if (
    opts.type.startsWith("seller_") ||
    opts.type.startsWith("license_") ||
    opts.type.startsWith("product_")
  ) {
    return {
      templateName: "sociva_order_update",
      bodyParams: [name, orderRef || opts.type, (opts.title || "Account update").slice(0, 120)],
      fallbackText,
    };
  }

  // Default utility order update
  return {
    templateName: "sociva_order_update",
    bodyParams: [name, orderRef, (opts.title || status || "Update").slice(0, 120)],
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
}): Promise<{ attempted: boolean; result?: WhatsAppSendResult & { usedTemplate?: boolean }; skipReason?: string }> {
  if (!shouldSendWhatsApp({
    type: opts.type,
    whatsappPref: opts.whatsappPref,
    payload: opts.payload,
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
    payload: opts.payload || {},
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
    },
  });

  return { attempted: true, result };
}
