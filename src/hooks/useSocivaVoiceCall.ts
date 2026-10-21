import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { functionInvokeErrorMessage } from '@/lib/function-invoke-error';
import { validateSocivaVoiceLead, type SocivaVoiceLeadInput } from '@/lib/sociva-voice-lead';

export type SocivaVoiceCallStatus =
  | 'idle'
  | 'starting'
  | 'connecting'
  | 'live'
  | 'agent_speaking'
  | 'ended'
  | 'error';

export interface SocivaVoiceCallState {
  status: SocivaVoiceCallStatus;
  muted: boolean;
  error: string | null;
  leadId: string | null;
  callId: string | null;
}

type RetellSession = {
  startCall: (opts: Record<string, unknown>) => Promise<void> | void;
  startAudioPlayback?: () => Promise<void> | void;
  stopCall: () => Promise<void> | void;
  mute: () => void;
  unmute: () => void;
  on: (event: string, handler: (...args: any[]) => void) => void;
};

function retellErrorMessage(err: unknown, fallback: string) {
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  if (err && typeof err === 'object' && 'message' in err) {
    const message = String((err as { message?: unknown }).message || '').trim();
    if (message) return message;
  }
  return fallback;
}

async function askForMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser cannot use the microphone');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
}

export function useSocivaVoiceCall() {
  const clientRef = useRef<RetellSession | null>(null);
  const [state, setState] = useState<SocivaVoiceCallState>({
    status: 'idle',
    muted: false,
    error: null,
    leadId: null,
    callId: null,
  });

  const reset = useCallback(() => {
    setState({
      status: 'idle',
      muted: false,
      error: null,
      leadId: null,
      callId: null,
    });
  }, []);

  const endCall = useCallback(async () => {
    try {
      await clientRef.current?.stopCall();
    } catch {
      /* already ended */
    }
    clientRef.current = null;
    setState((prev) => ({
      ...prev,
      status: prev.status === 'error' ? 'error' : 'ended',
      muted: false,
    }));
  }, []);

  useEffect(() => {
    return () => {
      try {
        clientRef.current?.stopCall();
      } catch {
        /* unmount */
      }
      clientRef.current = null;
    };
  }, []);

  const toggleMute = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    setState((prev) => {
      if (prev.muted) client.unmute();
      else client.mute();
      return { ...prev, muted: !prev.muted };
    });
  }, []);

  const startCall = useCallback(async (input: SocivaVoiceLeadInput) => {
    const parsed = validateSocivaVoiceLead(input);
    if (!parsed.ok || !parsed.value) {
      const first = parsed.errors.full_name || parsed.errors.phone || parsed.errors.society_name || 'Please check your details';
      setState((prev) => ({ ...prev, status: 'error', error: first }));
      return { ok: false as const, errors: parsed.errors };
    }

    try {
      await askForMicrophone();
    } catch {
      const message = 'Please allow the microphone so Sociva can hear you';
      setState((prev) => ({ ...prev, status: 'error', error: message }));
      return { ok: false as const, errors: { form: message } };
    }

    setState({
      status: 'starting',
      muted: false,
      error: null,
      leadId: null,
      callId: null,
    });

    const result = await supabase.functions.invoke('start-sociva-voice-call', {
      body: parsed.value,
    });
    const data = result.data;
    const invokeError = await functionInvokeErrorMessage(result, 'Could not start the call');

    if (result.error || data?.error || !data?.access_token || !data?.call_id) {
      const message = data?.error || invokeError;
      setState((prev) => ({ ...prev, status: 'error', error: message, leadId: data?.lead_id || null }));
      return { ok: false as const, errors: { form: message } };
    }

    try {
      const mod = await import('retell-client-js-sdk');
      const Client = (mod as any).RetellWebClient;
      if (typeof Client !== 'function') {
        throw new Error('Voice SDK is unavailable');
      }
      const client: RetellSession = new Client();
      clientRef.current = client;

      client.on('call_started', () => {
        setState((prev) => ({ ...prev, status: 'live' }));
      });
      client.on('agent_start_talking', () => {
        setState((prev) => ({ ...prev, status: 'agent_speaking' }));
      });
      client.on('agent_stop_talking', () => {
        setState((prev) => ({ ...prev, status: prev.status === 'ended' ? 'ended' : 'live' }));
      });
      client.on('call_ended', () => {
        clientRef.current = null;
        setState((prev) => ({ ...prev, status: 'ended', muted: false }));
      });
      client.on('error', (err: unknown) => {
        const message = retellErrorMessage(err, 'The call could not continue');
        setState((prev) => ({ ...prev, status: 'error', error: message }));
      });

      setState((prev) => ({
        ...prev,
        status: 'connecting',
        leadId: data.lead_id,
        callId: data.call_id,
      }));

      await client.startCall({
        accessToken: data.access_token,
        callId: data.call_id,
        transport: data.transport || 'gateway',
        iceServers: Array.isArray(data.ice_servers) ? data.ice_servers : undefined,
        sampleRate: 24000,
      });
      await client.startAudioPlayback?.();
      return { ok: true as const, errors: {} };
    } catch (err) {
      const message = retellErrorMessage(err, 'Microphone or voice connection failed');
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: message,
        leadId: data.lead_id || null,
        callId: data.call_id || null,
      }));
      return { ok: false as const, errors: { form: message } };
    }
  }, []);

  return { ...state, startCall, endCall, toggleMute, reset };
}
