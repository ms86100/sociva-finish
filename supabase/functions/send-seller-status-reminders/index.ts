import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const REMINDER_INTERVAL_MIN = 5;
const TYPE = "seller_order_status_reminder";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") || "";
  const isService = authHeader === `Bearer ${serviceKey}`;
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

  try {
    const supabase = createClient(supabaseUrl, serviceKey);
    const cutoff = new Date(Date.now() - REMINDER_INTERVAL_MIN * 60_000).toISOString();
    const bucket = Math.floor(Date.now() / (REMINDER_INTERVAL_MIN * 60_000));

    const { data: stuckOrders, error } = await supabase
      .from("orders")
      .select(`
        id,
        status,
        total_amount,
        seller_id,
        scheduled_date,
        scheduled_fulfillment_at,
        preparation_start_at,
        status_changed_at,
        updated_at,
        seller_profiles!inner(user_id, business_name)
      `)
      .eq("status", "accepted")
      .lte("status_changed_at", cutoff)
      .limit(100);

    if (error) {
      console.error("[StatusReminder] query failed:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let enqueued = 0;
    let skipped = 0;

    for (const row of stuckOrders || []) {
      const sellerUserId = (row as any).seller_profiles?.user_id as string | undefined;
      if (!sellerUserId) {
        skipped++;
        continue;
      }

      // Skip future scheduled orders — they are not due for fulfilment yet
      const scheduledDate = (row as any).scheduled_date as string | null;
      const prepStart = (row as any).preparation_start_at as string | null;
      if (scheduledDate) {
        const todayIst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
        if (scheduledDate > todayIst) {
          skipped++;
          continue;
        }
        if (prepStart && new Date(prepStart).getTime() > Date.now()) {
          skipped++;
          continue;
        }
      }

      const orderId = row.id as string;
      const orderRef = orderId.slice(-6).toUpperCase();
      const idempotencyKey = `${orderId}-status_reminder-${bucket}`;

      const { data: items } = await supabase
        .from("order_items")
        .select("quantity, products(name)")
        .eq("order_id", orderId)
        .limit(3);

      const itemLine = (items || [])
        .map((i: any) => `${i.quantity}x ${i.products?.name || "Item"}`)
        .join(", ");

      const storeName = (row as any).seller_profiles?.business_name || "your store";
      const title = "⏰ Update order status";
      const body = itemLine
        ? `Order #${orderRef} (${itemLine}) is still Accepted — tap to mark Preparing or advance.`
        : `Order #${orderRef} is still Accepted — tap to mark Preparing or advance the status.`;

      const { error: insErr } = await supabase.from("notification_queue").insert({
        user_id: sellerUserId,
        title,
        body,
        type: TYPE,
        reference_path: `/orders/${orderId}`,
        idempotency_key: idempotencyKey,
        payload: {
          type: TYPE,
          orderId,
          order_id: orderId,
          status: "accepted",
          target_role: "seller",
          high_priority: true,
          reminder_type: "status_nudge",
          action: "view_order",
          reference_path: `/orders/${orderId}`,
          item_summary: itemLine || null,
          seller_business_name: storeName,
        },
      });

      if (insErr) {
        if (insErr.code === "23505") {
          skipped++;
          continue;
        }
        console.warn("[StatusReminder] enqueue failed:", orderId, insErr.message);
        skipped++;
        continue;
      }

      enqueued++;
    }

    console.log(`[StatusReminder] done enqueued=${enqueued} skipped=${skipped} scanned=${stuckOrders?.length ?? 0}`);

    return new Response(
      JSON.stringify({
        ok: true,
        scanned: stuckOrders?.length ?? 0,
        enqueued,
        skipped,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[StatusReminder] fatal:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
