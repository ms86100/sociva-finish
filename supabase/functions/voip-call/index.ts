/**
 * Sociva peer VoIP lifecycle edge function.
 * Actions: start | respond | end | heartbeat | dispatch | capabilities | sweep
 * LiveKit JWTs minted when LIVEKIT_* secrets exist.
 * iOS rings via PushKit APNs (topic {bundle}.voip); Android via high-pri FCM queue.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";
import { livekitConfigured, mintLiveKitParticipantToken } from "./livekit.ts";
import { apnsVoipConfigured, sendApnsVoipPush } from "./apnsVoip.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";

  const userClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(supabaseUrl, service);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const action = String(body.action || "");

  if (action === "sweep") {
    const key = req.headers.get("x-voip-cron-key") || "";
    if (!key || key !== (Deno.env.get("VOIP_CRON_KEY") || "disabled")) {
      return json(401, { error: "Unauthorized" });
    }
    const { data, error } = await admin.rpc("voip_sweep_missed_rings", {
      p_timeout_seconds: Number(body.timeout_seconds || 30),
    });
    if (error) return json(500, { error: error.message });
    return json(200, { success: true, missed: data });
  }

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json(401, { error: "Not authenticated" });
  const userId = userData.user.id;

  if (action === "capabilities") {
    const { data, error } = await userClient.rpc("voip_runtime_capabilities");
    if (error) return json(400, { error: error.message });
    return json(200, {
      success: true,
      capabilities: data,
      livekit_env_present: livekitConfigured(),
      apns_voip_env_present: apnsVoipConfigured(),
    });
  }

  if (action === "start") {
    const contextType = String(body.context_type || "");
    const contextId = String(body.context_id || "");
    const idem = body.idempotency_key ? String(body.idempotency_key) : null;
    const { data, error } = await userClient.rpc("voip_start_call", {
      p_context_type: contextType,
      p_context_id: contextId,
      p_idempotency_key: idem,
    });
    if (error) {
      const msg = error.message || "start failed";
      const code = /busy/i.test(msg)
        ? "busy"
        : /not enabled/i.test(msg)
        ? "disabled"
        : "start_failed";
      return json(400, { success: false, code, error: msg });
    }

    const call = (data as any)?.call;
    let dispatch: Record<string, unknown> = { attempted: false };
    if (call?.id && call?.callee_id) {
      dispatch = await dispatchIncoming(admin, call, userId);
      await admin
        .from("call_sessions")
        .update({ dispatch_evidence: dispatch, updated_at: new Date().toISOString() })
        .eq("id", call.id);
    }

    return json(200, {
      success: true,
      ...((data as object) || {}),
      dispatch,
      livekit: null,
      note: "Caller LiveKit token is minted after callee accepts",
    });
  }

  if (action === "respond") {
    const callId = String(body.call_id || "");
    const accept = !!body.accept;
    const { data, error } = await userClient.rpc("voip_respond_call", {
      p_call_id: callId,
      p_accept: accept,
    });
    if (error) return json(400, { success: false, error: error.message });

    const call = (data as any)?.call;
    let livekit: Record<string, unknown> | null = null;
    if (accept && call?.livekit_room) {
      const callerTok = await mintLiveKitParticipantToken({
        room: call.livekit_room,
        identity: call.caller_id,
      });
      const calleeTok = await mintLiveKitParticipantToken({
        room: call.livekit_room,
        identity: call.callee_id,
      });
      if (!callerTok || !calleeTok) {
        return json(200, {
          success: true,
          ...((data as object) || {}),
          livekit: null,
          code: "livekit_not_configured",
          error: "Call accepted but LiveKit secrets are not configured yet",
        });
      }
      livekit = {
        url: callerTok.url,
        caller_token: callerTok.token,
        callee_token: calleeTok.token,
        room: call.livekit_room,
      };
    }
    return json(200, { success: true, ...((data as object) || {}), livekit });
  }

  if (action === "heartbeat") {
    const { data, error } = await userClient.rpc("voip_heartbeat", {
      p_call_id: String(body.call_id || ""),
      p_media_up: !!body.media_up,
    });
    if (error) return json(400, { success: false, error: error.message });
    return json(200, { success: true, ...((data as object) || {}) });
  }

  if (action === "end") {
    const { data, error } = await userClient.rpc("voip_end_call", {
      p_call_id: String(body.call_id || ""),
      p_reason: String(body.reason || "ended"),
    });
    if (error) return json(400, { success: false, error: error.message });
    return json(200, { success: true, ...((data as object) || {}) });
  }

  if (action === "dispatch") {
    const callId = String(body.call_id || "");
    const { data: call, error } = await admin
      .from("call_sessions")
      .select("*")
      .eq("id", callId)
      .maybeSingle();
    if (error || !call) return json(404, { error: "Call not found" });
    if (call.caller_id !== userId && call.callee_id !== userId) {
      return json(403, { error: "Not a participant" });
    }
    const dispatch = await dispatchIncoming(admin, call, call.caller_id);
    await admin
      .from("call_sessions")
      .update({ dispatch_evidence: dispatch, updated_at: new Date().toISOString() })
      .eq("id", callId);
    return json(200, { success: true, dispatch });
  }

  if (action === "join") {
    const callId = String(body.call_id || "");
    const { data: call, error } = await admin
      .from("call_sessions")
      .select("*")
      .eq("id", callId)
      .maybeSingle();
    if (error || !call) return json(404, { error: "Call not found" });
    if (call.caller_id !== userId && call.callee_id !== userId) {
      return json(403, { error: "Not a participant" });
    }
    if (!["active", "ringing", "accepted"].includes(String(call.status))) {
      return json(400, { error: `Call not joinable (${call.status})` });
    }
    if (!call.livekit_room) {
      return json(400, { error: "No LiveKit room on call" });
    }
    const minted = await mintLiveKitParticipantToken({
      room: call.livekit_room,
      identity: userId,
    });
    if (!minted) {
      return json(200, {
        success: false,
        code: "livekit_not_configured",
        error: "LiveKit secrets missing",
      });
    }
    return json(200, {
      success: true,
      call,
      livekit: { url: minted.url, token: minted.token, room: call.livekit_room },
    });
  }

  return json(400, { error: `Unknown action: ${action}` });
});

async function resolveCallerName(admin: any, callerId: string): Promise<string> {
  try {
    const { data } = await admin
      .from("profiles")
      .select("name")
      .eq("id", callerId)
      .maybeSingle();
    const name = String(data?.name || "").trim();
    return name || "Sociva";
  } catch {
    return "Sociva";
  }
}

async function dispatchIncoming(
  admin: any,
  call: any,
  callerId: string,
): Promise<Record<string, unknown>> {
  const { data: tokens } = await admin
    .from("device_tokens")
    .select("token, platform, voip_token, voip_platform, apns_token")
    .eq("user_id", call.callee_id)
    .eq("invalid", false)
    .limit(20);

  const rows = Array.isArray(tokens) ? tokens : [];
  const callerName = await resolveCallerName(admin, callerId || call.caller_id);
  const evidence: Record<string, unknown> = {
    attempted: true,
    at: new Date().toISOString(),
    token_count: rows.length,
    voip_token_count: rows.filter((t: any) => !!t.voip_token).length,
    channels: [] as string[],
    ios_voip_results: [] as unknown[],
    apns_voip_configured: apnsVoipConfigured(),
    note: "iOS PushKit via APNs .voip topic; Android FCM data via notification_queue",
  };

  const seenVoip = new Set<string>();
  for (const row of rows) {
    const voipTok = String(row.voip_token || "").trim();
    if (!voipTok) continue;
    if (seenVoip.has(voipTok)) continue;
    seenVoip.add(voipTok);

    const platform = String(row.voip_platform || row.platform || "").toLowerCase();
    const isIos =
      platform.includes("ios") ||
      platform.includes("pushkit") ||
      platform === "apple";

    if (isIos || (!platform && voipTok.length >= 64 && !voipTok.includes(":"))) {
      (evidence.channels as string[]).push("ios_pushkit");
      const result = await sendApnsVoipPush(voipTok, {
        call_id: call.id,
        caller_name: callerName,
        context_type: call.context_type,
        context_id: call.context_id,
        livekit_room: call.livekit_room,
      });
      (evidence.ios_voip_results as unknown[]).push({
        ok: result.success,
        error: result.error || null,
        topic: result.topic || null,
      });
      if (result.error === "INVALID_TOKEN") {
        await admin
          .from("device_tokens")
          .update({ voip_token: null, voip_token_updated_at: null })
          .eq("voip_token", voipTok);
      }
    }
  }

  for (const row of rows) {
    if (row.platform === "android" && row.token) {
      (evidence.channels as string[]).push("android_fcm_data");
      try {
        await admin.from("notification_queue").insert({
          user_id: call.callee_id,
          type: "voip_incoming",
          title: "Incoming Sociva call",
          body: `${callerName} is calling`,
          reference_path: `/call/${call.id}`,
          action_url: `/call/${call.id}`,
          payload: {
            type: "voip_incoming",
            call_id: call.id,
            caller_name: callerName,
            context_type: call.context_type,
            context_id: call.context_id,
            livekit_room: call.livekit_room,
          },
          status: "pending",
          idempotency_key: `voip_incoming:${call.id}`,
        });
      } catch {
        // Non-fatal
      }
      break;
    }
  }

  if ((evidence.voip_token_count as number) === 0) {
    evidence.fallback = "in_app_or_tel";
  }
  return evidence;
}
