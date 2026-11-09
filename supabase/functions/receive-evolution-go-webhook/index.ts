/**
 * Evolution Go inbound webhook.
 * F6: Auth via secure header only (never query-string secrets).
 * F7: Reject unregistered / untrusted instances.
 * Lead replies never change an order.
 * A seller button, or a 4-digit delivery code from that seller's own chat, can.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient } from "../_shared/credentials.ts";
import {
  evolutionGoSendButtons,
  evolutionGoSendText,
  loadEvolutionGoEnv,
} from "../_shared/evolution-go.ts";
import {
  extractLeadButtonTap,
  isGroupOrBroadcastChat,
  isPersonalWhatsAppDestination,
  resolveLeadButtonReply,
} from "../_shared/whatsapp-lead-flow.ts";
import {
  buildSellerWhatsAppCard,
  isDeliveryCodeMessage,
  parseSellerWhatsAppAction,
  type SellerCardContext,
} from "../_shared/whatsapp-seller-decision.ts";

async function logWa(row: {
  direction: "outbound" | "inbound";
  phone: string;
  message?: string | null;
  provider_message_id?: string | null;
  status: string;
  meta_payload?: unknown;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("whatsapp_messages").insert({
    direction: row.direction,
    phone: row.phone,
    message: row.message ?? null,
    provider: "evolution_go",
    provider_message_id: row.provider_message_id ?? null,
    status: row.status,
    meta_payload: row.meta_payload ?? null,
    delivery_status_supported: true,
  });
  if (error && String(error.code) !== "23505") {
    console.error("[receive-evolution-go-webhook] wa log", error);
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sociva-webhook-secret, instanceid",
};

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;
const REPLAY_MAX_AGE_MS = 15 * 60_000;
const hits = new Map<string, { count: number; windowStart: number }>();

function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function rateLimit(key: string): boolean {
  const now = Date.now();
  const row = hits.get(key);
  if (!row || now - row.windowStart > RATE_WINDOW_MS) {
    hits.set(key, { count: 1, windowStart: now });
    return true;
  }
  row.count += 1;
  return row.count <= RATE_MAX;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function redactedUrl(url: URL): string {
  // Never log secrets even if a client mistakenly adds query params
  return `${url.origin}${url.pathname}`;
}

function extractHeaderSecret(req: Request): string {
  const direct = req.headers.get("x-sociva-webhook-secret") || "";
  if (direct) return direct;
  const apikey = req.headers.get("apikey") || req.headers.get("x-api-key") || "";
  if (apikey) return apikey;
  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}

function eventTypeOf(payload: any): string {
  return String(
    payload?.event ||
      payload?.type ||
      payload?.Event ||
      payload?.data?.event ||
      payload?.messageType ||
      "unknown",
  );
}

function dedupeKeyOf(payload: any, instanceId: string | null): string {
  const candidates = [
    payload?.id,
    payload?.eventId,
    payload?.data?.Info?.ID,
    payload?.data?.key?.id,
    payload?.key?.id,
    payload?.message?.key?.id,
    payload?.hash,
  ];
  for (const c of candidates) {
    if (c != null && String(c).length > 0) {
      return `${instanceId || "na"}:${eventTypeOf(payload)}:${String(c)}`;
    }
  }
  const raw = JSON.stringify(payload).slice(0, 500);
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
  return `${instanceId || "na"}:${eventTypeOf(payload)}:${h}:${Math.floor(Date.now() / 5000)}`;
}

function extractSenderPhone(payload: any): string {
  const raw =
    payload?.data?.Info?.Chat ||
    payload?.data?.from ||
    payload?.from ||
    payload?.sender ||
    payload?.data?.key?.remoteJid ||
    "";
  return String(raw).replace(/@.*/, "").replace(/\D/g, "");
}

function extractText(payload: any): string | null {
  return (
    payload?.data?.Message?.conversation ||
    payload?.data?.Message?.extendedTextMessage?.text ||
    payload?.message?.conversation ||
    payload?.text ||
    payload?.body ||
    null
  );
}

function isConnectionEvent(type: string): boolean {
  return /connect|pair|qrcode|offline|logout|disconnect/i.test(type);
}

function isReceiptEvent(type: string): boolean {
  return /receipt|read|deliver|ack|send_message|sendmessage/i.test(type);
}

async function updateReadiness(
  admin: ReturnType<typeof createAdminClient>,
  args: Record<string, unknown>,
) {
  try {
    const { error } = await admin.rpc(
      "admin_update_whatsapp_evolution_readiness",
      args,
    );
    if (error) console.warn("[webhook] readiness", error.message || error);
  } catch (e) {
    console.warn("[webhook] readiness", e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const url = new URL(req.url);
  // F6: reject query-string secrets explicitly (do not accept, do not log values)
  if (url.searchParams.has("secret") || url.searchParams.has("token")) {
    console.warn("[receive-evolution-go-webhook] rejected query secret auth", redactedUrl(url));
    return new Response(JSON.stringify({
      success: false,
      error: "query_secret_rejected",
      message: "Use x-sociva-webhook-secret header (or apikey). Query secrets are not accepted.",
    }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { webhookSecret } = loadEvolutionGoEnv();
  if (!webhookSecret) {
    console.error("[receive-evolution-go-webhook] EVOLUTION_GO_WEBHOOK_SECRET missing");
    return new Response(JSON.stringify({ success: false, error: "misconfigured" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const provided = extractHeaderSecret(req);
  if (!provided || !timingSafeEqual(provided, webhookSecret)) {
    console.warn("[receive-evolution-go-webhook] invalid or missing header secret", {
      path: redactedUrl(url),
      hasHeader: !!provided,
    });
    return new Response(JSON.stringify({ success: false, error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ip = clientIp(req);
  if (!rateLimit(ip)) {
    return new Response(JSON.stringify({ success: false, error: "rate_limited" }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createAdminClient();

  try {
    const payload = await req.json();
    const eventType = eventTypeOf(payload);
    const headerInstance =
      req.headers.get("instanceid") ||
      req.headers.get("instanceId") ||
      payload?.instanceId ||
      payload?.instance?.id ||
      payload?.data?.instanceId ||
      payload?.instance?.name ||
      payload?.instanceName ||
      null;

    // F7: require an admin-trusted registered instance. Never auto-trust first contact.
    const { data: instances } = await admin
      .from("communication_instances")
      .select("id, provider_instance_id, instance_name, webhook_trusted, connection_status")
      .eq("channel", "whatsapp_evolution_go")
      .eq("webhook_trusted", true);

    const trusted = instances || [];
    if (trusted.length === 0) {
      console.warn("[receive-evolution-go-webhook] no trusted instances registered");
      return new Response(JSON.stringify({ success: false, error: "no_trusted_instance" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!headerInstance) {
      return new Response(JSON.stringify({ success: false, error: "instance_required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const matched = trusted.find((i) =>
      String(i.provider_instance_id || "") === String(headerInstance) ||
      String(i.instance_name || "") === String(headerInstance)
    );
    if (!matched) {
      console.warn("[receive-evolution-go-webhook] unregistered instance", String(headerInstance));
      return new Response(JSON.stringify({ success: false, error: "unknown_instance" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tsRaw =
      payload?.timestamp ||
      payload?.data?.Info?.Timestamp ||
      payload?.data?.timestamp ||
      null;
    if (tsRaw) {
      const ts = Date.parse(String(tsRaw));
      if (!Number.isNaN(ts) && Date.now() - ts > REPLAY_MAX_AGE_MS) {
        return new Response(JSON.stringify({ success: false, error: "replay_rejected" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const dedupeKey = dedupeKeyOf(payload, String(headerInstance));
    const { error: insertErr } = await admin.from("communication_webhook_events").insert({
      provider: "evolution_go",
      event_dedupe_key: dedupeKey,
      instance_id: String(headerInstance),
      event_type: eventType,
      payload: {
        event: eventType,
        instance: String(headerInstance),
        truncated: JSON.stringify(payload).slice(0, 4000),
      },
      processed: false,
    });

    if (insertErr) {
      if (String(insertErr.code) === "23505" || /duplicate|unique/i.test(insertErr.message || "")) {
        // First attempt may have crashed after insert. Retry must still process
        // unprocessed rows so lead button auto-replies are not skipped forever.
        const { data: existing } = await admin
          .from("communication_webhook_events")
          .select("processed")
          .eq("provider", "evolution_go")
          .eq("event_dedupe_key", dedupeKey)
          .maybeSingle();
        if (existing?.processed) {
          return new Response(JSON.stringify({ success: true, duplicate: true }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        console.error("[receive-evolution-go-webhook] insert", insertErr);
        return new Response(JSON.stringify({ success: false, error: "persist_failed" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Handle inbound / button taps BEFORE readiness RPCs so a readiness failure
    // cannot block auto-replies.
    if (isReceiptEvent(eventType)) {
      const msgId =
        payload?.data?.Info?.ID ||
        payload?.id ||
        payload?.messageId ||
        null;
      const status = /read/i.test(eventType)
        ? "read"
        : /deliver/i.test(eventType)
        ? "delivered"
        : "sent";
      if (msgId) {
        await admin
          .from("whatsapp_messages")
          .update({ status })
          .eq("provider", "evolution_go")
          .eq("provider_message_id", String(msgId));
      }
    } else if (
      /button.?click|buttons.?response|interactive/i.test(eventType) ||
      (/message/i.test(eventType) && !/send/i.test(eventType))
    ) {
      const phone = extractSenderPhone(payload) || "unknown";
      const text = extractText(payload);
      const groupChat = isGroupOrBroadcastChat(payload);
      const tap = extractLeadButtonTap(payload);
      const sellerAction = groupChat || tap.isFromMe
        ? null
        : parseSellerWhatsAppAction(tap.buttonId);
      const otpText = !groupChat && !tap.isFromMe && !sellerAction && isDeliveryCodeMessage(text)
        ? String(text).trim()
        : null;
      const replyTo = tap.chatJid && isPersonalWhatsAppDestination(tap.chatJid)
        ? tap.chatJid
        : isPersonalWhatsAppDestination(phone)
        ? phone
        : null;

      if (sellerAction && replyTo) {
        const destPhone = replyTo.replace(/@.*/, "").replace(/\D/g, "");
        const { data: alreadyDecided } = await admin
          .from("whatsapp_messages")
          .select("id")
          .eq("provider", "evolution_go")
          .eq("direction", "outbound")
          .filter("meta_payload->>event", "eq", "seller_order_decision")
          .filter("meta_payload->>button_id", "eq", sellerAction.buttonId)
          .gte("created_at", new Date(Date.now() - 2 * 60 * 1000).toISOString())
          .limit(1)
          .maybeSingle();

        let replyText = "";
        let decided = false;
        if (!alreadyDecided?.id) {
          const rpc = sellerAction.kind === "step"
            ? await admin.rpc("seller_whatsapp_apply_step", {
              p_order_id: sellerAction.orderId,
              p_to_status: sellerAction.status,
              p_phone: destPhone,
            })
            : await admin.rpc("seller_whatsapp_decide_order", {
              p_order_id: sellerAction.orderId,
              p_decision: sellerAction.kind,
              p_phone: destPhone,
            });
          const errText = String(rpc.error?.message || "");
          if (!rpc.error && rpc.data) {
            decided = true;
            const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
            const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
            if (serviceKey && supabaseUrl) {
              fetch(`${supabaseUrl}/functions/v1/process-notification-queue`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${serviceKey}`,
                  "Content-Type": "application/json",
                },
                body: "{}",
              }).catch(() => {});
            }
            if (sellerAction.kind === "reject") {
              replyText = "Rejected. The buyer can see this now.";
            }
          } else if (/no longer waiting|Send the delivery code/i.test(errText)) {
            replyText = "This order is already updated. The buyer can see the current status.";
          } else if (/Not authorized/i.test(errText)) {
            replyText = "This chat cannot update that order.";
          } else {
            replyText = "Could not update this order. Open Sociva and respond there.";
          }
        } else {
          replyText = "This order is already updated. The buyer can see the current status.";
        }

        const instanceId = String(matched.provider_instance_id || headerInstance || "") || undefined;
        if (decided && sellerAction.kind !== "reject") {
          const { data: ctxRaw } = await admin.rpc("seller_whatsapp_order_context", {
            p_order_id: sellerAction.orderId,
          });
          const ctx = (typeof ctxRaw === "string" ? JSON.parse(ctxRaw) : ctxRaw) as SellerCardContext | null;
          if (ctx?.order_id && !ctx.terminal) {
            const card = buildSellerWhatsAppCard(ctx);
            const send = card.buttons.length
              ? await evolutionGoSendButtons({
                number: replyTo,
                title: card.title,
                description: card.description,
                footer: "Sociva",
                buttons: card.buttons,
                instanceId,
                formatJid: !/@/.test(replyTo),
              })
              : await evolutionGoSendText({
                number: replyTo,
                text: card.text,
                instanceId,
                formatJid: !/@/.test(replyTo),
              });
            await logWa({
              direction: "outbound",
              phone: destPhone,
              message: card.text.slice(0, 500),
              provider_message_id: send.providerMessageId || null,
              status: send.success ? "sent" : "failed",
              meta_payload: {
                event: "seller_order_card",
                order_id: sellerAction.orderId,
                status: ctx.status || null,
                button_id: sellerAction.buttonId,
                informational_only: false,
              },
            });
          } else {
            replyText = "Updated. The buyer can see this now.";
          }
        }

        if (decided || replyText) {
          await logWa({
            direction: "outbound",
            phone: destPhone,
            message: replyText || "Updated",
            provider_message_id: null,
            status: "sent",
            meta_payload: {
              event: "seller_order_decision",
              order_id: sellerAction.orderId,
              button_id: sellerAction.buttonId,
              decision: sellerAction.kind === "step" ? sellerAction.status : sellerAction.kind,
              applied: decided,
              informational_only: false,
            },
          });
        }
        if (replyText) {
          await evolutionGoSendText({
            number: replyTo,
            text: replyText,
            instanceId,
            formatJid: !/@/.test(replyTo),
          });
        }
      } else if (otpText && replyTo) {
        const destPhone = replyTo.replace(/@.*/, "").replace(/\D/g, "");
        const { data: otpRows, error: otpErr } = await admin.rpc(
          "seller_whatsapp_apply_otp",
          { p_phone: destPhone, p_code: otpText },
        );
        const otp = Array.isArray(otpRows) ? otpRows[0] : otpRows;
        const outcome = String(otp?.result || (otpErr ? "failed" : "none"));
        if (outcome !== "none") {
          const replyText = outcome === "delivered" || outcome === "done"
            ? "Delivered. The buyer can see it."
            : outcome === "invalid"
            ? "That code did not match. Use the 4-digit code on the buyer's order."
            : outcome === "locked"
            ? "Too many tries. Wait 15 minutes, or open Sociva."
            : outcome === "multiple"
            ? "More than one delivery is waiting for a code. Open Sociva and enter it on the right order."
            : "Could not mark this delivered. Open Sociva and enter the code there.";
          const send = await evolutionGoSendText({
            number: replyTo,
            text: replyText,
            instanceId: String(matched.provider_instance_id || headerInstance || "") || undefined,
            formatJid: !/@/.test(replyTo),
          });
          await logWa({
            direction: "outbound",
            phone: destPhone,
            message: replyText,
            provider_message_id: send.providerMessageId || null,
            status: send.success ? "sent" : "failed",
            meta_payload: {
              event: "seller_delivery_otp",
              order_id: otp?.order_id || null,
              result: outcome,
              informational_only: false,
            },
          });
          if (outcome === "delivered") {
            const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
            const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
            if (serviceKey && supabaseUrl) {
              fetch(`${supabaseUrl}/functions/v1/process-notification-queue`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${serviceKey}`,
                  "Content-Type": "application/json",
                },
                body: "{}",
              }).catch(() => {});
            }
          }
        }
      }

      const lead = sellerAction || otpText || groupChat
        ? null
        : resolveLeadButtonReply({ buttonId: tap.buttonId });

      await logWa({
        direction: "inbound",
        phone,
        message: otpText
          ? "[delivery code]"
          : lead
          ? `[button:${lead.buttonId}] ${(tap.displayText || text || "").slice(0, 200)}`
          : text
          ? String(text).slice(0, 500)
          : null,
        provider_message_id: payload?.data?.Info?.ID
          ? String(payload.data.Info.ID)
          : null,
        status: "received",
        meta_payload: {
          event: eventType,
          informational_only: !sellerAction && !otpText,
          button_id: lead?.buttonId || tap.buttonId || null,
        },
      });

      // Auto-reply only to a personal button tap. Never a group, broadcast, or guessed number.
      if (lead && !tap.isFromMe && !groupChat) {
        const replyTo =
          tap.chatJid && isPersonalWhatsAppDestination(tap.chatJid)
            ? tap.chatJid
            : isPersonalWhatsAppDestination(phone)
            ? phone
            : null;
        if (replyTo) {
          const destPhone = replyTo.replace(/@.*/, "").replace(/\D/g, "") ||
            (phone !== "unknown" ? phone : "");
          // ButtonClick + Message both fire for one tap - send once per button/phone.
          const { data: alreadyReplied } = destPhone
            ? await admin
              .from("whatsapp_messages")
              .select("id")
              .eq("provider", "evolution_go")
              .eq("direction", "outbound")
              .eq("phone", destPhone)
              .filter("meta_payload->>event", "eq", "lead_button_auto_reply")
              .filter("meta_payload->>button_id", "eq", lead.buttonId)
              .gte(
                "created_at",
                new Date(Date.now() - 10 * 60 * 1000).toISOString(),
              )
              .limit(1)
              .maybeSingle()
            : { data: null };

          if (alreadyReplied?.id) {
            console.log("[receive-evolution-go-webhook] lead reply already sent", {
              buttonId: lead.buttonId,
              destPhone,
            });
          } else {
            const send = await evolutionGoSendText({
              number: replyTo,
              text: lead.replyText,
              instanceId: String(
                matched.provider_instance_id || headerInstance || "",
              ) || undefined,
              formatJid: !/@/.test(replyTo),
            });
            await logWa({
              direction: "outbound",
              phone: destPhone || replyTo.replace(/@.*/, ""),
              message: lead.replyText.slice(0, 500),
              provider_message_id: send.providerMessageId || null,
              status: send.success ? "sent" : "failed",
              meta_payload: {
                event: "lead_button_auto_reply",
                button_id: lead.buttonId,
                informational_only: true,
                error: send.success ? null : send.error,
              },
            });
            if (!send.success) {
              console.warn("[receive-evolution-go-webhook] lead reply failed", {
                buttonId: lead.buttonId,
                error: send.error,
              });
            }
          }
        } else {
          console.warn("[receive-evolution-go-webhook] lead reply skipped: no destination", {
            buttonId: lead.buttonId,
            eventType,
          });
        }
      }
      // IMPORTANT: no order accept/reject/cancel from WhatsApp text
    }

    const { instanceName } = loadEvolutionGoEnv();
    if (isConnectionEvent(eventType)) {
      const connected = /pair|connected|offline.?sync/i.test(eventType) &&
        !/disconnect|logout|close/i.test(eventType);
      await admin.from("communication_instances").update({
        connection_status: connected ? "connected" : /qr/i.test(eventType) ? "qr" : "disconnected",
        last_connected_at: connected ? new Date().toISOString() : undefined,
        updated_at: new Date().toISOString(),
      }).eq("instance_name", instanceName);

      if (connected) {
        await updateReadiness(admin, {
          p_connected: true,
          p_session_valid: true,
          p_webhook_ok: true,
          p_metadata: { source: "webhook", event: eventType },
        });
      } else if (/disconnect|logout|close/i.test(eventType)) {
        await updateReadiness(admin, {
          p_connected: false,
          p_session_valid: false,
          p_webhook_ok: true,
          p_metadata: { source: "webhook", event: eventType },
        });
      } else {
        await updateReadiness(admin, {
          p_webhook_ok: true,
          p_metadata: { source: "webhook", event: eventType },
        });
      }
    } else {
      await updateReadiness(admin, {
        p_webhook_ok: true,
        p_metadata: { source: "webhook", event: eventType },
      });
    }

    await admin
      .from("communication_webhook_events")
      .update({ processed: true })
      .eq("provider", "evolution_go")
      .eq("event_dedupe_key", dedupeKey);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[receive-evolution-go-webhook]", e);
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
