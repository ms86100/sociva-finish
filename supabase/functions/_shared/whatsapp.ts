/**
 * Shared WhatsApp Cloud API client for Sociva Edge Functions.
 * Credentials: Deno.env first, then Vault/admin_settings via get_edge_credential.
 */
import { createAdminClient, getCredential } from "./credentials.ts";

export const WHATSAPP_GRAPH_VERSION = "v23.0";

export type WhatsAppSendResult = {
  success: boolean;
  code:
    | "ok"
    | "missing_credentials"
    | "invalid_phone"
    | "unauthorized"
    | "token_expired"
    | "rate_limited"
    | "meta_error"
    | "unexpected";
  httpStatus?: number;
  metaMessageId?: string;
  meta?: unknown;
  error?: string;
  elapsedMs: number;
};

export function normalizeWhatsAppPhone(raw: string): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

export async function loadWhatsAppCredentials() {
  const admin = createAdminClient();
  const [accessToken, phoneNumberId, verifyToken, businessAccountId] = await Promise.all([
    getCredential(admin, "whatsapp_access_token", "WHATSAPP_ACCESS_TOKEN"),
    getCredential(admin, "whatsapp_phone_number_id", "WHATSAPP_PHONE_NUMBER_ID"),
    getCredential(admin, "whatsapp_verify_token", "WHATSAPP_VERIFY_TOKEN"),
    getCredential(admin, "whatsapp_business_account_id", "WHATSAPP_BUSINESS_ACCOUNT_ID"),
  ]);
  return {
    admin,
    accessToken: accessToken || "",
    phoneNumberId: phoneNumberId || "",
    verifyToken: verifyToken || "",
    businessAccountId: businessAccountId || "",
  };
}

function classifyMetaError(httpStatus: number, body: any): WhatsAppSendResult["code"] {
  const errMsg = String(body?.error?.message || body?.error?.error_user_msg || "").toLowerCase();
  const errCode = body?.error?.code;
  if (httpStatus === 401 || errCode === 190) return "token_expired";
  if (httpStatus === 403) return "unauthorized";
  if (httpStatus === 429 || errCode === 4 || errCode === 80007) return "rate_limited";
  if (/phone|recipient|invalid.*user|131026|131030/i.test(errMsg) || errCode === 100) {
    return "invalid_phone";
  }
  if (httpStatus >= 400) return "meta_error";
  return "unexpected";
}

async function postWhatsAppMessage(payload: Record<string, unknown>): Promise<WhatsAppSendResult> {
  const started = Date.now();
  const { accessToken, phoneNumberId } = await loadWhatsAppCredentials();
  if (!accessToken || !phoneNumberId) {
    return {
      success: false,
      code: "missing_credentials",
      error: "WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured",
      elapsedMs: Date.now() - started,
    };
  }

  const url = `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${phoneNumberId}/messages`;
  console.log("[whatsapp] outbound", JSON.stringify(payload).slice(0, 500));

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const meta = await res.json().catch(() => ({}));
    const elapsedMs = Date.now() - started;
    console.log("[whatsapp] http", res.status, "elapsedMs", elapsedMs, "meta", JSON.stringify(meta).slice(0, 500));

    if (!res.ok) {
      const code = classifyMetaError(res.status, meta);
      return {
        success: false,
        code,
        httpStatus: res.status,
        meta,
        error: meta?.error?.message || `Meta HTTP ${res.status}`,
        elapsedMs,
      };
    }

    return {
      success: true,
      code: "ok",
      httpStatus: res.status,
      metaMessageId: meta?.messages?.[0]?.id as string | undefined,
      meta,
      elapsedMs,
    };
  } catch (e) {
    console.error("[whatsapp] unexpected", e);
    return {
      success: false,
      code: "unexpected",
      error: String(e),
      elapsedMs: Date.now() - started,
    };
  }
}

export async function sendWhatsAppText(opts: {
  phoneNumber: string;
  message: string;
  previewUrl?: boolean;
}): Promise<WhatsAppSendResult> {
  const started = Date.now();
  const phone = normalizeWhatsAppPhone(opts.phoneNumber);
  if (!phone) {
    return {
      success: false,
      code: "invalid_phone",
      error: "Phone must be E.164 digits without +, e.g. 9198XXXXXXXX",
      elapsedMs: Date.now() - started,
    };
  }

  return postWhatsAppMessage({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phone,
    type: "text",
    text: {
      preview_url: !!opts.previewUrl,
      body: opts.message,
    },
  });
}

export type WhatsAppTemplateComponent = {
  type: "header" | "body" | "button";
  parameters?: Array<{ type: "text" | "currency" | "date_time" | "image" | "document" | "video"; text?: string }>;
  sub_type?: string;
  index?: string;
};

/** Send an approved Meta message template (required outside the 24h customer service window). */
export async function sendWhatsAppTemplate(opts: {
  phoneNumber: string;
  templateName: string;
  languageCode?: string;
  components?: WhatsAppTemplateComponent[];
}): Promise<WhatsAppSendResult> {
  const started = Date.now();
  const phone = normalizeWhatsAppPhone(opts.phoneNumber);
  if (!phone) {
    return {
      success: false,
      code: "invalid_phone",
      error: "Phone must be E.164 digits without +, e.g. 9198XXXXXXXX",
      elapsedMs: Date.now() - started,
    };
  }
  if (!opts.templateName?.trim()) {
    return {
      success: false,
      code: "meta_error",
      error: "templateName is required",
      elapsedMs: Date.now() - started,
    };
  }

  const template: Record<string, unknown> = {
    name: opts.templateName.trim(),
    language: { code: opts.languageCode || "en" },
  };
  if (opts.components?.length) {
    template.components = opts.components;
  }

  return postWhatsAppMessage({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phone,
    type: "template",
    template,
  });
}

/** Prefer Meta template; fall back to free-form text when template is unavailable/unapproved. */
export async function sendWhatsAppTemplateOrText(opts: {
  phoneNumber: string;
  templateName: string;
  languageCode?: string;
  bodyParams?: string[];
  fallbackText: string;
}): Promise<WhatsAppSendResult & { usedTemplate: boolean }> {
  const components: WhatsAppTemplateComponent[] | undefined = opts.bodyParams?.length
    ? [{
      type: "body",
      parameters: opts.bodyParams.map((text) => ({ type: "text" as const, text: String(text || "—").slice(0, 600) })),
    }]
    : undefined;

  const tpl = await sendWhatsAppTemplate({
    phoneNumber: opts.phoneNumber,
    templateName: opts.templateName,
    languageCode: opts.languageCode,
    components,
  });
  if (tpl.success) return { ...tpl, usedTemplate: true };

  // Pending/rejected template or outside eligibility → try session free-form (works inside 24h CSW)
  const text = await sendWhatsAppText({
    phoneNumber: opts.phoneNumber,
    message: opts.fallbackText,
  });
  return { ...text, usedTemplate: false };
}

export async function logWhatsAppMessage(row: {
  direction: "outbound" | "inbound";
  phone: string;
  message?: string | null;
  meta_message_id?: string | null;
  status: string;
  error_code?: string | null;
  error_message?: string | null;
  template_name?: string | null;
  meta_payload?: unknown;
  created_by?: string | null;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("whatsapp_messages").insert({
    direction: row.direction,
    phone: row.phone,
    message: row.message ?? null,
    meta_message_id: row.meta_message_id ?? null,
    status: row.status,
    error_code: row.error_code ?? null,
    error_message: row.error_message ?? null,
    template_name: row.template_name ?? null,
    meta_payload: row.meta_payload ?? null,
    created_by: row.created_by ?? null,
  });
  if (error) console.error("[whatsapp] log insert failed", error);
}

/** High-level templates — prefer approved Meta templates, fall back to free-form. */
export async function sendOTP(phoneNumber: string, otp: string) {
  const message = `Your Sociva verification code is ${otp}. Do not share this code.`;
  // Auth templates require Meta authentication category; until approved, session text only.
  return sendWhatsAppText({ phoneNumber, message });
}

export async function sendBookingConfirmation(opts: {
  phoneNumber: string;
  customerName: string;
  bookingId: string;
  providerName: string;
  serviceDate: string;
  serviceTime: string;
}) {
  const fallback =
    `Hi ${opts.customerName}, your booking with ${opts.providerName} is confirmed.\n` +
    `Booking: ${opts.bookingId}\n` +
    `When: ${opts.serviceDate} at ${opts.serviceTime}\n` +
    `— Sociva`;
  return sendWhatsAppTemplateOrText({
    phoneNumber: opts.phoneNumber,
    templateName: "sociva_booking_confirmed",
    bodyParams: [
      opts.customerName || "there",
      opts.providerName || "your provider",
      opts.bookingId || "—",
      opts.serviceDate || "—",
      opts.serviceTime || "—",
    ],
    fallbackText: fallback,
  });
}

export async function sendBookingCancelled(opts: {
  phoneNumber: string;
  customerName: string;
  bookingId: string;
  providerName: string;
  reason?: string;
}) {
  const reason = opts.reason || "No additional details.";
  const fallback =
    `Hi ${opts.customerName}, your booking ${opts.bookingId} with ${opts.providerName} was cancelled.` +
    `\nReason: ${reason}\n— Sociva`;
  return sendWhatsAppTemplateOrText({
    phoneNumber: opts.phoneNumber,
    templateName: "sociva_booking_cancelled",
    bodyParams: [
      opts.customerName || "there",
      opts.bookingId || "—",
      opts.providerName || "your provider",
      reason,
    ],
    fallbackText: fallback,
  });
}

export async function sendBookingReminder(opts: {
  phoneNumber: string;
  customerName: string;
  bookingId: string;
  providerName: string;
  serviceDate: string;
  serviceTime: string;
}) {
  const fallback =
    `Reminder: Hi ${opts.customerName}, you have a booking with ${opts.providerName} on ` +
    `${opts.serviceDate} at ${opts.serviceTime} (ref ${opts.bookingId}).\n— Sociva`;
  return sendWhatsAppTemplateOrText({
    phoneNumber: opts.phoneNumber,
    templateName: "sociva_booking_reminder",
    bodyParams: [
      opts.customerName || "there",
      opts.providerName || "your provider",
      opts.serviceDate || "—",
      opts.serviceTime || "—",
      opts.bookingId || "—",
    ],
    fallbackText: fallback,
  });
}
