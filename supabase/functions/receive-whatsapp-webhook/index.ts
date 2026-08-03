import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { loadWhatsAppCredentials, logWhatsAppMessage } from "../_shared/whatsapp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Meta webhook verification (GET)
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const { verifyToken } = await loadWhatsAppCredentials();

    if (mode === "subscribe" && token && verifyToken && token === verifyToken) {
      console.log("[receive-whatsapp-webhook] verified");
      return new Response(challenge || "", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    console.warn("[receive-whatsapp-webhook] verify failed", { mode, hasToken: !!token });
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const payload = await req.json();
    console.log("[receive-whatsapp-webhook] inbound", JSON.stringify(payload).slice(0, 2000));

    const entries = payload?.entry || [];
    for (const entry of entries) {
      const changes = entry?.changes || [];
      for (const change of changes) {
        const value = change?.value;
        const messages = value?.messages || [];
        for (const msg of messages) {
          const phone = String(msg.from || "").replace(/\D/g, "");
          const text =
            msg.text?.body ||
            msg.button?.text ||
            msg.interactive?.button_reply?.title ||
            msg.type ||
            null;
          await logWhatsAppMessage({
            direction: "inbound",
            phone: phone || "unknown",
            message: text,
            meta_message_id: msg.id || null,
            status: "received",
            meta_payload: { msg, metadata: value?.metadata },
          });
        }

        const statuses = value?.statuses || [];
        for (const st of statuses) {
          const phone = String(st.recipient_id || "").replace(/\D/g, "");
          await logWhatsAppMessage({
            direction: "outbound",
            phone: phone || "unknown",
            message: null,
            meta_message_id: st.id || null,
            status: st.status === "delivered" || st.status === "read" || st.status === "sent"
              ? st.status
              : st.status === "failed"
              ? "failed"
              : "unknown",
            error_code: st.errors?.[0]?.code ? String(st.errors[0].code) : null,
            error_message: st.errors?.[0]?.title || st.errors?.[0]?.message || null,
            meta_payload: st,
          });
        }
      }
    }

    // Meta requires 200 quickly
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[receive-whatsapp-webhook]", e);
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
