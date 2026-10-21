import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";
import { createRetellWebCall, getRetellAgentId, getRetellApiKey } from "../_shared/retell.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_PER_PHONE_PER_HOUR = 3;
const MAX_PER_IP_PER_HOUR = 8;

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeIndianPhone(input: string): string {
  const digits = String(input || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

function clipText(value: string, max: number): string {
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  const first = forwarded.split(",")[0]?.trim();
  return first || req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown";
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return json(400, { error: "Invalid JSON" });
    }

    const full_name = clipText(String(payload?.full_name || ""), 80);
    const society_name = clipText(String(payload?.society_name || ""), 120);
    const phone = normalizeIndianPhone(String(payload?.phone || ""));

    if (full_name.length < 2) return json(400, { error: "Please enter your name", field: "full_name" });
    if (!/^[6-9]\d{9}$/.test(phone)) {
      return json(400, { error: "Enter a valid 10-digit mobile number", field: "phone" });
    }
    if (society_name.length < 2) {
      return json(400, { error: "Please enter your society name", field: "society_name" });
    }

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: phoneCount, error: phoneCountErr } = await supabase
      .from("seller_interest_leads")
      .select("id", { count: "exact", head: true })
      .eq("phone", phone)
      .gte("created_at", since);
    if (phoneCountErr) {
      console.error("[start-sociva-voice-call] phone rate count failed", phoneCountErr.message);
      return json(500, { error: "Could not start the call" });
    }
    if ((phoneCount || 0) >= MAX_PER_PHONE_PER_HOUR) {
      return json(429, { error: "Please wait before starting another call with this number" });
    }

    const ip = clientIp(req);
    const ipHash = await sha256Hex(`sociva-voice:${ip}`);
    const { count: ipCount, error: ipCountErr } = await supabase
      .from("seller_interest_leads")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", since);
    if (ipCountErr) {
      console.error("[start-sociva-voice-call] ip rate count failed", ipCountErr.message);
      return json(500, { error: "Could not start the call" });
    }
    if ((ipCount || 0) >= MAX_PER_IP_PER_HOUR) {
      return json(429, { error: "Please wait before starting another call" });
    }

    let society_id: string | null = null;
    const { data: societies } = await supabase
      .from("societies")
      .select("id")
      .ilike("name", society_name)
      .limit(1);
    if (societies?.[0]?.id) society_id = societies[0].id;

    const { data: lead, error: insertErr } = await supabase
      .from("seller_interest_leads")
      .insert({
        full_name,
        phone,
        society_name,
        society_id,
        status: "new",
        ip_hash: ipHash,
      })
      .select("id")
      .single();

    if (insertErr || !lead?.id) {
      console.error("[start-sociva-voice-call] insert failed", insertErr?.message);
      return json(500, { error: "Could not save your details" });
    }

    const apiKey = await getRetellApiKey(supabase);
    const agentId = await getRetellAgentId(supabase);
    if (!apiKey || !agentId) {
      console.error("[start-sociva-voice-call] Retell credentials missing");
      return json(503, {
        error: "Voice assistant is not configured yet. Please try again later.",
        lead_id: lead.id,
      });
    }

    try {
      const call = await createRetellWebCall({
        apiKey,
        agentId,
        leadId: lead.id,
        sellerName: full_name,
        sellerPhone: phone,
        societyName: society_name,
      });

      const { error: updateErr } = await supabase
        .from("seller_interest_leads")
        .update({ retell_call_id: call.call_id })
        .eq("id", lead.id);
      if (updateErr) {
        console.error("[start-sociva-voice-call] call id stamp failed", updateErr.message);
      }

      return json(200, {
        lead_id: lead.id,
        call_id: call.call_id,
        access_token: call.access_token,
      });
    } catch (err) {
      console.error("[start-sociva-voice-call] Retell create failed", (err as Error)?.message || err);
      return json(502, {
        error: "Could not connect to the voice assistant. Please try again.",
        lead_id: lead.id,
      });
    }
  } catch (err) {
    console.error("[start-sociva-voice-call] unexpected", (err as Error)?.message || err);
    return json(500, { error: "Could not start the call" });
  }
});
