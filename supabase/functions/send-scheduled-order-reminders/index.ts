import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type ReminderKind =
  | "scheduled_48h"
  | "scheduled_24h"
  | "scheduled_prep"
  | "scheduled_30m";

interface WindowSpec {
  kind: ReminderKind;
  title: string;
  bodySeller: (ref: string, when: string) => string;
  bodyBuyer: (store: string, when: string) => string;
  match: (o: OrderRow, now: Date) => boolean;
}

interface OrderRow {
  id: string;
  buyer_id: string;
  seller_id: string;
  scheduled_date: string;
  scheduled_time_start: string | null;
  scheduled_fulfilment_at: string | null;
  preparation_start_at: string | null;
  status: string;
  reminder_state: Record<string, boolean> | null;
  seller_profiles: { user_id: string; business_name: string | null } | null;
}

function istNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}

function minsBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 60_000;
}

function formatWhen(o: OrderRow): string {
  const t = o.scheduled_time_start?.slice(0, 5) || "scheduled time";
  return `${o.scheduled_date} · ${t}`;
}

const WINDOWS: WindowSpec[] = [
  {
    kind: "scheduled_48h",
    title: "📅 Upcoming scheduled orders",
    bodySeller: (ref, when) => `Order #${ref} is scheduled for ${when}.`,
    bodyBuyer: (store, when) => `Your order from ${store} is scheduled for ${when}.`,
    match: (o, now) => {
      if (!o.scheduled_fulfilment_at) return false;
      const fulfil = new Date(o.scheduled_fulfilment_at);
      const m = minsBetween(fulfil, now);
      return m >= 47 * 60 && m <= 49 * 60;
    },
  },
  {
    kind: "scheduled_24h",
    title: "📅 Tomorrow's scheduled order",
    bodySeller: (ref, when) => `Order #${ref} is scheduled for ${when}.`,
    bodyBuyer: (store, when) => `Your order from ${store} is scheduled for tomorrow · ${when.split(" · ")[1] || when}.`,
    match: (o, now) => {
      if (!o.scheduled_fulfilment_at) return false;
      const fulfil = new Date(o.scheduled_fulfilment_at);
      const m = minsBetween(fulfil, now);
      return m >= 23 * 60 && m <= 25 * 60;
    },
  },
  {
    kind: "scheduled_prep",
    title: "⏰ Preparation reminder",
    bodySeller: (ref, when) => `Order #${ref} (${when}) — please begin preparation now.`,
    bodyBuyer: (store, when) => `${store} is preparing your scheduled order (${when}).`,
    match: (o, now) => {
      if (!o.preparation_start_at) return false;
      const prep = new Date(o.preparation_start_at);
      const m = minsBetween(prep, now);
      return m <= 20;
    },
  },
  {
    kind: "scheduled_30m",
    title: "🔔 Scheduled order due soon",
    bodySeller: (ref, when) => `Order #${ref} is due in ~30 minutes (${when}).`,
    bodyBuyer: (store, _when) => `Your order from ${store} is coming up soon.`,
    match: (o, now) => {
      if (!o.scheduled_fulfilment_at) return false;
      const fulfil = new Date(o.scheduled_fulfilment_at);
      const m = minsBetween(fulfil, now);
      return m >= 25 && m <= 35;
    },
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  const cronSecret = req.headers.get("x-cron-secret") || "";
  const isService = authHeader === `Bearer ${serviceKey}`;
  const isCron = cronSecret.length >= 32;
  if (!isService && !isCron) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const now = new Date();
  const todayIst = istNow().toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + 72 * 3_600_000).toISOString().slice(0, 10);

  const { data: orders, error } = await supabase
    .from("orders")
    .select(`
      id, buyer_id, seller_id, scheduled_date, scheduled_time_start,
      scheduled_fulfilment_at, preparation_start_at, status, reminder_state,
      seller_profiles!inner(user_id, business_name)
    `)
    .not("scheduled_date", "is", null)
    .gte("scheduled_date", todayIst)
    .lte("scheduled_date", horizon)
    .in("status", ["placed", "pending", "accepted", "confirmed", "scheduled", "requested"]);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let sent = 0;

  for (const raw of orders || []) {
    const o = raw as unknown as OrderRow;
    const ref = o.id.slice(-6).toUpperCase();
    const when = formatWhen(o);
    const store = o.seller_profiles?.business_name || "your store";
    const state = { ...(o.reminder_state || {}) };
    let stateDirty = false;

    for (const w of WINDOWS) {
      if (state[w.kind]) continue;
      if (!w.match(o, now)) continue;

      const type = `seller_${w.kind}`;
      const buyerType = `buyer_${w.kind}`;
      const idempotencySeller = `${o.id}-${w.kind}-seller`;
      const idempotencyBuyer = `${o.id}-${w.kind}-buyer`;

      if (o.seller_profiles?.user_id) {
        await supabase.from("notification_queue").insert({
          user_id: o.seller_profiles.user_id,
          title: w.title,
          body: w.bodySeller(ref, when),
          type,
          reference_path: `/orders/${o.id}`,
          idempotency_key: idempotencySeller,
          payload: {
            type,
            orderId: o.id,
            order_id: o.id,
            target_role: "seller",
            reminder_type: w.kind,
            scheduled_date: o.scheduled_date,
            reference_path: `/orders/${o.id}`,
          },
        });
      }

      await supabase.from("notification_queue").insert({
        user_id: o.buyer_id,
        title: w.title,
        body: w.bodyBuyer(store, when),
        type: buyerType,
        reference_path: `/orders/${o.id}`,
        idempotency_key: idempotencyBuyer,
        payload: {
          type: buyerType,
          orderId: o.id,
          order_id: o.id,
          target_role: "buyer",
          reminder_type: w.kind,
          scheduled_date: o.scheduled_date,
          reference_path: `/orders/${o.id}`,
        },
      });

      state[w.kind] = true;
      stateDirty = true;
      sent++;
    }

    if (stateDirty) {
      await supabase.from("orders").update({ reminder_state: state }).eq("id", o.id);
    }
  }

  return new Response(JSON.stringify({ ok: true, sent, scanned: orders?.length ?? 0 }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
