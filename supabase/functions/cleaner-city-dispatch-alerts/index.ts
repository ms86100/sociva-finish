import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, authorization",
};

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function setting(key: string): Promise<string> {
  const { data } = await admin()
    .from("admin_settings")
    .select("value, is_active")
    .eq("key", key)
    .maybeSingle();
  if (!data || data.is_active === false) return "";
  return String(data.value || "");
}

async function mark(id: string, status: string, error: string | null, attempts: number) {
  await admin()
    .from("cleaner_city_outbound_alerts")
    .update({
      status,
      last_error: error,
      attempts,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

async function sendSms(phone: string, body: string) {
  const authKey = (await setting("msg91_auth_key")) || Deno.env.get("MSG91_AUTH_KEY") || "";
  const template = (await setting("msg91_sos_template_id")) || Deno.env.get("MSG91_SOS_TEMPLATE_ID") || "";
  if (!authKey || !template) {
    return { ok: false, error: "sms_provider_not_configured" };
  }
  const mobiles = phone.replace(/[^0-9]/g, "");
  const res = await fetch("https://control.msg91.com/api/v5/flow/", {
    method: "POST",
    headers: { authkey: authKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      template_id: template,
      recipients: [{ mobiles, var: body.slice(0, 120) }],
    }),
  });
  if (!res.ok) return { ok: false, error: `sms_http_${res.status}` };
  return { ok: true, error: null };
}

async function sendWhatsapp(phone: string, body: string) {
  const token = (await setting("whatsapp_access_token")) || Deno.env.get("WHATSAPP_ACCESS_TOKEN") || "";
  const phoneId = (await setting("whatsapp_phone_number_id")) || Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";
  if (!token || !phoneId) return { ok: false, error: "whatsapp_provider_not_configured" };
  const to = phone.replace(/[^0-9]/g, "");
  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: body.slice(0, 400) },
    }),
  });
  if (!res.ok) return { ok: false, error: `whatsapp_http_${res.status}` };
  return { ok: true, error: null };
}

async function sendCall(callerPhone: string, otherPhone: string) {
  const sid = (await setting("twilio_account_sid")) || Deno.env.get("TWILIO_ACCOUNT_SID") || "";
  const token = (await setting("twilio_auth_token")) || Deno.env.get("TWILIO_AUTH_TOKEN") || "";
  const from = (await setting("twilio_phone_number")) || Deno.env.get("TWILIO_PHONE_NUMBER") || "";
  if (!sid || !token || !from) return { ok: false, error: "call_provider_not_configured" };
  const twiml = `<Response><Say>Connecting your Cleaner City ride.</Say><Dial>${otherPhone}</Dial></Response>`;
  const body = new URLSearchParams({ From: from, To: callerPhone, Twiml: twiml });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) return { ok: false, error: `call_http_${res.status}` };
  return { ok: true, error: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await admin().auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const payload = await req.json().catch(() => ({}));
    let query = admin()
      .from("cleaner_city_outbound_alerts")
      .select("id, user_id, channel, destination_phone, body, attempts, status")
      .eq("user_id", userData.user.id)
      .in("status", ["pending", "failed"])
      .lt("attempts", 3)
      .order("created_at", { ascending: true })
      .limit(10);
    if (payload.alert_id) query = query.eq("id", payload.alert_id);
    const { data: rows, error } = await query;
    if (error) throw error;

    let sent = 0;
    let failed = 0;
    const seen = new Set<string>();
    const deliver = async (row: {
      id: string;
      channel: string;
      destination_phone: string;
      body: string;
      attempts: number;
    }) => {
      if (seen.has(row.id)) return;
      seen.add(row.id);
      const nextAttempts = Number(row.attempts || 0) + 1;
      let result = { ok: false, error: "unsupported_channel" };
      if (row.channel === "sms") result = await sendSms(row.destination_phone, row.body);
      if (row.channel === "whatsapp") result = await sendWhatsapp(row.destination_phone, row.body);
      if (row.channel === "call") result = await sendCall(row.destination_phone, row.body);
      if (!result.ok && (row.channel === "sms" || row.channel === "whatsapp")) {
        await admin().rpc("cleaner_city_escalate_outbound_alert", { p_alert_id: row.id });
      }
      if (result.ok) {
        await mark(row.id, "sent", null, nextAttempts);
        sent += 1;
      } else if (nextAttempts >= 3) {
        await mark(row.id, "failed", result.error, nextAttempts);
        failed += 1;
      } else {
        await mark(row.id, "pending", result.error, nextAttempts);
        failed += 1;
      }
    };
    for (const row of rows || []) await deliver(row);
    const { data: fallbacks } = await admin()
      .from("cleaner_city_outbound_alerts")
      .select("id, user_id, channel, destination_phone, body, attempts, status")
      .eq("user_id", userData.user.id)
      .eq("channel", "whatsapp")
      .eq("status", "pending")
      .eq("attempts", 0)
      .limit(5);
    for (const row of fallbacks || []) await deliver(row);
    return new Response(JSON.stringify({ sent, failed, queued: (rows || []).length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Dispatch failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
