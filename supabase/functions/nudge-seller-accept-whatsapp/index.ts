/**
 * Personal WhatsApp cards for an open seller order.
 * First card about a minute after the status starts, then quieter reminders
 * until the order is delivered, cancelled, or 18 hours pass on that status.
 * Never a group.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient } from "../_shared/credentials.ts";
import {
  evolutionGoSendButtons,
  evolutionGoSendText,
  isEvolutionSessionDisconnect,
  upsertCommunicationInstance,
  loadEvolutionGoEnv,
} from "../_shared/evolution-go.ts";
import { isFarFutureScheduled } from "../_shared/seller-status-reminders-policy.ts";
import {
  buildSellerWhatsAppCard,
  sellerReminderDue,
  type SellerCardContext,
} from "../_shared/whatsapp-seller-decision.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const OPEN_STATUSES = [
  "placed",
  "enquired",
  "requested",
  "quoted",
  "accepted",
  "confirmed",
  "scheduled",
  "preparing",
  "ready",
  "picked_up",
  "on_the_way",
  "arrived",
  "at_gate",
  "awaiting_cod_confirmation",
];

function sellerWaNumber(raw: string | null | undefined): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  const withCc = digits.length === 10 ? `91${digits}` : digits;
  if (withCc.length < 10 || withCc.length > 13) return null;
  return withCc;
}

function asContext(data: unknown): SellerCardContext | null {
  const row = typeof data === "string" ? JSON.parse(data) : data;
  if (!row || typeof row !== "object" || !(row as SellerCardContext).order_id) return null;
  return row as SellerCardContext;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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

  const admin = createAdminClient();
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
    const ctx = asContext(ctxRaw);
    if (ctxErr || !ctx || ctx.terminal) {
      skipped++;
      continue;
    }

    const card = buildSellerWhatsAppCard(ctx, { reminder: cards.length > 0 });
    const send = card.buttons.length
      ? await evolutionGoSendButtons({
        number: phone,
        title: card.title,
        description: card.description,
        footer: "Sociva",
        buttons: card.buttons,
      })
      : await evolutionGoSendText({ number: phone, text: card.text });

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
      },
    });
    if (send.success) {
      sent++;
    } else {
      skipped++;
      const errText = String(send.error || "");
      if (send.code === "session_disconnected" || isEvolutionSessionDisconnect(errText)) {
        const { instanceName } = loadEvolutionGoEnv();
        await upsertCommunicationInstance({
          instance_name: instanceName,
          connection_status: "disconnected",
          last_error: errText.slice(0, 240),
        });
        await admin.rpc("admin_update_whatsapp_evolution_readiness", {
          p_connected: false,
          p_session_valid: false,
        });
      }
    }
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
