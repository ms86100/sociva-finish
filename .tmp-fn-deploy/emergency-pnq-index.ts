import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";
import { deliverWhatsAppForQueueItem } from "../_shared/whatsapp-notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: pending, error } = await supabase.rpc("claim_notification_queue", { _batch_size: 50 });
    if (error) throw error;
    if (!pending?.length) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userIds = [...new Set(pending.map((i: any) => i.user_id))];
    const { data: prefRows } = await supabase
      .from("notification_preferences")
      .select("user_id, orders, chat, promotions, whatsapp")
      .in("user_id", userIds);
    const prefMap = new Map((prefRows || []).map((r: any) => [r.user_id, r]));
    const { data: profileRows } = await supabase.from("profiles").select("id, phone, name").in("id", userIds);
    const profileMap = new Map((profileRows || []).map((r: any) => [r.id, r]));

    let processed = 0;
    let skippedPrefs = 0;

    for (const item of pending as any[]) {
      try {
        const userPrefs = prefMap.get(item.user_id) as any;
        const notifType = item.type || item.payload?.type || "order";
        let prefAllowed = true;
        if (userPrefs) {
          const isOrderRelated = notifType === "order" || notifType === "order_status" || notifType === "order_update"
            || notifType.startsWith("delivery_") || notifType.startsWith("booking_");
          if (isOrderRelated && userPrefs.orders === false) prefAllowed = false;
          if (notifType === "chat" && userPrefs.chat === false) prefAllowed = false;
          if ((notifType === "promotion" || notifType === "campaign") && userPrefs.promotions === false) prefAllowed = false;
        }
        if (!prefAllowed) {
          await supabase.from("user_notifications").insert({
            user_id: item.user_id, title: item.title, body: item.body, type: item.type,
            reference_path: item.reference_path, action_url: item.reference_path,
            queue_item_id: item.id, payload: item.payload || null, data: item.payload || null,
          });
          await supabase.from("notification_queue").update({
            status: "processed", processed_at: new Date().toISOString(),
            push_attempted: false, push_skip_reason: "prefs_opt_out",
          }).eq("id", item.id);
          skippedPrefs++;
          processed++;
          continue;
        }

        await supabase.from("user_notifications").insert({
          user_id: item.user_id, title: item.title, body: item.body, type: item.type,
          reference_path: item.reference_path, action_url: item.reference_path,
          queue_item_id: item.id, payload: item.payload || null, data: item.payload || null,
        });

        const profile = profileMap.get(item.user_id) as any;
        try {
          await deliverWhatsAppForQueueItem({
            userId: item.user_id,
            phone: profile?.phone,
            userName: profile?.name,
            type: item.type,
            title: item.title,
            body: item.body,
            payload: item.payload || {},
            whatsappPref: userPrefs?.whatsapp !== false,
            promotionsPref: userPrefs?.promotions === true,
            notificationId: item.id,
          });
        } catch (waErr) {
          console.warn(`[PNQ][${item.id}] WA error`, waErr);
        }

        const silentPush = item.payload?.silent_push === true;
        if (!silentPush) {
          const rawPayload = item.payload || {};
          const pushData: Record<string, string> = {};
          if (rawPayload.action) pushData.action = String(rawPayload.action);
          if (item.reference_path) pushData.reference_path = item.reference_path;
          if (rawPayload.target_role) pushData.target_role = String(rawPayload.target_role);
          const status = String(rawPayload.status || rawPayload.new_status || "");
          if (status) pushData.status = status;
          try {
            await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({
                userId: item.user_id,
                title: item.title,
                body: item.body,
                data: pushData,
                threadId: rawPayload.orderId || rawPayload.order_id || undefined,
                imageUrl: rawPayload.image_url || undefined,
              }),
            });
          } catch (pushErr) {
            console.warn(`[PNQ][${item.id}] push invoke error`, pushErr);
          }
        }

        await supabase.from("notification_queue").update({
          status: "processed",
          processed_at: new Date().toISOString(),
          push_attempted: !silentPush,
          push_skip_reason: silentPush ? "silent" : null,
        }).eq("id", item.id);
        processed++;
      } catch (e) {
        await supabase.from("notification_queue").update({
          status: "failed",
          last_error: String(e),
          processed_at: new Date().toISOString(),
        }).eq("id", item.id);
      }
    }

    return new Response(JSON.stringify({ processed, skipped_prefs: skippedPrefs, total: pending.length, mode: "compact_with_push_fn" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
