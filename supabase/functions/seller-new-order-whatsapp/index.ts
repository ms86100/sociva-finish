/**
 * First seller WhatsApp for a new order: Accept and Reject.
 * Interactive carousel first (actual buttons). Text fallback only if
 * interactive send fails. Legacy /send/button often returns HTTP 200 but
 * never renders; /send/carousel uses InteractiveMessage which does render.
 * Later status cards stay on the reminder worker. Personal chat only.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeadersFor, handleCorsPreflight } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";
import {
  isCronSecretRequest,
  isServiceRoleRequest,
} from "../_shared/worker-auth.ts";

/* cors: use corsHeadersFor(req) */

const WAITING = new Set(["placed", "enquired", "requested", "quoted"]);

function digits(raw: string | null | undefined): string {
  return String(raw || "").replace(/\D/g, "");
}

serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return handleCorsPreflight(req);
  }
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const authHeader = req.headers.get("Authorization") || "";
  const isService = isServiceRoleRequest(req, serviceKey);
  const isCron = isCronSecretRequest(req);
  if (!isService && !isCron) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let orderId = "";
  try {
    const body = await req.json();
    orderId = String(body?.order_id || body?.orderId || "");
  } catch {
    orderId = "";
  }
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
    return new Response(JSON.stringify({ ok: false, error: "order_id" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const { data: ctxRaw, error: ctxErr } = await admin.rpc("seller_whatsapp_order_context", {
    p_order_id: orderId,
  });
  const ctx = typeof ctxRaw === "string" ? JSON.parse(ctxRaw) : ctxRaw;
  const status = String(ctx?.status || "");
  if (ctxErr || !ctx?.order_id || ctx.terminal === true || !WAITING.has(status)) {
    return new Response(JSON.stringify({ ok: true, skipped: "not_waiting" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: step } = await admin.rpc("seller_whatsapp_next_step", { p_order_id: orderId });
  const stepRow = Array.isArray(step) ? step[0] : step;
  const sellerUserId = stepRow?.seller_user_id as string | undefined;
  if (!sellerUserId) {
    return new Response(JSON.stringify({ ok: true, skipped: "no_seller" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: profile } = await admin.from("profiles").select("phone").eq("id", sellerUserId).maybeSingle();
  const phoneDigits = digits(profile?.phone);
  const phone = phoneDigits.length === 10 ? `91${phoneDigits}` : phoneDigits;
  if (phone.length < 10 || phone.length > 13) {
    return new Response(JSON.stringify({ ok: true, skipped: "no_phone" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ref = String(ctx.order_ref || orderId.slice(-6)).toUpperCase();
  const who = String(ctx.buyer_name || "").replace(/\s+/g, " ").trim();
  const blockRaw = String(ctx.block || "").trim();
  const block = !blockRaw ? "" : /tower|block|wing|phase/i.test(blockRaw) ? blockRaw : `Block ${blockRaw}`;
  const flatRaw = String(ctx.flat || "").trim();
  const flat = !flatRaw ? "" : /flat|door|house/i.test(flatRaw) ? flatRaw : `Flat ${flatRaw}`;
  const place = [ctx.society, block, flat].filter(Boolean).join(" - ");
  const lines = [who, place, [ctx.items, ctx.amount ? `Rs ${Math.round(Number(ctx.amount))}` : ""].filter(Boolean).join(" - ")]
    .filter(Boolean);
  if (ctx.note) lines.push(`Note: ${String(ctx.note).slice(0, 80)}`);
  lines.push("Tap ACCEPT ORDER or REJECT ORDER. The buyer sees it right away.");
  const description = lines.join("\n");
  const title = `Order #${ref}`;
  const textBody = [
    title,
    description,
    "",
    "Reply ACCEPT or REJECT, or open Sociva Orders.",
    "- Sociva",
  ].join("\n");
  const replyButtons = [
    { type: "REPLY", id: `sociva_seller_accept:${orderId}`, displayText: "ACCEPT ORDER" },
    { type: "REPLY", id: `sociva_seller_reject:${orderId}`, displayText: "REJECT ORDER" },
  ];

  const baseUrl = String(Deno.env.get("EVOLUTION_GO_BASE_URL") || "").replace(/\/+$/, "");
  const apiKey = Deno.env.get("EVOLUTION_GO_API_KEY") || "";
  const last10 = phone.slice(-10);

  let knownLid: string | null = null;
  {
    const { data: lidRows } = await admin
      .from("whatsapp_messages")
      .select("meta_payload")
      .eq("direction", "outbound")
      .eq("provider", "evolution_go")
      .like("phone", `%${last10}`)
      .order("created_at", { ascending: false })
      .limit(30);
    for (const row of lidRows || []) {
      const meta = (row.meta_payload || {}) as Record<string, unknown>;
      for (const key of ["known_lid", "text_chat", "button_dest"] as const) {
        const chat = String(meta[key] || "").trim();
        if (/^\d+@lid$/i.test(chat)) {
          knownLid = chat;
          break;
        }
      }
      if (knownLid) break;
      const nested = String(
        (meta as { data?: { Info?: { Chat?: string } } })?.data?.Info?.Chat || "",
      ).trim();
      if (/^\d+@lid$/i.test(nested)) {
        knownLid = nested;
        break;
      }
    }
  }

  let textOk = false;
  let textMessageId: string | null = null;
  let textError: string | null = null;
  let textChat: string | null = null;
  let buttonOk = false;
  let buttonMessageId: string | null = null;
  let buttonError: string | null = null;
  let buttonDest: string | null = null;
  let buttonMethod: string | null = null;

  async function sendInteractive(dest: string, formatJid: boolean) {
    const headers = { apikey: apiKey, "Content-Type": "application/json" };
    const carouselRes = await fetch(`${baseUrl}/send/carousel`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        number: dest,
        formatJid,
        body: title,
        footer: "Sociva",
        cards: [
          {
            header: { title, subtitle: "Sociva" },
            body: { text: description.slice(0, 900) },
            footer: "Sociva",
            buttons: replyButtons,
          },
        ],
      }),
    });
    const carouselJson = await carouselRes.json().catch(() => ({}));
    if (carouselRes.ok) {
      return {
        ok: true,
        method: "carousel",
        messageId: (carouselJson?.messageId || carouselJson?.data?.Info?.ID || null) as string | null,
        chat: String(carouselJson?.data?.Info?.Chat || "").trim() || null,
        error: null as string | null,
      };
    }

    const btnRes = await fetch(`${baseUrl}/send/button`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        number: dest,
        formatJid,
        title,
        description,
        footer: "Sociva",
        buttons: replyButtons.map((b) => ({
          type: "reply",
          id: b.id,
          displayText: b.displayText,
        })),
      }),
    });
    const btnJson = await btnRes.json().catch(() => ({}));
    return {
      ok: btnRes.ok,
      method: btnRes.ok ? "button_fallback" : "failed",
      messageId: (btnJson?.messageId || btnJson?.data?.Info?.ID || null) as string | null,
      chat: String(btnJson?.data?.Info?.Chat || "").trim() || null,
      error: btnRes.ok
        ? null
        : String(
          `carousel: ${carouselJson?.error?.message || carouselJson?.error || carouselRes.status}; ` +
            `button: ${btnJson?.error?.message || btnJson?.error || btnRes.status}`,
        ).slice(0, 240),
    };
  }

  if (!baseUrl || !apiKey) {
    textError = "evolution_not_configured";
    buttonError = "evolution_not_configured";
  } else {
    // Interactive first - avoid orphan plain-text that says "Tap Accept" with no buttons.
    const buttonTargets: Array<{ dest: string; formatJid: boolean }> = [];
    if (knownLid) buttonTargets.push({ dest: knownLid, formatJid: false });
    buttonTargets.push({ dest: phone, formatJid: true });

    for (const target of buttonTargets) {
      try {
        const sent = await sendInteractive(target.dest, target.formatJid);
        if (sent.ok) {
          buttonOk = true;
          buttonMessageId = sent.messageId;
          buttonDest = target.dest;
          buttonMethod = sent.method;
          buttonError = null;
          if (sent.chat && /^\d+@lid$/i.test(sent.chat)) knownLid = sent.chat;
          break;
        }
        buttonError = sent.error;
      } catch (err) {
        buttonError = String(err).slice(0, 240);
      }
    }

    // Text fallback only when interactive failed (still actionable via ACCEPT/REJECT).
    if (!buttonOk) {
      try {
        const textRes = await fetch(`${baseUrl}/send/text`, {
          method: "POST",
          headers: { apikey: apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            number: phone,
            formatJid: true,
            text: textBody,
          }),
        });
        const textJson = await textRes.json().catch(() => ({}));
        textOk = textRes.ok;
        textMessageId = textJson?.messageId || textJson?.data?.Info?.ID || null;
        textChat = String(textJson?.data?.Info?.Chat || "").trim() || null;
        if (textChat && /^\d+@lid$/i.test(textChat)) knownLid = textChat;
        if (!textOk) {
          textError = String(
            textJson?.error?.message || textJson?.error || textJson?.message ||
              `HTTP ${textRes.status}`,
          ).slice(0, 240);
        }
      } catch (err) {
        textError = String(err).slice(0, 240);
      }
    } else {
      textOk = true;
      textChat = knownLid;
    }
  }

  const ok = buttonOk || textOk;
  await admin.from("whatsapp_messages").insert({
    direction: "outbound",
    phone,
    message: (buttonOk ? `${title}\n${description}` : textBody).slice(0, 500),
    provider: "evolution_go",
    provider_message_id: buttonMessageId || textMessageId,
    status: ok ? "sent" : "failed",
    delivery_status_supported: true,
    meta_payload: {
      event: "seller_order_card",
      order_id: orderId,
      status,
      reminder: false,
      first_decision: true,
      text_ok: textOk,
      text_message_id: textMessageId,
      text_error: textError,
      text_chat: textChat,
      known_lid: knownLid,
      button_ok: buttonOk,
      button_message_id: buttonMessageId,
      button_error: buttonError,
      button_dest: buttonDest,
      button_method: buttonMethod,
      note: "interactive_first_text_fallback",
    },
  });

  return new Response(
    JSON.stringify({
      ok,
      order_id: orderId,
      text_ok: textOk,
      button_ok: buttonOk,
      button_method: buttonMethod,
      error: ok ? null : (buttonError || textError),
    }),
    {
      status: ok ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
