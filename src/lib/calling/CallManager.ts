import { supabase } from '@/integrations/supabase/client';
import type { VoipContextType } from '@/lib/calling/resolveCallContext';

export type VoipCapabilities = {
  enabled: boolean;
  livekit_configured: boolean;
  apple_voip_push_configured: boolean;
  android_voip_push_configured: boolean;
  can_place_calls: boolean;
};

export type CallSession = {
  id: string;
  caller_id: string;
  callee_id: string;
  context_type: string;
  context_id: string;
  status: string;
  livekit_room?: string | null;
};

async function invoke(action: string, body: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('voip-call', {
    body: { action, ...body },
  });
  if (error) throw error;
  if (data?.error && data?.success === false) {
    const err = new Error(data.error);
    (err as any).code = data.code;
    throw err;
  }
  return data;
}

export async function fetchVoipCapabilities(): Promise<VoipCapabilities> {
  try {
    const { data, error } = await supabase.rpc('voip_runtime_capabilities');
    if (error) throw error;
    return data as VoipCapabilities;
  } catch {
    return {
      enabled: false,
      livekit_configured: false,
      apple_voip_push_configured: false,
      android_voip_push_configured: true,
      can_place_calls: false,
    };
  }
}

export async function startVoipCall(input: {
  contextType: VoipContextType;
  contextId: string;
  idempotencyKey?: string;
}) {
  return invoke('start', {
    context_type: input.contextType,
    context_id: input.contextId,
    idempotency_key: input.idempotencyKey || null,
  });
}

export async function respondVoipCall(callId: string, accept: boolean) {
  return invoke('respond', { call_id: callId, accept });
}

export async function heartbeatVoipCall(callId: string, mediaUp: boolean) {
  return invoke('heartbeat', { call_id: callId, media_up: mediaUp });
}

export async function endVoipCall(callId: string, reason = 'ended') {
  return invoke('end', { call_id: callId, reason });
}

export async function claimVoipToken(
  voipToken: string,
  platform: 'ios_pushkit' | 'android_fcm',
  alertToken?: string | null,
) {
  const { data, error } = await supabase.rpc('claim_voip_token', {
    p_voip_token: voipToken,
    p_voip_platform: platform,
    p_alert_token: alertToken ?? null,
  });
  if (error) throw error;
  return Boolean(data);
}
