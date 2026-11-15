import { FunctionsHttpError } from '@supabase/supabase-js';
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

function humanizeVoipError(code: string, raw?: string): string {
  switch (code) {
    case 'busy':
      return 'They are already on a call. Try again in a moment.';
    case 'rate_limited':
    case 'call_rate_limited':
      return 'Too many call attempts on this order. Wait a bit, then try again.';
    case 'disabled':
      return 'In-app calling is not enabled yet.';
    case 'not_callable':
    case 'order_not_callable':
      return 'This order cannot be called right now.';
    case 'not_authorized':
      return 'You cannot place this call.';
    default:
      return raw || 'Could not start call';
  }
}

async function readInvokeErrorPayload(error: unknown, data: unknown) {
  if (data && typeof data === 'object') return data as Record<string, unknown>;
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body && typeof body === 'object') return body as Record<string, unknown>;
    } catch {
      // ignore parse failures
    }
  }
  return null;
}

async function invoke(action: string, body: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('voip-call', {
    body: { action, ...body },
  });
  const payload =
    (data as Record<string, unknown> | null) ||
    (await readInvokeErrorPayload(error, data));

  if (payload?.success === false || (payload?.error && !payload?.call && action === 'start')) {
    const code = String(payload.code || payload.error || 'start_failed');
    const err = new Error(humanizeVoipError(code, String(payload.error || '')));
    (err as any).code = code;
    throw err;
  }

  if (error) {
    const code = String(payload?.code || payload?.error || '');
    if (code) {
      const err = new Error(humanizeVoipError(code, String(payload?.error || error.message)));
      (err as any).code = code;
      throw err;
    }
    throw new Error(
      /non-2xx/i.test(error.message)
        ? 'Call could not start. Please try again.'
        : error.message,
    );
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
