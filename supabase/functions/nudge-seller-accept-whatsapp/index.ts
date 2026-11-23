/**
 * Personal WhatsApp cards for open seller orders (status steps + reminders).
 * Uses /send/carousel (InteractiveMessage) so Accept/Reject and next-step
 * buttons actually render on consumer WhatsApp.
 * Self-contained - no _shared imports (keeps MCP deploy reliable).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeadersFor, handleCorsPreflight } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";
import {
  isCronSecretRequest,
  isServiceRoleRequest,
} from "../_shared/worker-auth.ts";

/* cors: use corsHeadersFor(req) */

const OPEN_STATUSES = [
  "placed", "enquired", "requested", "quoted", "accepted", "confirmed",
  "scheduled", "preparing", "ready", "picked_up", "on_the_way", "arrived",
  "at_gate", "awaiting_cod_confirmation",
];

const STEP_LABEL: Record<string, string> = {
  accepted: "ACCEPT ORDER",
  preparing: "START PREPARING",
  ready: "MARK READY",
  picked_up: "Picked up",
  on_the_way: "On the way",
  arrived: "Arrived",
  at_gate: "At gate",
  delivered: "Delivered",
  completed: "COMPLETE ORDER",
  buyer_received: "Buyer got it",
};

function digits(raw: string | null | undefined): string {
  return String(raw || "").replace(/\D/g, "");
}

function sellerWaNumber(raw: string | null | undefined): string | null {
  const d = digits(raw);
  const withCc = d.length === 10 ? `91${d}` : d;
  if (withCc.length < 10 || withCc.length > 13) return null;
  return withCc;
}

function sellerReminderDue(input: {
  statusAgeMs: number;
  lastCardAtMs: number | null;
  priorCards: number;
  nowMs: number;
}): boolean {
  const maxAge = 18 * 60 * 60 * 1000;
  if (input.statusAgeMs < 60_000 || input.statusAgeMs > maxAge) return false;
  if (input.lastCardAtMs == null || input.priorCards <= 0) return true;
  const gapMin = input.priorCards <= 1 ? 15 : input.priorCards === 2 ? 30 : 60;
  return input.nowMs - input.lastCardAtMs >= gapMin * 60_000;
}

function isFarFutureScheduled(row: {
  status?: string;
  scheduled_date?: string | null;
  preparation_start_at?: string | null;
}, nowMs: number): boolean {
  const status = String(row.status || "");
  if (!["placed", "enquired", "requested", "quoted", "scheduled"].includes(status)) {
    return false;
  }
  const sched = row.preparation_start_at || row.scheduled_date;
  if (!sched) return false;
  const t = new Date(sched).getTime();
  if (!Number.isFinite(t)) return false;
  return t - nowMs > 2 * 60 * 60 * 1000;
}

function buildCard(ctx: Record<string, unknown>, reminder: boolean) {
  const orderId = String(ctx.order_id || "");
  const ref = String(ctx.order_ref || orderId.slice(-6)).toUpperCase();
  const status = String(ctx.status || "");
  const title = `Order #${ref}`;
  const who = String(ctx.buyer_name || "").replace(/\s+/g, " ").trim();
  const blockRaw = String(ctx.block || "").trim();
  const block = !blockRaw
    ? ""
    : /tower|block|wing|phase/i.test(blockRaw)
    ? blockRaw
    : `Block ${blockRaw}`;
  const flatRaw = String(ctx.flat || "").trim();
  const flat = !flatRaw
    ? ""
    : /flat|door|house/i.test(flatRaw)
    ? flatRaw
    : `Flat ${flatRaw}`;
  const place = [ctx.society, block, flat].filter(Boolean).join(" - ");
  const amount = ctx.amount != null ? `Rs ${Math.round(Number(ctx.amount))}` : "";
  const lines = [
    who,
    place,
    [ctx.items, amount].filter(Boolean).join(" - "),
  ].filter(Boolean) as string[];
  if (ctx.note) lines.push(`Note: ${String(ctx.note).slice(0, 80)}`);

  const waiting = ctx.can_reject === true &&
    ["placed", "enquired", "requested", "quoted"].includes(status);
  const next = String(ctx.next_status || "");
  const needsOtp = ctx.needs_otp === true;
  const buttons: Array<{ id: string; displayText: string }> = [];

  if (waiting) {
    lines.push(
      reminder
        ? "Still waiting. Tap ACCEPT ORDER or REJECT ORDER. The buyer sees it right away."
        : "Tap ACCEPT ORDER or REJECT ORDER. The buyer sees it right away.",
    );
    buttons.push({ id: `sociva_seller_accept:${orderId}`, displayText: "ACCEPT ORDER" });
    buttons.push({ id: `sociva_seller_reject:${orderId}`, displayText: "REJECT ORDER" });
  } else if (needsOtp) {
    lines.push(
      reminder
        ? "Still waiting for the code. Reply with the 4-digit code the buyer shows you."
        : "Reply with the 4-digit code the buyer shows you. That marks it delivered.",
    );
  } else if (next) {
    const label = STEP_LABEL[next] || next;
    lines.push(reminder ? `Still open. Tap ${label}.` : `Tap ${label}.`);
    buttons.push({
      id: `sociva_seller_step:${orderId}:${next}`,
      displayText: label,
    });
  } else {
    lines.push("Open Sociva if you need another action.");
  }

  const description = lines.join("\n");
  return {
    title,
    description,
    text: `${title}\n${description}`,
    buttons: buttons.slice(0, 3),
  };
}

async function evoSend(opts: {
  number: string;
  title: string;
  description: string;
  text: string;
  buttons: Array<{ id: string; displayText: string }>;
}) {
  const baseUrl = String(Deno.env.get("EVOLUTION_GO_BASE_URL") || "").replace(/\/+$/, "");
  const apiKey = Deno.env.get("EVOLUTION_GO_API_KEY") || "";
  if (!baseUrl || !apiKey) {
    return { success: false, error: "evolution_not_configured", code: "missing_credentials" as const };
  }
  const headers = { apikey: apiKey, "Content-Type": "application/json" };

  if (opts.buttons.length > 0) {
    const carouselRes = await fetch(`${baseUrl}/send/carousel`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        number: opts.number,
        formatJid: true,
        body: opts.title,
        footer: "Sociva",
        cards: [
          {
            header: { title: opts.title, subtitle: "Sociva" },
            body: { text: opts.description.slice(0, 900) },
            footer: "Sociva",
            buttons: opts.buttons.map((b) => ({
              type: "REPLY",
              id: b.id,
              displayText: b.displayText,
            })),
          },
        ],
      }),
    });
    const carouselJson = await carouselRes.json().catch(() => ({}));
    if (carouselRes.ok) {
      return {
        success: true,
        providerMessageId: String(
          carouselJson?.messageId || carouselJson?.data?.Info?.ID || "",
        ) || null,
        send_method: "carousel",
        code: "ok" as const,
        error: null as string | null,
      };
    }

    const btnRes = await fetch(`${baseUrl}/send/button`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        number: opts.number,
        formatJid: true,
        title: opts.title,
        description: opts.description,
        footer: "Sociva",
        buttons: opts.buttons.map((b) => ({
          type: "reply",
          id: b.id,
          displayText: b.displayText,
        })),
      }),
    });
    const btnJson = await btnRes.json().catch(() => ({}));
    if (btnRes.ok) {
      return {
        success: true,
        providerMessageId: String(btnJson?.messageId || btnJson?.data?.Info?.ID || "") || null,
        send_method: "button_fallback",
        code: "ok" as const,
        error: null as string | null,
      };
    }
    return {
      success: false,
      providerMessageId: null,
      send_method: "failed",
      code: "evolution_error" as const,
      error: String(
        btnJson?.error?.message || carouselJson?.error?.message || `HTTP ${btnRes.status}`,
      ).slice(0, 240),
    };
  }

  const textRes = await fetch(`${baseUrl}/send/text`, {
    method: "POST",
    headers,
    body: JSON.stringify({ number: opts.number, formatJid: true, text: opts.text }),
  });
  const textJson = await textRes.json().catch(() => ({}));
  return {
    success: textRes.ok,
    providerMessageId: String(textJson?.messageId || textJson?.data?.Info?.ID || "") || null,
    send_method: "text",
    code: textRes.ok ? "ok" as const : "evolution_error" as const,
    error: textRes.ok
      ? null
      : String(textJson?.error?.message || textJson?.error || `HTTP ${textRes.status}`).slice(0, 240),
  };
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

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const nowMs = Date.now();
  const { data: rows, error } = await admin
    .from("orders")
    .select(`
      id,
      status,
      created_at,
      status_changed_at,
      scheduled_date,
      auto_cancel_at,
      preparation_start_at,
      seller_profiles!inner(user_id)
    `)
    .in("status", OPEN_STATUSES)
    .gte("status_changed_at", new Date(nowMs - 18 * 60 * 60 * 1000).toISOString())
    .order("status_changed_at", { ascending: true })
    .limit(40);

  if (error) {
    console.error("[nudge-seller-accept-whatsapp] query", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let sent = 0;
  let skipped = 0;

  for (const row of rows || []) {
    const orderId = String(row.id);
    const status = String(row.status || "");
    const startedAt = row.status_changed_at || row.created_at;
    const ageMs = startedAt ? nowMs - new Date(startedAt).getTime() : 0;
    const waiting = ["placed", "enquired", "requested", "quoted", "scheduled"].includes(status);
    if (waiting && isFarFutureScheduled(row, nowMs)) {
      skipped++;
      continue;
    }

    const { data: prior } = await admin
      .from("whatsapp_messages")
      .select("created_at")
      .eq("provider", "evolution_go")
      .eq("direction", "outbound")
      .filter("meta_payload->>event", "eq", "seller_order_card")
      .filter("meta_payload->>order_id", "eq", orderId)
      .filter("meta_payload->>status", "eq", status)
      .order("created_at", { ascending: false })
      .limit(8);

    const cards = prior || [];
    const lastMs = cards[0]?.created_at ? new Date(cards[0].created_at).getTime() : null;
    if (!sellerReminderDue({
      statusAgeMs: ageMs,
      lastCardAtMs: lastMs,
      priorCards: cards.length,
      nowMs,
    })) {
      skipped++;
      continue;
    }

    const sellerUserId = (row.seller_profiles as { user_id?: string } | null)?.user_id;
    if (!sellerUserId) {
      skipped++;
      continue;
    }
    const { data: profile } = await admin
      .from("profiles")
      .select("phone")
      .eq("id", sellerUserId)
      .maybeSingle();
    const phone = sellerWaNumber(profile?.phone);
    if (!phone) {
      skipped++;
      continue;
    }

    const { data: ctxRaw, error: ctxErr } = await admin.rpc(
      "seller_whatsapp_order_context",
      { p_order_id: orderId },
    );
    const ctx = (typeof ctxRaw === "string" ? JSON.parse(ctxRaw) : ctxRaw) as Record<string, unknown> | null;
    if (ctxErr || !ctx?.order_id || ctx.terminal === true) {
      skipped++;
      continue;
    }

    const card = buildCard(ctx, cards.length > 0);
    const send = await evoSend({
      number: phone,
      title: card.title,
      description: card.description,
      text: card.text,
      buttons: card.buttons,
    });

    await admin.from("whatsapp_messages").insert({
      direction: "outbound",
      phone,
      message: card.text.slice(0, 500),
      provider: "evolution_go",
      provider_message_id: send.providerMessageId || null,
      status: send.success ? "sent" : "failed",
      delivery_status_supported: true,
      meta_payload: {
        event: "seller_order_card",
        order_id: orderId,
        status,
        reminder: cards.length > 0,
        error: send.success ? null : send.error,
        code: send.success ? null : send.code,
        button_method: send.send_method,
        note: "carousel_preferred_self_contained",
      },
    });
    if (send.success) sent++;
    else skipped++;
  }

  return new Response(JSON.stringify({
    ok: true,
    scanned: rows?.length ?? 0,
    sent,
    skipped,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
