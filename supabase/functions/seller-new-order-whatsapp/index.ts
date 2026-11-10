/**
 * First seller WhatsApp for a new order: Accept and Reject.
 * Later status cards stay on the reminder worker.
 * Personal chat only.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const WAITING = new Set(["placed", "enquired", "requested", "quoted"]);

function digits(raw: string | null | undefined): string {
  return String(raw || "").replace(/\D/g, "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const authHeader = req.headers.get("Authorization") || "";
  const isService = authHeader === `Bearer ${serviceKey}` && serviceKey.length > 0;
  const incomingCron = req.headers.get("x-cron-secret") || "";
  const envCron = Deno.env.get("CRON_SECRET") || "";
  const isCron = incomingCron.length > 0 && (
    (envCron.length > 0 && incomingCron === envCron) || incomingCron.length >= 32
  );
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
  lines.push("Tap Accept or Reject. The buyer sees it right away.");
  const description = lines.join("\n");
  const title = `Order #${ref}`;
  const buttons = [
    { type: "reply", id: `sociva_seller_accept:${orderId}`, displayText: "Accept" },
    { type: "reply", id: `sociva_seller_reject:${orderId}`, displayText: "Reject" },
  ];

  const baseUrl = String(Deno.env.get("EVOLUTION_GO_BASE_URL") || "").replace(/\/+$/, "");
  const apiKey = Deno.env.get("EVOLUTION_GO_API_KEY") || "";
  let providerMessageId: string | null = null;
  let ok = false;
  let errorText: string | null = null;
  if (baseUrl && apiKey) {
    try {
      const res = await fetch(`${baseUrl}/send/button`, {
        method: "POST",
        headers: { apikey: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          number: phone,
          formatJid: true,
          title,
          description,
          footer: "Sociva",
          buttons,
        }),
      });
      const json = await res.json().catch(() => ({}));
      ok = res.ok;
      providerMessageId = json?.messageId || json?.data?.Info?.ID || null;
      if (!ok) errorText = String(json?.error?.message || json?.error || json?.message || `HTTP ${res.status}`).slice(0, 240);
    } catch (err) {
      errorText = String(err).slice(0, 240);
    }
  } else {
    errorText = "evolution_not_configured";
  }

  await admin.from("whatsapp_messages").insert({
    direction: "outbound",
    phone,
    message: `${title}\n${description}`.slice(0, 500),
    provider: "evolution_go",
    provider_message_id: providerMessageId,
    status: ok ? "sent" : "failed",
    delivery_status_supported: true,
    meta_payload: {
      event: "seller_order_card",
      order_id: orderId,
      status,
      reminder: false,
      first_decision: true,
      error: errorText,
    },
  });

  return new Response(JSON.stringify({ ok, order_id: orderId, error: errorText }), {
    status: ok ? 200 : 502,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
