/**
 * Evolution Go inbound webhook for seller order management.
 * Button taps + exact ACCEPT/REJECT text + 4-digit delivery OTP.
 * Resolves WhatsApp LID chats to the seller phone before RPC auth.
 * After a valid transition, sends the next interactive step card.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeadersFor, handleCorsPreflight } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

/* cors: use corsHeadersFor(req) */

const UUID = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
const ACCEPT_ID = new RegExp(`^sociva_seller_accept:${UUID}$`, "i");
const REJECT_ID = new RegExp(`^sociva_seller_reject:${UUID}$`, "i");
const STEP_ID = new RegExp(`^sociva_seller_step:${UUID}:([a-z_]{1,32})$`, "i");
const WAITING = ["placed", "enquired", "requested", "quoted"];

const STEP_LABEL: Record<string, string> = {
  accepted: "ACCEPT ORDER",
  confirmed: "Confirm",
  scheduled: "Schedule",
  preparing: "START PREPARING",
  ready: "MARK READY",
  ready_for_pickup: "Ready pickup",
  picked_up: "Picked up",
  on_the_way: "On the way",
  out_for_delivery: "Out for delivery",
  arrived: "Reached",
  at_gate: "At the gate",
  completed: "COMPLETE ORDER",
  delivered: "Mark delivered",
};

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

function digits(raw: unknown): string {
  return String(raw || "").replace(/@.*/, "").replace(/\D/g, "");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function headerSecret(req: Request): string {
  return (
    req.headers.get("x-sociva-webhook-secret") ||
    req.headers.get("apikey") ||
    req.headers.get("x-api-key") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim()
  );
}

function eventType(payload: any): string {
  return String(
    payload?.event || payload?.type || payload?.Event || payload?.data?.event ||
      payload?.messageType || "unknown",
  );
}

function extractPhone(payload: any): string {
  const candidates = [
    payload?.data?.Info?.SenderAlt,
    payload?.data?.Info?.RecipientAlt,
    payload?.data?.Info?.Sender,
    payload?.data?.Info?.Chat,
    payload?.data?.from,
    payload?.from,
    payload?.data?.key?.remoteJid,
  ].map(digits).filter(Boolean);
  // Prefer real E.164-ish lengths over long LID digit strings.
  return (
    candidates.find((d) => d.length >= 10 && d.length <= 13) ||
    candidates[0] ||
    ""
  );
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

function extractButton(payload: any): {
  buttonId: string | null;
  chatJid: string | null;
  isFromMe: boolean;
} {
  const msg = payload?.data?.Message || payload?.data?.message || payload?.Message || {};
  const br =
    msg?.buttonsResponseMessage ||
    msg?.templateButtonReplyMessage ||
    msg?.listResponseMessage ||
    payload?.data?.Button ||
    null;

  let nativeId: string | null = null;
  const native =
    msg?.interactiveResponseMessage?.nativeFlowResponseMessage ||
    msg?.nativeFlowResponseMessage ||
    null;
  const paramsJson = native?.paramsJson || native?.paramsJSON || native?.ParamsJSON;
  if (paramsJson) {
    try {
      const parsed = typeof paramsJson === "string" ? JSON.parse(paramsJson) : paramsJson;
      nativeId = String(
        parsed?.id || parsed?.button_id || parsed?.selectedButtonId || parsed?.selected_id || "",
      ).trim() || null;
    } catch {
      nativeId = null;
    }
  }
  if (!nativeId) {
    const selectedId = String(
      msg?.interactiveResponseMessage?.nativeFlowResponseMessage?.id ||
        msg?.templateButtonReplyMessage?.selectedId ||
        msg?.templateButtonReplyMessage?.selectedID ||
        "",
    ).trim();
    if (selectedId) nativeId = selectedId;
  }

  const buttonId = String(
    br?.selectedButtonID || br?.selectedButtonId || br?.buttonId || br?.id ||
      nativeId ||
      payload?.data?.selectedButtonID || payload?.selectedButtonID || "",
  ).trim() || null;
  const chatJid = String(
    payload?.data?.Info?.Chat || payload?.data?.Info?.Sender ||
      payload?.data?.key?.remoteJid || payload?.data?.from || "",
  ).trim() || null;
  const isFromMe = Boolean(
    payload?.data?.Info?.IsFromMe === true || payload?.data?.key?.fromMe === true,
  );
  return { buttonId, chatJid, isFromMe };
}

function isGroup(payload: any): boolean {
  const info = payload?.data?.Info || {};
  if (info.IsGroup === true) return true;
  const chats = [info.Chat, info.Sender, payload?.data?.key?.remoteJid, payload?.from];
  return chats.some((v) => /@g\.us|@broadcast|@newsletter/i.test(String(v || "")));
}

function parseButtonAction(buttonId: string | null) {
  const raw = String(buttonId || "").trim();
  const a = raw.match(ACCEPT_ID);
  if (a) return { kind: "accept" as const, orderId: a[1], buttonId: raw };
  const r = raw.match(REJECT_ID);
  if (r) return { kind: "reject" as const, orderId: r[1], buttonId: raw };
  const s = raw.match(STEP_ID);
  if (s) {
    return {
      kind: "step" as const,
      orderId: s[1],
      status: s[2].toLowerCase(),
      buttonId: raw,
    };
  }
  return null;
}

function parseTextDecision(text: string | null) {
  const raw = String(text || "").replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ").trim();
  const m = raw.match(/^(accept|reject)(?:\s+#?([0-9a-f]{6}))?$/i);
  if (!m) return null;
  return {
    decision: m[1].toLowerCase() as "accept" | "reject",
    orderRef: m[2] ? m[2].toUpperCase() : null,
  };
}

function looksLikeMobilePhone(d: string): boolean {
  return d.length >= 10 && d.length <= 13;
}

function looksLikeLidDigits(d: string): boolean {
  return d.length > 13;
}

/**
 * Map inbound chat (often @lid) to the seller mobile used by RPC auth.
 * Never trust button payload alone - phone must resolve to the order's seller.
 */
async function resolveAuthPhone(
  db: ReturnType<typeof admin>,
  extractedPhone: string,
  chatJid: string | null,
  orderId: string,
): Promise<string | null> {
  const direct = digits(extractedPhone);
  if (looksLikeMobilePhone(direct) && !looksLikeLidDigits(direct)) {
    return direct;
  }

  const lidCandidates = new Set<string>();
  const chat = String(chatJid || "").trim();
  if (/@lid$/i.test(chat)) lidCandidates.add(chat.toLowerCase());
  if (looksLikeLidDigits(direct)) lidCandidates.add(`${direct}@lid`);
  if (/^\d+$/.test(chat)) lidCandidates.add(`${chat}@lid`);

  for (const lid of lidCandidates) {
    const { data: rows } = await db
      .from("whatsapp_messages")
      .select("phone, meta_payload")
      .eq("direction", "outbound")
      .eq("provider", "evolution_go")
      .or(
        `meta_payload->>known_lid.eq.${lid},meta_payload->>text_chat.eq.${lid},meta_payload->>button_dest.eq.${lid}`,
      )
      .order("created_at", { ascending: false })
      .limit(10);
    for (const row of rows || []) {
      const p = digits(row.phone);
      if (looksLikeMobilePhone(p)) return p;
    }
  }

  // Last resort: seller phone for this order, only when inbound LID was used
  // as button_dest on a card we already sent for the same order.
  if (lidCandidates.size > 0 && /^[0-9a-f-]{36}$/i.test(orderId)) {
    const { data: cards } = await db
      .from("whatsapp_messages")
      .select("phone, meta_payload")
      .eq("direction", "outbound")
      .eq("provider", "evolution_go")
      .filter("meta_payload->>order_id", "eq", orderId)
      .order("created_at", { ascending: false })
      .limit(10);
    for (const row of cards || []) {
      const meta = (row.meta_payload || {}) as Record<string, unknown>;
      const known = [
        meta.known_lid,
        meta.text_chat,
        meta.button_dest,
      ].map((v) => String(v || "").trim().toLowerCase());
      for (const lid of lidCandidates) {
        if (known.includes(lid)) {
          const p = digits(row.phone);
          if (looksLikeMobilePhone(p)) return p;
        }
      }
    }
  }

  return looksLikeMobilePhone(direct) ? direct : null;
}

async function evoFetch(
  path: string,
  body: Record<string, unknown>,
  instanceId?: string,
) {
  const base = String(Deno.env.get("EVOLUTION_GO_BASE_URL") || "").replace(/\/+$/, "");
  const key = Deno.env.get("EVOLUTION_GO_API_KEY") || "";
  if (!base || !key) return { ok: false, json: {} as any };
  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
  };
  if (instanceId) headers.instanceId = instanceId;
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, json };
  } catch {
    return { ok: false, json: {} as any };
  }
}

async function evoText(number: string, text: string, instanceId?: string) {
  await evoFetch(
    "/send/text",
    { number, text, formatJid: !/@/.test(number) },
    instanceId,
  );
}

async function evoInteractive(
  number: string,
  title: string,
  description: string,
  buttons: Array<{ id: string; displayText: string }>,
  instanceId?: string,
) {
  const formatJid = !/@/.test(number);
  const mapped = buttons.slice(0, 3).map((b) => ({
    type: "REPLY",
    id: b.id,
    displayText: b.displayText.slice(0, 20),
  }));
  const carousel = await evoFetch(
    "/send/carousel",
    {
      number,
      formatJid,
      body: title,
      footer: "Sociva",
      cards: [{
        header: { title, subtitle: "Sociva" },
        body: { text: description.slice(0, 900) },
        footer: "Sociva",
        buttons: mapped,
      }],
    },
    instanceId,
  );
  if (carousel.ok) {
    return {
      ok: true,
      method: "carousel",
      messageId: carousel.json?.messageId || carousel.json?.data?.Info?.ID || null,
    };
  }
  const btn = await evoFetch(
    "/send/button",
    {
      number,
      formatJid,
      title,
      description,
      footer: "Sociva",
      buttons: mapped.map((b) => ({ type: "reply", id: b.id, displayText: b.displayText })),
    },
    instanceId,
  );
  return {
    ok: btn.ok,
    method: btn.ok ? "button_fallback" : "failed",
    messageId: btn.json?.messageId || btn.json?.data?.Info?.ID || null,
  };
}

function buildNextCard(ctx: any): {
  title: string;
  description: string;
  text: string;
  buttons: Array<{ id: string; displayText: string }>;
} | null {
  if (!ctx?.order_id || ctx.terminal === true) return null;
  const orderId = String(ctx.order_id);
  const ref = String(ctx.order_ref || orderId.slice(-6)).toUpperCase();
  const status = String(ctx.status || "");
  const who = String(ctx.buyer_name || "").replace(/\s+/g, " ").trim();
  const title = `Order #${ref}`;
  const next = String(ctx.next_status || "");
  const waiting = WAITING.includes(status) && ctx.can_reject === true;
  const lines = [
    who,
    [ctx.items, ctx.amount != null ? `Rs ${Math.round(Number(ctx.amount))}` : ""]
      .filter(Boolean)
      .join(" - "),
  ].filter(Boolean);

  const buttons: Array<{ id: string; displayText: string }> = [];
  if (waiting) {
    lines.push("Tap ACCEPT ORDER or REJECT ORDER. The buyer sees it right away.");
    buttons.push({ id: `sociva_seller_accept:${orderId}`, displayText: "ACCEPT ORDER" });
    buttons.push({ id: `sociva_seller_reject:${orderId}`, displayText: "REJECT ORDER" });
  } else if (ctx.needs_otp === true) {
    lines.push("Reply with the 4-digit code the buyer shows you.");
  } else if (next) {
    const label = (STEP_LABEL[next] || "Update").slice(0, 20);
    lines.push(`Next: ${label}`);
    buttons.push({
      id: `sociva_seller_step:${orderId}:${next}`,
      displayText: label,
    });
  } else {
    return null;
  }

  const description = lines.join("\n");
  return {
    title,
    description,
    text: `${title}\n${description}`,
    buttons,
  };
}

async function resolveTextAction(db: ReturnType<typeof admin>, phone: string, text: string | null) {
  const parsed = parseTextDecision(text);
  if (!parsed) return null;
  const last10 = digits(phone).slice(-10);
  if (last10.length !== 10) return null;

  let orderId: string | null = null;
  const { data: cards } = await db
    .from("whatsapp_messages")
    .select("meta_payload")
    .eq("direction", "outbound")
    .eq("provider", "evolution_go")
    .like("phone", `%${last10}`)
    .filter("meta_payload->>event", "eq", "seller_order_card")
    .order("created_at", { ascending: false })
    .limit(parsed.orderRef ? 10 : 20);

  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const row of cards || []) {
    const oid = String((row.meta_payload as { order_id?: string } | null)?.order_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(oid) || seen.has(oid)) continue;
    if (parsed.orderRef && oid.slice(-6).toUpperCase() !== parsed.orderRef) continue;
    seen.add(oid);
    candidates.push(oid);
  }

  const waiting: string[] = [];
  for (const oid of candidates.slice(0, 8)) {
    const { data: ctxRaw } = await db.rpc("seller_whatsapp_order_context", { p_order_id: oid });
    const ctx = typeof ctxRaw === "string" ? JSON.parse(ctxRaw) : ctxRaw;
    const st = String(ctx?.status || "");
    if (ctx?.order_id && ctx.terminal !== true && WAITING.includes(st)) waiting.push(oid);
  }
  if (parsed.orderRef) {
    orderId = waiting[0] || null;
  } else if (waiting.length === 1) {
    orderId = waiting[0];
  }
  if (!orderId) return null;
  return {
    kind: parsed.decision,
    orderId,
    buttonId: `sociva_seller_${parsed.decision}:${orderId}`,
  };
}

serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return handleCorsPreflight(req);
  }
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const secret = Deno.env.get("EVOLUTION_GO_WEBHOOK_SECRET") || "";
  const provided = headerSecret(req);
  if (!secret || !provided || !timingSafeEqual(provided, secret)) {
    return new Response(JSON.stringify({ success: false, error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const db = admin();
  try {
    const payload = await req.json();
    const et = eventType(payload);
    const headerInstance =
      req.headers.get("instanceid") ||
      req.headers.get("instanceId") ||
      payload?.instanceId ||
      payload?.instance?.id ||
      payload?.instanceName ||
      null;

    const { data: instances } = await db
      .from("communication_instances")
      .select("id, provider_instance_id, instance_name, webhook_trusted")
      .eq("channel", "whatsapp_evolution_go")
      .eq("webhook_trusted", true);
    const trusted = instances || [];
    if (!headerInstance || trusted.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "instance" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const matched = trusted.find((i) =>
      String(i.provider_instance_id || "") === String(headerInstance) ||
      String(i.instance_name || "") === String(headerInstance)
    );
    if (!matched) {
      return new Response(JSON.stringify({ success: false, error: "unknown_instance" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (
      /button.?click|buttons.?response|interactive/i.test(et) ||
      (/message/i.test(et) && !/send/i.test(et))
    ) {
      const phoneRaw = extractPhone(payload) || "unknown";
      const text = extractText(payload);
      const group = isGroup(payload);
      const tap = extractButton(payload);
      let action = group || tap.isFromMe ? null : parseButtonAction(tap.buttonId);
      const instanceId =
        String(matched.provider_instance_id || headerInstance || "") || undefined;
      const replyTo =
        tap.chatJid && !/@g\.us|@broadcast/i.test(tap.chatJid)
          ? tap.chatJid
          : (digits(phoneRaw).length >= 10 && digits(phoneRaw).length <= 15 ? phoneRaw : null);

      const authSeed = looksLikeMobilePhone(digits(phoneRaw))
        ? digits(phoneRaw)
        : (replyTo || phoneRaw);
      if (!action && !group && !tap.isFromMe) {
        const authForText = await resolveAuthPhone(
          db,
          authSeed,
          tap.chatJid,
          "",
        );
        action = await resolveTextAction(db, authForText || digits(phoneRaw), text);
      }
      const otp = !group && !tap.isFromMe && !action && /^[0-9]{4}$/.test(String(text || "").trim())
        ? String(text).trim()
        : null;

      if (action && replyTo) {
        const authPhone = await resolveAuthPhone(
          db,
          authSeed,
          tap.chatJid,
          action.orderId,
        );
        const destPhone = authPhone || digits(phoneRaw);
        const { data: already } = await db
          .from("whatsapp_messages")
          .select("id")
          .eq("provider", "evolution_go")
          .eq("direction", "outbound")
          .filter("meta_payload->>event", "eq", "seller_order_decision")
          .filter("meta_payload->>button_id", "eq", action.buttonId)
          .gte("created_at", new Date(Date.now() - 2 * 60 * 1000).toISOString())
          .limit(1)
          .maybeSingle();

        let replyText = "";
        let decided = false;
        let errText = "";

        if (!already?.id) {
          if (!destPhone || !looksLikeMobilePhone(digits(destPhone))) {
            replyText = "This chat cannot update that order.";
            errText = "Not authorized";
          } else {
            const rpc = action.kind === "step"
              ? await db.rpc("seller_whatsapp_apply_step", {
                p_order_id: action.orderId,
                p_to_status: action.status,
                p_phone: destPhone,
              })
              : await db.rpc("seller_whatsapp_decide_order", {
                p_order_id: action.orderId,
                p_decision: action.kind,
                p_phone: destPhone,
              });
            errText = String(rpc.error?.message || "");
            if (!rpc.error && rpc.data) {
              decided = true;
              const ackSource = action.kind === "reject"
                ? "WHATSAPP_REJECT"
                : action.kind === "accept"
                ? "WHATSAPP_ACCEPT"
                : "UNKNOWN";
              db.rpc("ack_seller_order_alert", {
                p_order_id: action.orderId,
                p_source: ackSource,
              }).catch(() => {});
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
            } else if (/no longer waiting|illegal|cannot/i.test(errText)) {
              replyText =
                "This order has already been updated through Sociva. No further action is required.";
            } else if (/Not authorized/i.test(errText)) {
              replyText = "This chat cannot update that order.";
            } else {
              replyText = "Could not update this order. Open Sociva Orders and respond there.";
            }
          }
        } else {
          replyText =
            "This order has already been updated through Sociva. No further action is required.";
        }

        if (decided && action.kind === "reject") {
          replyText = "ORDER REJECTED\n\nThe buyer has been notified.";
        }

        if (decided && action.kind !== "reject") {
          const { data: ctxRaw } = await db.rpc("seller_whatsapp_order_context", {
            p_order_id: action.orderId,
          });
          const ctx = typeof ctxRaw === "string" ? JSON.parse(ctxRaw) : ctxRaw;
          const card = buildNextCard(ctx);
          if (card?.buttons.length) {
            const sent = await evoInteractive(
              replyTo,
              card.title,
              card.description,
              card.buttons,
              instanceId,
            );
            await db.from("whatsapp_messages").insert({
              direction: "outbound",
              phone: digits(destPhone),
              message: card.text.slice(0, 500),
              provider: "evolution_go",
              provider_message_id: sent.messageId,
              status: sent.ok ? "sent" : "failed",
              delivery_status_supported: true,
              meta_payload: {
                event: "seller_order_card",
                order_id: action.orderId,
                status: ctx?.status || null,
                button_method: sent.method,
                button_ok: sent.ok,
                after_decision: true,
                note: "post_transition_next_step",
              },
            });
            if (!sent.ok) {
              await evoText(
                replyTo,
                `${card.text}\n\nIf buttons are missing, open Sociva Orders.`,
                instanceId,
              );
            }
          } else {
            replyText = replyText || "Updated. The buyer can see this now.";
          }
        }

        if (replyText) {
          await evoText(replyTo, replyText, instanceId);
        }

        await db.from("whatsapp_messages").insert({
          direction: "outbound",
          phone: digits(destPhone),
          message: replyText || "Updated",
          provider: "evolution_go",
          status: "sent",
          meta_payload: {
            event: "seller_order_decision",
            order_id: action.orderId,
            button_id: action.buttonId,
            decision: action.kind === "step" ? action.status : action.kind,
            applied: decided,
            auth_phone: digits(destPhone),
            chat_jid: tap.chatJid,
            error: errText || null,
            acknowledgement_source: action.kind === "reject"
              ? "WHATSAPP_REJECT"
              : action.kind === "accept"
              ? "WHATSAPP_ACCEPT"
              : "WHATSAPP_STEP",
          },
        });
      } else if (otp && replyTo) {
        const authPhone = await resolveAuthPhone(db, authSeed, tap.chatJid, "");
        const destPhone = authPhone || digits(phoneRaw);
        const { data: otpRows } = await db.rpc("seller_whatsapp_apply_otp", {
          p_phone: destPhone,
          p_code: otp,
        });
        const row = Array.isArray(otpRows) ? otpRows[0] : otpRows;
        const outcome = String(row?.result || "none");
        if (outcome !== "none") {
          const replyText = outcome === "delivered" || outcome === "done"
            ? "ORDER COMPLETED\n\nDelivered. The buyer can see it."
            : outcome === "invalid"
            ? "That code did not match. Use the 4-digit code on the buyer's order."
            : "Could not mark this delivered. Open Sociva and enter the code there.";
          await evoText(replyTo, replyText, instanceId);
        }
      }

      await db.from("whatsapp_messages").insert({
        direction: "inbound",
        phone: phoneRaw,
        message: otp ? "[delivery code]" : (text ? String(text).slice(0, 500) : null),
        provider: "evolution_go",
        status: "received",
        meta_payload: {
          event: et,
          informational_only: !action && !otp,
          button_id: action?.buttonId || tap.buttonId || null,
          chat_jid: tap.chatJid,
        },
      });
    }

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
